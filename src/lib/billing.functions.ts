import { createServerFn } from "@tanstack/react-start";
import { ADMIN_ROLES, OWNER_ROLES, SIGN_ROLES, isAdminRole, isManageRole } from "@/lib/roles";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createStripeClient, sanitizeStripeError, assertTaxComplianceReady, BILLING_MESSAGES, type StripeEnv } from "./stripe.server";
import { writeAuditLog } from "./audit.server";
import { getAccessState, isTrialEligible } from "./plan-guard.server";


const EnvSchema = z.enum(["sandbox", "live"]);

async function assertCompanyAdmin(companyId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from("company_members")
    .select("role,status")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (!data || !isAdminRole(data.role)) {
    throw new Error("Seuls owner/admin peuvent gérer la facturation.");
  }
  return data.role as "directeur" | "responsable_exploitation";
}

async function assertCompanyMember(companyId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from("company_members")
    .select("role,status")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (!data) throw new Error("Accès refusé.");
  return data.role as string;
}

/* ----------------------- Create Stripe Checkout session ---------------------- */

const CheckoutSchema = z.object({
  companyId: z.string().uuid(),
  priceId: z.enum([
    "starter_monthly",
    "starter_annual",
    "pro_monthly",
    "pro_annual",
    "business_monthly",
    "business_annual",
  ]),
  environment: EnvSchema,
  returnUrl: z.string().url(),
});

/** price lookup_key → clé de plan interne. */
function priceIdToPlan(priceId: string): "starter" | "pro" | "business" {
  return priceId.split("_")[0] as "starter" | "pro" | "business";
}

export const createCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => CheckoutSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId, supabase } = context;
    await assertCompanyAdmin(data.companyId, userId);

    // Garde-fou downgrade : on refuse un plan dont le nombre de sièges est
    // inférieur à la consommation actuelle (membres actifs + invitations).
    const targetPlan = priceIdToPlan(data.priceId);
    const [{ data: targetLimits }, { data: seatUsage }] = await Promise.all([
      supabaseAdmin
        .from("plan_limits")
        .select("max_members,display_name")
        .eq("plan", targetPlan)
        .maybeSingle(),
      supabaseAdmin.rpc("get_company_seat_usage" as never, { _company_id: data.companyId } as never),
    ]);
    const maxMembers = (targetLimits as any)?.max_members as number | null | undefined;
    const used = Number(seatUsage ?? 0);
    if (maxMembers != null && used > maxMembers) {
      throw new Error(
        `Le plan ${(targetLimits as any)?.display_name ?? targetPlan} est limité à ${maxMembers} utilisateur${maxMembers > 1 ? "s" : ""}, or votre entreprise en compte ${used} (invitations en attente incluses). Retirez des utilisateurs avant de rétrograder.`,
      );
    }

    const { data: { user } } = await supabase.auth.getUser();
    const email = user?.email ?? undefined;

    const stripe = createStripeClient(data.environment);
    // Fail-closed LIVE : aucun encaissement tant que l'enregistrement TVA
    // France n'est pas actif sur le compte Stripe (sandbox non bloquée).
    await assertTaxComplianceReady(data.environment, stripe);

    const price = await (async () => {
      try {
        const prices = await stripe.prices.list({ lookup_keys: [data.priceId], limit: 1 });
        return prices.data[0];
      } catch (e) {
        throw sanitizeStripeError(e, BILLING_MESSAGES.checkout);
      }
    })();
    if (!price) throw new Error("Cette offre n'est pas disponible actuellement.");


    // Garde anti-doublon : on inspecte TOUTES les lignes d'abonnement de
    // l'entreprise pour cet environnement (pas uniquement la plus récente, ni
    // uniquement la formule demandée) — un abonnement actif sur une autre
    // formule doit passer par le portail, pas par un second Checkout.
    const { data: existingRows } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_customer_id,plan,status,created_at")
      .eq("company_id", data.companyId)
      .eq("environment", data.environment);

    const guard = decideCheckoutGuard((existingRows ?? []) as any, targetPlan);
    if (guard.block) throw new Error(guard.block);

    let customerId = guard.customerId ?? undefined;

    if (!customerId) {
      try {
        const customer = await stripe.customers.create({
          email,
          metadata: { companyId: data.companyId, userId },
        });
        customerId = customer.id;
      } catch (e) {
        throw sanitizeStripeError(e, BILLING_MESSAGES.checkout);
      }
    }

    // Invariant : une entreprise = un seul essai de 14 jours à vie.
    // L'essai est INTERNE : attribué à la création de l'entreprise
    // (`companies.trial_started_at` + `trial_ends_at`). Un Checkout n'accorde
    // JAMAIS un nouveau `trial_period_days`.
    //
    // Règle commerciale : 14 jours gratuits COMPLETS. Choisir une formule
    // pendant l'essai aligne l'abonnement Stripe sur la date de fin d'essai
    // EXISTANTE (`trial_end`) : première facture = `companies.trial_ends_at`,
    // jamais avant, jamais après.
    //
    // Contrainte Stripe : `subscription_data.trial_end` doit être au moins
    // 48 h dans le futur. Dans les 48 dernières heures de l'essai, il est donc
    // impossible de créer un abonnement qui ne facture pas avant la fin de
    // l'essai : on REFUSE le Checkout (aucun prélèvement anticipé) et l'UI
    // invite à activer à la fin de l'essai. L'essai n'est ni prolongé ni
    // réinitialisé.
    const { data: companyTrial } = await supabaseAdmin
      .from("companies")
      .select("trial_ends_at")
      .eq("id", data.companyId)
      .maybeSingle();
    const trialEndsAtMs = (companyTrial as any)?.trial_ends_at
      ? new Date((companyTrial as any).trial_ends_at as string).getTime()
      : null;
    const STRIPE_MIN_TRIAL_MS = 48 * 3_600_000;
    const trialInProgress = trialEndsAtMs !== null && trialEndsAtMs > Date.now();
    if (trialInProgress && trialEndsAtMs! <= Date.now() + STRIPE_MIN_TRIAL_MS) {
      throw new Error(
        "Votre essai gratuit se termine dans moins de 48 heures : l'activation d'une formule sera possible dès sa fin, sans aucun prélèvement d'ici là.",
      );
    }
    const alignedTrialEnd = trialInProgress ? Math.floor(trialEndsAtMs! / 1000) : undefined;

    // Conservé pour l'audit : doit toujours valoir false hors anomalie.
    const legacyTrialEligible = await isTrialEligible(data.companyId);



    let session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: price.id, quantity: 1 }],
        success_url: `${data.returnUrl}?status=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${data.returnUrl}?status=cancel`,
        // TVA : les Stripe Prices PVIA sont HT (`tax_behavior: exclusive`).
        // Stripe Tax détermine le taux applicable DYNAMIQUEMENT selon
        // l'adresse de facturation et le statut TVA du client (20 % pour un
        // client France ; autoliquidation possible dans l'UE avec numéro
        // valide). Aucun taux n'est codé en dur côté application.
        automatic_tax: { enabled: true },
        // Nécessaire au calcul de la TVA : adresse de facturation du client.
        billing_address_collection: "required",
        // Persiste l'adresse / le nom sur le Customer → factures et
        // renouvellements conservent une TVA correcte.
        customer_update: { address: "auto", name: "auto" },
        // B2B : numéro de TVA intracommunautaire (autoliquidation hors France).
        // `required` est supporté par l'API 2026-03-25.dahlia / SDK 22.0.2
        // (vérifié en runtime sur une session sandbox).
        tax_id_collection: { enabled: true, required: "if_supported" },
        subscription_data: {
          ...(alignedTrialEnd ? { trial_end: alignedTrialEnd } : {}),
          metadata: { companyId: data.companyId, userId },
        },
        metadata: { companyId: data.companyId, userId },
      });
    } catch (e) {
      throw sanitizeStripeError(e, BILLING_MESSAGES.checkout);
    }

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "subscription",
      action: "billing.checkout_started",
      metadata: {
        plan: data.priceId,
        environment: data.environment,
        trial_days: 0,
        aligned_trial_end: alignedTrialEnd ?? null,
        legacy_trial_eligible: legacyTrialEligible,
      },
    });

    return { url: session.url, trialDays: 0, trialEnd: alignedTrialEnd ?? null };
  });


/* ------------------------- Stripe Customer Portal ------------------------- */

const PortalSchema = z.object({
  companyId: z.string().uuid(),
  environment: EnvSchema,
  returnUrl: z.string().url(),
});

export const createPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => PortalSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertCompanyAdmin(data.companyId, context.userId);

    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("company_id", data.companyId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!sub?.stripe_customer_id) throw new Error("Aucun abonnement à gérer.");

    const stripe = createStripeClient(data.environment);
    let portal;
    try {
      portal = await stripe.billingPortal.sessions.create({
        customer: sub.stripe_customer_id,
        return_url: data.returnUrl,
      });
    } catch (e) {
      throw sanitizeStripeError(e, BILLING_MESSAGES.portal);
    }

    await writeAuditLog({
      companyId: data.companyId,
      userId: context.userId,
      entityType: "subscription",
      action: "billing.portal_opened",
      metadata: { environment: data.environment },
    });

    return { url: portal.url };
  });


/* ------------------------- Get plan & usage ------------------------- */

const GetSchema = z.object({ companyId: z.string().uuid() });

export const getCompanyBilling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => GetSchema.parse(i))
  .handler(async ({ data, context }) => {
    const role = await assertCompanyMember(data.companyId, context.userId);
    const isAdmin = isAdminRole(role);

    const [planRes, limitsRes, subRes, pvCountRes, memberCountRes, seatUsageRes, access] = await Promise.all([
      supabaseAdmin.rpc("get_company_plan", { _company_id: data.companyId }),
      supabaseAdmin.from("plan_limits").select("*"),
      supabaseAdmin
        .from("subscriptions")
        .select("*")
        .eq("company_id", data.companyId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin.rpc("get_company_pv_count_current_period", { _company_id: data.companyId }),
      supabaseAdmin.rpc("get_company_member_count", { _company_id: data.companyId }),
      supabaseAdmin.rpc("get_company_seat_usage" as never, { _company_id: data.companyId } as never),
      getAccessState(data.companyId),
    ]);
    const trialEligible = await isTrialEligible(data.companyId);

    const plan = (planRes.data as string) || "starter";
    const allLimits = (limitsRes.data ?? []) as any[];
    const currentLimits = allLimits.find((l) => l.plan === plan) ?? null;

    // Strip Stripe identifiers for non-admin members.
    let subscription = subRes.data as any;
    if (subscription && !isAdmin) {
      const { stripe_customer_id, stripe_subscription_id, ...safe } = subscription;
      subscription = safe;
    }

    return {
      plan,
      limits: currentLimits,
      allPlans: allLimits
        .slice()
        .sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99)),
      subscription,
      access,
      /** Une entreprise = un seul essai à vie : false ⇒ activation payante. */
      trialEligible,
      usage: {
        pv_this_period: Number(pvCountRes.data ?? 0),
        members: Number(memberCountRes.data ?? 0),
        seats: Number(seatUsageRes.data ?? memberCountRes.data ?? 0),
      },
    };
  });


/* ------------------- Resynchronisation Stripe (retour Checkout/Portal) ------------------- */

const SyncSchema = z.object({ companyId: z.string().uuid(), environment: EnvSchema });

/**
 * Réconcilie la ligne `subscriptions` avec Stripe à la demande.
 * Utilisée au retour de Checkout/Portal pour ne pas dépendre du délai webhook :
 * après paiement, l'utilisateur retrouve immédiatement l'écriture sans avoir à
 * se déconnecter/reconnecter. Lecture Stripe uniquement + upsert de la ligne :
 * aucune garde d'écriture d'abonnement ici (sinon un compte expiré ne pourrait
 * jamais se réactiver). Réservée aux admins de l'entreprise.
 */
export const syncSubscriptionFromStripe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => SyncSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertCompanyAdmin(data.companyId, context.userId);
    // Throttling : la resynchronisation lit Stripe ; un bouton « Actualiser »
    // ne doit pas pouvoir marteler l'API. 10 appels / 5 min / entreprise.
    const { enforceRateLimit } = await import("./rate-limit.server");
    await enforceRateLimit({
      bucket: "billing_sync",
      key: data.companyId,
      limit: 10,
      windowSec: 300,
    });


    const { data: existing } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_customer_id,user_id")
      .eq("company_id", data.companyId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const customerId = (existing as any)?.stripe_customer_id as string | undefined;
    if (!customerId) return { synced: false as const };

    const stripe = createStripeClient(data.environment);
    let sub: any = null;
    try {
      const list = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 20,
        expand: ["data.items.data.price"],
      });
      // Sélection : on privilégie une subscription réellement exploitable
      // (active/trialing), puis une régularisable (past_due/unpaid/paused),
      // et seulement en dernier recours une ancienne canceled — même si
      // celle-ci est plus récente. Sinon une résiliation postérieure à une
      // réactivation empêcherait de retrouver l'accès en écriture.
      const rank = (s: string) =>
        s === "active" || s === "trialing" ? 0
        : s === "past_due" || s === "unpaid" || s === "paused" ? 1
        : s === "incomplete" ? 2
        : 3;
      sub = list.data
        .slice()
        .sort((a: any, b: any) => rank(a.status) - rank(b.status) || (b.created ?? 0) - (a.created ?? 0))[0] ?? null;
    } catch (e) {
      throw sanitizeStripeError(e, BILLING_MESSAGES.portal);
    }
    if (!sub) return { synced: false as const };


    const { priceToPlan } = await import("./stripe.server");
    const item = sub.items?.data?.[0];
    const plan = priceToPlan(item?.price) ?? null;
    const toIso = (s: number | null | undefined) => (s ? new Date(s * 1000).toISOString() : null);

    const { error } = await supabaseAdmin.from("subscriptions").upsert(
      {
        company_id: data.companyId,
        user_id: (existing as any)?.user_id ?? context.userId,
        stripe_subscription_id: sub.id,
        stripe_customer_id: customerId,
        ...(plan ? { plan } : {}),
        price_id: item?.price?.lookup_key ?? item?.price?.metadata?.lovable_external_id ?? null,
        billing_interval:
          item?.price?.recurring?.interval === "year"
            ? "annual"
            : item?.price?.recurring?.interval === "month"
              ? "monthly"
              : null,
        status: sub.status,
        current_period_start: toIso(item?.current_period_start ?? sub.current_period_start),
        current_period_end: toIso(item?.current_period_end ?? sub.current_period_end),
        cancel_at_period_end: Boolean(sub.cancel_at_period_end),
        trial_end: toIso(sub.trial_end),
        environment: data.environment,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "stripe_subscription_id" },
    );
    if (error) throw new Error("La synchronisation de l'abonnement a échoué. Réessayez dans quelques instants.");

    // Une réactivation payante lève une éventuelle suspension automatique
    // posée lors de l'annulation (`company.auto_suspended`).
    if (sub.status === "active" || sub.status === "trialing") {
      const { data: comp } = await supabaseAdmin
        .from("companies")
        .select("suspended_at,support_status")
        .eq("id", data.companyId)
        .maybeSingle();
      if ((comp as any)?.suspended_at && (comp as any)?.support_status !== "blocked") {
        await supabaseAdmin.from("companies").update({ suspended_at: null } as never).eq("id", data.companyId);
        await writeAuditLog({
          companyId: data.companyId,
          userId: context.userId,
          entityType: "company",
          action: "company.auto_unsuspended",
          metadata: { reason: "subscription_reactivated", status: sub.status },
        });
      }
    }

    return { synced: true as const, status: sub.status as string };
  });
