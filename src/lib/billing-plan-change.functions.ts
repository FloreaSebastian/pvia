/**
 * Changement d'offre autonome depuis /billing.
 * Aperçu recalculé côté serveur → demande enregistrée (10 min) → confirmation
 * protégée (verrou atomique, relecture Stripe, clé d'idempotence).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isAdminRole } from "@/lib/roles";
import { CHECKOUT_PRICE_IDS } from "./plans";
import {
  CHANGE_BLOCK_MESSAGES,
  changeBlockReason,
  computeOverages,
  decideChange,
  parsePriceId,
} from "./billing-plan-change";

const EnvSchema = z.enum(["sandbox", "live"]);
const PREVIEW_TTL_MS = 10 * 60_000;

const MSG = {
  generic: "Le changement de formule est momentanément indisponible. Réessayez dans quelques instants.",
  stale: "Votre abonnement a changé depuis l'aperçu. Relancez l'aperçu pour voir les montants à jour.",
  expired: "Cet aperçu a expiré ou a déjà été utilisé. Relancez l'aperçu.",
  busy: "Un changement de formule est déjà en cours de traitement. Patientez quelques secondes.",
  ack: "Confirmez avoir pris connaissance des dépassements avant de continuer.",
  noSchedule: "Aucun changement programmé à annuler.",
};

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;
}

async function assertBillingAdmin(companyId: string, userId: string) {
  const db = await admin();
  const { data } = await db
    .from("company_members")
    .select("role")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (!data || !isAdminRole(data.role)) throw new Error("Seuls owner/admin peuvent gérer la facturation.");
}

/** Ligne d'abonnement de CETTE entreprise faisant autorité (jamais un id fourni par le client). */
async function loadCompanySubscription(companyId: string, env: "sandbox" | "live") {
  const db = await admin();
  const { data } = await db
    .from("subscriptions")
    .select("stripe_subscription_id,stripe_customer_id,status,cancel_at_period_end,pending_price_id,created_at")
    .eq("company_id", companyId)
    .eq("environment", env)
    .order("created_at", { ascending: false });
  const rank = (s: string) => (s === "active" || s === "trialing" ? 0 : ["past_due", "unpaid", "incomplete"].includes(s) ? 1 : 2);
  return ((data ?? []) as any[]).slice().sort((a, b) => rank(a.status) - rank(b.status))[0] ?? null;
}

async function stripeFor(env: "sandbox" | "live") {
  const { getStripeClient } = await import("./stripe.server");
  return getStripeClient(env);
}

function friendly(e: unknown, fallback = MSG.generic): Error {
  const m = e instanceof Error ? e.message : "";
  if (m === "PRICE_NOT_ALLOWED" || m === "PRICE_UNAVAILABLE") return new Error(CHANGE_BLOCK_MESSAGES.invalid);
  console.error("[plan-change]", e);
  return new Error(fallback);
}

/** Abonnement Stripe relu et rattaché à l'entreprise (anti accès inter-entreprises). */
async function loadVerifiedStripeSub(companyId: string, env: "sandbox" | "live") {
  const row = await loadCompanySubscription(companyId, env);
  const block = changeBlockReason(row);
  if (block) throw new Error(block);
  const stripe = await stripeFor(env);
  const { retrieveSubscription } = await import("./billing-plan-change.server");
  let sub;
  try {
    sub = await retrieveSubscription(stripe, row.stripe_subscription_id);
  } catch (e) {
    throw friendly(e);
  }
  if (sub.customerId !== row.stripe_customer_id || (sub.companyId && sub.companyId !== companyId)) {
    throw new Error("Accès refusé.");
  }
  const live = changeBlockReason({
    status: sub.status,
    cancel_at_period_end: sub.cancelAtPeriodEnd,
    stripe_subscription_id: sub.id,
    pending_price_id: sub.pendingPriceId,
  });
  if (live) throw new Error(live);
  if (!sub.priceId || !parsePriceId(sub.priceId)) {
    throw new Error("Votre formule actuelle ne peut pas être modifiée en libre-service. Contactez contact@pvia.fr.");
  }
  return { stripe, sub };
}

/* --------------------------------- Aperçu --------------------------------- */

const PreviewSchema = z.object({
  companyId: z.string().uuid(),
  environment: EnvSchema,
  targetPriceId: z.enum(CHECKOUT_PRICE_IDS as [string, ...string[]]),
});

export const previewPlanChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => PreviewSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertBillingAdmin(data.companyId, context.userId);
    const { enforceRateLimit } = await import("./rate-limit.server");
    await enforceRateLimit({ bucket: "plan_change_preview", key: data.companyId, limit: 30, windowSec: 300 });

    const { stripe, sub } = await loadVerifiedStripeSub(data.companyId, data.environment);
    const decision = decideChange(sub.priceId!, data.targetPriceId, { trialing: sub.status === "trialing" });
    if (!decision.ok) throw new Error(decision.reason === "same" ? CHANGE_BLOCK_MESSAGES.same : CHANGE_BLOCK_MESSAGES.invalid);

    const srv = await import("./billing-plan-change.server");
    let target, preview;
    try {
      target = await srv.resolveCatalogPrice(stripe, data.targetPriceId);
      preview = await srv.previewChange(stripe, sub, target, decision.mode);
    } catch (e) {
      throw friendly(e);
    }

    const db = await admin();
    const fromPlan = parsePriceId(sub.priceId!)!.plan;
    const toPlan = parsePriceId(data.targetPriceId)!.plan;
    const [{ data: limits }, seatsRes, pvRes] = await Promise.all([
      db.from("plan_limits").select("*").in("plan", [fromPlan, toPlan]),
      db.rpc("get_company_seat_usage", { _company_id: data.companyId }),
      db.rpc("get_company_pv_count_current_period", { _company_id: data.companyId }),
    ]);
    const cur = (limits ?? []).find((l: any) => l.plan === fromPlan) ?? null;
    const tgt = (limits ?? []).find((l: any) => l.plan === toPlan);
    const overages = tgt
      ? computeOverages(cur, tgt, { seats: Number(seatsRes.data ?? 0), pv_this_period: Number(pvRes.data ?? 0) })
      : [];

    // Verrou orphelin (traitement interrompu) : libéré après 5 minutes.
    await db
      .from("billing_plan_changes")
      .update({ status: "failed", error_code: "interrupted" })
      .eq("company_id", data.companyId)
      .eq("environment", data.environment)
      .eq("status", "processing")
      .lt("confirmed_at", new Date(Date.now() - 5 * 60_000).toISOString());
    // Les demandes précédemment prévisualisées et non confirmées sont caduques.
    await db
      .from("billing_plan_changes")
      .update({ status: "superseded" })
      .eq("company_id", data.companyId)
      .eq("environment", data.environment)
      .eq("status", "previewed");

    const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS).toISOString();
    const payload = {
      dueNow: preview.dueNow,
      nextInvoice: preview.nextInvoice,
      effectiveAt: preview.effectiveAt,
      nextBillingAt: preview.nextBillingAt,
      overages,
      trialing: sub.status === "trialing",
      currentPeriodEnd: sub.periodEnd,
    };
    const { data: req, error } = await db
      .from("billing_plan_changes")
      .insert({
        company_id: data.companyId,
        requested_by: context.userId,
        environment: data.environment,
        stripe_subscription_id: sub.id,
        from_price_id: sub.priceId,
        to_price_id: data.targetPriceId,
        kind: decision.kind,
        mode: decision.mode,
        proration_date: preview.prorationDate,
        expected_schedule_id: sub.scheduleId,
        preview: payload,
        effective_at: preview.effectiveAt,
        expires_at: expiresAt,
      })
      .select("id")
      .single();
    if (error) throw friendly(error);

    return {
      requestId: req.id as string,
      kind: decision.kind,
      mode: decision.mode,
      fromPriceId: sub.priceId!,
      toPriceId: data.targetPriceId,
      expiresAt,
      ...payload,
    };
  });

/* ------------------------------ Confirmation ------------------------------ */

const ConfirmSchema = z.object({
  companyId: z.string().uuid(),
  environment: EnvSchema,
  requestId: z.string().uuid(),
  acknowledgeOverages: z.boolean().default(false),
});

export const confirmPlanChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ConfirmSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertBillingAdmin(data.companyId, context.userId);
    const db = await admin();
    const { writeAuditLog } = await import("./audit.server");

    const { data: req } = await db
      .from("billing_plan_changes")
      .select("*")
      .eq("id", data.requestId)
      .eq("company_id", data.companyId)
      .eq("environment", data.environment)
      .maybeSingle();
    if (!req) throw new Error(MSG.expired);
    if ((req.preview?.overages?.length ?? 0) > 0 && !data.acknowledgeOverages) throw new Error(MSG.ack);

    // Verrou atomique : une seule confirmation gagne (double clic, onglets).
    const { data: claimed, error: claimErr } = await db
      .from("billing_plan_changes")
      .update({ status: "processing", confirmed_at: new Date().toISOString() })
      .eq("id", req.id)
      .eq("status", "previewed")
      .gt("expires_at", new Date().toISOString())
      .select("id");
    if (claimErr) {
      if ((claimErr as any).code === "23505") throw new Error(MSG.busy);
      throw friendly(claimErr);
    }
    if (!claimed?.length) throw new Error(MSG.expired);

    const finish = (patch: Record<string, unknown>) =>
      db.from("billing_plan_changes").update(patch).eq("id", req.id);

    let stripe, sub;
    try {
      ({ stripe, sub } = await loadVerifiedStripeSub(data.companyId, data.environment));
    } catch (e) {
      await finish({ status: "failed", error_code: "not_eligible" });
      throw e;
    }
    // Contrôle de concurrence : l'abonnement doit être exactement celui de l'aperçu.
    if (
      sub.id !== req.stripe_subscription_id ||
      sub.priceId !== req.from_price_id ||
      (sub.scheduleId ?? null) !== (req.expected_schedule_id ?? null)
    ) {
      await finish({ status: "superseded", error_code: "stale" });
      throw new Error(MSG.stale);
    }

    const srv = await import("./billing-plan-change.server");
    const idem = `pvia-plan-change-${req.id}`;
    try {
      const target = await srv.resolveCatalogPrice(stripe, req.to_price_id);
      if (req.mode === "scheduled") {
        const s = await srv.scheduleChange(stripe, sub, target, {
          idempotencyKey: idem,
          metadata: { companyId: data.companyId, planChangeId: req.id },
        });
        await finish({ status: "scheduled", stripe_schedule_id: s.scheduleId, effective_at: s.effectiveAt });
      } else {
        const r = await srv.applyImmediate(stripe, sub, target, { prorationDate: req.proration_date, idempotencyKey: idem });
        await finish({
          status: r.outcome,
          stripe_invoice_id: r.invoiceId,
          hosted_invoice_url: r.outcome === "applied" ? null : r.hostedInvoiceUrl,
          error_code: r.outcome === "applied" ? null : r.reason,
        });
        // Une programmation remplacée par la montée devient caduque.
        if (sub.scheduleId) {
          await db
            .from("billing_plan_changes")
            .update({ status: "superseded" })
            .eq("company_id", data.companyId)
            .eq("environment", data.environment)
            .eq("status", "scheduled");
        }
      }
    } catch (e) {
      await finish({ status: "failed", error_code: "stripe_error" });
      await writeAuditLog({
        companyId: data.companyId,
        userId: context.userId,
        entityType: "subscription",
        entityId: req.id,
        action: "billing.plan_change_failed",
        metadata: { from: req.from_price_id, to: req.to_price_id, environment: data.environment },
      });
      throw friendly(e);
    }

    // Projection immédiate en base (le webhook confirmera de façon idempotente).
    const { syncPlanChangeState } = await import("./billing-sync.server");
    const fresh = await syncPlanChangeState(stripe, data.environment, sub.id);
    if (fresh) {
      const plan = parsePriceId(fresh.priceId ?? "")?.plan;
      const interval = parsePriceId(fresh.priceId ?? "")?.interval;
      if (plan) {
        await db
          .from("subscriptions")
          .update({
            plan,
            price_id: fresh.priceId,
            billing_interval: interval,
            status: fresh.status,
            current_period_end: fresh.periodEnd,
          })
          .eq("stripe_subscription_id", fresh.id)
          .eq("environment", data.environment);
      }
    }

    const { data: done } = await db
      .from("billing_plan_changes")
      .select("status,error_code,hosted_invoice_url,effective_at")
      .eq("id", req.id)
      .single();
    await writeAuditLog({
      companyId: data.companyId,
      userId: context.userId,
      entityType: "subscription",
      entityId: req.id,
      action: `billing.plan_change_${done.status}`,
      metadata: { from: req.from_price_id, to: req.to_price_id, mode: req.mode, environment: data.environment },
    });
    return {
      status: done.status as string,
      reason: (done.error_code ?? null) as string | null,
      hostedInvoiceUrl: (done.hosted_invoice_url ?? null) as string | null,
      effectiveAt: (done.effective_at ?? null) as string | null,
    };
  });

/* ------------------------- Annuler une programmation ------------------------- */

const CancelSchema = z.object({ companyId: z.string().uuid(), environment: EnvSchema });

export const cancelScheduledPlanChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => CancelSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertBillingAdmin(data.companyId, context.userId);
    const row = await loadCompanySubscription(data.companyId, data.environment);
    if (!row?.stripe_subscription_id) throw new Error(MSG.noSchedule);
    const stripe = await stripeFor(data.environment);
    const srv = await import("./billing-plan-change.server");
    const sub = await srv.retrieveSubscription(stripe, row.stripe_subscription_id).catch((e) => {
      throw friendly(e);
    });
    if (sub.customerId !== row.stripe_customer_id) throw new Error("Accès refusé.");
    const scheduled = sub.scheduleId ? await srv.readScheduledChange(stripe, sub.scheduleId, sub.priceId) : null;
    if (!scheduled) throw new Error(MSG.noSchedule);
    try {
      await srv.cancelScheduled(stripe, scheduled.scheduleId, `pvia-plan-cancel-${scheduled.scheduleId}`);
    } catch (e) {
      throw friendly(e);
    }
    const { syncPlanChangeState } = await import("./billing-sync.server");
    await syncPlanChangeState(stripe, data.environment, sub.id);
    const { writeAuditLog } = await import("./audit.server");
    await writeAuditLog({
      companyId: data.companyId,
      userId: context.userId,
      entityType: "subscription",
      action: "billing.plan_change_schedule_canceled",
      metadata: { to: scheduled.priceId, environment: data.environment },
    });
    return { canceled: true };
  });

/* ------------------------------ État courant ------------------------------ */

const StateSchema = z.object({ companyId: z.string().uuid(), environment: EnvSchema });

/** Dernière demande non terminale (paiement en attente / échoué) pour l'UI. */
export const getPlanChangeState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => StateSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertBillingAdmin(data.companyId, context.userId);
    const db = await admin();
    const { data: rows } = await db
      .from("billing_plan_changes")
      .select("id,status,mode,kind,from_price_id,to_price_id,effective_at,hosted_invoice_url,error_code,created_at")
      .eq("company_id", data.companyId)
      .eq("environment", data.environment)
      .in("status", ["payment_pending", "payment_failed", "scheduled"])
      .order("created_at", { ascending: false })
      .limit(1);
    return { open: (rows?.[0] ?? null) as null | Record<string, any> };
  });
