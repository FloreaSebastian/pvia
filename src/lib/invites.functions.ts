import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAuditLog } from "./audit.server";
import { assertCanAddMember } from "./plan-guard.server";
import { firePushToCompany } from "./push.server";

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

    // Verify caller is owner/admin of the company
    const { data: membership } = await supabaseAdmin
      .from("company_members")
      .select("role,status")
      .eq("company_id", data.companyId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    if (!membership || !["owner", "admin"].includes(membership.role)) {
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

    // Generate secure token
    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
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
          invite_token: token,
          invite_expires_at: expiresAt,
          invited_by: userId,
        })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("company_members").insert({
        company_id: data.companyId,
        invited_email: data.email.toLowerCase(),
        role: data.role,
        status: "invited",
        invite_token: token,
        invite_expires_at: expiresAt,
        invited_by: userId,
      });
      if (error) throw new Error(error.message);
    }

    const appUrl = (process.env.PUBLIC_APP_URL || "https://pvia.app").replace(/\/$/, "");
    const acceptUrl = `${appUrl}/invite/${token}`;

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) throw new Error("RESEND_API_KEY manquant côté serveur.");

    const html = renderEmail({
      companyName: company.name,
      inviterName: profile?.full_name || "Un administrateur",
      role: data.role,
      acceptUrl,
    });

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "PVIA <onboarding@resend.dev>",
        to: [data.email],
        subject: `${profile?.full_name || "PVIA"} vous invite sur ${company.name}`,
        html,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Échec envoi email (${resp.status}): ${body}`);
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
    const { data: invite } = await supabaseAdmin
      .from("company_members")
      .select("id,company_id,role,invited_email,invite_expires_at,status")
      .eq("invite_token", data.token)
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

    const { data: invite } = await supabaseAdmin
      .from("company_members")
      .select("id,invited_email,invite_expires_at,status")
      .eq("invite_token", data.token)
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
        accepted_at: new Date().toISOString(),
      })
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
    return { ok: true };
  });
