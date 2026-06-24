/**
 * Server functions for general jobsite photos (chantier_photos).
 * Distinct from reserve photos (pv_photos / reserve_lift_item_photos).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { writeAuditLog } from "./audit.server";

const BUCKET = "pv-assets";

async function assertCanManage(sb: SupabaseClient<Database>, companyId: string, userId: string) {
  const { data, error } = await sb.rpc("can_manage_company", { _company_id: companyId, _user_id: userId });
  if (error) throw new Error("Vérification des droits impossible.");
  if (data !== true) throw new Error("Droits insuffisants.");
}

const PhotoType = z.enum(["before", "during", "after"]);

export const listChantierPhotos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), chantierId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("chantier_photos")
      .select("*")
      .eq("chantier_id", data.chantierId)
      .eq("company_id", data.companyId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    const uploaderIds = Array.from(new Set((rows ?? []).map((r) => r.uploaded_by).filter(Boolean))) as string[];
    const uploaderMap = new Map<string, string>();
    if (uploaderIds.length) {
      const { data: profs } = await supabase.from("profiles").select("id,full_name").in("id", uploaderIds);
      for (const p of (profs ?? []) as any[]) if (p?.id && p?.full_name) uploaderMap.set(p.id, p.full_name);
    }
    // Sign URLs for storage paths (private bucket)
    const out: any[] = [];
    for (const r of rows ?? []) {
      let url: string | null = r.photo_url ?? null;
      if (r.storage_path) {
        const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(r.storage_path, 3600);
        if (signed?.signedUrl) url = signed.signedUrl;
      }
      out.push({ ...r, signed_url: url, uploader_name: r.uploaded_by ? uploaderMap.get(r.uploaded_by) ?? null : null });
    }
    return { photos: out };
  });

export const createChantierPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({
    companyId: z.string().uuid(),
    chantierId: z.string().uuid(),
    photo_type: PhotoType,
    storage_path: z.string().min(1).max(500),
    file_name: z.string().max(300).optional().nullable(),
    file_size: z.number().int().nullable().optional(),
    file_hash: z.string().max(128).nullable().optional(),
    caption: z.string().max(2000).nullable().optional(),
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),
    accuracy: z.number().nullable().optional(),
    taken_at: z.string().nullable().optional(),
    device_info: z.record(z.any()).nullable().optional(),
    exif_metadata: z.record(z.any()).nullable().optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanManage(supabase, data.companyId, userId);

    // Compute next index per type for the label
    const { count } = await supabase
      .from("chantier_photos")
      .select("id", { count: "exact", head: true })
      .eq("chantier_id", data.chantierId)
      .eq("photo_type", data.photo_type);
    const idx = (count ?? 0) + 1;
    const prefix = data.photo_type === "before" ? "AVANT" : data.photo_type === "during" ? "PENDANT" : "FIN";
    const label = `CHANTIER-${prefix}-${String(idx).padStart(3, "0")}`;

    const { data: row, error } = await supabase.from("chantier_photos").insert({
      company_id: data.companyId,
      chantier_id: data.chantierId,
      uploaded_by: userId,
      photo_type: data.photo_type,
      storage_path: data.storage_path,
      label,
      caption: data.caption ?? null,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      accuracy: data.accuracy ?? null,
      taken_at: data.taken_at ?? null,
      file_name: data.file_name ?? null,
      file_size: data.file_size ?? null,
      file_hash: data.file_hash ?? null,
      device_info: data.device_info ?? null,
      exif_metadata: data.exif_metadata ?? null,
    }).select("id").single();
    if (error || !row) throw new Error(error?.message ?? "Création impossible.");
    await writeAuditLog({ companyId: data.companyId, userId, entityType: "chantier_photo", entityId: row.id, action: "chantier_photo.create", newValues: { photo_type: data.photo_type, label } });
    return { ok: true, id: row.id as string, label };
  });

export const deleteChantierPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanManage(supabase, data.companyId, userId);
    const { data: row } = await supabase
      .from("chantier_photos")
      .select("storage_path")
      .eq("id", data.id)
      .eq("company_id", data.companyId)
      .maybeSingle();
    const { error } = await supabase.from("chantier_photos").delete().eq("id", data.id).eq("company_id", data.companyId);
    if (error) throw new Error(error.message);
    if (row?.storage_path) {
      await supabase.storage.from(BUCKET).remove([row.storage_path]);
    }
    await writeAuditLog({ companyId: data.companyId, userId, entityType: "chantier_photo", entityId: data.id, action: "chantier_photo.delete" });
    return { ok: true };
  });
