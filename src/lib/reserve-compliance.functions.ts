/**
 * Compliance metrics for the dashboard widget.
 *
 * Returns conformity ratios computed across the active company:
 *  - photos with GPS (browser or EXIF)
 *  - photos with EXIF metadata
 *  - reserves validated / rejected / unassigned / overdue
 *
 * Read-only; scoped to the caller's active company via `company_members`.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function pct(n: number, d: number): number {
  if (!d) return 0;
  return Math.round((n / d) * 1000) / 10;
}

export const getReserveComplianceMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: m } = await supabaseAdmin
      .from("company_members")
      .select("id")
      .eq("company_id", data.companyId)
      .eq("user_id", context.userId)
      .eq("status", "active")
      .maybeSingle();
    if (!m) throw new Error("Accès refusé.");

    // Reserves
    const { data: reserves } = await supabaseAdmin
      .from("pv_reserves")
      .select("id,status,assigned_to,due_date,lifted_at")
      .eq("company_id", data.companyId);

    const reservesTotal = (reserves ?? []).length;
    let validated = 0, rejected = 0, unassigned = 0, overdue = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const r of (reserves ?? []) as any[]) {
      if (r.status === "validee") validated++;
      if (r.status === "rejetee") rejected++;
      if (!r.assigned_to) unassigned++;
      if (
        r.due_date &&
        !r.lifted_at &&
        !["validee", "rejetee"].includes(r.status) &&
        new Date(r.due_date) < today
      ) overdue++;
    }

    // Photos (sample latest 1000 to keep widget cheap on large tenants)
    const { data: photos } = await supabaseAdmin
      .from("reserve_lift_item_photos" as any)
      .select("id,latitude,longitude,exif_metadata,suspicious_metadata")
      .eq("company_id", data.companyId)
      .order("uploaded_at", { ascending: false })
      .limit(1000);

    const photosTotal = (photos ?? []).length;
    let withGps = 0, withExif = 0, suspicious = 0;
    for (const p of (photos ?? []) as any[]) {
      if (p.latitude != null && p.longitude != null) withGps++;
      if (p.exif_metadata && Object.keys(p.exif_metadata).length > 0) withExif++;
      if (p.suspicious_metadata && Object.keys(p.suspicious_metadata).length > 0) suspicious++;
    }

    // Reserve-lift reports overall
    const { count: liftsTotal } = await supabaseAdmin
      .from("reserve_lift_reports")
      .select("id", { count: "exact", head: true })
      .eq("company_id", data.companyId);

    const { count: liftsValidated } = await supabaseAdmin
      .from("reserve_lift_reports")
      .select("id", { count: "exact", head: true })
      .eq("company_id", data.companyId)
      .eq("status", "client_validated");

    return {
      reserves: {
        total: reservesTotal,
        validated,
        rejected,
        unassigned,
        overdue,
        validatedPct: pct(validated, reservesTotal),
        rejectedPct: pct(rejected, reservesTotal),
        unassignedPct: pct(unassigned, reservesTotal),
        overduePct: pct(overdue, reservesTotal),
      },
      photos: {
        total: photosTotal,
        withGps,
        withExif,
        suspicious,
        withGpsPct: pct(withGps, photosTotal),
        withExifPct: pct(withExif, photosTotal),
        suspiciousPct: pct(suspicious, photosTotal),
      },
      lifts: {
        total: liftsTotal ?? 0,
        clientValidated: liftsValidated ?? 0,
        clientValidatedPct: pct(liftsValidated ?? 0, liftsTotal ?? 0),
      },
    };
  });
