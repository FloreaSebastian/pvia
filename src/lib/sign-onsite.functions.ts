/**
 * Onsite signature OTP flow.
 *
 * When a PV is signed on-site (both entreprise + client physically present
 * on the same device), the client must additionally confirm their identity
 * with a 6-digit OTP sent by email before the PV is locked as `signe`.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendOnsiteOtpEmail } from "./email.server";
import { writeAuditLog } from "./audit.server";
import { enforceRateLimit, getClientIp } from "./rate-limit.server";
import { sha256Hex, generateNumericCode, normalizeEmail, getClientUA } from "./client-auth.server";

const SendSchema = z.object({
  companyId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email().max(255),
  pvId: z.string().uuid().nullable().optional(),
});

export const sendOnsiteClientOtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => SendSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;

    // Membership check
    const { data: m } = await supabaseAdmin
      .from("company_members")
      .select("id")
      .eq("company_id", data.companyId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (!m) throw new Error("Accès refusé.");

    await enforceRateLimit({
      bucket: "onsite.otp.send",
      key: `${data.companyId}:${data.email}`,
      limit: 5,
      windowSec: 600,
    });

    const code = generateNumericCode();
    const codeHash = await sha256Hex(code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const ip = getClientIp(getRequest());
    const ua = getClientUA();

    const { data: ins, error } = await supabaseAdmin
      .from("pv_onsite_otp")
      .insert({
        company_id: data.companyId,
        pv_id: data.pvId ?? null,
        email: normalizeEmail(data.email),
        code_hash: codeHash,
        expires_at: expiresAt,
        ip_address: ip,
        user_agent: ua,
      })
      .select("id")
      .single();
    if (error || !ins) throw new Error(`OTP : ${error?.message ?? "inconnue"}`);

    const { data: company } = await supabaseAdmin
      .from("companies").select("name").eq("id", data.companyId).maybeSingle();

    await sendOnsiteOtpEmail({
      to: data.email,
      code,
      companyName: company?.name ?? "PVIA",
      companyId: data.companyId,
    });

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      pvId: data.pvId ?? undefined,
      entityType: "pv",
      action: "pv.onsite_otp_sent",
      metadata: { email: data.email },
      actor: "user",
    });

    return { ok: true, otpId: ins.id, expiresAt };
  });

const VerifySchema = z.object({
  otpId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/),
});

export const verifyOnsiteClientOtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => VerifySchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;

    const { data: otp } = await supabaseAdmin
      .from("pv_onsite_otp")
      .select("*")
      .eq("id", data.otpId)
      .maybeSingle();
    if (!otp) throw new Error("Code introuvable.");

    // Membership check
    const { data: m } = await supabaseAdmin
      .from("company_members")
      .select("id")
      .eq("company_id", otp.company_id)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (!m) throw new Error("Accès refusé.");

    if (otp.used_at) throw new Error("Code déjà utilisé.");
    if (new Date(otp.expires_at) < new Date()) throw new Error("Code expiré. Renvoyez un nouveau code.");
    if ((otp.attempts ?? 0) >= 5) throw new Error("Trop de tentatives. Renvoyez un nouveau code.");

    const codeHash = await sha256Hex(data.code);
    if (codeHash !== otp.code_hash) {
      await supabaseAdmin
        .from("pv_onsite_otp")
        .update({ attempts: (otp.attempts ?? 0) + 1 })
        .eq("id", otp.id);
      throw new Error("Code invalide.");
    }

    await supabaseAdmin
      .from("pv_onsite_otp")
      .update({ used_at: new Date().toISOString() })
      .eq("id", otp.id);

    await writeAuditLog({
      companyId: otp.company_id,
      userId,
      pvId: otp.pv_id ?? undefined,
      entityType: "pv",
      action: "pv.onsite_otp_verified",
      metadata: { email: otp.email },
      actor: "user",
    });

    return { ok: true, otpId: otp.id, email: otp.email };
  });
