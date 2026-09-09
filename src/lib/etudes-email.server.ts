/**
 * Cahiers des charges — e-mail d'envoi au client.
 * Réutilise le pipeline d'envoi existant (Resend + email_logs + relances).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getCompanyBranding, getCompanyBrandingSettings } from "./branding.server";
import { sendEmailWithRetryLog, type SendEmailResult } from "./email-sender.server";
import { getPublicAppUrl } from "./app-url.server";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendStudyEmail(input: {
  companyId: string;
  studyId: string;
  to: string;
  message?: string;
}): Promise<SendEmailResult> {
  const [{ data: study }, branding, settings] = await Promise.all([
    supabaseAdmin
      .from("technical_studies")
      .select("reference,title,study_type")
      .eq("id", input.studyId)
      .eq("company_id", input.companyId)
      .maybeSingle(),
    getCompanyBranding(input.companyId),
    getCompanyBrandingSettings(input.companyId),
  ]);
  if (!study) throw new Error("Cahier des charges introuvable.");

  const companyName = branding?.name ?? "Votre installateur";
  const portalUrl = `${getPublicAppUrl()}/client/etudes`;
  const subject = `${companyName} — Votre cahier des charges ${study.reference}`;
  const intro = input.message?.trim()
    ? `<p style="margin:0 0 16px;white-space:pre-line">${escapeHtml(input.message.trim())}</p>`
    : "";

  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f5f6f8;font-family:Arial,Helvetica,sans-serif;color:#111">
  <div style="max-width:600px;margin:0 auto;padding:24px">
    <div style="background:${settings.email_brand_color};color:#fff;padding:20px 24px;border-radius:12px 12px 0 0">
      <div style="font-size:18px;font-weight:bold">${escapeHtml(companyName)}</div>
      <div style="font-size:13px;opacity:.9">Cahier des charges ${escapeHtml(study.reference)}</div>
    </div>
    <div style="background:#fff;padding:24px;border-radius:0 0 12px 12px">
      <p style="margin:0 0 16px">Bonjour,</p>
      ${intro}
      <p style="margin:0 0 16px">Nous avons le plaisir de vous transmettre le cahier des charges de votre projet
      ${escapeHtml(study.title ?? "")}. Vous pouvez le consulter et le télécharger depuis votre espace client.</p>
      <p style="margin:24px 0"><a href="${portalUrl}" style="background:${settings.email_brand_color};color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">Consulter mon cahier des charges</a></p>
      <p style="margin:0 0 8px;font-size:13px;color:#555">Ce document est une pré-étude indicative : il ne constitue ni un devis, ni un engagement contractuel. Une visite technique confirmera les éléments retenus.</p>
      <p style="margin:16px 0 0;font-size:12px;color:#777">${escapeHtml(settings.email_footer)}</p>
    </div>
  </div></body></html>`;

  const text = [
    `Bonjour,`,
    input.message?.trim() ?? "",
    `Votre cahier des charges ${study.reference} est disponible dans votre espace client : ${portalUrl}`,
    `Ce document est une pré-étude indicative, il ne constitue ni un devis ni un engagement contractuel.`,
    companyName,
  ]
    .filter(Boolean)
    .join("\n\n");

  return sendEmailWithRetryLog({
    emailType: "study_sent",
    companyId: input.companyId,
    retryable: true,
    payload: {
      from: process.env["RESEND_FROM_EMAIL"] || `${companyName} <noreply@pvia.fr>`,
      to: input.to,
      subject,
      html,
      text,
    },
  });
}
