/** Emails du module Sous-traitants (invitation + notifications d'affectation). */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function esc(s: string) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function shell(title: string, body: string) {
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">
    <table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden">
      <tr><td style="padding:28px 32px 8px">
        <div style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#94a3b8">PVIA</div>
        <h1 style="margin:8px 0 0;font-size:22px;line-height:1.3;color:#0f172a">${esc(title)}</h1>
      </td></tr>
      <tr><td style="padding:12px 32px 28px;color:#334155;font-size:15px;line-height:1.65">${body}</td></tr>
      <tr><td style="padding:16px 32px 26px;color:#94a3b8;font-size:11px;text-align:center">PVIA — Réception de travaux intelligente</td></tr>
    </table>
  </td></tr></table></body></html>`;
}

async function send(opts: {
  to: string;
  subject: string;
  html: string;
  companyId: string | null;
  type: string;
}) {
  const resendKey = process.env["RESEND_API_KEY"];
  const from = process.env["RESEND_FROM_EMAIL"] || "PVIA <noreply@pvia.fr>";
  const log = async (status: "sent" | "failed", error?: string, resendId?: string) => {
    try {
      await supabaseAdmin.from("email_logs").insert({
        company_id: opts.companyId,
        recipient_email: opts.to,
        email_type: opts.type,
        subject: opts.subject,
        status,
        error_message: error ?? null,
        resend_id: resendId ?? null,
        payload: null,
        max_retries: 0,
        retries_count: 0,
        sent_at: status === "sent" ? new Date().toISOString() : null,
      } as never);
    } catch {}
  };
  if (!resendKey) {
    await log("failed", "RESEND_API_KEY manquant");
    throw new Error("Configuration email indisponible.");
  }
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [opts.to], subject: opts.subject, html: opts.html }),
  });
  if (!resp.ok) {
    await log("failed", `Resend ${resp.status}`);
    throw new Error("Envoi de l'email impossible pour le moment.");
  }
  const j = (await resp.json().catch(() => ({}))) as { id?: string };
  await log("sent", undefined, j.id);
}

export async function sendSubcontractorInviteEmail(opts: {
  to: string;
  companyName: string;
  subcontractorCompanyName: string;
  inviteUrl: string;
  expiresAt: string;
  companyId: string;
}) {
  const html = shell(
    `${opts.companyName} vous invite sur PVIA`,
    `<p>Bonjour,</p>
     <p><strong>${esc(opts.companyName)}</strong> vous donne accès à son espace sous-traitant PVIA
     au titre de <strong>${esc(opts.subcontractorCompanyName)}</strong>.</p>
     <p>Vous y retrouverez vos interventions, votre planning et les documents nécessaires
     sur les chantiers qui vous sont affectés.</p>
     <p style="margin:26px 0"><a href="${opts.inviteUrl}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:14px 24px;border-radius:10px;font-weight:600">Activer mon accès</a></p>
     <p style="font-size:13px;color:#64748b">Ce lien est personnel, à usage unique, et expire le
     ${esc(new Date(opts.expiresAt).toLocaleDateString("fr-FR"))}. Si vous n'êtes pas concerné, ignorez cet email.</p>`,
  );
  await send({
    to: opts.to,
    subject: `${opts.companyName} vous invite comme sous-traitant sur PVIA`,
    html,
    companyId: opts.companyId,
    type: "subcontractor_invite",
  });
}

export async function sendSubcontractorLoginCodeEmail(opts: {
  to: string;
  code: string;
  device: string;
  companyId: string | null;
}) {
  const html = shell(
    "Votre code de connexion",
    `<p>Voici votre code de connexion à l'espace sous-traitant PVIA :</p>
     <div style="margin:20px 0;font-size:34px;letter-spacing:.32em;font-weight:700;color:#0f172a">${esc(opts.code)}</div>
     <p style="font-size:13px;color:#64748b">Valide 10 minutes · demande depuis ${esc(opts.device)}.<br>
     Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>`,
  );
  await send({
    to: opts.to,
    subject: "Votre code de connexion PVIA",
    html,
    companyId: opts.companyId,
    type: "subcontractor_login_code",
  });
}

export async function sendSubcontractorAssignmentEmail(opts: {
  to: string;
  companyName: string;
  chantierLabel: string;
  mission: string;
  scheduledAt: string | null;
  url: string;
  companyId: string;
}) {
  const when = opts.scheduledAt
    ? new Date(opts.scheduledAt).toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" })
    : "à planifier";
  const html = shell(
    "Nouvelle intervention",
    `<p><strong>${esc(opts.companyName)}</strong> vous a affecté une intervention.</p>
     <table style="margin:16px 0;font-size:14px">
       <tr><td style="padding:4px 12px 4px 0;color:#64748b">Chantier</td><td><strong>${esc(opts.chantierLabel)}</strong></td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#64748b">Mission</td><td>${esc(opts.mission)}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#64748b">Date</td><td>${esc(when)}</td></tr>
     </table>
     <p style="margin:24px 0"><a href="${opts.url}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:600">Voir l'intervention</a></p>`,
  );
  await send({
    to: opts.to,
    subject: `Nouvelle intervention — ${opts.chantierLabel}`,
    html,
    companyId: opts.companyId,
    type: "subcontractor_assignment",
  });
}
