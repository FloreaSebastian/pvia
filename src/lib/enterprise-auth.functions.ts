import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAuditLog } from "@/lib/audit.server";
import { enforceRateLimit } from "@/lib/rate-limit.server";
import {
  describeUA,
  generateNumericCode,
  getClientIp,
  getClientUA,
  normalizeEmail,
  sha256Hex,
  timingSafeEqual,
} from "@/lib/client-auth.server";
import { sendEnterpriseLoginCodeEmail } from "@/lib/email.server";

const LoginCodeSchema = z.object({
  email: z.string().email().max(255),
});

const VerifyCodeSchema = z.object({
  email: z.string().email().max(255),
  code: z.string().regex(/^\d{6}$/, "Code à 6 chiffres requis"),
});

const CODE_TTL_SEC = 60 * 10; // 10 minutes
const MAX_ATTEMPTS = 5;

async function findAuthUserByEmail(email: string) {
  const pageSize = 1000;
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: pageSize });
    if (error) throw error;
    const user = data.users.find((u) => u.email?.toLowerCase() === email);
    if (user) return user;
    if (data.users.length < pageSize) break;
  }
  return null;
}

export const sendEnterpriseLoginCode = createServerFn({ method: "POST" })
  .inputValidator((d) => LoginCodeSchema.parse(d))
  .handler(async ({ data }) => {
    const email = normalizeEmail(data.email);
    const ip = getClientIp() ?? "unknown";
    const ua = getClientUA();

    await enforceRateLimit({ bucket: "enterprise_login_send_email", key: email, limit: 3, windowSec: 900 });
    await enforceRateLimit({ bucket: "enterprise_login_send_ip", key: ip, limit: 10, windowSec: 3600 });

    const user = await findAuthUserByEmail(email);
    if (!user) {
      await writeAuditLog({
        companyId: null,
        userId: null,
        entityType: "auth",
        action: "user.login_failed",
        metadata: { email, reason: "unknown_enterprise_email", ip },
      });
      throw new Error("Aucun compte entreprise associé à cet email.");
    }

    const { data: membership } = await supabaseAdmin
      .from("company_members")
      .select("company_id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    if (!membership?.company_id) {
      await writeAuditLog({
        companyId: null,
        userId: user.id,
        entityType: "auth",
        action: "user.login_failed",
        metadata: { email, reason: "not_active_enterprise_member", ip },
      });
      throw new Error("Ce compte n'est pas actif dans un espace entreprise PVIA.");
    }

    const appUrl = process.env.PUBLIC_APP_URL?.replace(/\/$/, "") || "https://pvia.fr";
    const { data: linkData, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: `${appUrl}/verify?email=${encodeURIComponent(email)}` },
    });

    const tokenHash = linkData?.properties?.hashed_token;
    if (error || !tokenHash) {
      await writeAuditLog({
        companyId: membership.company_id,
        userId: user.id,
        entityType: "auth",
        action: "user.login_failed",
        metadata: { email, reason: "magiclink_generation_failed", error: error?.message, ip },
      });
      throw new Error("Impossible de générer le code de connexion.");
    }

    // Generate our own 6-digit code (single source of truth) and bind it to
    // the Supabase magic-link hashed_token. The Supabase-native OTP
    // (`email_otp`, length depends on project setting) is intentionally
    // discarded — we only use the hashed_token at verification time.
    const code = generateNumericCode();
    const codeHash = await sha256Hex(code);
    const expiresAt = new Date(Date.now() + CODE_TTL_SEC * 1000).toISOString();

    // Invalidate previous unused codes for this email.
    await supabaseAdmin
      .from("enterprise_auth_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("email", email)
      .is("used_at", null);

    const { error: insErr } = await supabaseAdmin.from("enterprise_auth_codes").insert({
      email,
      code_hash: codeHash,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });
    if (insErr) {
      await writeAuditLog({
        companyId: membership.company_id,
        userId: user.id,
        entityType: "auth",
        action: "user.login_failed",
        metadata: { email, reason: "code_persist_failed", error: insErr.message, ip },
      });
      throw new Error("Impossible d'enregistrer le code de connexion.");
    }

    await sendEnterpriseLoginCodeEmail({
      to: email,
      code,
      ip,
      device: describeUA(ua),
      companyId: membership.company_id,
    });

    await writeAuditLog({
      companyId: membership.company_id,
      userId: user.id,
      entityType: "auth",
      action: "user.login_code_sent",
      metadata: { email, method: "enterprise_otp_6digits", ip },
    });

    return { ok: true as const };
  });

/**
 * Verifies the 6-digit code and returns the Supabase magic-link `token_hash`
 * so the client can exchange it for a session via
 * `supabase.auth.verifyOtp({ type: 'magiclink', token_hash })`.
 */
export const verifyEnterpriseLoginCode = createServerFn({ method: "POST" })
  .inputValidator((d) => VerifyCodeSchema.parse(d))
  .handler(async ({ data }) => {
    const email = normalizeEmail(data.email);
    const ip = getClientIp() ?? "unknown";

    await enforceRateLimit({ bucket: "enterprise_login_verify_email", key: email, limit: 10, windowSec: 900 });
    await enforceRateLimit({ bucket: "enterprise_login_verify_ip", key: ip, limit: 30, windowSec: 900 });

    const { data: row, error } = await supabaseAdmin
      .from("enterprise_auth_codes")
      .select("id, code_hash, token_hash, expires_at, attempts, used_at")
      .eq("email", email)
      .is("used_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !row) {
      throw new Error("Code invalide ou expiré.");
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      throw new Error("Code expiré. Demandez-en un nouveau.");
    }
    if ((row.attempts ?? 0) >= MAX_ATTEMPTS) {
      throw new Error("Trop de tentatives. Demandez un nouveau code.");
    }

    const hash = await sha256Hex(data.code);
    if (!timingSafeEqual(hash, row.code_hash)) {
      await supabaseAdmin
        .from("enterprise_auth_codes")
        .update({ attempts: (row.attempts ?? 0) + 1 })
        .eq("id", row.id);
      throw new Error("Code invalide.");
    }

    await supabaseAdmin
      .from("enterprise_auth_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("id", row.id);

    return { ok: true as const, tokenHash: row.token_hash, email };
  });
