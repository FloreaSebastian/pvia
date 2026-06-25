/**
 * Batched overview for the reserves list:
 *  - photo counts (initial/before/after)
 *  - first photo signed URL (for card thumbnail)
 *  - whether a lift report exists
 *
 * One round trip per page render of reserves. Signed URLs are short-lived.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SIGNED_TTL = 60 * 30; // 30 min, plenty for a list view

export type ReserveOverviewEntry = {
  reserveId: string;
  initialCount: number;
  beforeCount: number;
  afterCount: number;
  liftCount: number;
  thumbUrl: string | null;
};

export const listReservesOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        companyId: z.string().uuid(),
        reserveIds: z.array(z.string().uuid()).min(1).max(300),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Authorize: caller must be active member of the company.
    const { data: member } = await supabase
      .from("company_members")
      .select("id")
      .eq("company_id", data.companyId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (!member) throw new Error("Accès refusé.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const map = new Map<string, ReserveOverviewEntry>();
    for (const id of data.reserveIds) {
      map.set(id, {
        reserveId: id,
        initialCount: 0,
        beforeCount: 0,
        afterCount: 0,
        liftCount: 0,
        thumbUrl: null,
      });
    }

    // Initial photos from pv_photos.reserve_id (also serves as default thumbnail source).
    const { data: pvPhotos } = await supabaseAdmin
      .from("pv_photos")
      .select("id,url,reserve_id,created_at")
      .in("reserve_id", data.reserveIds)
      .order("created_at", { ascending: true });
    const firstInitial = new Map<string, string>();
    for (const r of (pvPhotos ?? []) as any[]) {
      if (!r.reserve_id) continue;
      const e = map.get(r.reserve_id);
      if (!e) continue;
      e.initialCount += 1;
      if (!firstInitial.has(r.reserve_id)) firstInitial.set(r.reserve_id, r.url);
    }

    // Lift photos (before/after) from reserve_lift_item_photos.
    const { data: liftPhotos } = await supabaseAdmin
      .from("reserve_lift_item_photos" as any)
      .select("id,reserve_id,storage_path,photo_type,uploaded_at")
      .in("reserve_id", data.reserveIds)
      .order("uploaded_at", { ascending: true });
    const firstBefore = new Map<string, string>();
    const firstAfter = new Map<string, string>();
    for (const r of (liftPhotos ?? []) as any[]) {
      if (!r.reserve_id) continue;
      const e = map.get(r.reserve_id);
      if (!e) continue;
      if (r.photo_type === "before") {
        e.beforeCount += 1;
        if (!firstBefore.has(r.reserve_id)) firstBefore.set(r.reserve_id, r.storage_path);
      } else if (r.photo_type === "after") {
        e.afterCount += 1;
        if (!firstAfter.has(r.reserve_id)) firstAfter.set(r.reserve_id, r.storage_path);
      }
    }

    // Lift report count per reserve.
    const { data: liftItems } = await supabaseAdmin
      .from("reserve_lift_items")
      .select("reserve_id,report_id")
      .in("reserve_id", data.reserveIds);
    const liftSet = new Map<string, Set<string>>();
    for (const r of (liftItems ?? []) as any[]) {
      if (!r.reserve_id || !r.report_id) continue;
      const e = map.get(r.reserve_id);
      if (!e) continue;
      if (!liftSet.has(r.reserve_id)) liftSet.set(r.reserve_id, new Set());
      liftSet.get(r.reserve_id)!.add(r.report_id);
    }
    for (const [id, set] of liftSet) {
      const e = map.get(id);
      if (e) e.liftCount = set.size;
    }

    // Pick + sign the thumbnail: prefer after, then before, then initial.
    for (const e of map.values()) {
      const candidate =
        firstAfter.get(e.reserveId) ?? firstBefore.get(e.reserveId) ?? firstInitial.get(e.reserveId) ?? null;
      if (candidate) {
        const { data: signed } = await supabaseAdmin.storage
          .from("pv-assets")
          .createSignedUrl(candidate, SIGNED_TTL);
        e.thumbUrl = signed?.signedUrl ?? null;
      }
    }

    return { entries: Array.from(map.values()) };
  });
