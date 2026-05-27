import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requirePlatformAdmin } from "./admin-guard.server";

// Backward-compatible alias used throughout this module.
const assertPlatformAdmin = requirePlatformAdmin;


/* ----------------------------- List errors ----------------------------- */

const ListSchema = z.object({
  severity: z.enum(["all", "info", "warning", "error", "critical"]).default("all"),
  resolved: z.enum(["all", "open", "resolved"]).default("open"),
  source: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(200).default(100),
  offset: z.number().int().min(0).default(0),
});

export const listAppErrors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ListSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context.userId);

    let q = supabaseAdmin
      .from("app_errors")
      .select("id,severity,source,message,stack,context,user_id,company_id,resolved,created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);

    if (data.severity !== "all") q = q.eq("severity", data.severity);
    if (data.resolved === "open") q = q.eq("resolved", false);
    else if (data.resolved === "resolved") q = q.eq("resolved", true);
    if (data.source) q = q.ilike("source", `%${data.source}%`);

    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);
    return { errors: rows ?? [], total: count ?? 0 };
  });

/* --------------------------------- Stats -------------------------------- */

export const getMonitoringStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context.userId);

    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
    const last7d = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();

    const [c24, c7d, critical, bySeverity, bySource] = await Promise.all([
      supabaseAdmin.from("app_errors").select("id", { count: "exact", head: true }).gte("created_at", last24h),
      supabaseAdmin.from("app_errors").select("id", { count: "exact", head: true }).gte("created_at", last7d),
      supabaseAdmin.from("app_errors").select("id", { count: "exact", head: true })
        .eq("severity", "critical").eq("resolved", false),
      supabaseAdmin.from("app_errors").select("severity").gte("created_at", last7d),
      supabaseAdmin.from("app_errors").select("source").gte("created_at", last7d).limit(500),
    ]);

    const sevCounts: Record<string, number> = { info: 0, warning: 0, error: 0, critical: 0 };
    for (const r of (bySeverity.data ?? []) as Array<{ severity: string }>) {
      sevCounts[r.severity] = (sevCounts[r.severity] ?? 0) + 1;
    }
    const srcCounts: Record<string, number> = {};
    for (const r of (bySource.data ?? []) as Array<{ source: string }>) {
      srcCounts[r.source] = (srcCounts[r.source] ?? 0) + 1;
    }
    const topSources = Object.entries(srcCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([source, count]) => ({ source, count }));

    return {
      last24h: c24.count ?? 0,
      last7d: c7d.count ?? 0,
      criticalOpen: critical.count ?? 0,
      severity7d: sevCounts,
      topSources,
    };
  });

/* ------------------------------- Resolve ------------------------------- */

const ResolveSchema = z.object({ id: z.string().uuid(), resolved: z.boolean() });

export const setAppErrorResolved = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ResolveSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertPlatformAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("app_errors")
      .update({ resolved: data.resolved })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* --------------------------- Health snapshot --------------------------- */

export const getHealthStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context.userId);
    const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];

    // DB
    const t0 = Date.now();
    try {
      await supabaseAdmin.from("companies").select("id", { head: true, count: "exact" }).limit(1);
      checks.push({ name: "Database", ok: true, detail: `${Date.now() - t0}ms` });
    } catch (e: any) {
      checks.push({ name: "Database", ok: false, detail: e?.message ?? "fail" });
    }

    // Storage
    try {
      const { error } = await supabaseAdmin.storage.from("pv-assets").list("", { limit: 1 });
      checks.push({ name: "Storage", ok: !error, detail: error?.message });
    } catch (e: any) {
      checks.push({ name: "Storage", ok: false, detail: e?.message });
    }

    // VAPID
    checks.push({
      name: "Push (VAPID)",
      ok: !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY,
      detail: process.env.VAPID_PUBLIC_KEY ? "keys present" : "missing keys",
    });

    // Stripe
    checks.push({
      name: "Stripe (sandbox)",
      ok: !!process.env.STRIPE_SANDBOX_API_KEY,
      detail: process.env.STRIPE_SANDBOX_API_KEY ? "key present" : "missing key",
    });

    // Resend
    checks.push({
      name: "Resend (email)",
      ok: !!process.env.RESEND_API_KEY,
      detail: process.env.RESEND_API_KEY ? "key present" : "missing key",
    });

    return { checks, at: new Date().toISOString() };
  });

/* ----------------------------- Export logs ----------------------------- */

export const downloadAppErrorsCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertPlatformAdmin(context.userId);
    const { data: rows } = await supabaseAdmin
      .from("app_errors")
      .select("id,severity,source,message,resolved,created_at")
      .order("created_at", { ascending: false })
      .limit(5000);
    const header = "id,severity,source,message,resolved,created_at\n";
    const escape = (s: string) => `"${String(s).replace(/"/g, '""').replace(/\n/g, " ")}"`;
    const body = (rows ?? [])
      .map((r) => [r.id, r.severity, r.source, escape(r.message), r.resolved, r.created_at].join(","))
      .join("\n");
    return { csv: header + body, filename: `app-errors-${new Date().toISOString().slice(0, 10)}.csv` };
  });
