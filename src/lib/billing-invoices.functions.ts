/**
 * Facturation — lecture des factures Stripe (source de vérité financière).
 *
 * Principes :
 *  - PVIA ne recrée JAMAIS de factures locales : tout est lu à la demande chez
 *    Stripe, avec le `stripe_customer_id` résolu CÔTÉ SERVEUR à partir de
 *    l'entreprise authentifiée (jamais fourni par le frontend).
 *  - Toute facture demandée est re-vérifiée : `invoice.customer` doit
 *    correspondre au customer de l'entreprise, sinon accès refusé.
 *  - Les URLs Stripe (PDF, hosted invoice page) sont renvoyées à la demande et
 *    tracées dans le journal d'audit.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isAdminRole } from "@/lib/roles";
import { getStripeClient, sanitizeStripeError, BILLING_MESSAGES, type StripeEnv } from "./stripe.server";
import { writeAuditLog } from "./audit.server";
import { enforceRateLimit } from "./rate-limit.server";

const EnvSchema = z.enum(["sandbox", "live"]);

/* --------------------------- Gardes multi-tenant --------------------------- */

async function assertCompanyBillingAdmin(companyId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from("company_members")
    .select("role,status")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (!data || !isAdminRole((data as any).role)) {
    throw new Error("Seuls les rôles direction / responsable d'exploitation accèdent à la facturation.");
  }
}

/** Résout le Stripe Customer de l'entreprise — jamais accepté du client. */
async function resolveCompanyCustomerId(companyId: string, environment: StripeEnv): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("company_id", companyId)
    .eq("environment", environment)
    .not("stripe_customer_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return ((data as any)?.stripe_customer_id as string | undefined) ?? null;
}

/* ------------------------------- Mapping UI ------------------------------- */

export type InvoiceStatusKey =
  | "paid"
  | "open"
  | "draft"
  | "past_due"
  | "void"
  | "uncollectible"
  | "unknown";

const PLAN_LABELS: Record<string, string> = {
  starter: "Essentiel",
  pro: "Pro",
  business: "Business",
  enterprise: "Entreprise",
};

function planLabelFromLookupKey(key: string | null | undefined): string | null {
  if (!key) return null;
  const [plan, interval] = key.split("_");
  const label = PLAN_LABELS[plan];
  if (!label) return null;
  return `${label} ${interval === "annual" ? "annuel" : "mensuel"}`;
}

function toIso(unix: number | null | undefined): string | null {
  return unix ? new Date(unix * 1000).toISOString() : null;
}

function invoiceStatus(inv: any): InvoiceStatusKey {
  const s = String(inv?.status ?? "");
  if (s === "paid") return "paid";
  if (s === "draft") return "draft";
  if (s === "void") return "void";
  if (s === "uncollectible") return "uncollectible";
  if (s === "open") {
    const due = inv?.due_date ? inv.due_date * 1000 : null;
    if (due && due < Date.now()) return "past_due";
    return "open";
  }
  return "unknown";
}

export type CompanyInvoice = {
  id: string;
  number: string | null;
  created: string | null;
  period_start: string | null;
  period_end: string | null;
  plan_label: string | null;
  currency: string;
  /** Montants en centimes. */
  subtotal_excl_tax: number;
  tax: number;
  total: number;
  amount_paid: number;
  status: InvoiceStatusKey;
  has_pdf: boolean;
  has_hosted_page: boolean;
};

function mapInvoice(inv: any): CompanyInvoice {
  const line = inv?.lines?.data?.[0];
  const lookupKey =
    line?.price?.lookup_key ??
    line?.pricing?.price_details?.price ??
    line?.plan?.metadata?.lovable_external_id ??
    null;
  return {
    id: String(inv.id),
    number: inv.number ?? null,
    created: toIso(inv.created),
    period_start: toIso(line?.period?.start ?? inv.period_start),
    period_end: toIso(line?.period?.end ?? inv.period_end),
    plan_label: planLabelFromLookupKey(typeof lookupKey === "string" ? lookupKey : null),
    currency: String(inv.currency ?? "eur").toUpperCase(),
    subtotal_excl_tax: Number(inv.subtotal_excluding_tax ?? inv.subtotal ?? 0),
    tax: Number(
      inv.tax ??
        (Array.isArray(inv.total_taxes)
          ? inv.total_taxes.reduce((a: number, t: any) => a + Number(t.amount ?? 0), 0)
          : 0),
    ),
    total: Number(inv.total ?? 0),
    amount_paid: Number(inv.amount_paid ?? 0),
    status: invoiceStatus(inv),
    has_pdf: Boolean(inv.invoice_pdf),
    has_hosted_page: Boolean(inv.hosted_invoice_url),
  };
}

/* ------------------------------ Liste factures ----------------------------- */

const ListSchema = z.object({
  companyId: z.string().uuid(),
  environment: EnvSchema,
  limit: z.number().int().min(1).max(50).optional(),
});

export const getCompanyInvoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ListSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertCompanyBillingAdmin(data.companyId, context.userId);
    await enforceRateLimit({
      bucket: "billing_invoices",
      key: `${data.companyId}:${context.userId}`,
      limit: 60,
      windowSec: 60,
    });

    const customerId = await resolveCompanyCustomerId(data.companyId, data.environment);
    if (!customerId) return { invoices: [] as CompanyInvoice[], customerLinked: false as const };

    const stripe = getStripeClient(data.environment);
    try {
      const list = await stripe.invoices.list({
        customer: customerId,
        limit: data.limit ?? 24,
        expand: ["data.lines.data.price"],
      });
      return {
        customerLinked: true as const,
        invoices: list.data.map(mapInvoice),
      };
    } catch (e) {
      throw sanitizeStripeError(e, BILLING_MESSAGES.portal);
    }
  });

/* --------------------------- Document d'une facture -------------------------- */

const DocSchema = z.object({
  companyId: z.string().uuid(),
  environment: EnvSchema,
  invoiceId: z.string().regex(/^in_[A-Za-z0-9]+$/, "Facture introuvable."),
  kind: z.enum(["pdf", "hosted"]),
});

/**
 * Renvoie l'URL Stripe officielle (PDF ou page hébergée) d'UNE facture,
 * après contrôle strict d'appartenance au Stripe Customer de l'entreprise.
 * Un `invoiceId` d'une autre entreprise est rejeté même s'il est valide.
 */
export const getInvoiceDocumentUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => DocSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertCompanyBillingAdmin(data.companyId, context.userId);
    await enforceRateLimit({
      bucket: "billing_invoice_doc",
      key: `${data.companyId}:${context.userId}`,
      limit: 30,
      windowSec: 60,
    });

    const customerId = await resolveCompanyCustomerId(data.companyId, data.environment);
    if (!customerId) throw new Error("Facture introuvable.");

    const stripe = getStripeClient(data.environment);
    let invoice: any;
    try {
      invoice = await stripe.invoices.retrieve(data.invoiceId);
    } catch (e) {
      throw sanitizeStripeError(e, "Facture introuvable.");
    }

    const owner = typeof invoice?.customer === "string" ? invoice.customer : invoice?.customer?.id;
    if (!owner || owner !== customerId) {
      await writeAuditLog({
        companyId: data.companyId,
        userId: context.userId,
        entityType: "invoice",
        action: "billing.invoice_access_denied",
        metadata: { environment: data.environment },
      });
      throw new Error("Facture introuvable.");
    }

    const url = data.kind === "pdf" ? invoice.invoice_pdf : invoice.hosted_invoice_url;
    if (!url) throw new Error("Ce document n'est pas encore disponible chez Stripe.");

    await writeAuditLog({
      companyId: data.companyId,
      userId: context.userId,
      entityType: "invoice",
      entityId: String(invoice.id),
      action: data.kind === "pdf" ? "billing.invoice_pdf_downloaded" : "billing.invoice_viewed",
      metadata: { environment: data.environment, number: invoice.number ?? null },
    });

    return { url: String(url) };
  });

/* --------------------------------- Timeline -------------------------------- */

export type BillingEvent = {
  at: string;
  kind:
    | "trial_started"
    | "trial_ending"
    | "trial_ended"
    | "subscription_started"
    | "invoice_created"
    | "invoice_paid"
    | "payment_failed"
    | "plan_changed"
    | "cancel_scheduled"
    | "canceled"
    | "paused"
    | "resumed"
    | "reactivated";
  title: string;
  detail?: string | null;
};

function eurCents(cents: number, currency = "EUR") {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(cents / 100);
}

const TimelineSchema = z.object({ companyId: z.string().uuid(), environment: EnvSchema });

/**
 * Timeline métier : essai, souscription, factures, paiements, changements de
 * formule, annulation, pause. Aucun événement Stripe purement technique.
 */
export const getBillingTimeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => TimelineSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertCompanyBillingAdmin(data.companyId, context.userId);
    await enforceRateLimit({
      bucket: "billing_timeline",
      key: `${data.companyId}:${context.userId}`,
      limit: 60,
      windowSec: 60,
    });

    const events: BillingEvent[] = [];

    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("trial_started_at,trial_ends_at")
      .eq("id", data.companyId)
      .maybeSingle();
    const trialStart = (company as any)?.trial_started_at as string | null;
    const trialEnd = (company as any)?.trial_ends_at as string | null;
    if (trialStart) {
      events.push({ at: trialStart, kind: "trial_started", title: "Essai gratuit démarré", detail: "14 jours" });
    }
    if (trialEnd) {
      const ended = new Date(trialEnd).getTime() <= Date.now();
      events.push({
        at: trialEnd,
        kind: ended ? "trial_ended" : "trial_ending",
        title: ended ? "Fin de l'essai gratuit" : "Fin de l'essai gratuit prévue",
      });
    }

    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("company_id", data.companyId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const customerId = ((sub as any)?.stripe_customer_id as string | undefined) ?? null;

    if (customerId) {
      const stripe = getStripeClient(data.environment);
      try {
        const [invoices, subs] = await Promise.all([
          stripe.invoices.list({ customer: customerId, limit: 24, expand: ["data.lines.data.price"] }),
          stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 }),
        ]);

        for (const s of subs.data as any[]) {
          const item = s.items?.data?.[0];
          const label = planLabelFromLookupKey(item?.price?.lookup_key ?? null);
          if (s.start_date) {
            events.push({
              at: new Date(s.start_date * 1000).toISOString(),
              kind: "subscription_started",
              title: "Abonnement souscrit",
              detail: label,
            });
          }
          if (s.pause_collection) {
            events.push({
              at: new Date((s.created ?? s.start_date) * 1000).toISOString(),
              kind: "paused",
              title: "Abonnement mis en pause",
            });
          }
          if (s.cancel_at_period_end && s.cancel_at) {
            events.push({
              at: new Date(s.cancel_at * 1000).toISOString(),
              kind: "cancel_scheduled",
              title: "Résiliation programmée",
              detail: label,
            });
          }
          if (s.canceled_at) {
            events.push({
              at: new Date(s.canceled_at * 1000).toISOString(),
              kind: "canceled",
              title: "Abonnement résilié",
              detail: label,
            });
          }
        }

        for (const inv of invoices.data as any[]) {
          const m = mapInvoice(inv);
          const amount = `${eurCents(m.subtotal_excl_tax, m.currency)} HT`;
          if (m.created) {
            events.push({
              at: m.created,
              kind: "invoice_created",
              title: "Facture émise",
              detail: [m.number, m.plan_label, amount].filter(Boolean).join(" — "),
            });
          }
          if (inv.status === "paid" && inv.status_transitions?.paid_at) {
            events.push({
              at: new Date(inv.status_transitions.paid_at * 1000).toISOString(),
              kind: "invoice_paid",
              title: "Paiement effectué",
              detail: [amount, m.plan_label].filter(Boolean).join(" — "),
            });
          }
          if ((inv.status === "open" || inv.status === "uncollectible") && Number(inv.attempt_count ?? 0) > 0) {
            events.push({
              at: toIso(inv.status_transitions?.finalized_at ?? inv.created) ?? new Date().toISOString(),
              kind: "payment_failed",
              title: "Paiement échoué",
              detail: [m.number, amount].filter(Boolean).join(" — "),
            });
          }
        }
      } catch (e) {
        throw sanitizeStripeError(e, BILLING_MESSAGES.portal);
      }
    }

    // Changements de formule / réactivations tracés localement.
    const { data: logs } = await supabaseAdmin
      .from("audit_logs")
      .select("action,created_at,metadata")
      .eq("company_id", data.companyId)
      .in("action", ["billing.plan_changed", "company.auto_unsuspended", "billing.subscription_resumed"])
      .order("created_at", { ascending: false })
      .limit(30);
    for (const l of (logs ?? []) as any[]) {
      events.push({
        at: l.created_at,
        kind:
          l.action === "billing.plan_changed"
            ? "plan_changed"
            : l.action === "billing.subscription_resumed"
              ? "resumed"
              : "reactivated",
        title:
          l.action === "billing.plan_changed"
            ? "Changement de formule"
            : l.action === "billing.subscription_resumed"
              ? "Abonnement repris"
              : "Abonnement réactivé",
        detail: (l.metadata?.plan as string) ?? null,
      });
    }

    events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return { events: events.slice(0, 60) };
  });
