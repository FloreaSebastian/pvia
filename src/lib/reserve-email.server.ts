/**
 * Lot 3.5 — Emails liés aux réserves PVIA.
 *
 * 6 helpers sobres, anti-spam, branding entreprise :
 *  - sendReserveAssignedEmail            (à l'assigné)
 *  - sendReserveDeadlineNearEmail        (24h avant)
 *  - sendReserveOverdueEmail             (échéance dépassée)
 *  - sendReserveLiftedEmail              (notif interne)
 *  - sendReserveClientValidatedEmail     (client a validé)
 *  - sendReserveClientRejectedEmail      (client a rejeté + motif)
 *
 * Tous best-effort : ne lèvent jamais — loguent dans email_logs et audit_logs.
 * Pas de pièce jointe : payload retryable côté worker.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAuditLog } from "./audit.server";
import { sendEmailWithRetryLog } from "./email-sender.server";
import {
  getCompanyBrandingSettings,
  normalizeHex,
  DEFAULT_BRANDING_SETTINGS,
  type CompanyBrandingSettings,
} from "./branding.server";

/* ─── helpers ─────────────────────────────────────────────────────────── */

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "numeric", month: "long", year: "numeric",
    });
  } catch {
    return iso;
  }
}

type Variant =
  | "assigned"
  | "deadline_near"
  | "overdue"
  | "lifted"
  | "client_validated"
  | "client_rejected";

const VARIANT_META: Record<Variant, { tag: string; subject: (n: string) => string; heading: string }> = {
  assigned:         { tag: "Nouvelle réserve assignée",  subject: (n) => `Réserve assignée — PV ${n}`,                heading: "Réserve assignée" },
  deadline_near:    { tag: "Échéance proche",            subject: (n) => `Rappel — échéance dans 24h (PV ${n})`,     heading: "Échéance proche" },
  overdue:          { tag: "Échéance dépassée",          subject: (n) => `Échéance dépassée — PV ${n}`,              heading: "Échéance dépassée" },
  lifted:           { tag: "Réserve levée",              subject: (n) => `Réserve levée — PV ${n}`,                  heading: "Réserve levée" },
  client_validated: { tag: "Validée par le client",      subject: (n) => `Réserve validée par le client — PV ${n}`,  heading: "Validation client" },
  client_rejected:  { tag: "Rejetée par le client",      subject: (n) => `Réserve rejetée par le client — PV ${n}`,  heading: "Rejet client" },
};

type RenderOpts = {
  variant: Variant;
  recipientName: string;
  companyName: string;
  pvNumero: string;
  reserveDescription: string;
  severity?: string | null;
  priority?: string | null;
  dueDate?: string | null;
  reason?: string | null;
  actionUrl?: string | null;
  branding?: CompanyBrandingSettings;
};

function renderReserveEmail(o: RenderOpts) {
  const b = o.branding ?? DEFAULT_BRANDING_SETTINGS;
  const accent = normalizeHex(b.email_brand_color || b.brand_color, "#1e3a8a");
  const meta = VARIANT_META[o.variant];
  const footer = escapeHtml(b.email_footer || "Cet email a été envoyé par PVIA.");

  const rows: Array<[string, string]> = [
    ["PV", escapeHtml(o.pvNumero)],
    ["Réserve", escapeHtml(o.reserveDescription).slice(0, 240)],
  ];
  if (o.severity) rows.push(["Gravité", escapeHtml(o.severity)]);
  if (o.priority) rows.push(["Priorité", escapeHtml(o.priority)]);
  if (o.dueDate)  rows.push(["Échéance", escapeHtml(fmtDate(o.dueDate))]);
  if (o.reason)   rows.push(["Motif", escapeHtml(o.reason).slice(0, 800)]);

  const detailRows = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#64748b;font-size:13px;width:120px;vertical-align:top">${k}</td><td style="padding:6px 0;font-size:14px;color:#0f172a">${v}</td></tr>`,
    )
    .join("");

  const cta = o.actionUrl
    ? `<div style="text-align:center;margin:24px 0">
         <a href="${escapeHtml(o.actionUrl)}" style="display:inline-block;padding:12px 24px;background:${accent};color:#fff;text-decoration:none;border-radius:10px;font-size:14px;font-weight:600">Ouvrir dans PVIA</a>
       </div>`
    : "";

  return `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0"><tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)">
      <tr><td style="padding:24px 32px;background:${accent};color:#fff">
        <div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;opacity:.8">PVIA · ${escapeHtml(meta.tag)}</div>
        <div style="font-size:22px;font-weight:600;margin-top:6px">${escapeHtml(meta.heading)}</div>
      </td></tr>
      <tr><td style="padding:28px 32px">
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6">Bonjour ${escapeHtml(o.recipientName)},</p>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#334155">
          ${variantIntro(o.variant, escapeHtml(o.companyName))}
        </p>
        <table cellpadding="0" cellspacing="0" style="margin:8px 0 4px;border-collapse:collapse">${detailRows}</table>
        ${cta}
        <p style="margin:20px 0 0;font-size:12px;color:#64748b;line-height:1.6">
          Vous recevez cet email car vous êtes membre actif de l'entreprise <strong>${escapeHtml(o.companyName)}</strong> sur PVIA.
        </p>
      </td></tr>
      <tr><td style="padding:16px 32px;background:#f8fafc;color:#94a3b8;font-size:11px;text-align:center;line-height:1.6">
        ${footer}
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

function variantIntro(v: Variant, companyName: string): string {
  switch (v) {
    case "assigned":         return `Une nouvelle réserve vous a été assignée par <strong>${companyName}</strong>.`;
    case "deadline_near":    return `L'échéance de cette réserve approche (moins de 24h).`;
    case "overdue":          return `L'échéance de cette réserve est dépassée. Merci d'intervenir rapidement.`;
    case "lifted":           return `Une réserve vient d'être levée par votre équipe.`;
    case "client_validated": return `Le client a validé la levée de réserves.`;
    case "client_rejected":  return `Le client a <strong>rejeté</strong> la levée de réserves. Un motif a été fourni ci-dessous.`;
  }
}

/* ─── data fetch ──────────────────────────────────────────────────────── */

type ReserveCtx = {
  reserveId: string;
  companyId: string;
  pvId: string;
  pvNumero: string;
  description: string;
  severity: string;
  priority: string;
  dueDate: string | null;
  companyName: string;
  branding: CompanyBrandingSettings;
  appUrl: string;
};

async function loadReserveCtx(reserveId: string): Promise<ReserveCtx | null> {
  const { data: r } = await supabaseAdmin
    .from("pv_reserves")
    .select("id,company_id,pv_id,description,severity,priority,due_date,pv:pv_id(numero)")
    .eq("id", reserveId)
    .maybeSingle();
  if (!r?.company_id || !r.pv_id) return null;
  const [{ data: company }, branding] = await Promise.all([
    supabaseAdmin.from("companies").select("name").eq("id", r.company_id).maybeSingle(),
    getCompanyBrandingSettings(r.company_id),
  ]);
  const appUrl = (process.env.PUBLIC_APP_URL || "https://pvia.fr").replace(/\/$/, "");
  return {
    reserveId: r.id as string,
    companyId: r.company_id as string,
    pvId: r.pv_id as string,
    pvNumero: ((r as any).pv?.numero as string) || "—",
    description: (r.description as string) || "",
    severity: (r.severity as string) || "—",
    priority: (r.priority as string) || "normal",
    dueDate: (r.due_date as string | null) ?? null,
    companyName: (company?.name as string) || "PVIA",
    branding,
    appUrl,
  };
}

async function resolveUserEmail(userId: string): Promise<{ email: string; name: string } | null> {
  try {
    const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
    const email = data?.user?.email ?? null;
    if (!email) return null;
    const name = (data?.user?.user_metadata?.full_name as string | undefined) || email.split("@")[0];
    return { email, name };
  } catch {
    return null;
  }
}

/* ─── core sender ─────────────────────────────────────────────────────── */

async function deliver(
  variant: Variant,
  ctx: ReserveCtx,
  recipient: { email: string; name: string },
  extras: { reason?: string | null; actionUrl?: string | null } = {},
) {
  const meta = VARIANT_META[variant];
  const subject = meta.subject(ctx.pvNumero);
  const html = renderReserveEmail({
    variant,
    recipientName: recipient.name,
    companyName: ctx.companyName,
    pvNumero: ctx.pvNumero,
    reserveDescription: ctx.description,
    severity: ctx.severity,
    priority: ctx.priority,
    dueDate: ctx.dueDate,
    reason: extras.reason ?? null,
    actionUrl: extras.actionUrl ?? `${ctx.appUrl}/pv/${ctx.pvId}`,
    branding: ctx.branding,
  });
  const from = process.env.RESEND_FROM_EMAIL || `${ctx.companyName} <noreply@pvia.fr>`;

  const result = await sendEmailWithRetryLog({
    emailType: `reserve_${variant}`,
    companyId: ctx.companyId,
    pvId: ctx.pvId,
    retryable: true,
    payload: { from, to: recipient.email, subject, html },
  });

  await writeAuditLog({
    companyId: ctx.companyId,
    pvId: ctx.pvId,
    entityType: "reserve",
    entityId: ctx.reserveId,
    action: result.status === "sent"
      ? `reserve.${variant}_email_sent`
      : `reserve.${variant}_email_failed`,
    metadata: {
      recipient: recipient.email,
      resend_id: result.resendId ?? null,
      error: result.error ?? null,
    },
    actor: "email",
  });
  return result;
}

/* ─── public api ──────────────────────────────────────────────────────── */

export async function sendReserveAssignedEmail(reserveId: string, assigneeId: string) {
  const ctx = await loadReserveCtx(reserveId);
  if (!ctx) return { ok: false, reason: "ctx_missing" };
  const u = await resolveUserEmail(assigneeId);
  if (!u) return { ok: false, reason: "no_email" };
  const res = await deliver("assigned", ctx, u);
  return { ok: res.status === "sent", reason: res.error };
}

export async function sendReserveDeadlineNearEmail(reserveId: string, assigneeId: string) {
  const ctx = await loadReserveCtx(reserveId);
  if (!ctx) return { ok: false, reason: "ctx_missing" };
  const u = await resolveUserEmail(assigneeId);
  if (!u) return { ok: false, reason: "no_email" };
  const res = await deliver("deadline_near", ctx, u);
  return { ok: res.status === "sent", reason: res.error };
}

export async function sendReserveOverdueEmail(
  reserveId: string,
  recipientUserId: string,
) {
  const ctx = await loadReserveCtx(reserveId);
  if (!ctx) return { ok: false, reason: "ctx_missing" };
  const u = await resolveUserEmail(recipientUserId);
  if (!u) return { ok: false, reason: "no_email" };
  const res = await deliver("overdue", ctx, u);
  return { ok: res.status === "sent", reason: res.error };
}

export async function sendReserveLiftedEmail(reserveId: string, recipientUserId: string) {
  const ctx = await loadReserveCtx(reserveId);
  if (!ctx) return { ok: false, reason: "ctx_missing" };
  const u = await resolveUserEmail(recipientUserId);
  if (!u) return { ok: false, reason: "no_email" };
  const res = await deliver("lifted", ctx, u);
  return { ok: res.status === "sent", reason: res.error };
}

export async function sendReserveClientValidatedEmail(reserveId: string, recipientUserId: string) {
  const ctx = await loadReserveCtx(reserveId);
  if (!ctx) return { ok: false, reason: "ctx_missing" };
  const u = await resolveUserEmail(recipientUserId);
  if (!u) return { ok: false, reason: "no_email" };
  const res = await deliver("client_validated", ctx, u);
  return { ok: res.status === "sent", reason: res.error };
}

export async function sendReserveClientRejectedEmail(
  reserveId: string,
  recipientUserId: string,
  reason: string,
) {
  const ctx = await loadReserveCtx(reserveId);
  if (!ctx) return { ok: false, reason: "ctx_missing" };
  const u = await resolveUserEmail(recipientUserId);
  if (!u) return { ok: false, reason: "no_email" };
  const res = await deliver("client_rejected", ctx, u, { reason });
  return { ok: res.status === "sent", reason: res.error };
}
