import { createServerFn } from "@tanstack/react-start";
import { ADMIN_ROLES, OWNER_ROLES, SIGN_ROLES, isAdminRole, isManageRole } from "@/lib/roles";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createStripeClient, type StripeEnv } from "./stripe.server";
import { writeAuditLog } from "./audit.server";
import { getAccessState } from "./plan-guard.server";


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
    const prices = await stripe.prices.list({ lookup_keys: [data.priceId], limit: 1 });
    const price = prices.data[0];
    if (!price) throw new Error(`Tarif ${data.priceId} introuvable.`);


    // Reuse existing customer if any
    const { data: existing } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_customer_id,plan,status")
      .eq("company_id", data.companyId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Abonnement déjà actif sur ce plan → passer par le portail (évite le doublon).
    if (
      existing &&
      (existing as any).plan === targetPlan &&
      ["active", "trialing", "past_due"].includes(String((existing as any).status))
    ) {
      throw new Error(
        "Vous êtes déjà abonné à ce plan. Utilisez « Gérer mon abonnement » pour modifier la périodicité ou le moyen de paiement.",
      );
    }


    let customerId = existing?.stripe_customer_id as string | undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email,
        metadata: { companyId: data.companyId, userId },
      });
      customerId = customer.id;
    }

    // Only offer the 14-day trial on first ever checkout for this company.
    const trialDays = existing?.stripe_customer_id ? undefined : 14;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: price.id, quantity: 1 }],
      success_url: `${data.returnUrl}?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${data.returnUrl}?status=cancel`,
      subscription_data: {
        ...(trialDays ? { trial_period_days: trialDays } : {}),
        metadata: { companyId: data.companyId, userId },
      },
      metadata: { companyId: data.companyId, userId },
    });

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "subscription",
      action: "billing.checkout_started",
      metadata: { plan: data.priceId, environment: data.environment, trial_days: trialDays ?? 0 },
    });

    return { url: session.url, trialDays: trialDays ?? 0 };
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
    const portal = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: data.returnUrl,
    });

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
      usage: {
        pv_this_period: Number(pvCountRes.data ?? 0),
        members: Number(memberCountRes.data ?? 0),
        seats: Number(seatUsageRes.data ?? memberCountRes.data ?? 0),
      },
    };
  });


