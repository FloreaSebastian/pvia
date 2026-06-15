import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { type StripeEnv, verifyWebhook, priceToPlan, createStripeClient } from "@/lib/stripe.server";

let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _supabase;
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
  const db = getSupabase() as any;
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

  const db = getSupabase() as any;
  const { error } = await db
    .from("subscriptions")
    .upsert(row, { onConflict: "stripe_subscription_id" });
  if (error) console.error("[webhook] upsert subscription failed", error);

  await audit({
    companyId, userId,
    entityType: "subscription",
    entityId: subscription.id,
    action: opts?.auditAction ?? `subscription.${subscription.status}`,
    metadata: { plan, environment: env },
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
      const stripe = createStripeClient(env);
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

// ST-C2/C3: idempotent cancellation with audit.
// Upsert ensures the row exists even if `subscription.deleted` arrives
// before `subscription.created` (out-of-order webhook delivery).
async function markCanceled(subscription: any, env: StripeEnv) {
  // Re-use upsertSubscription with a forced canceled status; this preserves
  // the canonical row shape (NOT NULL columns satisfied) and writes the
  // standard subscription.canceled audit.
  await upsertSubscription({ ...subscription, status: "canceled" }, env, {
    auditAction: "stripe.cancel_processed",
  });

  const companyId = subscription.metadata?.companyId;
  if (companyId) {
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
    const db = getSupabase() as any;
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
}

async function handleWebhook(req: Request, env: StripeEnv) {
  const event = await verifyWebhook(req, env);
  const eventId = (event as any).id as string | undefined;
  console.log("[webhook] event:", event.type, eventId);

  // ST-C2/C3: idempotency gate. Insert event_id; on PK conflict, ignore.
  if (eventId) {
    const db = getSupabase() as any;
    const { error: dupErr } = await db.from("stripe_webhook_events").insert({
      event_id: eventId,
      event_type: event.type,
      environment: env,
    });
    if (dupErr) {
      const code = (dupErr as { code?: string }).code;
      if (code === "23505") {
        // Already processed — audit + return success so Stripe stops retrying.
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
      // Unknown DB error — log but proceed (don't lose the event).
      console.error("[webhook] idempotency insert failed", dupErr);
    }
  }

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event.data.object, env);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await upsertSubscription(event.data.object, env);
      break;
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
