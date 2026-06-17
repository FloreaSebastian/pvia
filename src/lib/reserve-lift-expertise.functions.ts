/**
 * Reserve-lift expertise export.
 *
 * Produces a ZIP bundle for insurance / expertise / litigation:
 *  - the internal PDF (with watermark, GPS, hashes)
 *  - the client PDF
 *  - every original photo (before / after / legacy) with its stored hash
 *  - a machine-readable manifest.json (report, items, photos, GPS, EXIF, hashes)
 *  - audit_logs filtered for this report (chain of custody)
 *
 * Returned as base64 to the client. Sized for "small to medium" lifts
 * (~50–100 photos); above that, prefer an async + email workflow.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import JSZip from "jszip";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAuditLog } from "./audit.server";

function safeName(s: string | null | undefined, fallback = "fichier"): string {
  const base = (s ?? fallback).normalize("NFKD").replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_");
  return base.slice(0, 120) || fallback;
}

export const exportReserveLiftExpertise = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ reportId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const userId = context.userId;

    // 1. Load report + access check
    const { data: report } = await supabaseAdmin
      .from("reserve_lift_reports")
      .select("*")
      .eq("id", data.reportId)
      .maybeSingle();
    if (!report) throw new Error("Levée introuvable.");

    const { data: member } = await supabaseAdmin
      .from("company_members")
      .select("id,role")
      .eq("company_id", report.company_id)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (!member) throw new Error("Accès refusé.");

    // 2. Related rows
    const [pvRes, itemsRes, photosRes, auditRes, companyRes] = await Promise.all([
      supabaseAdmin.from("pv")
        .select("id,numero,type,reception_date,client_id,chantier_id,description,signed_at")
        .eq("id", report.pv_id).maybeSingle(),
      supabaseAdmin.from("reserve_lift_items")
        .select("id,reserve_id,comment,photo_urls")
        .eq("report_id", report.id),
      supabaseAdmin.from("reserve_lift_item_photos" as any)
        .select("*")
        .eq("report_id", report.id)
        .order("uploaded_at", { ascending: true }),
      supabaseAdmin.from("audit_logs")
        .select("id,action,user_id,entity_type,entity_id,metadata,created_at")
        .eq("entity_type", "reserve_lift")
        .eq("entity_id", report.id)
        .order("created_at", { ascending: true }),
      supabaseAdmin.from("companies").select("name,siren,email").eq("id", report.company_id).maybeSingle(),
    ]);

    const reserveIds = Array.from(new Set((itemsRes.data ?? []).map((it: any) => it.reserve_id)));
    const reservesRes = reserveIds.length
      ? await supabaseAdmin.from("pv_reserves")
          .select("id,description,severity,priority,nature,status,due_date,lifted_at,validated_at")
          .in("id", reserveIds)
      : { data: [] as any[] };

    const zip = new JSZip();

    // 3. PDFs (best-effort)
    async function addPdf(path: string | null | undefined, name: string) {
      if (!path) return;
      const { data: f } = await supabaseAdmin.storage.from("pv-assets").download(path);
      if (!f) return;
      zip.file(name, new Uint8Array(await f.arrayBuffer()));
    }
    await addPdf((report as any).pdf_internal_url, "pdf/levee-interne.pdf");
    await addPdf((report as any).pdf_client_url ?? report.pdf_url, "pdf/levee-client.pdf");

    // 4. Photos
    const photosManifest: any[] = [];
    let downloadedCount = 0;
    let missingCount = 0;
    for (const p of ((photosRes.data ?? []) as any[])) {
      const folder = p.photo_type === "before" ? "photos/avant"
        : p.photo_type === "after" ? "photos/apres"
        : "photos/autres";
      const fname = safeName(p.file_name || `${p.id}.jpg`);
      const path = `${folder}/${fname}`;
      try {
        const { data: f } = await supabaseAdmin.storage.from("pv-assets").download(p.storage_path);
        if (f) {
          zip.file(path, new Uint8Array(await f.arrayBuffer()));
          downloadedCount++;
        } else {
          missingCount++;
        }
      } catch {
        missingCount++;
      }
      photosManifest.push({
        id: p.id,
        path_in_zip: path,
        storage_path: p.storage_path,
        photo_type: p.photo_type,
        reserve_id: p.reserve_id,
        reserve_lift_item_id: p.reserve_lift_item_id,
        file_name: p.file_name,
        file_size: p.file_size,
        file_hash_sha256: p.file_hash,
        latitude: p.latitude,
        longitude: p.longitude,
        accuracy_meters: p.accuracy,
        taken_at: p.taken_at,
        uploaded_at: p.uploaded_at,
        uploaded_by: p.uploaded_by,
        device_info: p.device_info,
        exif_metadata: p.exif_metadata,
      });
    }

    // 5. Manifest
    const manifest = {
      schema: "pvia.reserve_lift_expertise/v1",
      generated_at_utc: new Date().toISOString(),
      generated_by_user_id: userId,
      company: companyRes.data ?? null,
      pv: pvRes.data ?? null,
      report: {
        id: report.id,
        numero: report.numero,
        status: report.status,
        signed_at: report.signed_at,
        client_validated_at: (report as any).client_validated_at,
        client_validated_email: (report as any).client_validated_email,
        client_rejected_at: (report as any).client_rejected_at,
        technician_name: (report as any).technician_name,
        pdf_internal_url: (report as any).pdf_internal_url,
        pdf_client_url: (report as any).pdf_client_url ?? report.pdf_url,
        created_at: report.created_at,
      },
      reserves: reservesRes.data ?? [],
      items: (itemsRes.data ?? []).map((it: any) => ({
        id: it.id,
        reserve_id: it.reserve_id,
        comment: it.comment,
        legacy_photo_urls: it.photo_urls ?? [],
      })),
      photos: photosManifest,
      audit_trail: auditRes.data ?? [],
      stats: {
        photos_total: photosManifest.length,
        photos_downloaded: downloadedCount,
        photos_missing: missingCount,
      },
    };

    zip.file("manifest.json", JSON.stringify(manifest, null, 2));

    // README for the expert / insurer
    zip.file(
      "LISEZ-MOI.txt",
      [
        `Dossier d'expertise — Levée de réserves ${report.numero ?? ""}`,
        `Généré le ${new Date().toISOString()} (UTC)`,
        ``,
        `Contenu :`,
        `- pdf/levee-interne.pdf     : version interne (GPS, EXIF, hashes, filigrane)`,
        `- pdf/levee-client.pdf      : version client (sans coordonnées GPS exactes)`,
        `- photos/avant/             : photos avant intervention`,
        `- photos/apres/             : photos après intervention`,
        `- photos/autres/            : photos legacy (non catégorisées)`,
        `- manifest.json             : méta-données structurées (GPS, EXIF, SHA-256)`,
        ``,
        `Chaque photo est référencée dans manifest.json avec son empreinte`,
        `cryptographique SHA-256, permettant de vérifier qu'aucun fichier n'a`,
        `été altéré depuis l'upload.`,
      ].join("\n"),
    );

    const buf = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const base64 = Buffer.from(buf).toString("base64");

    await writeAuditLog({
      companyId: report.company_id,
      userId,
      pvId: report.pv_id,
      entityType: "reserve_lift",
      entityId: report.id,
      action: "reserve_lift.expertise_exported",
      metadata: {
        numero: report.numero,
        photos_total: photosManifest.length,
        photos_downloaded: downloadedCount,
        photos_missing: missingCount,
        bytes: buf.byteLength,
      },
      actor: "user",
    });

    return {
      base64,
      fileName: `expertise-${safeName(report.numero ?? report.id)}.zip`,
      sizeBytes: buf.byteLength,
      photosTotal: photosManifest.length,
      photosMissing: missingCount,
    };
  });
