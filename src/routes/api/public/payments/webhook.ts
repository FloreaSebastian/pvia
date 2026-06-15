import { createFileRoute } from "@tanstack/react-router";
import { type StripeEnv, verifyWebhook, priceToPlan, getStripeClient, assertStripeEnvConsistent, checkStripeEnv } from "@/lib/stripe.server";
import { sendPaymentFailedEmail } from "@/lib/billing-email.server";

// ST-M5: route file lives in client module graph — dynamic import only.
// Caches the shared admin client per-isolate after first call.
let _adminClient: any = null;
async function getSupabase() {
  if (_adminClient) return _adminClient;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  _adminClient = supabaseAdmin;
  return _adminClient;
}

function tsToIso(seconds: number | null | undefined): string | null {
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

async function audit(opts: {
  companyId?: string | null;
  userId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  metadata?: Record<string, unknown>;
}) {
  const db = (await getSupabase()) as any;
  await db.from("audit_logs").insert({
    company_id: opts.companyId ?? null,
    user_id: opts.userId ?? null,
    entity_type: opts.entityType,
    entity_id: opts.entityId,
    action: opts.action,
    metadata: opts.metadata ?? {},
  });
}

async function upsertSubscription(subscription: any, env: StripeEnv, opts?: { auditAction?: string }) {
  const companyId = subscription.metadata?.companyId ?? null;
  const userId = subscription.metadata?.userId ?? null;
  if (!companyId || !userId) {
    console.error("[webhook] subscription missing companyId/userId in metadata", subscription.id);
    return;
  }

  const item = subscription.items?.data?.[0];
  const plan = priceToPlan(item?.price);
  if (!plan) {
    console.error("[webhook] could not resolve plan from price", item?.price?.id);
    return;
  }

  const periodStart = item?.current_period_start ?? subscription.current_period_start;
  const periodEnd = item?.current_period_end ?? subscription.current_period_end;

  const row = {
    company_id: companyId,
    user_id: userId,
    stripe_subscription_id: subscription.id,
    stripe_customer_id: typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id,
    plan,
    status: subscription.status,
    current_period_start: tsToIso(periodStart),
    current_period_end: tsToIso(periodEnd),
    cancel_at_period_end: subscription.cancel_at_period_end ?? false,
    trial_end: tsToIso(subscription.trial_end),
    environment: env,
    updated_at: new Date().toISOString(),
  };

  const db = (await getSupabase()) as any;

  // ST-M4: detect status transition for notifications.
  const { data: prevRow } = await db
    .from("subscriptions")
    .select("status")
    .eq("stripe_subscription_id", subscription.id)
    .maybeSingle();
  const prevStatus: string | null = prevRow?.status ?? null;

  const { error } = await db
    .from("subscriptions")
    .upsert(row, { onConflict: "stripe_subscription_id" });
  if (error) console.error("[webhook] upsert subscription failed", error);

  await audit({
    companyId, userId,
    entityType: "subscription",
    entityId: subscription.id,
    action: opts?.auditAction ?? `subscription.${subscription.status}`,
    metadata: { plan, environment: env, prevStatus },
  });

  // ST-M4: notify on status transitions (active / trialing / past_due / canceled / unpaid).
  if (prevStatus !== subscription.status) {
    await notifySubscriptionStatusChange({
      companyId,
      subscriptionId: subscription.id,
      prevStatus,
      newStatus: subscription.status,
      plan,
      env,
    });
  }
}

const STATUS_NOTIFS: Record<string, { title: string; body: string; auditAction: string }> = {
  active: { title: "Abonnement actif",
    body: "Votre abonnement PVIA est actif. Merci !",
    auditAction: "stripe.subscription_activated" },
  trialing: { title: "Période d'essai démarrée",
    body: "Votre essai PVIA est en cours.",
    auditAction: "stripe.subscription_trialing" },
  past_due: { title: "Paiement en retard",
    body: "Votre dernier paiement n'a pas abouti. Mettez à jour votre moyen de paiement.",
    auditAction: "stripe.subscription_past_due" },
  canceled: { title: "Abonnement annulé",
    body: "Votre abonnement PVIA a été annulé.",
    auditAction: "stripe.subscription_canceled" },
  unpaid: { title: "Abonnement impayé",
    body: "Toutes les tentatives de prélèvement ont échoué. Régularisez pour réactiver l'accès.",
    auditAction: "stripe.subscription_unpaid" },
};

async function notifySubscriptionStatusChange(args: {
  companyId: string;
  subscriptionId: string;
  prevStatus: string | null;
  newStatus: string;
  plan: string | null;
  env: StripeEnv;
}) {
  const cfg = STATUS_NOTIFS[args.newStatus];
  if (!cfg) return;

  // App notification (per-company fanout to owners/admins).
  try {
    const db = (await getSupabase()) as any;
    const { data: members } = await db
      .from("company_members")
      .select("user_id")
      .eq("company_id", args.companyId)
      .eq("status", "active")
      .in("role", ["owner", "admin"]);
    const rows = (members ?? [])
      .filter((m: any) => m.user_id)
      .map((m: any) => ({
        company_id: args.companyId,
        user_id: m.user_id,
        type: cfg.auditAction,
        title: cfg.title,
        body: cfg.body,
      }));
    if (rows.length) await db.from("notifications").insert(rows);
  } catch (e) {
    console.error("[webhook] notification insert failed", e);
  }

  // Push notification (best-effort).
  try {
    const { sendPushToCompany } = await import("@/lib/push.server");
    await sendPushToCompany(args.companyId, {
      title: cfg.title,
      body: cfg.body,
      url: "/billing",
      tag: `sub-${args.newStatus}-${args.subscriptionId}`,
      requireInteraction: args.newStatus === "past_due" || args.newStatus === "unpaid",
      data: { kind: cfg.auditAction },
    });
  } catch (e) {
    console.error("[webhook] push fanout failed", e);
  }

  // Audit (granular per transition, in addition to subscription.<status>).
  await audit({
    companyId: args.companyId,
    entityType: "subscription",
    entityId: args.subscriptionId,
    action: cfg.auditAction,
    metadata: {
      prevStatus: args.prevStatus,
      newStatus: args.newStatus,
      plan: args.plan,
      environment: args.env,
    },
  });
}

// ST-C1: explicit handler for checkout.session.completed.
// Some Stripe configs deliver this before/without customer.subscription.created,
// so we resolve the subscription up front to guarantee the row exists.
async function handleCheckoutCompleted(session: any, env: StripeEnv) {
  const companyId = session.metadata?.companyId ?? null;
  const userId = session.metadata?.userId ?? null;

  await audit({
    companyId, userId,
    entityType: "checkout_session",
    entityId: session.id,
    action: "stripe.checkout_completed",
    metadata: {
      mode: session.mode,
      environment: env,
      subscription: session.subscription ?? null,
      customer: typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
      payment_status: session.payment_status,
    },
  });

  if (session.mode === "subscription" && session.subscription) {
    const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
    try {
      const stripe = getStripeClient(env);
      const sub = await stripe.subscriptions.retrieve(subId, { expand: ["items.data.price"] });
      await upsertSubscription(sub, env, { auditAction: "stripe.subscription_created" });
    } catch (e) {
      console.error("[webhook] retrieve subscription after checkout failed", e);
      await audit({
        companyId, userId,
        entityType: "subscription",
        entityId: subId,
        action: "subscription.created",
        metadata: { error: "retrieve_failed", environment: env, session_id: session.id },
      });
    }
  }
}

// ST-C2/C3 + ST-M3: idempotent cancellation with audit + auto-suspend company.
async function markCanceled(subscription: any, env: StripeEnv) {
  await upsertSubscription({ ...subscription, status: "canceled" }, env, {
    auditAction: "stripe.cancel_processed",
  });

  const companyId = subscription.metadata?.companyId;
  if (companyId) {
    // ST-M3: auto-suspend the company so RLS guards (plan-guard) block
    // further writes. Idempotent: only set suspended_at if currently null.
    try {
      const db = (await getSupabase()) as any;
      const { data: existing } = await db
        .from("companies")
        .select("id,suspended_at")
        .eq("id", companyId)
        .maybeSingle();
      if (existing && !existing.suspended_at) {
        await db.from("companies")
          .update({ suspended_at: new Date().toISOString() })
          .eq("id", companyId);
        await audit({
          companyId,
          entityType: "company",
          entityId: companyId,
          action: "company.auto_suspended",
          metadata: { reason: "subscription_canceled", subscription_id: subscription.id, environment: env },
        });
      }
    } catch (e) {
      console.error("[webhook] auto-suspend failed", e);
    }

    try {
      const { firePushToCompany } = await import("@/lib/push.server");
      firePushToCompany(companyId, {
        title: "Abonnement annulé",
        body: "Votre abonnement PVIA a été annulé.",
        url: "/billing",
        tag: `sub-canceled-${subscription.id}`,
        requireInteraction: true,
        data: { kind: "billing.subscription_canceled" },
      });
    } catch {}
  }
}

async function notifyPaymentFailed(invoice: any, env: StripeEnv) {
  let companyId = invoice?.metadata?.companyId ?? null;
  const subscriptionId = typeof invoice?.subscription === "string" ? invoice.subscription : invoice?.subscription?.id ?? null;

  // ST-M2 partial fix: if invoice metadata is missing companyId, fall back
  // to the subscription row in our DB (cheaper than calling Stripe again).
  if (!companyId && subscriptionId) {
    const db = (await getSupabase()) as any;
    const { data: sub } = await db
      .from("subscriptions")
      .select("company_id")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();
    companyId = sub?.company_id ?? null;
  }
  if (!companyId) {
    console.error("[webhook] payment_failed without resolvable companyId", invoice?.id);
    return;
  }
  try {
    const { firePushToCompany } = await import("@/lib/push.server");
    firePushToCompany(companyId, {
      title: "Paiement échoué",
      body: "Le règlement de votre abonnement a échoué. Mettez à jour votre moyen de paiement.",
      url: "/billing",
      tag: `payment-failed-${invoice.id}`,
      requireInteraction: true,
      data: { kind: "billing.payment_failed" },
    });
  } catch {}
  await audit({
    companyId,
    entityType: "invoice",
    entityId: invoice.id,
    action: "billing.payment_failed",
    metadata: { amount_due: invoice.amount_due, currency: invoice.currency, environment: env },
  });

  // ST-M1: persist past_due on the subscription row so the UI/plan-guard
  // sees the correct state even before customer.subscription.updated lands.
  if (subscriptionId) {
    try {
      const db = (await getSupabase()) as any;
      await db
        .from("subscriptions")
        .update({ status: "past_due", updated_at: new Date().toISOString() })
        .eq("stripe_subscription_id", subscriptionId)
        .neq("status", "canceled");
    } catch (e) {
      console.error("[webhook] subscription past_due update failed", e);
    }
  }

  // EM-C2: send "payment failed" email (idempotent per invoice_id).
  try {
    await sendPaymentFailedEmail({
      companyId,
      invoiceId: invoice.id ?? null,
      subscriptionId,
      amountDue: invoice.amount_due ?? null,
      currency: invoice.currency ?? null,
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      plan: invoice.lines?.data?.[0]?.price?.lookup_key ?? null,
      environment: env,
    });
  } catch (e) {
    console.error("[webhook] payment-failed email error", e);
  }
}

/** EM-C2 sister-trigger: notify on subscription → past_due (idempotent per invoice). */
async function notifyPastDue(subscription: any, env: StripeEnv) {
  const companyId = subscription.metadata?.companyId ?? null;
  if (!companyId) return;
  const latestInvoice = typeof subscription.latest_invoice === "string"
    ? subscription.latest_invoice : subscription.latest_invoice?.id ?? null;
  try {
    await sendPaymentFailedEmail({
      companyId,
      invoiceId: latestInvoice,
      subscriptionId: subscription.id,
      amountDue: null,
      currency: null,
      hostedInvoiceUrl: null,
      plan: subscription.items?.data?.[0]?.price?.lookup_key ?? null,
      environment: env,
    });
  } catch (e) {
    console.error("[webhook] past_due email error", e);
  }
}

async function handleWebhook(req: Request, env: StripeEnv) {
  // ST-C4: refuse to process if env credentials are missing/mismatched.
  const envReport = checkStripeEnv(env);
  if (!envReport.ok) {
    await audit({
      entityType: "stripe_event",
      entityId: "env_guard",
      action: "stripe.env_mismatch_blocked",
      metadata: { env, errors: envReport.errors },
    });
    throw new Error(`STRIPE_ENV_MISMATCH:${env}: ${envReport.errors.join("; ")}`);
  }

  const event = await verifyWebhook(req, env);
  const eventId = (event as any).id as string | undefined;
  console.log("[webhook] event:", event.type, eventId);

  // ST-C2/C3: idempotency gate. Insert event_id; on PK conflict, ignore.
  if (eventId) {
    const db = (await getSupabase()) as any;
    const { error: dupErr } = await db.from("stripe_webhook_events").insert({
      event_id: eventId,
      event_type: event.type,
      environment: env,
    });
    if (dupErr) {
      const code = (dupErr as { code?: string }).code;
      if (code === "23505") {
        await audit({
          entityType: "stripe_event",
          entityId: eventId,
          action: event.type === "customer.subscription.deleted"
            ? "stripe.cancel_duplicate_ignored"
            : "stripe.duplicate_ignored",
          metadata: { event_type: event.type, environment: env },
        });
        return;
      }
      console.error("[webhook] idempotency insert failed", dupErr);
    }
  }

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event.data.object, env);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object;
      await upsertSubscription(sub, env);
      // EM-C2 sister-trigger: notify on past_due transitions.
      if (sub?.status === "past_due") {
        await notifyPastDue(sub, env);
      }
      break;
    }
    case "customer.subscription.deleted":
      await markCanceled(event.data.object, env);
      break;
    case "invoice.payment_failed":
      await notifyPaymentFailed(event.data.object, env);
      break;
    default:
      console.log("[webhook] unhandled:", event.type);
  }
}
// Keep noqa-ref for assertStripeEnvConsistent (re-exported for callers)
void assertStripeEnvConsistent;

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get("env");
        if (rawEnv !== "sandbox" && rawEnv !== "live") {
          return Response.json({ received: true, ignored: "invalid env" });
        }
        try {
          await handleWebhook(request, rawEnv);
          return Response.json({ received: true });
        } catch (e) {
          console.error("[webhook] error", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
