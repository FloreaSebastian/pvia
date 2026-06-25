/**
 * Phase B — Export ZIP du dossier chantier.
 * Produit un ZIP nommé "CH####XX-Nom.zip" structuré :
 *  - 01-PV/                       (tous les PDF des PV liés)
 *  - 02-Levees/                   (PDF client + interne des levées)
 *  - 03-Photos-Chantier/{Avant,Pendant,Apres}/
 *  - 04-Documents/                (documents chantier)
 *  - manifest.json                (références, contenu, horodatage)
 *
 * Renvoyé en base64 — adapté aux dossiers "petits/moyens" (~quelques dizaines
 * de fichiers). Au-delà, prévoir un workflow asynchrone + email.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import JSZip from "jszip";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { writeAuditLog } from "./audit.server";

function safeName(s: string | null | undefined, fallback = "fichier"): string {
  const base = (s ?? fallback).normalize("NFKD").replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_");
  return base.slice(0, 150) || fallback;
}

function extOf(name: string | null | undefined, fallback = "bin"): string {
  if (!name) return fallback;
  const m = name.match(/\.([a-zA-Z0-9]{1,8})$/);
  return m ? m[1].toLowerCase() : fallback;
}

/**
 * Récupère les octets d'un asset depuis Storage.
 * Accepte aussi bien un storage_path interne qu'une URL complète (legacy /
 * signée), pour éviter un échec si une colonne `pdf_url` contient déjà une URL.
 */
async function downloadBytes(
  supabaseAdmin: any,
  bucket: string,
  pathOrUrl: string,
): Promise<Uint8Array | null> {
  if (!pathOrUrl) return null;
  // URL complète (http[s]) → fetch direct.
  if (/^https?:\/\//i.test(pathOrUrl)) {
    try {
      const r = await fetch(pathOrUrl);
      if (!r.ok) return null;
      const ab = await r.arrayBuffer();
      return new Uint8Array(ab);
    } catch {
      return null;
    }
  }
  // Storage path relatif au bucket (cas standard).
  const cleaned = pathOrUrl.replace(/^\/+/, "");
  const { data, error } = await supabaseAdmin.storage.from(bucket).download(cleaned);
  if (error || !data) return null;
  const ab = await (data as Blob).arrayBuffer();
  return new Uint8Array(ab);
}

export const exportChantierDossier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      companyId: z.string().uuid(),
      chantierId: z.string().uuid(),
      variant: z.enum(["internal", "client"]).default("internal"),
    }).parse(i),
  )

  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 1) Vérif droits via RLS : on récupère le chantier sous le contexte user.
    const { data: chantier, error: chErr } = await supabase
      .from("chantiers")
      .select("id,name,reference,company_id,address,client_id,start_date,end_date")
      .eq("id", data.chantierId)
      .eq("company_id", data.companyId)
      .maybeSingle();
    if (chErr || !chantier) throw new Error("Chantier introuvable ou accès refusé.");
    const ref = (chantier as { reference?: string }).reference ?? "CHANTIER";

    // 2) Charger PV / Levées / Photos / Documents
    const [pvsRes, photosRes, docsRes] = await Promise.all([
      supabase
        .from("pv")
        .select("id,numero,type,status,signed_at,pdf_url")
        .eq("chantier_id", chantier.id)
        .eq("company_id", data.companyId)
        .order("created_at", { ascending: true }),
      supabase
        .from("chantier_photos")
        .select("id,photo_type,label,caption,storage_path,file_name,taken_at,created_at,latitude,longitude")
        .eq("chantier_id", chantier.id)
        .eq("company_id", data.companyId)
        .order("created_at", { ascending: true })
        .limit(1000),
      supabase
        .from("chantier_documents")
        .select("id,name,category,storage_path,file_url,file_type,created_at")
        .eq("chantier_id", chantier.id)
        .eq("company_id", data.companyId)
        .order("created_at", { ascending: true })
        .limit(500),
    ]);
    const pvs = pvsRes.data ?? [];
    const pvIds = pvs.map((p: any) => p.id);
    const lifts = pvIds.length
      ? (
          await supabase
            .from("reserve_lift_reports")
            .select("id,numero,status,pv_id,signed_at,pdf_url,pdf_client_url,pdf_internal_url,created_at")
            .in("pv_id", pvIds)
            .order("created_at", { ascending: true })
        ).data ?? []
      : [];

    // 3) Construction du ZIP — admin client pour téléchargement Storage
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const isClientVariant = data.variant === "client";
    const zip = new JSZip();
    const manifest: Record<string, unknown> = {
      generated_at: new Date().toISOString(),
      generated_by: userId,
      variant: data.variant,
      privacy_notice: isClientVariant
        ? "Variante CLIENT : coordonnées GPS exactes retirées (seul un indicateur is_geolocated est conservé)."
        : "Variante INTERNE : contient des données sensibles (coordonnées GPS exactes des photos). À ne pas diffuser au client.",
      chantier: {
        id: chantier.id,
        reference: ref,
        name: chantier.name,
        address: chantier.address,
        start_date: chantier.start_date,
        end_date: chantier.end_date,
      },
      pvs: [] as Array<Record<string, unknown>>,
      lifts: [] as Array<Record<string, unknown>>,
      photos: [] as Array<Record<string, unknown>>,
      documents: [] as Array<Record<string, unknown>>,
    };


    // 01-PV
    for (const p of pvs as any[]) {
      const entry: Record<string, unknown> = {
        id: p.id, numero: p.numero, type: p.type, status: p.status, signed_at: p.signed_at,
      };
      if (p.pdf_url) {
        const bytes = await downloadBytes(supabaseAdmin, "pv-assets", p.pdf_url);
        if (bytes) {
          const name = `01-PV/${safeName(p.numero ?? p.id)}.pdf`;
          zip.file(name, bytes);
          entry.path_in_zip = name;
        }
      }
      (manifest.pvs as any[]).push(entry);
    }

    // 02-Levees
    for (const l of lifts as any[]) {
      const numero = l.numero ?? l.id;
      const e: Record<string, unknown> = { id: l.id, numero, status: l.status, pv_id: l.pv_id, signed_at: l.signed_at, files: {} };
      if (l.pdf_client_url) {
        const b = await downloadBytes(supabaseAdmin, "pv-assets", l.pdf_client_url);
        if (b) {
          const name = `02-Levees/${safeName(numero)}-client.pdf`;
          zip.file(name, b);
          (e.files as any).client = name;
        }
      }
      if (l.pdf_internal_url) {
        const b = await downloadBytes(supabaseAdmin, "pv-assets", l.pdf_internal_url);
        if (b) {
          const name = `02-Levees/${safeName(numero)}-interne.pdf`;
          zip.file(name, b);
          (e.files as any).internal = name;
        }
      } else if (l.pdf_url) {
        const b = await downloadBytes(supabaseAdmin, "pv-assets", l.pdf_url);
        if (b) {
          const name = `02-Levees/${safeName(numero)}.pdf`;
          zip.file(name, b);
          (e.files as any).pdf = name;
        }
      }
      (manifest.lifts as any[]).push(e);
    }

    // 03-Photos-Chantier
    const folderForType = (t: string) =>
      t === "before" ? "Avant" : t === "during" ? "Pendant" : "Apres";
    for (const ph of (photosRes.data ?? []) as any[]) {
      if (!ph.storage_path) continue;
      const bytes = await downloadBytes(supabaseAdmin, "pv-assets", ph.storage_path);
      if (!bytes) continue;
      const ex = extOf(ph.file_name, "jpg");
      const label = ph.label ?? `${ref}-${ph.photo_type}`;
      const name = `03-Photos-Chantier/${folderForType(ph.photo_type)}/${safeName(label)}.${ex}`;
      zip.file(name, bytes);
      const hasGeo = ph.latitude != null && ph.longitude != null;
      (manifest.photos as any[]).push({
        id: ph.id, type: ph.photo_type, label: ph.label, caption: ph.caption,
        taken_at: ph.taken_at,
        is_geolocated: hasGeo,
        // GPS exact uniquement dans la variante interne.
        ...(isClientVariant ? {} : { latitude: ph.latitude, longitude: ph.longitude }),
        path_in_zip: name,
      });
    }


    // 04-Documents
    for (const d of (docsRes.data ?? []) as any[]) {
      if (!d.storage_path) {
        (manifest.documents as any[]).push({ id: d.id, name: d.name, category: d.category, url: d.file_url });
        continue;
      }
      const bytes = await downloadBytes(supabaseAdmin, "pv-assets", d.storage_path);
      if (!bytes) continue;
      const ex = extOf(d.name ?? d.storage_path, "bin");
      const base = d.name?.replace(/\.[a-zA-Z0-9]{1,8}$/, "") ?? d.id;
      const name = `04-Documents/${safeName(d.category ?? "autre")}/${safeName(base)}.${ex}`;
      zip.file(name, bytes);
      (manifest.documents as any[]).push({
        id: d.id, name: d.name, category: d.category, path_in_zip: name,
      });
    }

    zip.file("manifest.json", JSON.stringify(manifest, null, 2));
    zip.file(
      "README.txt",
      [
        `Dossier chantier ${ref} - ${chantier.name ?? ""}`,
        `Genere le ${new Date().toISOString()}`,
        `Variante : ${isClientVariant ? "CLIENT (sans coordonnees GPS exactes)" : "INTERNE (contient les coordonnees GPS des photos)"}`,
        isClientVariant
          ? "Cette archive peut etre transmise au client."
          : "ATTENTION : archive INTERNE. Ne pas diffuser telle quelle au client (donnees de geolocalisation).",
        "",
        "01-PV/                : Proces-verbaux signes (PDF)",
        "02-Levees/            : Rapports de levee de reserves (PDF client + interne)",
        "03-Photos-Chantier/   : Photos avant / pendant / apres",
        "04-Documents/         : Pieces jointes (devis, plans, factures...)",
        "manifest.json         : Index machine-readable",
      ].join("\n"),
    );


    const buf = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
    // base64
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < buf.length; i += chunk) {
      bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)) as any);
    }
    const base64 = btoa(bin);

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "chantier",
      entityId: chantier.id,
      action: "chantier.dossier_exported",
      metadata: {
        reference: ref,
        pv_count: pvs.length,
        lift_count: lifts.length,
        photo_count: (photosRes.data ?? []).length,
        document_count: (docsRes.data ?? []).length,
        bytes: buf.length,
      },
    });

    return {
      base64,
      fileName: `${safeName(ref)}-${safeName(chantier.name ?? "chantier")}.zip`,
      byteLength: buf.length,
    };
  });
