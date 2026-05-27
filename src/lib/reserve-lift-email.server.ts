/**
 * Email helpers for reserve-lift reports.
 * Sends the validated lift PDF to client + a copy to the company.
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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return btoa(binary);
}

function renderLiftValidatedEmail(opts: {
  companyName: string;
  clientName: string;
  numero: string;
  pvNumero: string;
  validatedAt: string;
  isCopy?: boolean;
  branding?: CompanyBrandingSettings;
}) {
  const b = opts.branding ?? DEFAULT_BRANDING_SETTINGS;
  const accent = normalizeHex(b.email_brand_color || b.brand_color, "#1e3a8a");
  const validatedDate = new Date(opts.validatedAt).toLocaleString("fr-FR", {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const title = opts.isCopy
    ? `Copie — Levée ${opts.numero} validée par le client`
    : `Votre validation de levée de réserves`;
  const intro = opts.isCopy
    ? `Le client <strong>${escapeHtml(opts.clientName)}</strong> vient de valider la levée de réserves <strong>${escapeHtml(opts.numero)}</strong> du PV <strong>${escapeHtml(opts.pvNumero)}</strong>.`
    : `Vous avez validé la levée de réserves <strong>${escapeHtml(opts.numero)}</strong> du procès-verbal <strong>${escapeHtml(opts.pvNumero)}</strong>. Vous trouverez ci-joint le PDF final signé.`;
  const footerText = escapeHtml(b.email_footer || "Cet email a été envoyé par PVIA.");
  return `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0"><tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)">
      <tr><td style="padding:32px 40px;background:${accent};color:#fff">
        <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;opacity:.75">PVIA · Levée de réserves validée</div>
        <div style="font-size:24px;font-weight:600;margin-top:8px">${escapeHtml(title)}</div>
      </td></tr>
      <tr><td style="padding:32px 40px">
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6">${intro}</p>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#475569"><strong>Date de validation :</strong> ${validatedDate}</p>
        <div style="margin:24px 0;padding:16px 20px;background:#f0fdf4;border-left:3px solid ${accent};border-radius:8px">
          <p style="margin:0;font-size:13px;color:#065f46;line-height:1.6">📎 Le PV de levée de réserves signé est joint à cet email au format PDF.</p>
        </div>
        <p style="margin:24px 0 0;font-size:13px;color:#64748b;line-height:1.6">Cordialement,<br><strong>${escapeHtml(opts.companyName)}</strong></p>
      </td></tr>
      <tr><td style="padding:20px 40px;background:#f8fafc;color:#94a3b8;font-size:11px;text-align:center;line-height:1.6">
        ${footerText}<br>
        Document signé électroniquement conformément au règlement eIDAS
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

async function sendOne(opts: {
  pvId: string;
  reportId: string;
  companyId: string;
  recipient: string;
  subject: string;
  html: string;
  pdfBytes: Uint8Array;
  pdfFilename: string;
  from: string;
}): Promise<{ ok: boolean; error?: string }> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    await supabaseAdmin.from("email_logs").insert({
      company_id: opts.companyId,
      pv_id: opts.pvId,
      recipient_email: opts.recipient,
      email_type: "reserve_lift_validated",
      status: "failed",
      error_message: "RESEND_API_KEY manquant",
      subject: opts.subject,
    });
    return { ok: false, error: "RESEND_API_KEY manquant" };
  }
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: opts.from,
        to: [opts.recipient],
        subject: opts.subject,
        html: opts.html,
        attachments: [{ filename: opts.pdfFilename, content: bytesToBase64(opts.pdfBytes) }],
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      await supabaseAdmin.from("email_logs").insert({
        company_id: opts.companyId,
        pv_id: opts.pvId,
        recipient_email: opts.recipient,
        email_type: "reserve_lift_validated",
        status: "failed",
        error_message: `${resp.status}: ${body.slice(0, 500)}`,
        subject: opts.subject,
      });
      return { ok: false, error: `${resp.status}` };
    }
    const json = (await resp.json().catch(() => ({}))) as { id?: string };
    await supabaseAdmin.from("email_logs").insert({
      company_id: opts.companyId,
      pv_id: opts.pvId,
      recipient_email: opts.recipient,
      email_type: "reserve_lift_validated",
      status: "sent",
      resend_id: json.id ?? null,
      subject: opts.subject,
      sent_at: new Date().toISOString(),
    });
    return { ok: true };
  } catch (e: any) {
    await supabaseAdmin.from("email_logs").insert({
      company_id: opts.companyId,
      pv_id: opts.pvId,
      recipient_email: opts.recipient,
      email_type: "reserve_lift_validated",
      status: "failed",
      error_message: e?.message ?? "unknown",
      subject: opts.subject,
    });
    return { ok: false, error: e?.message };
  }
}

/**
 * Loads the validated lift PDF and sends it to client + copy to the company.
 */
export async function deliverSignedReserveLift(opts: { reportId: string }): Promise<void> {
  const { data: report } = await supabaseAdmin
    .from("reserve_lift_reports")
    .select(
      "id,numero,pv_id,company_id,pdf_url,client_validated_at,client_validated_email",
    )
    .eq("id", opts.reportId)
    .maybeSingle();
  if (!report?.company_id) throw new Error("Rapport introuvable.");
  if (!report.pdf_url) throw new Error("PDF indisponible.");

  const [pdfFile, { data: pv }, { data: company }, branding] = await Promise.all([
    supabaseAdmin.storage.from("pv-assets").download(report.pdf_url),
    supabaseAdmin.from("pv").select("numero,client_id,sent_to_email").eq("id", report.pv_id).maybeSingle(),
    supabaseAdmin.from("companies").select("name,email").eq("id", report.company_id).maybeSingle(),
    getCompanyBrandingSettings(report.company_id),
  ]);
  if (pdfFile.error || !pdfFile.data) throw new Error("PDF introuvable dans le stockage.");
  const pdfBytes = new Uint8Array(await pdfFile.data.arrayBuffer());

  const { data: client } = pv?.client_id
    ? await supabaseAdmin.from("clients").select("name,email").eq("id", pv.client_id).maybeSingle()
    : { data: null as any };

  const companyName = company?.name || "PVIA";
  const clientName = client?.name || "Cher client";
  const pvNumero = pv?.numero ?? "—";
  const numero = report.numero;
  const pdfFilename = `Levee-${numero}.pdf`;
  const from = process.env.RESEND_FROM_EMAIL || `${companyName} <onboarding@resend.dev>`;
  const subject = `Levée de réserves validée – N° ${numero}`;
  const copySubject = `[Copie] Levée ${numero} validée par ${clientName}`;

  const clientEmail =
    report.client_validated_email || client?.email || pv?.sent_to_email || null;
  const companyEmail = company?.email || null;

  if (clientEmail) {
    await sendOne({
      pvId: report.pv_id,
      reportId: report.id,
      companyId: report.company_id,
      recipient: clientEmail,
      subject,
      html: renderLiftValidatedEmail({
        companyName,
        clientName,
        numero,
        pvNumero,
        validatedAt: report.client_validated_at!,
        branding,
      }),
      pdfBytes,
      pdfFilename,
      from,
    });
  }

  if (companyEmail && companyEmail.toLowerCase() !== (clientEmail || "").toLowerCase()) {
    await sendOne({
      pvId: report.pv_id,
      reportId: report.id,
      companyId: report.company_id,
      recipient: companyEmail,
      subject: copySubject,
      html: renderLiftValidatedEmail({
        companyName,
        clientName,
        numero,
        pvNumero,
        validatedAt: report.client_validated_at!,
        isCopy: true,
        branding,
      }),
      pdfBytes,
      pdfFilename,
      from,
    });
  }

  await writeAuditLog({
    companyId: report.company_id,
    pvId: report.pv_id,
    entityType: "reserve_lift",
    entityId: report.id,
    action: "pv.email_sent",
    metadata: {
      email_type: "reserve_lift_validated",
      recipients: [clientEmail, companyEmail].filter(Boolean),
    },
    actor: "email",
  });
}
