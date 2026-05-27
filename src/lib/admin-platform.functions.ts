import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requirePlatformAdmin } from "./admin-guard.server";
import { writeAuditLog } from "./audit.server";

/* ----------------------------- isAdmin (light) ---------------------------- */

export const getIsPlatformAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    return { isAdmin: !!data };
  });

/* -------------------------------- Stats ---------------------------------- */

export const getPlatformStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context.userId);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const last7d = new Date(Date.now() - 7 * 86400_000).toISOString();

    const [
      companiesTotal, companiesOnboarded,
      usersTotal, pvTotal, pvMonth, pvSigned,
      emailsMonth, webhooksFailed, errorsCritical,
      subs, recentCompanies, recentErrors,
    ] = await Promise.all([
      supabaseAdmin.from("companies").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("companies").select("id", { count: "exact", head: true }).not("onboarding_completed_at", "is", null),
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("pv").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("pv").select("id", { count: "exact", head: true }).gte("created_at", monthStart),
      supabaseAdmin.from("pv").select("id", { count: "exact", head: true }).eq("status", "signe"),
      supabaseAdmin.from("email_logs").select("id", { count: "exact", head: true }).gte("created_at", monthStart),
      supabaseAdmin.from("webhook_deliveries").select("id", { count: "exact", head: true }).eq("status", "failed"),
      supabaseAdmin.from("app_errors").select("id", { count: "exact", head: true }).eq("severity", "critical").eq("resolved", false),
      supabaseAdmin.from("subscriptions").select("status,plan,current_period_end"),
      supabaseAdmin.from("companies").select("id,name,email,created_at,onboarding_completed_at").order("created_at", { ascending: false }).limit(8),
      supabaseAdmin.from("app_errors").select("id,severity,source,message,created_at,company_id").eq("resolved", false).order("created_at", { ascending: false }).limit(8),
    ]);

    const subsRows = subs.data ?? [];
    const subsByStatus: Record<string, number> = {};
    let paying = 0, trialing = 0, pastDue = 0;
    for (const s of subsRows) {
      subsByStatus[s.status] = (subsByStatus[s.status] ?? 0) + 1;
      if (s.status === "active" || s.status === "past_due") paying++;
      if (s.status === "trialing") trialing++;
      if (s.status === "past_due") pastDue++;
    }

    return {
      companies: { total: companiesTotal.count ?? 0, onboarded: companiesOnboarded.count ?? 0 },
      users: { total: usersTotal.count ?? 0 },
      pv: { total: pvTotal.count ?? 0, month: pvMonth.count ?? 0, signed: pvSigned.count ?? 0 },
      emails: { month: emailsMonth.count ?? 0 },
      webhooks: { failed: webhooksFailed.count ?? 0 },
      errors: { criticalOpen: errorsCritical.count ?? 0 },
      subscriptions: { paying, trialing, pastDue, byStatus: subsByStatus },
      recentCompanies: recentCompanies.data ?? [],
      recentErrors: recentErrors.data ?? [],
    };
  });

/* ----------------------------- Companies list ---------------------------- */

const ListCompaniesSchema = z.object({
  search: z.string().max(200).optional(),
  status: z.enum(["all", "trial", "active", "past_due", "canceled", "no_sub", "onboarding"]).default("all"),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export const listAdminCompanies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ListCompaniesSchema.parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);

    let q = supabaseAdmin
      .from("companies")
      .select("id,name,email,siren,siret,created_at,onboarding_completed_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);

    if (data.search) {
      const s = data.search.trim();
      q = q.or(`name.ilike.%${s}%,email.ilike.%${s}%,siren.ilike.%${s}%,siret.ilike.%${s}%`);
    }
    if (data.status === "onboarding") q = q.is("onboarding_completed_at", null);

    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);

    const ids = (rows ?? []).map((r) => r.id);
    if (ids.length === 0) return { companies: [], total: count ?? 0 };

    const [subs, members, pvs] = await Promise.all([
      supabaseAdmin.from("subscriptions").select("company_id,plan,status,current_period_end,trial_end").in("company_id", ids),
      supabaseAdmin.from("company_members").select("company_id").in("company_id", ids).eq("status", "active"),
      supabaseAdmin.from("pv").select("company_id,created_at").in("company_id", ids),
    ]);

    const subsBy: Record<string, any> = {};
    for (const s of subs.data ?? []) subsBy[s.company_id] = s;
    const memCount: Record<string, number> = {};
    for (const m of members.data ?? []) memCount[m.company_id] = (memCount[m.company_id] ?? 0) + 1;
    const pvCount: Record<string, number> = {};
    const lastPv: Record<string, string> = {};
    for (const p of pvs.data ?? []) {
      pvCount[p.company_id!] = (pvCount[p.company_id!] ?? 0) + 1;
      if (!lastPv[p.company_id!] || p.created_at > lastPv[p.company_id!]) lastPv[p.company_id!] = p.created_at;
    }

    let companies = (rows ?? []).map((c) => {
      const sub = subsBy[c.id];
      return {
        ...c,
        plan: sub?.plan ?? "starter",
        sub_status: sub?.status ?? "no_sub",
        current_period_end: sub?.current_period_end ?? null,
        member_count: memCount[c.id] ?? 0,
        pv_count: pvCount[c.id] ?? 0,
        last_pv_at: lastPv[c.id] ?? null,
      };
    });

    if (data.status !== "all" && data.status !== "onboarding") {
      const wanted =
        data.status === "trial" ? ["trialing"]
        : data.status === "active" ? ["active"]
        : data.status === "past_due" ? ["past_due"]
        : data.status === "canceled" ? ["canceled"]
        : data.status === "no_sub" ? ["no_sub"]
        : [];
      companies = companies.filter((c) => wanted.includes(c.sub_status));
    }

    return { companies, total: count ?? 0 };
  });

/* ------------------------------ Company detail --------------------------- */

const IdSchema = z.object({ id: z.string().uuid() });

export const getAdminCompanyDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => IdSchema.parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const id = data.id;

    const [company, members, sub, pvs, errors, emails, hooks, audits] = await Promise.all([
      supabaseAdmin.from("companies").select("*").eq("id", id).maybeSingle(),
      supabaseAdmin.from("company_members").select("id,user_id,invited_email,role,status,created_at,accepted_at").eq("company_id", id),
      supabaseAdmin.from("subscriptions").select("*").eq("company_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabaseAdmin.from("pv").select("id,numero,status,created_at").eq("company_id", id).order("created_at", { ascending: false }).limit(10),
      supabaseAdmin.from("app_errors").select("id,severity,source,message,created_at,resolved").eq("company_id", id).order("created_at", { ascending: false }).limit(10),
      supabaseAdmin.from("email_logs").select("id,email_type,recipient_email,status,created_at").eq("company_id", id).order("created_at", { ascending: false }).limit(10),
      supabaseAdmin.from("webhook_deliveries").select("id,event,status,response_code,created_at").eq("company_id", id).order("created_at", { ascending: false }).limit(10),
      supabaseAdmin.from("audit_logs").select("id,action,entity_type,created_at,user_id").eq("company_id", id).order("created_at", { ascending: false }).limit(20),
    ]);

    if (!company.data) throw new Error("Entreprise introuvable");

    await writeAuditLog({
      companyId: id, userId: context.userId, entityType: "platform_admin",
      action: "admin.company_viewed", actor: "user",
    });

    return {
      company: company.data,
      members: members.data ?? [],
      subscription: sub.data ?? null,
      pvs: pvs.data ?? [],
      errors: errors.data ?? [],
      emails: emails.data ?? [],
      webhooks: hooks.data ?? [],
      audits: audits.data ?? [],
    };
  });

/* ------------------------------ Support issues --------------------------- */

export const listAdminSupportIssues = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context.userId);
    const since = new Date(Date.now() - 7 * 86400_000).toISOString();

    const [errors, emailFails, hookFails, pastDue, stuckOnboarding] = await Promise.all([
      supabaseAdmin.from("app_errors").select("id,severity,source,message,company_id,created_at").eq("resolved", false).gte("created_at", since).order("created_at", { ascending: false }).limit(50),
      supabaseAdmin.from("email_logs").select("id,email_type,recipient_email,error_message,company_id,created_at").eq("status", "failed").gte("created_at", since).order("created_at", { ascending: false }).limit(50),
      supabaseAdmin.from("webhook_deliveries").select("id,event,response_code,error,company_id,created_at").eq("status", "failed").gte("created_at", since).order("created_at", { ascending: false }).limit(50),
      supabaseAdmin.from("subscriptions").select("company_id,plan,status,current_period_end").eq("status", "past_due"),
      supabaseAdmin.from("companies").select("id,name,email,created_at").is("onboarding_completed_at", null).lte("created_at", new Date(Date.now() - 3 * 86400_000).toISOString()).order("created_at", { ascending: false }).limit(50),
    ]);

    return {
      errors: errors.data ?? [],
      emailFailures: emailFails.data ?? [],
      webhookFailures: hookFails.data ?? [],
      pastDue: pastDue.data ?? [],
      stuckOnboarding: stuckOnboarding.data ?? [],
    };
  });

/* ------------------------------- Admin actions --------------------------- */

const SuspendSchema = z.object({
  companyId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

export const adminSuspendCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => SuspendSchema.parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const oldRow = await supabaseAdmin
      .from("companies")
      .select("suspended_at,support_status,suspension_reason")
      .eq("id", data.companyId)
      .maybeSingle();
    const { error } = await supabaseAdmin
      .from("companies")
      .update({
        suspended_at: new Date().toISOString(),
        suspended_by: context.userId,
        suspension_reason: data.reason ?? null,
        support_status: "blocked",
      } as any)
      .eq("id", data.companyId);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      companyId: data.companyId,
      userId: context.userId,
      entityType: "company",
      action: "admin.company_suspended",
      oldValues: (oldRow.data as any) ?? null,
      newValues: { suspended: true, reason: data.reason ?? null, support_status: "blocked" },
      actor: "user",
    });
    return { ok: true };
  });

export const adminReactivateCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("companies")
      .update({
        suspended_at: null,
        suspended_by: null,
        suspension_reason: null,
        support_status: "active",
      } as any)
      .eq("id", data.companyId);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      companyId: data.companyId,
      userId: context.userId,
      entityType: "company",
      action: "admin.company_reactivated",
      actor: "user",
    });
    return { ok: true };
  });

export const adminSetSupportStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      companyId: z.string().uuid(),
      status: z.enum(["active", "watched", "blocked"]),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const patch: any = { support_status: data.status };
    if (data.status === "blocked") {
      patch.suspended_at = new Date().toISOString();
      patch.suspended_by = context.userId;
    } else {
      patch.suspended_at = null;
      patch.suspended_by = null;
      patch.suspension_reason = null;
    }
    const { error } = await supabaseAdmin.from("companies").update(patch).eq("id", data.companyId);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      companyId: data.companyId,
      userId: context.userId,
      entityType: "company",
      action: "admin.support_status_changed",
      newValues: { support_status: data.status },
      actor: "user",
    });
    return { ok: true };
  });

export const adminResetCompanyOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("companies")
      .update({ onboarding_completed_at: null })
      .eq("id", data.companyId);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      companyId: data.companyId,
      userId: context.userId,
      entityType: "platform_admin",
      action: "admin.onboarding_reset",
      actor: "user",
    });
    return { ok: true };
  });

export const adminRetryFailedWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ deliveryId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("webhook_deliveries")
      .update({ status: "pending", next_attempt_at: new Date().toISOString(), attempts: 0, error: null })
      .eq("id", data.deliveryId);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      companyId: null,
      userId: context.userId,
      entityType: "platform_admin",
      action: "admin.webhook_retried",
      metadata: { deliveryId: data.deliveryId },
      actor: "user",
    });
    return { ok: true };
  });

export const adminRetryFailedEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ emailLogId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    // Mark as pending — the email worker (or a manual resend flow) will pick it up.
    await supabaseAdmin
      .from("email_logs")
      .update({ status: "queued", error_message: null })
      .eq("id", data.emailLogId);
    await writeAuditLog({
      companyId: null,
      userId: context.userId,
      entityType: "platform_admin",
      action: "admin.email_retried",
      metadata: { emailLogId: data.emailLogId },
      actor: "user",
    });
    return { ok: true };
  });

export const adminResendInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ memberId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    // Bump expiry; client invite flow can regenerate on demand.
    const newExpiry = new Date(Date.now() + 7 * 86400_000).toISOString();
    const { error } = await supabaseAdmin
      .from("company_members")
      .update({ invite_expires_at: newExpiry })
      .eq("id", data.memberId)
      .eq("status", "invited");
    if (error) throw new Error(error.message);
    await writeAuditLog({
      companyId: null,
      userId: context.userId,
      entityType: "platform_admin",
      action: "admin.invite_extended",
      metadata: { memberId: data.memberId, newExpiry },
      actor: "user",
    });
    return { ok: true };
  });

export const adminResyncStripeSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    // Mark stale so the next billing webhook/refresh picks it up.
    await supabaseAdmin
      .from("subscriptions")
      .update({ updated_at: new Date().toISOString() })
      .eq("company_id", data.companyId);
    await writeAuditLog({
      companyId: data.companyId,
      userId: context.userId,
      entityType: "platform_admin",
      action: "admin.stripe_resync_requested",
      actor: "user",
    });
    return { ok: true };
  });

/* ------------------------------- Support notes --------------------------- */

export const adminListSupportNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { data: rows, error } = await supabaseAdmin
      .from("support_notes" as any)
      .select("id,note,visibility,created_at,created_by")
      .eq("company_id", data.companyId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { notes: (rows as any[]) ?? [] };
  });

export const adminAddSupportNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      companyId: z.string().uuid(),
      note: z.string().min(1).max(2000),
      visibility: z.enum(["internal", "customer_visible"]).default("internal"),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { error } = await supabaseAdmin.from("support_notes" as any).insert({
      company_id: data.companyId,
      created_by: context.userId,
      note: data.note,
      visibility: data.visibility,
    });
    if (error) throw new Error(error.message);
    await writeAuditLog({
      companyId: data.companyId,
      userId: context.userId,
      entityType: "support_note",
      action: "admin.support_note_created",
      metadata: { visibility: data.visibility },
      actor: "user",
    });
    return { ok: true };
  });

export const adminDeleteSupportNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid(), companyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    await supabaseAdmin.from("support_notes" as any).delete().eq("id", data.id);
    await writeAuditLog({
      companyId: data.companyId,
      userId: context.userId,
      entityType: "support_note",
      action: "admin.support_note_deleted",
      metadata: { id: data.id },
      actor: "user",
    });
    return { ok: true };
  });

/* ------------------------------- Impersonation --------------------------- */

const IMPERSONATION_MAX_MINUTES = 30;

export const adminStartImpersonation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      companyId: z.string().uuid(),
      reason: z.string().min(3).max(500),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const expiresAt = new Date(Date.now() + IMPERSONATION_MAX_MINUTES * 60_000).toISOString();
    const { data: row, error } = await supabaseAdmin
      .from("impersonation_sessions" as any)
      .insert({
        admin_user_id: context.userId,
        company_id: data.companyId,
        reason: data.reason,
        read_only: true,
        expires_at: expiresAt,
      })
      .select("id,expires_at")
      .single();
    if (error) throw new Error(error.message);
    await writeAuditLog({
      companyId: data.companyId,
      userId: context.userId,
      entityType: "impersonation",
      entityId: (row as any).id,
      action: "admin.impersonation_started",
      metadata: { reason: data.reason, expires_at: expiresAt, read_only: true },
      actor: "user",
    });
    return { sessionId: (row as any).id, expiresAt };
  });

export const adminEndImpersonation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ sessionId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { data: row } = await supabaseAdmin
      .from("impersonation_sessions" as any)
      .select("company_id")
      .eq("id", data.sessionId)
      .maybeSingle();
    await supabaseAdmin
      .from("impersonation_sessions" as any)
      .update({ ended_at: new Date().toISOString(), ended_reason: "manual" })
      .eq("id", data.sessionId);
    await writeAuditLog({
      companyId: (row as any)?.company_id ?? null,
      userId: context.userId,
      entityType: "impersonation",
      entityId: data.sessionId,
      action: "admin.impersonation_ended",
      actor: "user",
    });
    return { ok: true };
  });

/* --------------------------------- Billing ------------------------------- */

export const getAdminBillingOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context.userId);

    const [subs, plans, companies] = await Promise.all([
      supabaseAdmin
        .from("subscriptions")
        .select("id,company_id,plan,status,current_period_end,trial_end,cancel_at_period_end,created_at,environment"),
      supabaseAdmin.from("plan_limits").select("plan,monthly_price_eur,display_name"),
      supabaseAdmin.from("companies").select("id,name,email"),
    ]);

    const priceByPlan: Record<string, number> = {};
    for (const p of plans.data ?? []) priceByPlan[(p as any).plan] = (p as any).monthly_price_eur ?? 0;

    const companyById: Record<string, any> = {};
    for (const c of companies.data ?? []) companyById[(c as any).id] = c;

    const subRows = (subs.data ?? []) as any[];
    const buckets = { active: [] as any[], trialing: [] as any[], past_due: [] as any[], canceled: [] as any[] };
    let mrr = 0;
    for (const s of subRows) {
      const enriched = { ...s, company: companyById[s.company_id], monthly_price_eur: priceByPlan[s.plan] ?? 0 };
      if (s.status === "active" || s.status === "trialing" || s.status === "past_due" || s.status === "canceled") {
        (buckets as any)[s.status].push(enriched);
      }
      if (s.status === "active" || s.status === "past_due") mrr += priceByPlan[s.plan] ?? 0;
    }

    const subscribedIds = new Set(subRows.map((s) => s.company_id));
    const noSub = (companies.data ?? []).filter((c) => !subscribedIds.has((c as any).id));

    return {
      mrrEstimateEur: mrr,
      counts: {
        active: buckets.active.length,
        trialing: buckets.trialing.length,
        past_due: buckets.past_due.length,
        canceled: buckets.canceled.length,
        no_sub: noSub.length,
        total_companies: (companies.data ?? []).length,
      },
      buckets,
      noSub,
    };
  });


/* ----------------------------- Retry queue KPIs --------------------------- */

export const getRetryQueueStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context.userId);
    const since24h = new Date(Date.now() - 86400_000).toISOString();
    const [whPending, whRetrying, whDead, emPending, emRetrying, emDead, retried24] = await Promise.all([
      supabaseAdmin.from("webhook_deliveries").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabaseAdmin.from("webhook_deliveries").select("id", { count: "exact", head: true }).eq("status", "retrying"),
      supabaseAdmin.from("webhook_deliveries").select("id", { count: "exact", head: true }).eq("status", "dead"),
      supabaseAdmin.from("email_logs").select("id", { count: "exact", head: true }).eq("status", "failed"),
      supabaseAdmin.from("email_logs").select("id", { count: "exact", head: true }).eq("status", "retrying"),
      supabaseAdmin.from("email_logs").select("id", { count: "exact", head: true }).eq("status", "dead"),
      supabaseAdmin.from("audit_logs").select("id", { count: "exact", head: true })
        .in("action", ["webhook.delivery_retried", "email.delivery_retried", "webhook.delivery_dead", "email.delivery_dead"])
        .gte("created_at", since24h),
    ]);
    return {
      webhooks: { pending: whPending.count ?? 0, retrying: whRetrying.count ?? 0, dead: whDead.count ?? 0 },
      emails: { pending: emPending.count ?? 0, retrying: emRetrying.count ?? 0, dead: emDead.count ?? 0 },
      retryEvents24h: retried24.count ?? 0,
    };
  });

export const adminRetryEmailNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ logId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    // Force the row eligible for the next drain pass.
    await supabaseAdmin.from("email_logs").update({
      status: "retrying",
      next_retry_at: new Date().toISOString(),
    }).eq("id", data.logId);
    const { drainFailedEmails } = await import("./retry.server");
    const r = await drainFailedEmails(1);
    await writeAuditLog({
      userId: context.userId, entityType: "email", entityId: data.logId,
      action: "admin.email_retry_now", metadata: r as any, actor: "user",
    });
    return r;
  });

export const adminMarkEmailDead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ logId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    await supabaseAdmin.from("email_logs").update({
      status: "dead", next_retry_at: null,
    }).eq("id", data.logId);
    await writeAuditLog({
      userId: context.userId, entityType: "email", entityId: data.logId,
      action: "admin.email_marked_dead", actor: "user",
    });
    return { ok: true };
  });

export const adminRetryWebhookNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ deliveryId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    await supabaseAdmin.from("webhook_deliveries").update({
      status: "pending",
      next_attempt_at: new Date().toISOString(),
    }).eq("id", data.deliveryId);
    const { deliverOne } = await import("./webhooks.server");
    const r = await deliverOne(data.deliveryId);
    await writeAuditLog({
      userId: context.userId, entityType: "webhook_delivery", entityId: data.deliveryId,
      action: "admin.webhook_retry_now", metadata: r as any, actor: "user",
    });
    return r;
  });
