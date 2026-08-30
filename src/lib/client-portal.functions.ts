/**
 * Espace Client — pilotage côté entreprise.
 *
 * L'identité client est globale (`client_identities`), mais une entreprise ne
 * doit JAMAIS déduire l'activité d'une autre entreprise. On n'expose donc que :
 *   - l'état d'activation du compte (booléen dérivé),
 *   - la date d'invitation *de cette entreprise* (`clients.portal_invited_at`).
 * Aucune date de dernière connexion, aucun UUID d'identité, aucune relation
 * cross-entreprise ne sort d'ici.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isManageRole } from "@/lib/roles";
import { writeAuditLog } from "./audit.server";
import { enforceRateLimit } from "./rate-limit.server";
import { getPublicAppUrl } from "./app-url.server";

/** États affichables côté entreprise. */
export type PortalState =
  | "no_email" // pas d'email → espace client impossible
  | "not_invited" // jamais invité par cette entreprise
  | "invited" // invitation envoyée, compte pas encore activé
  | "active" // compte activé (le client s'est déjà connecté)
  | "suspended"; // accès portail suspendu par cette entreprise

export type PortalStatus = {
  clientId: string;
  state: PortalState;
  email: string | null;
  invitedAt: string | null;
  suspendedAt: string | null;
};

const CompanyClient = z.object({
  companyId: z.string().uuid(),
  clientId: z.string().uuid(),
});

async function requireMember(companyId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from("company_members")
    .select("role,status")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (!data) throw new Error("Accès refusé.");
  return data as { role: string; status: string };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function deriveState(row: {
  email: string | null;
  portal_invited_at: string | null;
  portal_suspended_at: string | null;
  activated: boolean;
}): PortalState {
  if (!row.email || !EMAIL_RE.test(row.email.trim().toLowerCase())) return "no_email";
  if (row.portal_suspended_at) return "suspended";
  if (row.activated) return "active";
  if (row.portal_invited_at) return "invited";
  return "not_invited";
}

/** Statuts portail de tous les clients d'une entreprise (liste). */
export const listClientPortalStatuses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ companyId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<PortalStatus[]> => {
    await requireMember(data.companyId, context.userId);

    const { data: clients } = await supabaseAdmin
      .from("clients")
      .select("id,email,client_identity_id,portal_invited_at,portal_suspended_at")
      .eq("company_id", data.companyId);

    const rows = (clients ?? []) as any[];
    const identityIds = Array.from(
      new Set(rows.map((r) => r.client_identity_id).filter(Boolean) as string[]),
    );
    const activated = new Set<string>();
    if (identityIds.length > 0) {
      const { data: ids } = await supabaseAdmin
        .from("client_identities")
        .select("id,activated_at")
        .in("id", identityIds);
      for (const i of (ids ?? []) as any[]) if (i.activated_at) activated.add(i.id as string);
    }

    return rows.map((r) => ({
      clientId: r.id as string,
      email: (r.email ?? null) as string | null,
      invitedAt: (r.portal_invited_at ?? null) as string | null,
      suspendedAt: (r.portal_suspended_at ?? null) as string | null,
      state: deriveState({
        email: r.email ?? null,
        portal_invited_at: r.portal_invited_at ?? null,
        portal_suspended_at: r.portal_suspended_at ?? null,
        activated: !!(r.client_identity_id && activated.has(r.client_identity_id)),
      }),
    }));
  });

/** Statut portail d'un client précis (fiche détail). */
export const getClientPortalStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CompanyClient.parse(input))
  .handler(async ({ data, context }): Promise<PortalStatus> => {
    await requireMember(data.companyId, context.userId);
    const { data: row } = await supabaseAdmin
      .from("clients")
      .select("id,email,client_identity_id,portal_invited_at,portal_suspended_at")
      .eq("id", data.clientId)
      .eq("company_id", data.companyId)
      .maybeSingle();
    if (!row) throw new Error("Client introuvable.");

    let activated = false;
    if ((row as any).client_identity_id) {
      const { data: identity } = await supabaseAdmin
        .from("client_identities")
        .select("activated_at")
        .eq("id", (row as any).client_identity_id)
        .maybeSingle();
      activated = !!(identity as any)?.activated_at;
    }

    return {
      clientId: (row as any).id as string,
      email: ((row as any).email ?? null) as string | null,
      invitedAt: ((row as any).portal_invited_at ?? null) as string | null,
      suspendedAt: ((row as any).portal_suspended_at ?? null) as string | null,
      state: deriveState({
        email: (row as any).email ?? null,
        portal_invited_at: (row as any).portal_invited_at ?? null,
        portal_suspended_at: (row as any).portal_suspended_at ?? null,
        activated,
      }),
    };
  });

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function renderInviteEmail(opts: { companyName: string; clientName: string; loginUrl: string; alreadyActive: boolean }) {
  const { companyName, clientName, loginUrl, alreadyActive } = opts;
  return `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0"><tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)">
      <tr><td style="padding:32px 40px;background:linear-gradient(135deg,#001020,#0A66F5);color:#fff">
        <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;opacity:.7">PVIA</div>
        <div style="font-size:24px;font-weight:600;margin-top:8px">Votre espace client ${escapeHtml(companyName)}</div>
      </td></tr>
      <tr><td style="padding:32px 40px">
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6">Bonjour ${escapeHtml(clientName)},</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6"><strong>${escapeHtml(companyName)}</strong> met à votre disposition un espace en ligne pour consulter vos procès-verbaux de réception, signer vos documents et suivre la levée des réserves.</p>
        <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#475569">${
          alreadyActive
            ? "Vous avez déjà un espace client PVIA : connectez-vous avec cette adresse email, les documents de cette entreprise y apparaîtront automatiquement."
            : "Aucun mot de passe à retenir : vous recevez un code à 6 chiffres par email à chaque connexion."
        }</p>
        <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#0A66F5">
          <a href="${loginUrl}" style="display:inline-block;padding:14px 28px;color:#fff;text-decoration:none;font-weight:600;font-size:15px">Accéder à mon espace →</a>
        </td></tr></table>
        <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;line-height:1.6">Si le bouton ne fonctionne pas, copiez ce lien :<br><span style="color:#475569;word-break:break-all">${loginUrl}</span></p>
      </td></tr>
      <tr><td style="padding:20px 40px;background:#f8fafc;color:#94a3b8;font-size:11px;text-align:center">© PVIA · Réception de travaux</td></tr>
    </table>
  </td></tr></table></body></html>`;
}

/** Invite (ou relance) un client vers l'Espace Client. */
export const inviteClientToPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CompanyClient.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const membership = await requireMember(data.companyId, userId);
    if (!isManageRole(membership.role)) {
      throw new Error("Vous n'avez pas les droits pour inviter ce client.");
    }

    await (await import("./plan-guard.server")).assertCompanyWriteAccess(data.companyId, userId);

    // Les quotas restent serveur ; le message affiché reste métier (aucun nom
    // de bucket interne, aucune seconde brute exposée au client).
    try {
      await enforceRateLimit({ bucket: "client.portal_invite", key: userId, limit: 30, windowSec: 3600 });
      await enforceRateLimit({ bucket: "client.portal_invite.client", key: data.clientId, limit: 3, windowSec: 3600 });
    } catch {
      throw new Error(
        "Trop d'invitations envoyées à ce client. Réessayez dans un moment (3 invitations par heure maximum).",
      );
    }


    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("id,name,email,client_identity_id,portal_invited_at,portal_suspended_at,archived_at")
      .eq("id", data.clientId)
      .eq("company_id", data.companyId)
      .maybeSingle();
    if (!client) throw new Error("Client introuvable.");
    if ((client as any).archived_at) throw new Error("Ce client est archivé.");
    if ((client as any).portal_suspended_at) throw new Error("L'accès portail de ce client est suspendu.");

    const email = ((client as any).email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      throw new Error("Ajoutez une adresse email valide au client avant de l'inviter.");
    }

    const { resolveIdentityId } = await import("@/lib/client-identity.server");
    const identityId = await resolveIdentityId(email);
    if (!identityId) throw new Error("Impossible de préparer l'espace client.");

    const { data: identity } = await supabaseAdmin
      .from("client_identities")
      .select("id,status,activated_at")
      .eq("id", identityId)
      .maybeSingle();
    const alreadyActive = !!(identity as any)?.activated_at;

    const now = new Date().toISOString();
    const isReinvite = !!(client as any).portal_invited_at;

    await supabaseAdmin
      .from("clients")
      .update({ client_identity_id: identityId, portal_invited_at: now } as never)
      .eq("id", data.clientId)
      .eq("company_id", data.companyId);

    if ((identity as any)?.status === "pending") {
      await supabaseAdmin
        .from("client_identities")
        .update({ status: "invited", invited_at: now } as never)
        .eq("id", identityId);
    }

    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("name")
      .eq("id", data.companyId)
      .maybeSingle();

    const appUrl = getPublicAppUrl();
    const loginUrl = `${appUrl}/client/login`;

    const { assertNotRecentlySent } = await import("@/lib/email-throttle.server");
    await assertNotRecentlySent({
      emailType: "client_portal_invite",
      companyId: data.companyId,
      recipient: email,
      windowSec: 60,
      label: "L'invitation",
    });

    const { sendEmailWithRetryLog } = await import("@/lib/email-sender.server");
    const res = await sendEmailWithRetryLog({
      emailType: "client_portal_invite",
      companyId: data.companyId,
      retryable: true,
      payload: {
        from: process.env.RESEND_FROM_EMAIL || "PVIA <noreply@pvia.fr>",
        to: [email],
        subject: `${company?.name ?? "PVIA"} — accédez à votre espace client`,
        html: renderInviteEmail({
          companyName: company?.name ?? "PVIA",
          clientName: ((client as any).name ?? "") as string,
          loginUrl,
          alreadyActive,
        }),
      },
    });

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "client",
      entityId: data.clientId,
      action: isReinvite ? "client.portal_reinvited" : "client.portal_invited",
      newValues: { email, invited_at: now },
      metadata: { already_active: alreadyActive, email_status: res.status },
      actor: "user",
    });

    if (res.status === "failed") {
      throw new Error("Invitation enregistrée, mais l'email n'a pas pu partir (relance automatique en cours).");
    }

    return { ok: true as const, reinvited: isReinvite, alreadyActive, email };
  });

/**
 * Suspend / réactive l'accès du client à l'espace client POUR CETTE ENTREPRISE
 * uniquement. La suspension est portée par la ligne `clients` (jamais par
 * l'identité globale) : les documents des autres entreprises restent visibles.
 */
export const setClientPortalAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CompanyClient.extend({ suspended: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const membership = await requireMember(data.companyId, userId);
    if (!isManageRole(membership.role)) {
      throw new Error("Vous n'avez pas les droits pour modifier l'accès de ce client.");
    }

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("id,portal_suspended_at")
      .eq("id", data.clientId)
      .eq("company_id", data.companyId)
      .maybeSingle();
    if (!client) throw new Error("Client introuvable.");

    const now = new Date().toISOString();
    const next = data.suspended ? now : null;
    await supabaseAdmin
      .from("clients")
      .update({ portal_suspended_at: next } as never)
      .eq("id", data.clientId)
      .eq("company_id", data.companyId);

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "client",
      entityId: data.clientId,
      action: data.suspended ? "client.portal_suspended" : "client.portal_resumed",
      oldValues: { portal_suspended_at: (client as any).portal_suspended_at ?? null },
      newValues: { portal_suspended_at: next },
      actor: "user",
    });

    return { ok: true as const, suspended: data.suspended };
  });
