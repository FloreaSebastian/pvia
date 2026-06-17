/**
 * EM-C2 — Email "paiement échoué".
 *
 * Triggered from the Stripe webhook on `invoice.payment_failed` or when
 * a subscription transitions to status='past_due'. Idempotent per Stripe
 * event id (the webhook handler already drops duplicate events before
 * reaching here).
 *
 * Recipients (in order): company owner email, company.email fallback.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ADMIN_ROLES, OWNER_ROLES, SIGN_ROLES, isAdminRole, isManageRole } from "@/lib/roles";
import { writeAuditLog } from "./audit.server";

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function renderPaymentFailedEmail(opts: {
  companyName: string;
  plan: string | null;
  amount: string | null;
  hostedInvoiceUrl: string | null;
  portalUrl: string;
  retryWindowDays: number;
}) {
  return `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0"><tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)">
      <tr><td style="padding:32px 40px;background:#b91c1c;color:#fff">
        <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;opacity:.85">PVIA · Facturation</div>
        <div style="font-size:24px;font-weight:600;margin-top:8px">Paiement échoué</div>
      </td></tr>
      <tr><td style="padding:32px 40px">
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6">Bonjour ${escapeHtml(opts.companyName)},</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6">
          Le prélèvement de votre abonnement <strong>${escapeHtml(opts.plan ?? "PVIA")}</strong>
          ${opts.amount ? `(<strong>${escapeHtml(opts.amount)}</strong>)` : ""} a échoué.
        </p>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#475569">
          Nous allons retenter automatiquement le prélèvement dans les prochains jours.
          Sans mise à jour de votre moyen de paiement sous <strong>${opts.retryWindowDays} jours</strong>,
          votre abonnement sera suspendu et l'accès à PVIA limité.
        </p>
        <div style="text-align:center;margin:28px 0">
          <a href="${escapeHtml(opts.portalUrl)}" style="display:inline-block;padding:14px 28px;background:#1e3a8a;color:#fff;text-decoration:none;border-radius:10px;font-size:14px;font-weight:600">Mettre à jour mon moyen de paiement</a>
        </div>
        ${opts.hostedInvoiceUrl ? `<p style="text-align:center;margin:0 0 16px"><a href="${escapeHtml(opts.hostedInvoiceUrl)}" style="color:#1e3a8a;font-size:13px">Voir la facture concernée</a></p>` : ""}
        <p style="margin:24px 0 0;padding:14px 16px;background:#fef2f2;border-left:3px solid #b91c1c;border-radius:8px;font-size:13px;color:#7f1d1d;line-height:1.6">
          Besoin d'aide ? Écrivez-nous à <a href="mailto:contact@pvia.fr" style="color:#7f1d1d">contact@pvia.fr</a>.
        </p>
      </td></tr>
      <tr><td style="padding:20px 40px;background:#f8fafc;color:#94a3b8;font-size:11px;text-align:center;line-height:1.6">
        PVIA — Réception de travaux intelligente
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

function formatAmount(amount: number | null | undefined, currency: string | null | undefined): string | null {
  if (typeof amount !== "number" || !currency) return null;
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: currency.toUpperCase() }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export async function sendPaymentFailedEmail(opts: {
  companyId: string;
  invoiceId?: string | null;
  subscriptionId?: string | null;
  amountDue?: number | null;
  currency?: string | null;
  hostedInvoiceUrl?: string | null;
  plan?: string | null;
  environment: "sandbox" | "live";
}): Promise<{ ok: boolean; recipients: string[]; error?: string }> {
  // Idempotency: skip if we already sent one for this invoice
  if (opts.invoiceId) {
    const { data: prior } = await supabaseAdmin
      .from("email_logs")
      .select("id")
      .eq("company_id", opts.companyId)
      .eq("email_type", "billing_payment_failed")
      .eq("status", "sent")
      .contains("payload" as never, { invoice_id: opts.invoiceId } as never)
      .limit(1);
    if (prior && prior.length > 0) {
      return { ok: true, recipients: [], error: "already_sent" };
    }
  }

  const { data: company } = await supabaseAdmin
    .from("companies")
    .select("name,email")
    .eq("id", opts.companyId)
    .maybeSingle();
  if (!company) return { ok: false, recipients: [], error: "company_not_found" };

  const { data: owners } = await supabaseAdmin
    .from("company_members")
    .select("user_id")
    .eq("company_id", opts.companyId)
    .eq("role", "owner")
    .eq("status", "active");
  let ownerEmails: string[] = [];
  if (owners && owners.length > 0) {
    const ids = owners.map((o) => o.user_id).filter(Boolean) as string[];
    if (ids.length > 0) {
      const { data: users } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
      ownerEmails = (users?.users ?? [])
        .filter((u) => ids.includes(u.id) && !!u.email)
        .map((u) => u.email!.toLowerCase());
    }
  }
  const recipients = Array.from(new Set([...ownerEmails, company.email].filter(Boolean) as string[]));
  if (recipients.length === 0) {
    await writeAuditLog({
      companyId: opts.companyId,
      entityType: "invoice",
      entityId: opts.invoiceId ?? opts.subscriptionId ?? "unknown",
      action: "billing.payment_failed_email_failed",
      metadata: { reason: "no_recipient", environment: opts.environment },
      actor: "email",
    });
    return { ok: false, recipients: [], error: "no_recipient" };
  }

  const appUrl = (process.env.PUBLIC_APP_URL || "https://pvia.fr").replace(/\/$/, "");
  const portalUrl = `${appUrl}/billing`;
  const amount = formatAmount(opts.amountDue ?? null, opts.currency ?? null);
  const subject = `PVIA — Paiement échoué${amount ? ` (${amount})` : ""}`;
  const html = renderPaymentFailedEmail({
    companyName: company.name || "votre entreprise",
    plan: opts.plan ?? null,
    amount,
    hostedInvoiceUrl: opts.hostedInvoiceUrl ?? null,
    portalUrl,
    retryWindowDays: 7,
  });
  const from = process.env.RESEND_FROM_EMAIL || `PVIA <noreply@pvia.fr>`;
  const resendKey = process.env.RESEND_API_KEY;

  async function logRow(recipient: string, status: "sent" | "failed", err?: string, resendId?: string) {
    await supabaseAdmin.from("email_logs").insert({
      company_id: opts.companyId,
      recipient_email: recipient,
      email_type: "billing_payment_failed",
      status,
      subject,
      error_message: err ?? null,
      resend_id: resendId ?? null,
      sent_at: status === "sent" ? new Date().toISOString() : null,
      payload: {
        invoice_id: opts.invoiceId ?? null,
        subscription_id: opts.subscriptionId ?? null,
        environment: opts.environment,
      } as never,
    } as never);
  }

  if (!resendKey) {
    for (const r of recipients) await logRow(r, "failed", "RESEND_API_KEY manquant");
    await writeAuditLog({
      companyId: opts.companyId,
      entityType: "invoice",
      entityId: opts.invoiceId ?? opts.subscriptionId ?? "unknown",
      action: "billing.payment_failed_email_failed",
      metadata: { reason: "resend_key_missing", recipients, environment: opts.environment },
      actor: "email",
    });
    return { ok: false, recipients, error: "RESEND_API_KEY manquant" };
  }

  const sent: string[] = [];
  const failed: Array<{ to: string; err: string }> = [];
  for (const recipient of recipients) {
    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [recipient], subject, html }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        const err = `${resp.status}: ${body.slice(0, 200)}`;
        await logRow(recipient, "failed", err);
        failed.push({ to: recipient, err });
      } else {
        const j = (await resp.json().catch(() => ({}))) as { id?: string };
        await logRow(recipient, "sent", undefined, j.id);
        sent.push(recipient);
      }
    } catch (e: any) {
      const err = e?.message ?? "unknown";
      await logRow(recipient, "failed", err);
      failed.push({ to: recipient, err });
    }
  }

  if (sent.length > 0) {
    await writeAuditLog({
      companyId: opts.companyId,
      entityType: "invoice",
      entityId: opts.invoiceId ?? opts.subscriptionId ?? "unknown",
      action: "billing.payment_failed_email_sent",
      metadata: {
        recipients: sent,
        invoice_id: opts.invoiceId ?? null,
        subscription_id: opts.subscriptionId ?? null,
        environment: opts.environment,
      },
      actor: "email",
    });
  }
  if (failed.length > 0) {
    await writeAuditLog({
      companyId: opts.companyId,
      entityType: "invoice",
      entityId: opts.invoiceId ?? opts.subscriptionId ?? "unknown",
      action: "billing.payment_failed_email_failed",
      metadata: { failed, environment: opts.environment },
      actor: "email",
    });
  }
  return { ok: sent.length > 0, recipients: sent, error: failed.length > 0 ? failed[0].err : undefined };
}
