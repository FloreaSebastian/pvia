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
  return data.role as "owner" | "admin";
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
  priceId: z.enum(["starter_monthly", "pro_monthly", "enterprise_monthly"]),
  environment: EnvSchema,
  returnUrl: z.string().url(),
});

export const createCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => CheckoutSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId, supabase } = context;
    await assertCompanyAdmin(data.companyId, userId);

    const { data: { user } } = await supabase.auth.getUser();
    const email = user?.email ?? undefined;

    const stripe = createStripeClient(data.environment);
    const prices = await stripe.prices.list({ lookup_keys: [data.priceId], limit: 1 });
    const price = prices.data[0];
    if (!price) throw new Error(`Tarif ${data.priceId} introuvable.`);

    // Reuse existing customer if any
    const { data: existing } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("company_id", data.companyId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

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

    const [planRes, limitsRes, subRes, pvCountRes, memberCountRes, access] = await Promise.all([
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
      allPlans: allLimits.sort((a, b) => a.monthly_price_eur - b.monthly_price_eur),
      subscription,
      access,
      usage: {
        pv_this_period: Number(pvCountRes.data ?? 0),
        members: Number(memberCountRes.data ?? 0),
      },
    };
  });


