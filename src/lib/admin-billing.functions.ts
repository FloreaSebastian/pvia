/**
 * Cockpit facturation PLATEFORME (super-admin PVIA uniquement).
 *
 * Aucune de ces fonctions n'est accessible à un « admin » d'entreprise cliente :
 * `requirePlatformAdmin` exige le rôle `platform_admin` ET un e-mail @pvia.fr.
 *
 * DÉFINITION MRR / ARR (documentée, cohérente, HORS TAXES) :
 *  - MRR = somme des prix HT normalisés au mois des abonnements dont le statut
 *    est `active` ou `past_due` (engagement contractuel réel en cours).
 *    Un abonnement annuel compte pour prix_annuel_HT / 12.
 *  - Les essais (`trialing`) ne génèrent aucun revenu et sont EXCLUS.
 *  - Les abonnements `canceled`, `unpaid`, `paused`, `incomplete*` sont exclus.
 *  - ARR = MRR × 12 (estimation glissante).
 *  - La TVA n'est JAMAIS comptée : c'est une taxe collectée, pas du revenu.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requirePlatformAdmin } from "./admin-guard.server";
import { writeAuditLog } from "./audit.server";

const REVENUE_STATUSES = ["active", "past_due"] as const;

type PlanPrices = Record<string, { monthly: number | null; annual: number | null; display: string }>;

async function loadPlanPrices(): Promise<PlanPrices> {
  const { data } = await supabaseAdmin
    .from("plan_limits")
    .select("plan,monthly_price_eur,annual_price_eur,display_name,max_members");
  const out: PlanPrices = {};
  for (const p of (data ?? []) as any[]) {
    out[p.plan] = {
      monthly: p.monthly_price_eur ?? null,
      annual: p.annual_price_eur ?? null,
      display: p.display_name ?? p.plan,
    };
  }
  return out;
}

/** Prix HT normalisé au mois pour un abonnement. */
function monthlyHt(prices: PlanPrices, plan: string, interval: string | null): number {
  const p = prices[plan];
  if (!p) return 0;
  if (interval === "annual") return p.annual != null ? Math.round((p.annual / 12) * 100) / 100 : 0;
  return p.monthly ?? 0;
}

/* --------------------------------- KPI ---------------------------------- */

export const getAdminBillingKpis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context.userId);
    const prices = await loadPlanPrices();

    const [{ data: subs }, { data: companies }] = await Promise.all([
      supabaseAdmin
        .from("subscriptions")
        .select("company_id,plan,status,billing_interval,cancel_at_period_end,current_period_end,created_at"),
      supabaseAdmin.from("companies").select("id,trial_ends_at"),
    ]);

    // Une entreprise = son abonnement le plus récent.
    const latest = new Map<string, any>();
    for (const s of (subs ?? []) as any[]) {
      const prev = latest.get(s.company_id);
      if (!prev || new Date(s.created_at) > new Date(prev.created_at)) latest.set(s.company_id, s);
    }

    const counts = {
      companies: (companies ?? []).length,
      trials_active: 0,
      subscriptions_active: 0,
      starter_active: 0,
      pro_active: 0,
      business_active: 0,
      cancel_scheduled: 0,
      past_due: 0,
      unpaid: 0,
      canceled: 0,
      trials_expired_without_subscription: 0,
    };

    let mrr = 0;
    for (const s of latest.values()) {
      if (s.status === "active") {
        counts.subscriptions_active += 1;
        if (s.plan === "starter") counts.starter_active += 1;
        if (s.plan === "pro") counts.pro_active += 1;
        if (s.plan === "business") counts.business_active += 1;
      }
      if (s.status === "past_due") counts.past_due += 1;
      if (s.status === "unpaid") counts.unpaid += 1;
      if (s.status === "canceled") counts.canceled += 1;
      if (s.cancel_at_period_end && s.status !== "canceled") counts.cancel_scheduled += 1;
      if ((REVENUE_STATUSES as readonly string[]).includes(s.status)) {
        mrr += monthlyHt(prices, s.plan, s.billing_interval ?? null);
      }
    }

    const now = Date.now();
    for (const c of (companies ?? []) as any[]) {
      const sub = latest.get(c.id);
      const trialEnd = c.trial_ends_at ? new Date(c.trial_ends_at).getTime() : null;
      const paying = sub && ["active", "past_due", "trialing"].includes(sub.status);
      if (trialEnd && trialEnd > now && !paying) counts.trials_active += 1;
      if (sub?.status === "trialing") counts.trials_active += 1;
      if (trialEnd && trialEnd <= now && !paying) counts.trials_expired_without_subscription += 1;
    }

    const mrrHt = Math.round(mrr * 100) / 100;
    return {
      counts,
      mrr_ht_eur: mrrHt,
      arr_ht_eur: Math.round(mrrHt * 12 * 100) / 100,
      definition:
        "MRR = prix HT normalisés au mois des abonnements active + past_due (annuel ÷ 12). Essais et abonnements résiliés exclus. ARR = MRR × 12. TVA jamais comptée.",
    };
  });

/* --------------------------- Tableau paginé ------------------------------ */

const ListSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(5).max(100).default(25),
  search: z.string().trim().max(120).optional(),
  status: z
    .array(z.enum(["trialing", "active", "past_due", "unpaid", "canceled", "paused"]))
    .optional(),
  plan: z.array(z.enum(["starter", "pro", "business", "enterprise"])).optional(),
  interval: z.enum(["monthly", "annual"]).optional(),
});

export const listAdminSubscriptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ListSchema.parse(i ?? {}))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const prices = await loadPlanPrices();

    let query = supabaseAdmin
      .from("subscriptions")
      .select(
        "id,company_id,plan,status,billing_interval,price_id,current_period_start,current_period_end,cancel_at_period_end,trial_end,stripe_customer_id,stripe_subscription_id,updated_at,created_at,environment",
        { count: "exact" },
      )
      .order("updated_at", { ascending: false });

    if (data.status?.length) query = query.in("status", data.status);
    if (data.plan?.length) query = query.in("plan", data.plan);
    if (data.interval) query = query.eq("billing_interval", data.interval);

    // Recherche : entreprise / responsable / e-mail → filtre par company_id ;
    // Stripe Customer ID → filtre direct.
    if (data.search) {
      const term = data.search;
      if (/^cus_[A-Za-z0-9]+$/.test(term)) {
        query = query.eq("stripe_customer_id", term);
      } else {
        const like = `%${term.replace(/[%_]/g, "")}%`;
        const { data: matches } = await supabaseAdmin
          .from("companies")
          .select("id")
          .or(`name.ilike.${like},email.ilike.${like}`)
          .limit(500);
        const ids = (matches ?? []).map((m: any) => m.id);
        if (ids.length === 0) {
          return { rows: [], total: 0, page: data.page, pageSize: data.pageSize };
        }
        query = query.in("company_id", ids);
      }
    }

    const from = (data.page - 1) * data.pageSize;
    const { data: rows, count, error } = await query.range(from, from + data.pageSize - 1);
    if (error) throw new Error("Chargement des abonnements impossible.");

    const companyIds = [...new Set((rows ?? []).map((r: any) => r.company_id))];
    const [{ data: companies }, { data: members }] = await Promise.all([
      companyIds.length
        ? supabaseAdmin.from("companies").select("id,name,email,trial_started_at,trial_ends_at").in("id", companyIds)
        : Promise.resolve({ data: [] as any[] } as any),
      companyIds.length
        ? supabaseAdmin
            .from("company_members")
            .select("company_id,user_id,role,status")
            .in("company_id", companyIds)
            .eq("status", "active")
        : Promise.resolve({ data: [] as any[] } as any),
    ]);

    const companyById = new Map<string, any>();
    for (const c of (companies ?? []) as any[]) companyById.set(c.id, c);
    const seatsByCompany = new Map<string, number>();
    const ownerByCompany = new Map<string, string>();
    for (const m of (members ?? []) as any[]) {
      seatsByCompany.set(m.company_id, (seatsByCompany.get(m.company_id) ?? 0) + 1);
      if (m.role === "directeur" && !ownerByCompany.has(m.company_id)) ownerByCompany.set(m.company_id, m.user_id);
    }

    return {
      total: count ?? 0,
      page: data.page,
      pageSize: data.pageSize,
      rows: (rows ?? []).map((r: any) => {
        const c = companyById.get(r.company_id);
        return {
          id: r.id,
          company_id: r.company_id,
          company_name: c?.name ?? "—",
          company_email: c?.email ?? null,
          plan: r.plan,
          plan_label: prices[r.plan]?.display ?? r.plan,
          status: r.status,
          billing_interval: r.billing_interval ?? null,
          price_ht_eur: monthlyHt(prices, r.plan, r.billing_interval ?? null),
          trial_started_at: c?.trial_started_at ?? null,
          trial_ends_at: c?.trial_ends_at ?? null,
          current_period_start: r.current_period_start,
          current_period_end: r.current_period_end,
          cancel_at_period_end: Boolean(r.cancel_at_period_end),
          seats: seatsByCompany.get(r.company_id) ?? 0,
          stripe_customer_id: r.stripe_customer_id,
          stripe_subscription_id: r.stripe_subscription_id,
          environment: r.environment,
          updated_at: r.updated_at,
        };
      }),
    };
  });

/* ------------------------- Fiche billing entreprise ----------------------- */

export const getAdminCompanyBilling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);

    const { getServerStripeEnv } = await import("./app-env.server");
    const env = getServerStripeEnv();

    const [{ data: company }, { data: sub }, { data: logs }] = await Promise.all([
      supabaseAdmin
        .from("companies")
        .select("id,name,email,phone,city,trial_started_at,trial_ends_at,suspended_at,support_status,created_at")
        .eq("id", data.companyId)
        .maybeSingle(),
      supabaseAdmin
        .from("subscriptions")
        .select("*")
        .eq("company_id", data.companyId)
        .eq("environment", env)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("audit_logs")
        .select("action,created_at,metadata,user_id")
        .eq("company_id", data.companyId)
        .like("action", "billing.%")
        .order("created_at", { ascending: false })
        .limit(40),
    ]);

    if (!company) throw new Error("Entreprise introuvable.");

    const [{ data: plan }, { data: limits }, seats] = await Promise.all([
      supabaseAdmin.rpc("get_company_plan", { _company_id: data.companyId }),
      supabaseAdmin.from("plan_limits").select("*"),
      supabaseAdmin.rpc("get_company_seat_usage" as never, { _company_id: data.companyId } as never),
    ]);
    const planKey = (plan as unknown as string) ?? "starter";
    const planRow = ((limits ?? []) as any[]).find((l) => l.plan === planKey) ?? null;

    const { getAccessState } = await import("./plan-guard.server");
    const access = await getAccessState(data.companyId);

    // Factures & paiements réels : lus chez Stripe, jamais recréés localement.
    let invoices: any[] = [];
    let stripeError: string | null = null;
    const customerId = (sub as any)?.stripe_customer_id as string | undefined;
    if (customerId) {
      try {
        const { getStripeClient } = await import("./stripe.server");
        const stripe = getStripeClient(env);
        const list = await stripe.invoices.list({ customer: customerId, limit: 12 });
        invoices = list.data.map((inv: any) => ({
          id: inv.id,
          number: inv.number ?? null,
          created: inv.created ? new Date(inv.created * 1000).toISOString() : null,
          status: inv.status,
          currency: String(inv.currency ?? "eur").toUpperCase(),
          subtotal_excl_tax: Number(inv.subtotal_excluding_tax ?? inv.subtotal ?? 0),
          tax: Number(inv.tax ?? 0),
          total: Number(inv.total ?? 0),
          hosted_invoice_url: inv.hosted_invoice_url ?? null,
          invoice_pdf: inv.invoice_pdf ?? null,
        }));
      } catch (e) {
        stripeError = "Lecture Stripe indisponible pour le moment.";
      }
    }

    return {
      environment: env,
      company,
      subscription: sub ?? null,
      access,
      entitlements: {
        can_write: !access?.blocked,
        can_technical_visits: Boolean(planRow?.can_technical_visits),
        seat_limit: planRow?.max_members ?? null,
        seats_used: Number(seats ?? 0),
        pv_limit_per_month: planRow?.max_pv_per_month ?? null,
        plan: planKey,
        plan_label: planRow?.display_name ?? planKey,
      },
      invoices,
      stripeError,
      events: (logs ?? []).map((l: any) => ({
        action: l.action,
        at: l.created_at,
        metadata: l.metadata ?? null,
      })),
    };
  });

/* ------------------------------ Action admin ----------------------------- */

/**
 * SEULE action admin autorisée sur la facturation : relire Stripe.
 * Aucune action ne permet de forcer un statut ni de fabriquer un paiement.
 * Journalisée avec état avant / après.
 */
export const adminRefreshCompanyBilling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);

    const { getServerStripeEnv } = await import("./app-env.server");
    const env = getServerStripeEnv();

    const { data: before } = await supabaseAdmin
      .from("subscriptions")
      .select("status,plan,billing_interval,current_period_end,cancel_at_period_end")
      .eq("company_id", data.companyId)
      .eq("environment", env)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { adminResyncStripeSubscription } = await import("./admin-platform.functions");
    const result: any = await (adminResyncStripeSubscription as any)({ data: { companyId: data.companyId } });

    const { data: after } = await supabaseAdmin
      .from("subscriptions")
      .select("status,plan,billing_interval,current_period_end,cancel_at_period_end")
      .eq("company_id", data.companyId)
      .eq("environment", env)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    await writeAuditLog({
      companyId: data.companyId,
      userId: context.userId,
      entityType: "subscription",
      action: "billing.admin_resync",
      oldValues: (before ?? null) as any,
      newValues: (after ?? null) as any,
      metadata: { environment: env, result: result?.ok ?? null, recovered: result?.recovered ?? 0 },
      actor: "user",
    });

    return { ok: true, before: before ?? null, after: after ?? null };
  });
