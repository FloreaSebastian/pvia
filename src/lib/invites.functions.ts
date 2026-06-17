import { createServerFn } from "@tanstack/react-start";
import { ADMIN_ROLES, OWNER_ROLES, SIGN_ROLES, isAdminRole, isManageRole } from "@/lib/roles";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAuditLog } from "./audit.server";
import { assertCanAddMember } from "./plan-guard.server";
import { firePushToCompany } from "./push.server";
import { enforceRateLimit, getClientIp } from "./rate-limit.server";

const InviteSchema = z.object({
  companyId: z.string().uuid(),
  email: z.string().email().max(255),
  role: z.enum(["admin", "manager", "user"]),
});

function renderEmail(opts: {
  companyName: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
}) {
  const { companyName, inviterName, role, acceptUrl } = opts;
  return `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)">
        <tr><td style="padding:32px 40px;background:linear-gradient(135deg,#0f172a,#1e3a8a);color:#fff">
          <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;opacity:.7">PVIA</div>
          <div style="font-size:24px;font-weight:600;margin-top:8px">Vous êtes invité à rejoindre ${escapeHtml(companyName)}</div>
        </td></tr>
        <tr><td style="padding:32px 40px">
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6"><strong>${escapeHtml(inviterName)}</strong> vous invite à rejoindre l'espace <strong>${escapeHtml(companyName)}</strong> sur PVIA en tant que <strong>${escapeHtml(role)}</strong>.</p>
          <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#475569">PVIA est la plateforme de procès-verbaux de réception de travaux pour les entreprises du BTP. Signature électronique, photos, réserves et PDF — tout en un.</p>
          <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#1e3a8a">
            <a href="${acceptUrl}" style="display:inline-block;padding:14px 28px;color:#fff;text-decoration:none;font-weight:600;font-size:15px">Rejoindre PVIA →</a>
          </td></tr></table>
          <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;line-height:1.6">Ce lien est valable 7 jours. Si le bouton ne fonctionne pas, copiez ce lien : <br><span style="color:#475569;word-break:break-all">${acceptUrl}</span></p>
        </td></tr>
        <tr><td style="padding:20px 40px;background:#f8fafc;color:#94a3b8;font-size:11px;text-align:center">
          © PVIA · Réception de travaux intelligente
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export const sendInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => InviteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    // Limite anti-spam invitations
    await enforceRateLimit({ bucket: "invite.send", key: userId, limit: 20, windowSec: 3600 });
    await enforceRateLimit({ bucket: "invite.send.email", key: `${userId}:${data.email.toLowerCase()}`, limit: 3, windowSec: 3600 });

    // Verify caller is owner/admin of the company
    const { data: membership } = await supabaseAdmin
      .from("company_members")
      .select("role,status")
      .eq("company_id", data.companyId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    if (!membership || !isAdminRole(membership.role)) {
      throw new Error("Vous n'avez pas les droits pour inviter des membres.");
    }

    // Plan quota: max members per plan
    await assertCanAddMember(data.companyId);



    // Company info + inviter profile
    const [{ data: company }, { data: profile }] = await Promise.all([
      supabaseAdmin.from("companies").select("name").eq("id", data.companyId).maybeSingle(),
      supabaseAdmin.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
    ]);
    if (!company) throw new Error("Entreprise introuvable.");

    // Generate secure token (returned in email link only) + store SHA-256 hash in DB
    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const tokenHashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const tokenHash = Array.from(new Uint8Array(tokenHashBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

    // Upsert invitation row
    const { data: existing } = await supabaseAdmin
      .from("company_members")
      .select("id,status")
      .eq("company_id", data.companyId)
      .eq("invited_email", data.email.toLowerCase())
      .is("user_id", null)
      .maybeSingle();

    if (existing) {
      const { error } = await supabaseAdmin
        .from("company_members")
        .update({
          role: data.role,
          status: "invited",
          invite_token: null,
          invite_token_hash: tokenHash,
          invite_expires_at: expiresAt,
          invited_by: userId,
        } as never)
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("company_members").insert({
        company_id: data.companyId,
        invited_email: data.email.toLowerCase(),
        role: data.role,
        status: "invited",
        invite_token: null,
        invite_token_hash: tokenHash,
        invite_expires_at: expiresAt,
        invited_by: userId,
      } as never);
      if (error) throw new Error(error.message);
    }


    const appUrl = (process.env.PUBLIC_APP_URL || "https://pvia.fr").replace(/\/$/, "");
    const acceptUrl = `${appUrl}/invite/${token}`;

    const html = renderEmail({
      companyName: company.name,
      inviterName: profile?.full_name || "Un administrateur",
      role: data.role,
      acceptUrl,
    });

    // EM-M3: idempotent invite resend (prevents double-click sending 2 emails).
    const { assertNotRecentlySent } = await import("@/lib/email-throttle.server");
    await assertNotRecentlySent({
      emailType: "member_invite",
      companyId: data.companyId,
      recipient: data.email,
      windowSec: 60,
      label: "L'invitation",
    });

    const { sendEmailWithRetryLog } = await import("@/lib/email-sender.server");
    const sendRes = await sendEmailWithRetryLog({
      emailType: "member_invite",
      companyId: data.companyId,
      retryable: true,
      payload: {
        from: process.env.RESEND_FROM_EMAIL || "PVIA <noreply@pvia.fr>",
        to: [data.email],
        subject: `${profile?.full_name || "PVIA"} vous invite sur ${company.name}`,
        html,
      },
    });
    if (sendRes.status === "failed") {
      // Invitation row was already created — the queued log will auto-retry.
      throw new Error(`Échec envoi email: ${sendRes.error ?? "inconnue"} (sera relancé automatiquement)`);
    }

    await writeAuditLog({
      companyId: data.companyId, userId, entityType: "member",
      action: "member.invited",
      newValues: { invited_email: data.email.toLowerCase(), role: data.role },
      metadata: { expires_at: expiresAt }, actor: "user",
    });

    firePushToCompany(data.companyId, {
      title: "Invitation envoyée",
      body: `${data.email.toLowerCase()} a été invité (${data.role}).`,
      url: "/equipe",
      tag: `invite-${data.email.toLowerCase()}`,
    }, { excludeUserId: userId });

    return { ok: true, acceptUrl };
  });

const TokenSchema = z.object({ token: z.string().min(10).max(128) });

export const getInviteByToken = createServerFn({ method: "POST" })
  .inputValidator((input) => TokenSchema.parse(input))
  .handler(async ({ data }) => {
    // Rate-limit anonymous token lookups (per IP + token prefix) to mitigate enumeration.
    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      const ip = getClientIp(getRequest());
      await enforceRateLimit({
        bucket: "invite.get",
        key: `${ip}:${data.token.slice(0, 16)}`,
        limit: 20,
        windowSec: 60,
      });
    } catch (e) {
      if ((e as any)?.name === "RateLimitError") throw e;
      // not in request context — best-effort
    }

    const tokenHashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data.token));
    const tokenHash = Array.from(new Uint8Array(tokenHashBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const { data: invite } = await supabaseAdmin
      .from("company_members")
      .select("id,company_id,role,invited_email,invite_expires_at,status")
      .eq("invite_token_hash" as never, tokenHash)
      .maybeSingle();
    if (!invite) return { valid: false as const };
    if (invite.status !== "invited") return { valid: false as const, reason: "used" };
    if (invite.invite_expires_at && new Date(invite.invite_expires_at) < new Date())
      return { valid: false as const, reason: "expired" };

    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("name")
      .eq("id", invite.company_id)
      .maybeSingle();

    return {
      valid: true as const,
      email: invite.invited_email,
      role: invite.role,
      companyName: company?.name ?? "PVIA",
    };
  });

export const acceptInviteForCurrentUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => TokenSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId, claims } = context;
    const email = (claims as any)?.email as string | undefined;

    const tokenHashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data.token));
    const tokenHash = Array.from(new Uint8Array(tokenHashBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const { data: invite } = await supabaseAdmin
      .from("company_members")
      .select("id,invited_email,invite_expires_at,status")
      .eq("invite_token_hash" as never, tokenHash)
      .maybeSingle();
    if (!invite) throw new Error("Invitation introuvable.");
    if (invite.status !== "invited") throw new Error("Invitation déjà utilisée.");
    if (invite.invite_expires_at && new Date(invite.invite_expires_at) < new Date())
      throw new Error("Invitation expirée.");
    if (email && invite.invited_email && email.toLowerCase() !== invite.invited_email.toLowerCase())
      throw new Error("Cette invitation est destinée à un autre email.");

    const { error } = await supabaseAdmin
      .from("company_members")
      .update({
        user_id: userId,
        status: "active",
        invited_email: null,
        invite_token: null,
        invite_token_hash: null,
        accepted_at: new Date().toISOString(),
      } as never)
      .eq("id", invite.id);
    if (error) throw new Error(error.message);


    // Lookup company for audit context
    const { data: row } = await supabaseAdmin
      .from("company_members").select("company_id,role").eq("id", invite.id).maybeSingle();
    await writeAuditLog({
      companyId: row?.company_id ?? null, userId, entityType: "member", entityId: invite.id,
      action: "member.joined", newValues: { role: row?.role, email },
      actor: "user",
    });
    if (row?.company_id) {
      firePushToCompany(
        row.company_id,
        {
          title: "Nouveau membre",
          body: `${email ?? "Un collaborateur"} a rejoint l'équipe.`,
          url: "/equipe",
          tag: `member-joined-${invite.id}`,
          data: { kind: "member.joined" },
        },
        { excludeUserId: userId },
      );
    }
    return { ok: true };
  });
