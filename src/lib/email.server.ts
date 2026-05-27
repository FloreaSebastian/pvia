import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAuditLog } from "./audit.server";
import { getCompanyBrandingSettings, normalizeHex, DEFAULT_BRANDING_SETTINGS, type CompanyBrandingSettings } from "./branding.server";


function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/**
 * Email premium passwordless — code de connexion espace client.
 * Fond blanc, accent #1e40af, code en gros, contexte connexion, lien CTA.
 */
function renderClientLoginCodeEmail(opts: {
  code: string;
  ip: string;
  device: string;
  verifyUrl: string;
  expiresMin: number;
}) {
  const { code, ip, device, verifyUrl, expiresMin } = opts;
  return `<!doctype html><html><body style="margin:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;background:#f6f7f9"><tr><td align="center">
    <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)">
      <tr><td style="padding:28px 36px 8px">
        <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#1e40af;font-weight:600">PVIA · Connexion sécurisée</div>
        <div style="font-size:22px;font-weight:600;margin-top:10px;color:#0f172a">Votre code de connexion</div>
      </td></tr>
      <tr><td style="padding:8px 36px 0">
        <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#334155">
          Utilisez le code ci-dessous pour accéder à votre espace client PVIA.
        </p>
        <div style="margin:24px 0;padding:22px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;text-align:center">
          <div style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:42px;letter-spacing:14px;font-weight:700;color:#1e40af">${escapeHtml(code)}</div>
          <div style="margin-top:10px;font-size:12px;color:#64748b">Valide ${expiresMin} minutes · usage unique</div>
        </div>
        <div style="text-align:center;margin:0 0 24px">
          <a href="${escapeHtml(verifyUrl)}" style="display:inline-block;padding:12px 24px;background:#1e40af;color:#ffffff;text-decoration:none;border-radius:10px;font-size:14px;font-weight:600">Se connecter à PVIA</a>
        </div>
        <div style="margin:24px 0 0;padding:14px 16px;background:#fafafa;border-radius:10px;font-size:12px;color:#64748b;line-height:1.6">
          Demande émise depuis <strong>${escapeHtml(ip)}</strong> · ${escapeHtml(device)}.<br>
          Si vous n'avez pas demandé ce code, ignorez simplement cet email — aucun accès n'a été créé.
        </div>
      </td></tr>
      <tr><td style="padding:20px 36px 28px;color:#94a3b8;font-size:11px;text-align:center;line-height:1.6">
        PVIA — Réception de travaux intelligente<br>
        Connexion sans mot de passe · sécurisée
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

/**
 * Envoie l'email de code passwordless via Resend. Throw si Resend indisponible
 * — l'appelant (sendClientLoginCode) attrape déjà l'erreur.
 */
export async function sendClientLoginCodeEmail(opts: {
  to: string;
  code: string;
  ip: string;
  device: string;
  companyId?: string | null;
}): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  const appUrl = process.env.PUBLIC_APP_URL?.replace(/\/$/, "") || "https://pvia.fr";
  const verifyUrl = `${appUrl}/client/verify?email=${encodeURIComponent(opts.to)}`;
  const from = process.env.RESEND_FROM_EMAIL || `PVIA <noreply@pvia.fr>`;
  const html = renderClientLoginCodeEmail({
    code: opts.code,
    ip: opts.ip,
    device: opts.device,
    verifyUrl,
    expiresMin: 10,
  });
  const subject = "Votre code de connexion PVIA";

  // OTP code = sensitive secret. Log the attempt for audit/monitoring but
  // NEVER persist the payload — auto-retry would re-emit a stale code and
  // the code is short-lived (10 min) anyway. Failed sends surface in admin
  // monitoring as `manual_required`.
  async function logAttempt(status: "sent" | "failed", error?: string, resendId?: string) {
    try {
      await supabaseAdmin.from("email_logs").insert({
        company_id: opts.companyId ?? null,
        recipient_email: opts.to,
        email_type: "client_login_code",
        subject,
        status,
        error_message: error ?? null,
        resend_id: resendId ?? null,
        payload: null,
        max_retries: 0,
        retries_count: 0,
        sent_at: status === "sent" ? new Date().toISOString() : null,
      } as never);
    } catch {}
  }

  if (!resendKey) {
    await logAttempt("failed", "RESEND_API_KEY manquant");
    throw new Error("RESEND_API_KEY manquant");
  }
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [opts.to], subject, html }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    const err = `Resend ${resp.status}: ${body.slice(0, 200)}`;
    await logAttempt("failed", err);
    throw new Error(err);
  }
  const j = (await resp.json().catch(() => ({}))) as { id?: string };
  await logAttempt("sent", undefined, j.id);
}

function renderEnterpriseLoginCodeEmail(opts: {
  code: string;
  ip: string;
  device: string;
  expiresMin: number;
}) {
  const { code, ip, device, expiresMin } = opts;
  return `<!doctype html><html><body style="margin:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;background:#f6f7f9"><tr><td align="center">
    <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)">
      <tr><td style="padding:28px 36px 8px">
        <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#1e40af;font-weight:700">PVIA · Connexion sécurisée</div>
        <div style="font-size:22px;font-weight:700;margin-top:10px;color:#0f172a">Votre code de connexion PVIA</div>
      </td></tr>
      <tr><td style="padding:8px 36px 0">
        <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#334155">
          Utilisez ce code à 8 chiffres pour accéder à votre espace professionnel PVIA.
        </p>
        <div style="margin:24px 0;padding:22px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;text-align:center">
          <div style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:42px;letter-spacing:14px;font-weight:800;color:#1e40af">${escapeHtml(code)}</div>
          <div style="margin-top:10px;font-size:12px;color:#64748b">Valide ${expiresMin} minutes · usage unique</div>
        </div>
        <div style="margin:24px 0 0;padding:14px 16px;background:#fafafa;border-radius:10px;font-size:12px;color:#64748b;line-height:1.6">
          Demande émise depuis <strong>${escapeHtml(ip)}</strong> · ${escapeHtml(device)}.<br>
          Si vous n'avez pas demandé ce code, ignorez simplement cet email.
        </div>
      </td></tr>
      <tr><td style="padding:20px 36px 28px;color:#94a3b8;font-size:11px;text-align:center;line-height:1.6">
        PVIA — Réception de travaux intelligente<br>
        Aucun lien de connexion n'est inclus dans cet email.
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

export async function sendEnterpriseLoginCodeEmail(opts: {
  to: string;
  code: string;
  ip: string;
  device: string;
  companyId?: string | null;
}): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || `PVIA <noreply@pvia.fr>`;
  const subject = "Votre code de connexion PVIA";
  const html = renderEnterpriseLoginCodeEmail({
    code: opts.code,
    ip: opts.ip,
    device: opts.device,
    expiresMin: 10,
  });

  async function logAttempt(status: "sent" | "failed", error?: string, resendId?: string) {
    try {
      await supabaseAdmin.from("email_logs").insert({
        company_id: opts.companyId ?? null,
        recipient_email: opts.to,
        email_type: "enterprise_login_code",
        subject,
        status,
        error_message: error ?? null,
        resend_id: resendId ?? null,
        payload: null,
        max_retries: 0,
        retries_count: 0,
        sent_at: status === "sent" ? new Date().toISOString() : null,
      } as never);
    } catch {}
  }

  if (!resendKey) {
    await logAttempt("failed", "RESEND_API_KEY manquant");
    throw new Error("Configuration email indisponible.");
  }

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [opts.to], subject, html }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    const err = `Resend ${resp.status}: ${body.slice(0, 200)}`;
    await logAttempt("failed", err);
    throw new Error("Impossible d'envoyer le code pour le moment.");
  }

  const j = (await resp.json().catch(() => ({}))) as { id?: string };
  await logAttempt("sent", undefined, j.id);
}

/**
 * Onsite client OTP — sent during in-person PV signature to confirm the
 * client's identity by email before locking the PV as 'signe'.
 */
function renderOnsiteOtpEmail(opts: { code: string; companyName: string }) {
  const { code, companyName } = opts;
  return `<!doctype html><html><body style="margin:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;background:#f6f7f9"><tr><td align="center">
    <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)">
      <tr><td style="padding:28px 36px 8px">
        <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#1e3a8a;font-weight:700">PVIA · Confirmation de signature</div>
        <div style="font-size:22px;font-weight:700;margin-top:10px;color:#0f172a">Validez votre signature</div>
      </td></tr>
      <tr><td style="padding:8px 36px 0">
        <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#334155">
          <strong>${escapeHtml(companyName)}</strong> vous demande de confirmer la signature d'un procès-verbal de réception de travaux. Communiquez le code ci-dessous au technicien sur place pour valider votre signature.
        </p>
        <div style="margin:24px 0;padding:22px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;text-align:center">
          <div style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:42px;letter-spacing:14px;font-weight:800;color:#1e3a8a">${escapeHtml(code)}</div>
          <div style="margin-top:10px;font-size:12px;color:#64748b">Valide 10 minutes · usage unique</div>
        </div>
        <div style="margin:20px 0 0;padding:14px 16px;background:#fef3c7;border-left:3px solid #f59e0b;border-radius:8px;font-size:12px;color:#78350f;line-height:1.6">
          ⚠️ Ne transmettez ce code à personne d'autre que le technicien présent sur place pour signature. Si vous n'êtes pas en train de signer un PV, ignorez cet email.
        </div>
      </td></tr>
      <tr><td style="padding:20px 36px 28px;color:#94a3b8;font-size:11px;text-align:center;line-height:1.6">
        PVIA — Réception de travaux intelligente
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

export async function sendOnsiteOtpEmail(opts: {
  to: string;
  code: string;
  companyName: string;
  companyId: string;
}): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || `PVIA <noreply@pvia.fr>`;
  const subject = `Code de confirmation – Signature PV ${opts.companyName}`;
  const html = renderOnsiteOtpEmail({ code: opts.code, companyName: opts.companyName });

  async function logAttempt(status: "sent" | "failed", error?: string, resendId?: string) {
    try {
      await supabaseAdmin.from("email_logs").insert({
        company_id: opts.companyId,
        recipient_email: opts.to,
        email_type: "onsite_client_otp",
        subject,
        status,
        error_message: error ?? null,
        resend_id: resendId ?? null,
        payload: null,
        max_retries: 0,
        retries_count: 0,
        sent_at: status === "sent" ? new Date().toISOString() : null,
      } as never);
    } catch {}
  }

  if (!resendKey) {
    await logAttempt("failed", "RESEND_API_KEY manquant");
    throw new Error("Configuration email indisponible.");
  }
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [opts.to], subject, html }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    await logAttempt("failed", `Resend ${resp.status}: ${body.slice(0, 200)}`);
    throw new Error("Impossible d'envoyer le code de confirmation.");
  }
  const j = (await resp.json().catch(() => ({}))) as { id?: string };
  await logAttempt("sent", undefined, j.id);
}





function bytesToBase64(bytes: Uint8Array): string {
  // Chunk to avoid call stack issues on large buffers
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return btoa(binary);
}

function renderSignedPvEmail(opts: {
  companyName: string;
  clientName: string;
  pvNumero: string;
  chantierName?: string | null;
  signedAt: string;
  isCopy?: boolean;
  branding?: CompanyBrandingSettings;
}) {
  const { companyName, clientName, pvNumero, chantierName, signedAt, isCopy } = opts;
  const b = opts.branding ?? DEFAULT_BRANDING_SETTINGS;
  const accent = normalizeHex(b.email_brand_color || b.brand_color, "#1e3a8a");
  const signedDate = new Date(signedAt).toLocaleString("fr-FR", {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const title = isCopy ? `Copie — PV ${pvNumero} signé` : `Votre procès-verbal signé est disponible`;
  const intro = isCopy
    ? `Le client <strong>${escapeHtml(clientName)}</strong> vient de signer électroniquement le PV <strong>${escapeHtml(pvNumero)}</strong>.`
    : `Nous avons le plaisir de vous transmettre votre procès-verbal <strong>${escapeHtml(pvNumero)}</strong> signé électroniquement.`;
  const signatureHtml = b.email_signature
    ? `<div style="margin-top:18px;padding-top:14px;border-top:1px solid #e2e8f0;white-space:pre-line;font-size:13px;color:#475569;line-height:1.55">${escapeHtml(b.email_signature)}</div>`
    : `<p style="margin:24px 0 0;font-size:13px;color:#64748b;line-height:1.6">Cordialement,<br><strong>${escapeHtml(companyName)}</strong></p>`;
  const footerText = escapeHtml(b.email_footer || "Cet email a été envoyé par PVIA.");
  return `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0"><tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)">
      <tr><td style="padding:32px 40px;background:${accent};color:#fff">
        <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;opacity:.75">PVIA · Document signé</div>
        <div style="font-size:24px;font-weight:600;margin-top:8px">${escapeHtml(title)}</div>
      </td></tr>
      <tr><td style="padding:32px 40px">
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6">Bonjour${isCopy ? "" : " " + escapeHtml(clientName)},</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6">${intro}</p>
        ${chantierName ? `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#475569"><strong>Chantier :</strong> ${escapeHtml(chantierName)}</p>` : ""}
        <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#475569"><strong>Date de signature :</strong> ${signedDate}</p>
        <div style="margin:24px 0;padding:16px 20px;background:#f0f9ff;border-left:3px solid ${accent};border-radius:8px">
          <p style="margin:0;font-size:13px;color:#0c4a6e;line-height:1.6">📎 Le PV signé est joint à cet email au format PDF. Vous pouvez l'archiver, l'imprimer ou le partager.</p>
        </div>
        ${signatureHtml}
      </td></tr>
      <tr><td style="padding:20px 40px;background:#f8fafc;color:#94a3b8;font-size:11px;text-align:center;line-height:1.6">
        ${footerText}<br>
        Signé électroniquement conformément au règlement eIDAS
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}


export type SendSignedPvResult = {
  recipient: string;
  status: "sent" | "failed";
  resendId?: string;
  error?: string;
};

/**
 * Sends the signed PV PDF as an attachment to one recipient via Resend and logs the attempt.
 * Returns the per-recipient outcome; never throws.
 */
export async function sendSignedPvEmailTo(opts: {
  pvId: string;
  companyId: string;
  recipient: string;
  emailType: "signed_to_client" | "signed_copy_to_company" | "signed_resend";
  subject: string;
  html: string;
  pdfBytes: Uint8Array;
  pdfFilename: string;
  from: string;
}): Promise<SendSignedPvResult> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    await supabaseAdmin.from("email_logs").insert({
      company_id: opts.companyId,
      pv_id: opts.pvId,
      recipient_email: opts.recipient,
      email_type: opts.emailType,
      status: "failed",
      error_message: "RESEND_API_KEY manquant",
      subject: opts.subject,
    });
    return { recipient: opts.recipient, status: "failed", error: "RESEND_API_KEY manquant" };
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
        attachments: [
          { filename: opts.pdfFilename, content: bytesToBase64(opts.pdfBytes) },
        ],
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      await supabaseAdmin.from("email_logs").insert({
        company_id: opts.companyId,
        pv_id: opts.pvId,
        recipient_email: opts.recipient,
        email_type: opts.emailType,
        status: "failed",
        error_message: `${resp.status}: ${body.slice(0, 500)}`,
        subject: opts.subject,
      });
      await writeAuditLog({
        companyId: opts.companyId, pvId: opts.pvId, entityType: "email",
        action: "pv.email_failed",
        metadata: { recipient: opts.recipient, email_type: opts.emailType, status: resp.status },
        actor: "email",
      });
      return { recipient: opts.recipient, status: "failed", error: `${resp.status}` };
    }
    const json = (await resp.json().catch(() => ({}))) as { id?: string };
    await supabaseAdmin.from("email_logs").insert({
      company_id: opts.companyId,
      pv_id: opts.pvId,
      recipient_email: opts.recipient,
      email_type: opts.emailType,
      status: "sent",
      resend_id: json.id ?? null,
      subject: opts.subject,
      sent_at: new Date().toISOString(),
    });
    await writeAuditLog({
      companyId: opts.companyId, pvId: opts.pvId, entityType: "email",
      action: "pv.email_sent",
      metadata: { recipient: opts.recipient, email_type: opts.emailType, resend_id: json.id ?? null, subject: opts.subject },
      actor: "email",
    });
    // Fire push (fan-out, never throws). Only for client-bound emails to avoid noise on internal copies.
    if (opts.emailType !== "signed_copy_to_company") {
      try {
        const { firePushToCompany } = await import("./push.server");
        firePushToCompany(opts.companyId, {
          title: "PV envoyé au client",
          body: `Envoyé à ${opts.recipient}`,
          url: `/pv/${opts.pvId}`,
          tag: `pv-email-${opts.pvId}`,
          data: { kind: "pv.email_sent", pvId: opts.pvId },
        });
      } catch {}
    }
    return { recipient: opts.recipient, status: "sent", resendId: json.id };
  } catch (e: any) {
    const msg = e?.message || "Erreur inconnue";
    await supabaseAdmin.from("email_logs").insert({
      company_id: opts.companyId,
      pv_id: opts.pvId,
      recipient_email: opts.recipient,
      email_type: opts.emailType,
      status: "failed",
      error_message: msg,
      subject: opts.subject,
    });
    return { recipient: opts.recipient, status: "failed", error: msg };
  }
}

/**
 * Loads the signed PV PDF and metadata, then sends it to the client AND a copy to the company.
 * Used by `signPvByToken` (auto after signature) and by the manual resend server fn.
 */
export async function deliverSignedPv(opts: {
  pvId: string;
  trigger: "auto" | "manual";
}): Promise<{ client?: SendSignedPvResult; company?: SendSignedPvResult; pvNumero: string }> {
  const { data: pv } = await supabaseAdmin
    .from("pv")
    .select("id,numero,company_id,client_id,chantier_id,pdf_url,signed_at,sent_to_email")
    .eq("id", opts.pvId)
    .maybeSingle();
  if (!pv) throw new Error("PV introuvable.");
  if (!pv.company_id) throw new Error("PV sans entreprise.");
  if (!pv.pdf_url) throw new Error("PDF non disponible — veuillez régénérer.");
  if (!pv.signed_at) throw new Error("Le PV n'est pas signé.");

  const [{ data: company }, { data: settings }, clientRes, chantierRes, pdfFile, branding] = await Promise.all([
    supabaseAdmin.from("companies").select("name,email").eq("id", pv.company_id).maybeSingle(),
    supabaseAdmin.from("company_settings")
      .select("pv_email_recipients,pv_email_cc,send_signed_pv_to_company,company_signed_email")
      .eq("company_id", pv.company_id).maybeSingle(),
    pv.client_id
      ? supabaseAdmin.from("clients").select("name,email").eq("id", pv.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
    pv.chantier_id
      ? supabaseAdmin.from("chantiers").select("name").eq("id", pv.chantier_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin.storage.from("pv-assets").download(pv.pdf_url),
    getCompanyBrandingSettings(pv.company_id),
  ]);
  if (pdfFile.error || !pdfFile.data) throw new Error("PDF introuvable dans le stockage.");
  const pdfBytes = new Uint8Array(await pdfFile.data.arrayBuffer());

  const client = (clientRes as any).data as { name?: string; email?: string } | null;
  const chantier = (chantierRes as any).data as { name?: string } | null;
  const companyName = company?.name || "PVIA";
  const clientName = client?.name || "Cher client";
  const pvNumero = pv.numero;
  const pdfFilename = `PV-${pvNumero}-signe.pdf`;
  const from = process.env.RESEND_FROM_EMAIL || `${companyName} <noreply@pvia.fr>`;
  const subject = `Votre procès-verbal signé – PVIA (${pvNumero})`;
  const copySubject = `[Copie] PV ${pvNumero} signé par ${clientName}`;

  const clientEmail = client?.email || pv.sent_to_email || null;
  const sendToCompany = (settings as any)?.send_signed_pv_to_company !== false;
  const companyEmail = sendToCompany ? ((settings as any)?.company_signed_email || company?.email || null) : null;
  const ccExtra: string[] = [
    ...(((settings as any)?.pv_email_recipients ?? []) as string[]),
    ...(((settings as any)?.pv_email_cc ?? []) as string[]),
  ]
    .map((e) => e?.trim().toLowerCase())
    .filter((e): e is string => !!e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

  const results: { client?: SendSignedPvResult; company?: SendSignedPvResult; pvNumero: string } = { pvNumero };

  if (clientEmail) {
    results.client = await sendSignedPvEmailTo({
      pvId: pv.id,
      companyId: pv.company_id,
      recipient: clientEmail,
      emailType: opts.trigger === "manual" ? "signed_resend" : "signed_to_client",
      subject,
      html: renderSignedPvEmail({
        companyName, clientName, pvNumero,
        chantierName: chantier?.name, signedAt: pv.signed_at, branding,
      }),
      pdfBytes, pdfFilename, from,
    });
  }

  if (companyEmail && companyEmail.toLowerCase() !== (clientEmail || "").toLowerCase()) {
    results.company = await sendSignedPvEmailTo({
      pvId: pv.id,
      companyId: pv.company_id,
      recipient: companyEmail,
      emailType: "signed_copy_to_company",
      subject: copySubject,
      html: renderSignedPvEmail({
        companyName, clientName, pvNumero,
        chantierName: chantier?.name, signedAt: pv.signed_at, isCopy: true, branding,
      }),
      pdfBytes, pdfFilename, from,
    });
  }

  // Additional CC recipients (configured in company settings)
  const ccSeen = new Set<string>(
    [clientEmail, companyEmail].filter(Boolean).map((e) => e!.toLowerCase()),
  );
  for (const cc of ccExtra) {
    if (ccSeen.has(cc)) continue;
    ccSeen.add(cc);
    await sendSignedPvEmailTo({
      pvId: pv.id,
      companyId: pv.company_id,
      recipient: cc,
      emailType: "signed_copy_to_company",
      subject: copySubject,
      html: renderSignedPvEmail({
        companyName, clientName, pvNumero,
        chantierName: chantier?.name, signedAt: pv.signed_at, isCopy: true, branding,
      }),
      pdfBytes, pdfFilename, from,
    });
  }

  const allRecipients = Array.from(ccSeen);
  if (allRecipients.length) {
    await supabaseAdmin.from("notifications").insert({
      company_id: pv.company_id,
      type: "pv_signed_emailed",
      title: "PV signé envoyé par email",
      body: `Le PV ${pvNumero} signé a été envoyé à ${allRecipients.join(", ")}.`,
    });
  }

  return results;
}

