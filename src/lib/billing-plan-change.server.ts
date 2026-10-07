/**
 * Changement d'offre — opérations Stripe (serveur uniquement).
 * Ce module ne touche pas la base : il reçoit un client Stripe et renvoie
 * des résultats bruts, ce qui permet de l'exercer en sandbox Stripe sans
 * aucune donnée PVIA.
 */
import type Stripe from "stripe";
import {
  amountsFromInvoice,
  classifyPaymentIntentStatus,
  parsePriceId,
  type ChangeMode,
  type PreviewAmounts,
} from "./billing-plan-change";

const toIso = (s: number | null | undefined) => (s ? new Date(s * 1000).toISOString() : null);

export function lookupKeyOf(price: any): string | null {
  if (!price || typeof price === "string") return null;
  return price.lookup_key ?? price.metadata?.lovable_external_id ?? null;
}

/** Prix Stripe du catalogue EXISTANT, vérifié (actif, EUR, périodicité cohérente). */
export async function resolveCatalogPrice(stripe: Stripe, lookupKey: string) {
  const parsed = parsePriceId(lookupKey);
  if (!parsed) throw new Error("PRICE_NOT_ALLOWED");
  const list = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 2 });
  const price = list.data[0];
  if (!price || list.data.length !== 1) throw new Error("PRICE_UNAVAILABLE");
  const expected = parsed.interval === "annual" ? "year" : "month";
  if (price.currency !== "eur" || price.recurring?.interval !== expected || price.type !== "recurring") {
    throw new Error("PRICE_UNAVAILABLE");
  }
  return price;
}

export type SubState = {
  id: string;
  status: string;
  customerId: string;
  itemId: string;
  priceId: string | null; // lookup key
  stripePriceId: string | null;
  periodEnd: string | null;
  periodEndUnix: number | null;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
  scheduleId: string | null;
  pendingPriceId: string | null;
  pendingExpiresAt: string | null;
  companyId: string | null;
};

export function snapshotSubscription(sub: any): SubState {
  const item = sub.items?.data?.[0];
  const periodEnd = item?.current_period_end ?? sub.current_period_end ?? null;
  const pendingItem = sub.pending_update?.subscription_items?.[0];
  return {
    id: sub.id,
    status: sub.status,
    customerId: typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
    itemId: item?.id,
    priceId: lookupKeyOf(item?.price),
    stripePriceId: typeof item?.price === "string" ? item.price : item?.price?.id ?? null,
    periodEnd: toIso(periodEnd),
    periodEndUnix: periodEnd,
    trialEnd: toIso(sub.trial_end),
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    scheduleId: typeof sub.schedule === "string" ? sub.schedule : sub.schedule?.id ?? null,
    pendingPriceId: sub.pending_update ? (lookupKeyOf(pendingItem?.price) ?? "inconnu") : null,
    pendingExpiresAt: toIso(sub.pending_update?.expires_at),
    companyId: sub.metadata?.companyId ?? null,
  };
}

export async function retrieveSubscription(stripe: Stripe, subId: string) {
  const sub = await stripe.subscriptions.retrieve(subId, {
    expand: ["items.data.price", "pending_update.subscription_items.price"] as any,
  } as any);
  return snapshotSubscription(sub);
}

/** Changement programmé lu sur le schedule Stripe attaché, sinon null. */
export async function readScheduledChange(stripe: Stripe, scheduleId: string | null, currentPriceId: string | null) {
  if (!scheduleId) return null;
  const sched: any = await stripe.subscriptionSchedules.retrieve(scheduleId, { expand: ["phases.items.price"] } as any);
  if (!["active", "not_started"].includes(sched.status)) return null;
  const now = Math.floor(Date.now() / 1000);
  const next = (sched.phases ?? []).find((p: any) => p.start_date > now);
  if (!next) return null;
  const key = lookupKeyOf(next.items?.[0]?.price);
  if (!key || key === currentPriceId) return null;
  const parsed = parsePriceId(key);
  return {
    scheduleId: sched.id as string,
    priceId: key,
    plan: parsed?.plan ?? null,
    interval: parsed?.interval ?? null,
    at: toIso(next.start_date),
  };
}

/* --------------------------------- Aperçu --------------------------------- */

export type StripePreview = {
  mode: ChangeMode;
  dueNow: PreviewAmounts | null;
  nextInvoice: PreviewAmounts | null;
  effectiveAt: string;
  nextBillingAt: string | null;
  prorationDate: number | null;
};

export async function previewChange(
  stripe: Stripe,
  sub: SubState,
  target: Stripe.Price,
  mode: ChangeMode,
): Promise<StripePreview> {
  const trialing = sub.status === "trialing";
  const targetInterval = target.recurring?.interval === "year" ? "year" : "month";

  // Montant d'une échéance pleine au nouveau tarif (TVA calculée par Stripe
  // selon l'adresse du client) : simulation de nouvel abonnement, rien n'est créé.
  const renewal: any = await (stripe.invoices as any).createPreview({
    customer: sub.customerId,
    automatic_tax: { enabled: true },
    subscription_details: { items: [{ price: target.id, quantity: 1 }] },
  });
  const nextInvoice = amountsFromInvoice(renewal);

  if (mode === "scheduled") {
    const at = sub.periodEnd ?? new Date().toISOString();
    const nextEnd = new Date(at);
    if (targetInterval === "year") nextEnd.setFullYear(nextEnd.getFullYear() + 1);
    else nextEnd.setMonth(nextEnd.getMonth() + 1);
    return { mode, dueNow: null, nextInvoice, effectiveAt: at, nextBillingAt: at, prorationDate: null };
  }

  if (trialing) {
    return {
      mode,
      dueNow: { currency: nextInvoice.currency, ht: 0, tva: 0, ttc: 0, credit: 0 },
      nextInvoice,
      effectiveAt: new Date().toISOString(),
      nextBillingAt: sub.trialEnd,
      prorationDate: null,
    };
  }

  const prorationDate = Math.floor(Date.now() / 1000);
  const inv: any = await (stripe.invoices as any).createPreview({
    customer: sub.customerId,
    subscription: sub.id,
    subscription_details: {
      items: [{ id: sub.itemId, price: target.id, quantity: 1 }],
      proration_behavior: "always_invoice",
      proration_date: prorationDate,
    },
  });
  // Prochaine échéance : fin de la ligne « nouvelle période » si la
  // périodicité change, sinon la fin de période actuelle est conservée.
  const ends = (inv.lines?.data ?? []).map((l: any) => l.period?.end ?? 0);
  const maxEnd = ends.length ? Math.max(...ends) : 0;
  const nextBillingAt = toIso(Math.max(maxEnd, sub.periodEndUnix ?? 0));
  return {
    mode,
    dueNow: amountsFromInvoice(inv),
    nextInvoice,
    effectiveAt: new Date(prorationDate * 1000).toISOString(),
    nextBillingAt,
    prorationDate,
  };
}

/* ------------------------------- Application ------------------------------- */

export type ImmediateResult =
  | { outcome: "applied"; sub: SubState; invoiceId: string | null }
  | {
      outcome: "payment_pending" | "payment_failed";
      reason: "sca_required" | "payment_failed" | "processing";
      sub: SubState;
      invoiceId: string | null;
      hostedInvoiceUrl: string | null;
    };

async function invoicePaymentStatus(stripe: Stripe, invoiceId: string) {
  const inv: any = await stripe.invoices.retrieve(invoiceId, {
    expand: ["payments.data.payment.payment_intent"],
  } as any);
  const pi = inv.payments?.data?.[0]?.payment?.payment_intent;
  return {
    status: inv.status as string,
    hosted: (inv.hosted_invoice_url as string) ?? null,
    piStatus: (typeof pi === "object" ? pi?.status : null) as string | null,
  };
}

/**
 * Montée de gamme immédiate. `pending_if_incomplete` : si le paiement du
 * prorata échoue ou exige une authentification forte, Stripe CONSERVE
 * l'ancien tarif (donc les anciens droits) et place le changement en
 * attente ; il ne s'applique qu'après paiement confirmé.
 */
export async function applyImmediate(
  stripe: Stripe,
  sub: SubState,
  target: Stripe.Price,
  opts: { prorationDate: number | null; idempotencyKey: string },
): Promise<ImmediateResult> {
  const trialing = sub.status === "trialing";
  if (sub.scheduleId) {
    // Une montée annule toute baisse programmée (le schedule bloquerait la mise à jour).
    await stripe.subscriptionSchedules.release(sub.scheduleId, {}, { idempotencyKey: `${opts.idempotencyKey}-release` });
  }
  const updated: any = await stripe.subscriptions.update(
    sub.id,
    {
      items: [{ id: sub.itemId, price: target.id, quantity: 1 }],
      proration_behavior: trialing ? "none" : "always_invoice",
      ...(opts.prorationDate && !trialing ? { proration_date: opts.prorationDate } : {}),
      payment_behavior: "pending_if_incomplete",
      expand: ["items.data.price", "pending_update.subscription_items.price", "latest_invoice"],
    } as any,
    { idempotencyKey: opts.idempotencyKey },
  );
  const snap = snapshotSubscription(updated);
  const invoiceId = typeof updated.latest_invoice === "string" ? updated.latest_invoice : updated.latest_invoice?.id ?? null;
  if (!updated.pending_update) return { outcome: "applied", sub: snap, invoiceId };

  let reason: "sca_required" | "payment_failed" | "processing" = "payment_failed";
  let hosted: string | null = null;
  if (invoiceId) {
    const st = await invoicePaymentStatus(stripe, invoiceId);
    hosted = st.hosted;
    reason = classifyPaymentIntentStatus(st.piStatus) ?? "payment_failed";
  }
  return {
    outcome: reason === "payment_failed" ? "payment_failed" : "payment_pending",
    reason,
    sub: snap,
    invoiceId,
    hostedInvoiceUrl: hosted,
  };
}

/** Baisse / annuel → mensuel : programmée à la fin de période payée. */
export async function scheduleChange(
  stripe: Stripe,
  sub: SubState,
  target: Stripe.Price,
  opts: { idempotencyKey: string; metadata: Record<string, string> },
) {
  if (!sub.periodEndUnix || !sub.stripePriceId) throw new Error("PERIOD_UNKNOWN");
  let scheduleId = sub.scheduleId;
  if (!scheduleId) {
    const created = await stripe.subscriptionSchedules.create(
      { from_subscription: sub.id },
      { idempotencyKey: `${opts.idempotencyKey}-create` },
    );
    scheduleId = created.id;
  }
  const sched: any = await stripe.subscriptionSchedules.retrieve(scheduleId);
  const now = Math.floor(Date.now() / 1000);
  const current =
    (sched.phases ?? []).find((p: any) => p.start_date <= now && (!p.end_date || p.end_date > now)) ??
    sched.phases?.[0];
  const interval = target.recurring?.interval === "year" ? "year" : "month";
  const updated = await stripe.subscriptionSchedules.update(
    scheduleId,
    {
      end_behavior: "release",
      proration_behavior: "none",
      metadata: opts.metadata,
      phases: [
        {
          items: [{ price: sub.stripePriceId, quantity: 1 }],
          start_date: current?.start_date ?? now,
          end_date: sub.periodEndUnix,
          proration_behavior: "none",
          automatic_tax: { enabled: true },
        },
        {
          items: [{ price: target.id, quantity: 1 }],
          duration: { interval, interval_count: 1 },
          proration_behavior: "none",
          automatic_tax: { enabled: true },
        },
      ],
    } as any,
    { idempotencyKey: `${opts.idempotencyKey}-update` },
  );
  return { scheduleId: updated.id, effectiveAt: toIso(sub.periodEndUnix)! };
}

/** Annule la programmation : l'abonnement reste sur sa formule actuelle. */
export async function cancelScheduled(stripe: Stripe, scheduleId: string, idempotencyKey: string) {
  await stripe.subscriptionSchedules.release(scheduleId, {}, { idempotencyKey });
}
