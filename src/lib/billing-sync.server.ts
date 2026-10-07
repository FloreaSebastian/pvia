/**
 * Synchronisation Stripe → PVIA des informations de changement d'offre :
 * changement programmé (subscription schedule), changement en attente de
 * paiement (pending_update) et statut des demandes `billing_plan_changes`.
 *
 * Toujours relu chez Stripe : indépendant de l'ordre d'arrivée des webhooks.
 */
import type Stripe from "stripe";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  buildSyncPlan,
  reconcileRequest,
  type ChangeStatus,
  type ScheduleRead,
} from "./billing-plan-change";
import { sanitizeStripeError } from "./stripe.server";
import {
  readScheduledChange,
  retrieveSubscription,
  type SubState,
} from "./billing-plan-change.server";

export async function syncPlanChangeState(
  stripe: Stripe,
  env: "sandbox" | "live",
  subId: string,
): Promise<(SubState & { scheduleReadFailed: boolean }) | null> {
  let sub: SubState;
  try {
    sub = await retrieveSubscription(stripe, subId);
  } catch (e) {
    sanitizeStripeError(e, "");
    return null;
  }
  let schedule: ScheduleRead;
  try {
    schedule = { ok: true, value: await readScheduledChange(stripe, sub.scheduleId, sub.priceId) };
  } catch (e) {
    sanitizeStripeError(e, "");
    schedule = { ok: false };
  }
  const plan = buildSyncPlan(sub, schedule);

  const db = supabaseAdmin as any;
  await db
    .from("subscriptions")
    .update(plan.patch)
    .eq("stripe_subscription_id", subId)
    .eq("environment", env);
  const scheduled = schedule.ok ? schedule.value : null;

  const { data: open } = await db
    .from("billing_plan_changes")
    .select("id,status,mode,to_price_id,stripe_schedule_id,company_id")
    .eq("stripe_subscription_id", subId)
    .eq("environment", env)
    .in("status", ["payment_pending", "payment_failed", "scheduled"]);

  for (const r of (open ?? []) as any[]) {
    // Lecture du schedule en échec : on ne conclut rien sur les programmations.
    if (plan.skipScheduledReconcile && r.mode === "scheduled") continue;
    const next: ChangeStatus | null = reconcileRequest(r, {
      price_id: sub.priceId,
      pending_price_id: sub.pendingPriceId,
      schedule_id: sub.scheduleId,
      scheduled_price_id: scheduled?.priceId ?? null,
      status: sub.status,
    });
    if (!next || next === r.status) continue;
    await db
      .from("billing_plan_changes")
      .update({ status: next })
      .eq("id", r.id)
      .eq("status", r.status);
    await db.from("audit_logs").insert({
      company_id: r.company_id,
      entity_type: "subscription",
      entity_id: r.id,
      action: `billing.plan_change_${next}`,
      metadata: { environment: env, to: r.to_price_id, from_status: r.status, actor: "system" },
    });
  }
  return { ...sub, scheduleReadFailed: plan.scheduleReadFailed };
}

/** Marque la demande liée à une facture de changement dont le paiement a échoué. */
export async function markPlanChangePaymentFailed(env: "sandbox" | "live", subId: string) {
  const db = supabaseAdmin as any;
  await db
    .from("billing_plan_changes")
    .update({ status: "payment_failed" })
    .eq("stripe_subscription_id", subId)
    .eq("environment", env)
    .eq("status", "payment_pending");
}
