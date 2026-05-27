import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requirePlatformAdmin } from "./admin-guard.server";
import { writeAuditLog } from "./audit.server";

const IdSchema = z.object({ companyId: z.string().uuid() });

/* ----------------------------- Health score ------------------------------ */

type Alert = { level: "high" | "medium" | "low"; key: string; message: string; recommendation: string };

function computeScore(input: {
  onboardingDone: boolean;
  suspended: boolean;
  subStatus: string | null;
  webhookFailures: number;
  emailFailures: number;
  emailTotal: number;
  pdfFailures: number;
  errorsCritical: number;
  activeMembers: number;
  trialExpired: boolean;
}) {
  let score = 100;
  const alerts: Alert[] = [];

  if (!input.onboardingDone) {
    score -= 15;
    alerts.push({ level: "medium", key: "onboarding", message: "Onboarding non terminé.", recommendation: "Relancer le client ou réinitialiser l'onboarding." });
  }
  if (input.suspended) {
    score -= 40;
    alerts.push({ level: "high", key: "suspended", message: "Entreprise suspendue.", recommendation: "Vérifier la cause puis réactiver si justifié." });
  }
  if (input.subStatus === "past_due") {
    score -= 20;
    alerts.push({ level: "high", key: "billing.past_due", message: "Paiement en retard (past_due).", recommendation: "Relancer le client, resync Stripe, ou suspendre." });
  } else if (!input.subStatus || input.subStatus === "no_sub") {
    score -= 10;
    alerts.push({ level: "low", key: "billing.none", message: "Aucun abonnement actif.", recommendation: "Vérifier si essai expiré ou plan starter." });
  } else if (input.trialExpired) {
    score -= 10;
    alerts.push({ level: "medium", key: "billing.trial_expired", message: "Essai expiré non converti.", recommendation: "Proposer une remise / contacter le client." });
  }
  if (input.webhookFailures > 5) {
    score -= 15;
    alerts.push({ level: "high", key: "webhooks", message: `${input.webhookFailures} webhooks échoués en 7 jours.`, recommendation: "Vérifier l'URL cible ou relancer manuellement." });
  } else if (input.webhookFailures > 0) {
    score -= 5;
    alerts.push({ level: "low", key: "webhooks.minor", message: `${input.webhookFailures} webhook(s) en erreur.`, recommendation: "Relancer si nécessaire." });
  }
  const emailRate = input.emailTotal > 0 ? input.emailFailures / input.emailTotal : 0;
  if (emailRate > 0.1) {
    score -= 10;
    alerts.push({ level: "high", key: "emails", message: `Taux d'échec email ${Math.round(emailRate * 100)}%.`, recommendation: "Vérifier Resend, domaine, suppressions." });
  }
  if (input.pdfFailures > 0) {
    score -= 5;
    alerts.push({ level: "medium", key: "pdf", message: `${input.pdfFailures} PDF(s) non générés.`, recommendation: "Régénérer le PDF depuis la fiche PV." });
  }
  if (input.errorsCritical > 0) {
    score -= 15;
    alerts.push({ level: "high", key: "errors", message: `${input.errorsCritical} erreur(s) critique(s) ouvertes.`, recommendation: "Inspecter app_errors et corriger." });
  }
  if (input.activeMembers === 0) {
    score -= 15;
    alerts.push({ level: "high", key: "members", message: "Aucun membre actif.", recommendation: "Compte fantôme : contacter ou archiver." });
  }

  score = Math.max(0, Math.min(100, score));
  const level: "healthy" | "warning" | "critical" =
    score >= 80 ? "healthy" : score >= 50 ? "warning" : "critical";
  return { score, level, alerts };
}

/* ----------------------- Company support dashboard ----------------------- */

export const getCompanySupportDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => IdSchema.parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const id = data.companyId;
    const now = Date.now();
    const since7 = new Date(now - 7 * 86400_000).toISOString();
    const since24 = new Date(now - 86400_000).toISOString();

    const [
      company, sub, members, pvAll, pvDraft, pvAwaiting, pvWithReserves,
      reservesOpen, liftsAwaiting,
      emails7, emailsFailed7, webhooks7, webhooksFailed7,
      pdfFailures7, errorsCrit24, errorsAll7,
      webhooksConfig, calendarTokens, pushSubs,
    ] = await Promise.all([
      supabaseAdmin.from("companies").select("*").eq("id", id).maybeSingle(),
      supabaseAdmin.from("subscriptions").select("*").eq("company_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabaseAdmin.from("company_members").select("id,user_id,invited_email,role,status,created_at,accepted_at,invite_expires_at").eq("company_id", id),
      supabaseAdmin.from("pv").select("id", { count: "exact", head: true }).eq("company_id", id),
      supabaseAdmin.from("pv").select("id", { count: "exact", head: true }).eq("company_id", id).eq("status", "brouillon"),
      supabaseAdmin.from("pv").select("id", { count: "exact", head: true }).eq("company_id", id).eq("status", "envoye"),
      supabaseAdmin.from("pv").select("id", { count: "exact", head: true }).eq("company_id", id).eq("reception_with_reserves", true).neq("reserve_lift_status", "completed"),
      supabaseAdmin.from("pv_reserves").select("id", { count: "exact", head: true }).eq("company_id", id).eq("status", "ouverte"),
      supabaseAdmin.from("reserve_lift_reports").select("id", { count: "exact", head: true }).eq("company_id", id).in("status", ["envoye", "en_attente"]),
      supabaseAdmin.from("email_logs").select("id", { count: "exact", head: true }).eq("company_id", id).gte("created_at", since7),
      supabaseAdmin.from("email_logs").select("id,created_at,error_message,email_type", { count: "exact" }).eq("company_id", id).eq("status", "failed").gte("created_at", since7),
      supabaseAdmin.from("webhook_deliveries").select("id,event,status,created_at", { count: "exact" }).eq("company_id", id).gte("created_at", since7),
      supabaseAdmin.from("webhook_deliveries").select("id", { count: "exact", head: true }).eq("company_id", id).eq("status", "failed").gte("created_at", since7),
      supabaseAdmin.from("audit_logs").select("id", { count: "exact", head: true }).eq("company_id", id).eq("action", "pv.pdf_generated").gte("created_at", since7), // proxy: presence
      supabaseAdmin.from("app_errors").select("id", { count: "exact", head: true }).eq("company_id", id).eq("severity", "critical").eq("resolved", false).gte("created_at", since24),
      supabaseAdmin.from("app_errors").select("id,severity,source,message,created_at,resolved").eq("company_id", id).gte("created_at", since7).order("created_at", { ascending: false }).limit(20),
      supabaseAdmin.from("webhooks").select("id,url,enabled,last_status,failure_count").eq("company_id", id),
      supabaseAdmin.from("integration_calendar_tokens").select("id,revoked_at").eq("company_id", id).is("revoked_at", null),
      supabaseAdmin.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("company_id", id),
    ]);

    if (!company.data) throw new Error("Entreprise introuvable");

    // Member user ids → last_sign_in
    const memberUserIds = (members.data ?? []).map((m: any) => m.user_id).filter(Boolean);
    let lastSignIns: Record<string, string | null> = {};
    if (memberUserIds.length) {
      try {
        const list = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
        for (const u of list.data?.users ?? []) {
          if (memberUserIds.includes(u.id)) lastSignIns[u.id] = u.last_sign_in_at ?? null;
        }
      } catch { /* ignore */ }
    }

    // Pdf failures from audit_logs.metadata if any (best-effort)
    const { count: pdfFail } = await supabaseAdmin
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("company_id", id)
      .like("action", "%pdf%fail%")
      .gte("created_at", since7);

    // Trial / sub state
    const subRow: any = sub.data ?? null;
    const trialExpired = !!(subRow?.trial_end && new Date(subRow.trial_end).getTime() < now);

    const activeMembers = (members.data ?? []).filter((m: any) => m.status === "active").length;

    const health = computeScore({
      onboardingDone: !!company.data.onboarding_completed_at,
      suspended: !!(company.data as any).suspended_at,
      subStatus: subRow?.status ?? null,
      webhookFailures: webhooksFailed7.count ?? 0,
      emailFailures: emailsFailed7.count ?? 0,
      emailTotal: emails7.count ?? 0,
      pdfFailures: pdfFail ?? 0,
      errorsCritical: errorsCrit24.count ?? 0,
      activeMembers,
      trialExpired,
    });

    // Build 7-day series (emails, webhooks, errors)
    const days: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * 86400_000);
      days.push(d.toISOString().slice(0, 10));
    }
    const bucket = (rows: any[], dateKey: string) => {
      const map: Record<string, number> = Object.fromEntries(days.map((d) => [d, 0]));
      for (const r of rows) {
        const k = (r[dateKey] ?? "").slice(0, 10);
        if (k in map) map[k]++;
      }
      return days.map((d) => ({ date: d, value: map[d] }));
    };

    const emailSeries = bucket(emailsFailed7.data ?? [], "created_at");
    const webhookSeries = bucket((webhooks7.data ?? []).filter((w: any) => w.status === "failed"), "created_at");
    const errorSeries = bucket(errorsAll7.data ?? [], "created_at");

    return {
      company: company.data,
      subscription: subRow,
      members: (members.data ?? []).map((m: any) => ({ ...m, last_sign_in_at: lastSignIns[m.user_id] ?? null })),
      health,
      pipeline: {
        pvTotal: pvAll.count ?? 0,
        pvDraft: pvDraft.count ?? 0,
        pvAwaitingSignature: pvAwaiting.count ?? 0,
        pvWithOpenReserves: pvWithReserves.count ?? 0,
        reservesOpen: reservesOpen.count ?? 0,
        liftsAwaiting: liftsAwaiting.count ?? 0,
        pdfFailures: pdfFail ?? 0,
      },
      integrations: {
        webhooks: webhooksConfig.data ?? [],
        calendarConnected: (calendarTokens.data?.length ?? 0) > 0,
        pushCount: pushSubs.count ?? 0,
        stripeOk: !!subRow?.stripe_subscription_id,
      },
      counts: {
        emails7d: emails7.count ?? 0,
        emailsFailed7d: emailsFailed7.count ?? 0,
        webhooks7d: webhooks7.count ?? 0,
        webhooksFailed7d: webhooksFailed7.count ?? 0,
        errorsCritical24h: errorsCrit24.count ?? 0,
        activeMembers,
      },
      series: { emails: emailSeries, webhooks: webhookSeries, errors: errorSeries, days },
      recentErrors: errorsAll7.data ?? [],
    };
  });

/* ------------------------- Unified support timeline ---------------------- */

const TimelineSchema = z.object({
  companyId: z.string().uuid(),
  types: z.array(z.enum(["audit", "email", "webhook", "error", "notification"])).optional(),
  search: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(500).default(150),
});

export const getCompanySupportTimeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => TimelineSchema.parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const id = data.companyId;
    const types = new Set(data.types ?? ["audit", "email", "webhook", "error", "notification"]);

    const [audits, emails, hooks, errors, notifs] = await Promise.all([
      types.has("audit")
        ? supabaseAdmin.from("audit_logs").select("id,action,entity_type,entity_id,pv_id,user_id,created_at,metadata").eq("company_id", id).order("created_at", { ascending: false }).limit(data.limit)
        : Promise.resolve({ data: [] as any[] }),
      types.has("email")
        ? supabaseAdmin.from("email_logs").select("id,email_type,recipient_email,status,error_message,created_at,pv_id").eq("company_id", id).order("created_at", { ascending: false }).limit(data.limit)
        : Promise.resolve({ data: [] as any[] }),
      types.has("webhook")
        ? supabaseAdmin.from("webhook_deliveries").select("id,event,status,response_code,error,created_at").eq("company_id", id).order("created_at", { ascending: false }).limit(data.limit)
        : Promise.resolve({ data: [] as any[] }),
      types.has("error")
        ? supabaseAdmin.from("app_errors").select("id,severity,source,message,resolved,created_at").eq("company_id", id).order("created_at", { ascending: false }).limit(data.limit)
        : Promise.resolve({ data: [] as any[] }),
      types.has("notification")
        ? supabaseAdmin.from("notifications").select("id,type,title,body,user_id,created_at").eq("company_id", id).order("created_at", { ascending: false }).limit(data.limit)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    type Item = {
      kind: "audit" | "email" | "webhook" | "error" | "notification";
      id: string;
      created_at: string;
      title: string;
      detail?: string;
      severity?: "info" | "warn" | "error";
      pv_id?: string | null;
      user_id?: string | null;
    };

    const items: Item[] = [
      ...(audits.data ?? []).map((r: any) => ({
        kind: "audit" as const, id: `a-${r.id}`, created_at: r.created_at,
        title: r.action, detail: r.entity_type, severity: "info" as const,
        pv_id: r.pv_id, user_id: r.user_id,
      })),
      ...(emails.data ?? []).map((r: any) => ({
        kind: "email" as const, id: `e-${r.id}`, created_at: r.created_at,
        title: `Email ${r.email_type} → ${r.recipient_email}`,
        detail: r.error_message ?? r.status,
        severity: (r.status === "failed" ? "error" : r.status === "sent" ? "info" : "warn") as any,
        pv_id: r.pv_id ?? null,
      })),
      ...(hooks.data ?? []).map((r: any) => ({
        kind: "webhook" as const, id: `w-${r.id}`, created_at: r.created_at,
        title: `Webhook ${r.event}`,
        detail: `HTTP ${r.response_code ?? "—"} ${r.error ?? ""}`.trim(),
        severity: (r.status === "failed" ? "error" : "info") as any,
      })),
      ...(errors.data ?? []).map((r: any) => ({
        kind: "error" as const, id: `x-${r.id}`, created_at: r.created_at,
        title: `${r.severity?.toUpperCase()} · ${r.source}`,
        detail: r.message?.slice(0, 300),
        severity: (r.severity === "critical" || r.severity === "error" ? "error" : "warn") as any,
      })),
      ...(notifs.data ?? []).map((r: any) => ({
        kind: "notification" as const, id: `n-${r.id}`, created_at: r.created_at,
        title: r.title, detail: r.body, severity: "info" as const, user_id: r.user_id,
      })),
    ];

    items.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    let filtered = items;
    if (data.search) {
      const s = data.search.toLowerCase();
      filtered = filtered.filter((i) => i.title.toLowerCase().includes(s) || (i.detail ?? "").toLowerCase().includes(s));
    }

    return { items: filtered.slice(0, data.limit) };
  });

/* ----------------------------- Support actions --------------------------- */

export const adminRegeneratePvPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ pvId: z.string().uuid(), companyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    await supabaseAdmin.from("pv").update({ pdf_url: null, pdf_generated_at: null }).eq("id", data.pvId);
    await writeAuditLog({
      companyId: data.companyId, userId: context.userId, entityType: "pv", entityId: data.pvId,
      action: "admin.pv_pdf_regen_requested", actor: "user",
    });
    return { ok: true };
  });

export const adminClearErrorNotifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => IdSchema.parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    await supabaseAdmin.from("notifications").update({ read: true }).eq("company_id", data.companyId).in("type", ["error", "pdf_failed", "email_failed", "webhook_failed"] as any);
    await writeAuditLog({
      companyId: data.companyId, userId: context.userId, entityType: "platform_admin",
      action: "admin.error_notifications_cleared", actor: "user",
    });
    return { ok: true };
  });

export const adminMarkErrorResolved = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ errorId: z.string().uuid(), companyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    await supabaseAdmin.from("app_errors").update({ resolved: true }).eq("id", data.errorId);
    await writeAuditLog({
      companyId: data.companyId, userId: context.userId, entityType: "app_error", entityId: data.errorId,
      action: "admin.error_resolved", actor: "user",
    });
    return { ok: true };
  });

/* ------------------------- Enriched support notes ------------------------ */

const NoteCreateSchema = z.object({
  companyId: z.string().uuid(),
  note: z.string().min(1).max(2000),
  type: z.enum(["incident", "billing", "onboarding", "bug", "customer-success", "general"]).default("general"),
  priority: z.enum(["high", "normal", "low"]).default("normal"),
  visibility: z.enum(["internal", "customer_visible"]).default("internal"),
});

export const adminAddSupportNoteV2 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => NoteCreateSchema.parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { error } = await supabaseAdmin.from("support_notes" as any).insert({
      company_id: data.companyId,
      created_by: context.userId,
      note: data.note,
      visibility: data.visibility,
      type: data.type,
      priority: data.priority,
      status: "open",
    } as any);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      companyId: data.companyId, userId: context.userId, entityType: "support_note",
      action: "admin.support_note_created", metadata: { type: data.type, priority: data.priority, visibility: data.visibility }, actor: "user",
    });
    return { ok: true };
  });

export const adminResolveSupportNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid(), companyId: z.string().uuid(), status: z.enum(["open", "resolved"]).default("resolved") }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const patch: any = { status: data.status };
    if (data.status === "resolved") { patch.resolved_at = new Date().toISOString(); patch.resolved_by = context.userId; }
    else { patch.resolved_at = null; patch.resolved_by = null; }
    await supabaseAdmin.from("support_notes" as any).update(patch).eq("id", data.id);
    await writeAuditLog({
      companyId: data.companyId, userId: context.userId, entityType: "support_note", entityId: data.id,
      action: data.status === "resolved" ? "admin.support_note_resolved" : "admin.support_note_reopened",
      actor: "user",
    });
    return { ok: true };
  });

export const adminListSupportNotesV2 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => IdSchema.parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const { data: rows, error } = await supabaseAdmin
      .from("support_notes" as any)
      .select("id,note,visibility,type,priority,status,resolved_at,resolved_by,created_at,created_by,updated_at")
      .eq("company_id", data.companyId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { notes: (rows as any[]) ?? [] };
  });

/* --------------------------- View audit (passive) ------------------------ */

export const adminMarkCompanyViewed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => IdSchema.parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    await writeAuditLog({
      companyId: data.companyId, userId: context.userId, entityType: "platform_admin",
      action: "admin.company_support_viewed", actor: "user",
    });
    return { ok: true };
  });
