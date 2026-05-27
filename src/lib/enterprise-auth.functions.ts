import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAuditLog } from "@/lib/audit.server";
import { enforceRateLimit } from "@/lib/rate-limit.server";
import { describeUA, getClientIp, getClientUA, normalizeEmail } from "@/lib/client-auth.server";
import { sendEnterpriseLoginCodeEmail } from "@/lib/email.server";

const LoginCodeSchema = z.object({
  email: z.string().email().max(255),
});

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

    const code = linkData.properties?.email_otp;
    if (error || !code) {
      await writeAuditLog({
        companyId: membership.company_id,
        userId: user.id,
        entityType: "auth",
        action: "user.login_failed",
        metadata: { email, reason: "otp_generation_failed", error: error?.message, ip },
      });
      throw new Error("Impossible de générer le code de connexion.");
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
      metadata: { email, method: "enterprise_otp_resend", ip },
    });

    return { ok: true as const };
  });