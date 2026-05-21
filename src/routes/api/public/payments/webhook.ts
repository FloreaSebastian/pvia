import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { type StripeEnv, verifyWebhook, priceToPlan } from "@/lib/stripe.server";

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

async function upsertSubscription(subscription: any, env: StripeEnv) {
  const companyId = subscription.metadata?.companyId;
  const userId = subscription.metadata?.userId;
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

  await db.from("audit_logs").insert({
    company_id: companyId,
    user_id: userId,
    entity_type: "subscription",
    entity_id: subscription.id,
    action: `subscription.${subscription.status}`,
    metadata: { plan, environment: env },
  });
}

async function markCanceled(subscription: any, env: StripeEnv) {
  const db = getSupabase() as any;
  await db
    .from("subscriptions")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", subscription.id)
    .eq("environment", env);
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

async function notifyPaymentFailed(invoice: any) {
  const companyId = invoice?.metadata?.companyId;
  if (!companyId) return;
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
  const db = getSupabase() as any;
  await db.from("audit_logs").insert({
    company_id: companyId,
    entity_type: "invoice",
    entity_id: invoice.id,
    action: "billing.payment_failed",
    metadata: { amount_due: invoice.amount_due, currency: invoice.currency },
  });
}

async function handleWebhook(req: Request, env: StripeEnv) {
  const event = await verifyWebhook(req, env);
  console.log("[webhook] event:", event.type);

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await upsertSubscription(event.data.object, env);
      break;
    case "customer.subscription.deleted":
      await markCanceled(event.data.object, env);
      break;
    case "invoice.payment_failed":
      await notifyPaymentFailed(event.data.object);
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
