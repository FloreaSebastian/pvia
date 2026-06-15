/**
 * EM-C1 — Email "levée de réserves à valider".
 *
 * Sent automatically when a reserve-lift report is signed by the company
 * (status='signe') and is waiting for client validation.
 *
 * The link points to /client/pv/:pvId/levee-reserves/:liftId. The client
 * accesses it through the existing passwordless login flow (OTP per email),
 * so no extra token is required — access is already gated by client session.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAuditLog } from "./audit.server";
import {
  getCompanyBrandingSettings,
  normalizeHex,
  DEFAULT_BRANDING_SETTINGS,
  type CompanyBrandingSettings,
} from "./branding.server";

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function renderLiftValidationRequestEmail(opts: {
  companyName: string;
  clientName: string;
  numero: string;
  pvNumero: string;
  signedAt: string;
  validateUrl: string;
  branding?: CompanyBrandingSettings;
}) {
  const b = opts.branding ?? DEFAULT_BRANDING_SETTINGS;
  const accent = normalizeHex(b.email_brand_color || b.brand_color, "#1e3a8a");
  const signedDate = new Date(opts.signedAt).toLocaleString("fr-FR", {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const footerText = escapeHtml(b.email_footer || "Cet email a été envoyé par PVIA.");
  return `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0"><tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)">
      <tr><td style="padding:32px 40px;background:${accent};color:#fff">
        <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;opacity:.75">PVIA · Levée de réserves à valider</div>
        <div style="font-size:24px;font-weight:600;margin-top:8px">Action requise</div>
      </td></tr>
      <tr><td style="padding:32px 40px">
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6">Bonjour ${escapeHtml(opts.clientName)},</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6">
          <strong>${escapeHtml(opts.companyName)}</strong> vient de signer la levée de réserves
          <strong>${escapeHtml(opts.numero)}</strong> liée au procès-verbal
          <strong>${escapeHtml(opts.pvNumero)}</strong>.
        </p>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#475569">
          <strong>Signée par l'entreprise le :</strong> ${signedDate}
        </p>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#475569">
          Merci de consulter la levée et de la valider depuis votre espace client.
          Votre validation confirmera officiellement la levée des réserves.
        </p>
        <div style="text-align:center;margin:28px 0">
          <a href="${escapeHtml(opts.validateUrl)}" style="display:inline-block;padding:14px 28px;background:${accent};color:#fff;text-decoration:none;border-radius:10px;font-size:14px;font-weight:600">Consulter et valider la levée</a>
        </div>
        <p style="margin:24px 0 0;padding:14px 16px;background:#fafafa;border-radius:10px;font-size:12px;color:#64748b;line-height:1.6">
          Connexion à l'espace client par code de vérification envoyé à votre email.
          Le lien reste valide tant que la levée n'est pas validée.
        </p>
        <p style="margin:24px 0 0;font-size:13px;color:#64748b;line-height:1.6">Cordialement,<br><strong>${escapeHtml(opts.companyName)}</strong></p>
      </td></tr>
      <tr><td style="padding:20px 40px;background:#f8fafc;color:#94a3b8;font-size:11px;text-align:center;line-height:1.6">
        ${footerText}
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

/**
 * Send the "please validate" email to the client. Logs to email_logs +
 * writes audit events on success/failure. Best-effort, never throws.
 */
export async function sendReserveLiftValidationRequestEmail(opts: {
  reportId: string;
}): Promise<{ ok: boolean; recipient: string | null; error?: string }> {
  const { data: report } = await supabaseAdmin
    .from("reserve_lift_reports")
    .select("id,numero,pv_id,company_id,signed_at,status,client_validated_at")
    .eq("id", opts.reportId)
    .maybeSingle();
  if (!report?.company_id || !report.pv_id) {
    return { ok: false, recipient: null, error: "Rapport introuvable" };
  }
  if (report.client_validated_at) {
    return { ok: false, recipient: null, error: "Déjà validée" };
  }

  const [{ data: pv }, { data: company }, branding] = await Promise.all([
    supabaseAdmin.from("pv").select("id,numero,client_id,sent_to_email").eq("id", report.pv_id).maybeSingle(),
    supabaseAdmin.from("companies").select("name").eq("id", report.company_id).maybeSingle(),
    getCompanyBrandingSettings(report.company_id),
  ]);
  const { data: client } = pv?.client_id
    ? await supabaseAdmin.from("clients").select("name,email").eq("id", pv.client_id).maybeSingle()
    : { data: null as any };

  const recipient = client?.email || pv?.sent_to_email || null;
  if (!recipient) {
    await writeAuditLog({
      companyId: report.company_id,
      pvId: report.pv_id,
      entityType: "reserve_lift",
      entityId: report.id,
      action: "reserve_lift.validation_email_failed",
      metadata: { reason: "no_recipient" },
      actor: "email",
    });
    return { ok: false, recipient: null, error: "Aucun destinataire" };
  }

  const appUrl = (process.env.PUBLIC_APP_URL || "https://pvia.fr").replace(/\/$/, "");
  const validateUrl = `${appUrl}/client/pv/${pv!.id}/levee-reserves/${report.id}`;
  const companyName = company?.name || "PVIA";
  const clientName = client?.name || "Cher client";
  const subject = `Action requise — Validation de la levée de réserves ${report.numero}`;
  const html = renderLiftValidationRequestEmail({
    companyName,
    clientName,
    numero: report.numero,
    pvNumero: pv?.numero ?? "—",
    signedAt: report.signed_at ?? new Date().toISOString(),
    validateUrl,
    branding,
  });

  const from = process.env.RESEND_FROM_EMAIL || `${companyName} <noreply@pvia.fr>`;
  const resendKey = process.env.RESEND_API_KEY;

  if (!resendKey) {
    await supabaseAdmin.from("email_logs").insert({
      company_id: report.company_id,
      pv_id: report.pv_id,
      recipient_email: recipient,
      email_type: "reserve_lift_validation_request",
      status: "failed",
      subject,
      error_message: "RESEND_API_KEY manquant",
    } as never);
    await writeAuditLog({
      companyId: report.company_id,
      pvId: report.pv_id,
      entityType: "reserve_lift",
      entityId: report.id,
      action: "reserve_lift.validation_email_failed",
      metadata: { reason: "resend_key_missing", recipient },
      actor: "email",
    });
    return { ok: false, recipient, error: "RESEND_API_KEY manquant" };
  }

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [recipient], subject, html }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      const err = `${resp.status}: ${body.slice(0, 300)}`;
      await supabaseAdmin.from("email_logs").insert({
        company_id: report.company_id,
        pv_id: report.pv_id,
        recipient_email: recipient,
        email_type: "reserve_lift_validation_request",
        status: "failed",
        subject,
        error_message: err,
      } as never);
      await writeAuditLog({
        companyId: report.company_id,
        pvId: report.pv_id,
        entityType: "reserve_lift",
        entityId: report.id,
        action: "reserve_lift.validation_email_failed",
        metadata: { reason: "resend_error", error: err, recipient },
        actor: "email",
      });
      return { ok: false, recipient, error: err };
    }
    const j = (await resp.json().catch(() => ({}))) as { id?: string };
    await supabaseAdmin.from("email_logs").insert({
      company_id: report.company_id,
      pv_id: report.pv_id,
      recipient_email: recipient,
      email_type: "reserve_lift_validation_request",
      status: "sent",
      subject,
      resend_id: j.id ?? null,
      sent_at: new Date().toISOString(),
    } as never);
    await writeAuditLog({
      companyId: report.company_id,
      pvId: report.pv_id,
      entityType: "reserve_lift",
      entityId: report.id,
      action: "reserve_lift.validation_email_sent",
      metadata: { recipient, numero: report.numero, resend_id: j.id ?? null },
      actor: "email",
    });
    return { ok: true, recipient };
  } catch (e: any) {
    const err = e?.message ?? "unknown";
    await supabaseAdmin.from("email_logs").insert({
      company_id: report.company_id,
      pv_id: report.pv_id,
      recipient_email: recipient,
      email_type: "reserve_lift_validation_request",
      status: "failed",
      subject,
      error_message: err,
    } as never);
    await writeAuditLog({
      companyId: report.company_id,
      pvId: report.pv_id,
      entityType: "reserve_lift",
      entityId: report.id,
      action: "reserve_lift.validation_email_failed",
      metadata: { reason: "exception", error: err, recipient },
      actor: "email",
    });
    return { ok: false, recipient, error: err };
  }
}
