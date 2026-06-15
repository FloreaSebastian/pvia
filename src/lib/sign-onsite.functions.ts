/**
 * Onsite signature OTP flow.
 *
 * When a PV is signed on-site (entreprise + client on the same device), the
 * client confirms their identity with a 6-digit OTP sent by email before the
 * PV is locked as `signe`. Delegates persistence to `signature-otp.server.ts`.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendOnsiteOtpEmail } from "./email.server";
import { writeAuditLog } from "./audit.server";
import { enforceRateLimit } from "./rate-limit.server";
import {
  createSignatureOtp,
  verifySignatureOtp,
  maskEmail,
} from "./signature-otp.server";

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

    const { id: otpId, code, expiresAt } = await createSignatureOtp({
      companyId: data.companyId,
      pvId: data.pvId ?? null,
      email: data.email,
      mode: "onsite",
    });

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
      metadata: { email_masked: maskEmail(data.email) },
      actor: "user",
    });

    return { ok: true, otpId, expiresAt };
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

    // Pre-check membership against the OTP's company before verification.
    const { data: otpHead } = await supabaseAdmin
      .from("pv_signature_otps")
      .select("company_id")
      .eq("id", data.otpId)
      .maybeSingle();
    if (!otpHead) throw new Error("Code introuvable.");

    const { data: m } = await supabaseAdmin
      .from("company_members")
      .select("id")
      .eq("company_id", otpHead.company_id)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (!m) throw new Error("Accès refusé.");

    const otp = await verifySignatureOtp({
      otpId: data.otpId,
      code: data.code,
      expectedMode: "onsite",
    });

    await writeAuditLog({
      companyId: otp.company_id,
      userId,
      pvId: otp.pv_id ?? undefined,
      entityType: "pv",
      action: "pv.onsite_otp_verified",
      metadata: { email_masked: maskEmail(otp.email) },
      actor: "user",
    });

    return { ok: true, otpId: otp.id, email: otp.email };
  });
