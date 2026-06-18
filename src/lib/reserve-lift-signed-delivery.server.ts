/**
 * EM-B1 — Email automatique APRÈS signature de la levée de réserves.
 *
 * Comportement :
 *  - mode "on_site"  → PDF client envoyé au client + PDF interne envoyé à l'entreprise.
 *  - mode "remote"   → PDF interne envoyé à l'entreprise (le client reçoit déjà
 *                       le lien de validation via sendReserveLiftValidationRequestEmail).
 *
 * Audits émis :
 *  - reserve_lift.email_client_sent / email_client_failed
 *  - reserve_lift.email_company_sent / email_company_failed
 *
 * Best-effort : jamais throw.
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

function renderEmail(opts: {
  companyName: string;
  recipientName: string;
  numero: string;
  pvNumero: string;
  signedAt: string;
  audience: "client" | "company";
  mode: "on_site" | "remote";
  branding?: CompanyBrandingSettings;
}) {
  const b = opts.branding ?? DEFAULT_BRANDING_SETTINGS;
  const accent = normalizeHex(b.email_brand_color || b.brand_color, "#1e3a8a");
  const signedDate = new Date(opts.signedAt).toLocaleString("fr-FR", {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const title =
    opts.audience === "client"
      ? `Levée de réserves ${opts.numero} signée`
      : `Copie interne — Levée ${opts.numero} signée`;
  let intro = "";
  if (opts.audience === "client") {
    intro = `Bonjour ${escapeHtml(opts.recipientName)},<br><br>
      <strong>${escapeHtml(opts.companyName)}</strong> vient de signer avec vous la levée de réserves
      <strong>${escapeHtml(opts.numero)}</strong> liée au procès-verbal <strong>${escapeHtml(opts.pvNumero)}</strong>.
      Vous trouverez ci-joint le PDF signé.`;
  } else if (opts.mode === "on_site") {
    intro = `Copie interne : la levée de réserves <strong>${escapeHtml(opts.numero)}</strong>
      (PV <strong>${escapeHtml(opts.pvNumero)}</strong>) a été signée sur place avec le client.
      Le PDF interne (avec métadonnées EXIF/GPS) est joint.`;
  } else {
    intro = `Copie interne : la levée de réserves <strong>${escapeHtml(opts.numero)}</strong>
      (PV <strong>${escapeHtml(opts.pvNumero)}</strong>) a été signée par votre équipe.
      Le client a été notifié et doit la valider depuis son espace.
      Le PDF interne (avec métadonnées EXIF/GPS) est joint.`;
  }
  const footerText = escapeHtml(b.email_footer || "Cet email a été envoyé par PVIA.");
  return `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0"><tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)">
      <tr><td style="padding:32px 40px;background:${accent};color:#fff">
        <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;opacity:.75">PVIA · Levée de réserves</div>
        <div style="font-size:24px;font-weight:600;margin-top:8px">${escapeHtml(title)}</div>
      </td></tr>
      <tr><td style="padding:32px 40px">
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6">${intro}</p>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#475569"><strong>Signée le :</strong> ${signedDate}</p>
        <div style="margin:24px 0;padding:16px 20px;background:#f0fdf4;border-left:3px solid ${accent};border-radius:8px">
          <p style="margin:0;font-size:13px;color:#065f46;line-height:1.6">📎 Le PDF est joint à cet email.</p>
        </div>
        <p style="margin:24px 0 0;font-size:13px;color:#64748b;line-height:1.6">Cordialement,<br><strong>${escapeHtml(opts.companyName)}</strong></p>
      </td></tr>
      <tr><td style="padding:20px 40px;background:#f8fafc;color:#94a3b8;font-size:11px;text-align:center;line-height:1.6">
        ${footerText}<br>Document signé électroniquement conformément au règlement eIDAS
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
  emailType: string;
  audience: "client" | "company";
}): Promise<{ ok: boolean; error?: string }> {
  const resendKey = process.env.RESEND_API_KEY;
  const auditOk = opts.audience === "client" ? "reserve_lift.email_client_sent" : "reserve_lift.email_company_sent";
  const auditFail = opts.audience === "client" ? "reserve_lift.email_client_failed" : "reserve_lift.email_company_failed";

  const fail = async (err: string) => {
    await supabaseAdmin.from("email_logs").insert({
      company_id: opts.companyId,
      pv_id: opts.pvId,
      recipient_email: opts.recipient,
      email_type: opts.emailType,
      status: "failed",
      error_message: err.slice(0, 500),
      subject: opts.subject,
    } as never);
    await writeAuditLog({
      companyId: opts.companyId, pvId: opts.pvId,
      entityType: "reserve_lift", entityId: opts.reportId,
      action: auditFail, metadata: { recipient: opts.recipient, error: err.slice(0, 300) },
      actor: "email",
    });
    return { ok: false, error: err };
  };

  if (!resendKey) return fail("RESEND_API_KEY manquant");

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
      return fail(`${resp.status}: ${body.slice(0, 300)}`);
    }
    const j = (await resp.json().catch(() => ({}))) as { id?: string };
    await supabaseAdmin.from("email_logs").insert({
      company_id: opts.companyId,
      pv_id: opts.pvId,
      recipient_email: opts.recipient,
      email_type: opts.emailType,
      status: "sent",
      resend_id: j.id ?? null,
      subject: opts.subject,
      sent_at: new Date().toISOString(),
    } as never);
    await writeAuditLog({
      companyId: opts.companyId, pvId: opts.pvId,
      entityType: "reserve_lift", entityId: opts.reportId,
      action: auditOk, metadata: { recipient: opts.recipient, resend_id: j.id ?? null },
      actor: "email",
    });
    return { ok: true };
  } catch (e: any) {
    return fail(e?.message ?? "unknown");
  }
}

async function downloadPdf(path: string | null | undefined): Promise<Uint8Array | null> {
  if (!path) return null;
  const f = await supabaseAdmin.storage.from("pv-assets").download(path);
  if (f.error || !f.data) return null;
  return new Uint8Array(await f.data.arrayBuffer());
}

/**
 * Send the post-signature emails (client + company) for a freshly signed lift.
 * Mode-aware: on_site sends to both parties, remote only to company copy.
 */
export async function deliverReserveLiftAtSignature(opts: {
  reportId: string;
  mode: "on_site" | "remote";
}): Promise<void> {
  const { data: report } = await supabaseAdmin
    .from("reserve_lift_reports")
    .select("id,numero,pv_id,company_id,signed_at,pdf_client_url,pdf_internal_url,pdf_url")
    .eq("id", opts.reportId)
    .maybeSingle();
  if (!report?.company_id || !report.pv_id) return;

  const [{ data: pv }, { data: company }, branding] = await Promise.all([
    supabaseAdmin.from("pv").select("id,numero,client_id,sent_to_email").eq("id", report.pv_id).maybeSingle(),
    supabaseAdmin.from("companies").select("name,email").eq("id", report.company_id).maybeSingle(),
    getCompanyBrandingSettings(report.company_id),
  ]);
  const { data: client } = pv?.client_id
    ? await supabaseAdmin.from("clients").select("name,email").eq("id", pv.client_id).maybeSingle()
    : { data: null as any };

  const companyName = company?.name || "PVIA";
  const clientName = client?.name || "Cher client";
  const pvNumero = pv?.numero ?? "—";
  const numero = report.numero;
  const signedAt = report.signed_at ?? new Date().toISOString();
  const from = process.env.RESEND_FROM_EMAIL || `${companyName} <noreply@pvia.fr>`;

  const clientEmail = client?.email || pv?.sent_to_email || null;
  const companyEmail = company?.email || null;

  // --- Client (on_site only) -----------------------------------------------
  if (opts.mode === "on_site") {
    if (!clientEmail) {
      await writeAuditLog({
        companyId: report.company_id, pvId: report.pv_id,
        entityType: "reserve_lift", entityId: report.id,
        action: "reserve_lift.email_client_failed",
        metadata: { reason: "no_recipient", mode: opts.mode },
        actor: "email",
      });
    } else {
      const clientPdf = await downloadPdf((report as any).pdf_client_url ?? report.pdf_url);
      if (!clientPdf) {
        await writeAuditLog({
          companyId: report.company_id, pvId: report.pv_id,
          entityType: "reserve_lift", entityId: report.id,
          action: "reserve_lift.email_client_failed",
          metadata: { reason: "pdf_unavailable", recipient: clientEmail, mode: opts.mode },
          actor: "email",
        });
      } else {
        await sendOne({
          pvId: report.pv_id, reportId: report.id, companyId: report.company_id,
          recipient: clientEmail,
          subject: `Levée de réserves signée — N° ${numero}`,
          html: renderEmail({
            companyName, recipientName: clientName, numero, pvNumero, signedAt,
            audience: "client", mode: opts.mode, branding,
          }),
          pdfBytes: clientPdf,
          pdfFilename: `Levee-${numero}.pdf`,
          from,
          emailType: "reserve_lift_signed_client",
          audience: "client",
        });
      }
    }
  }

  // --- Company copy (always) ----------------------------------------------
  if (!companyEmail) {
    await writeAuditLog({
      companyId: report.company_id, pvId: report.pv_id,
      entityType: "reserve_lift", entityId: report.id,
      action: "reserve_lift.email_company_failed",
      metadata: { reason: "no_recipient", mode: opts.mode },
      actor: "email",
    });
    return;
  }
  if (companyEmail.toLowerCase() === (clientEmail || "").toLowerCase() && opts.mode === "on_site") {
    // Same address already received the client email — skip duplicate.
    return;
  }
  const internalPdf = await downloadPdf((report as any).pdf_internal_url ?? (report as any).pdf_client_url ?? report.pdf_url);
  if (!internalPdf) {
    await writeAuditLog({
      companyId: report.company_id, pvId: report.pv_id,
      entityType: "reserve_lift", entityId: report.id,
      action: "reserve_lift.email_company_failed",
      metadata: { reason: "pdf_unavailable", recipient: companyEmail, mode: opts.mode },
      actor: "email",
    });
    return;
  }
  await sendOne({
    pvId: report.pv_id, reportId: report.id, companyId: report.company_id,
    recipient: companyEmail,
    subject:
      opts.mode === "on_site"
        ? `[Copie] Levée ${numero} signée sur place`
        : `[Copie] Levée ${numero} signée — en attente validation client`,
    html: renderEmail({
      companyName, recipientName: companyName, numero, pvNumero, signedAt,
      audience: "company", mode: opts.mode, branding,
    }),
    pdfBytes: internalPdf,
    pdfFilename: `Levee-${numero}-interne.pdf`,
    from,
    emailType: "reserve_lift_signed_company",
    audience: "company",
  });
}
