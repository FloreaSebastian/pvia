import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { generatePvPdfBytes } from "./pdf.server";

const Schema = z.object({ pvId: z.string().uuid() });

/** Public: regenerate the signed PDF for an authenticated company member. */
export const regeneratePvPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => Schema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: pv } = await supabaseAdmin
      .from("pv")
      .select("id,company_id")
      .eq("id", data.pvId)
      .maybeSingle();
    if (!pv?.company_id) throw new Error("PV introuvable.");

    const { data: m } = await supabaseAdmin
      .from("company_members")
      .select("id")
      .eq("company_id", pv.company_id)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (!m) throw new Error("Accès refusé.");

    const path = await buildAndStorePvPdf(pv.id);
    return { ok: true, pdfPath: path };
  });

/** Internal: build the PDF, upload it to `pv-assets`, persist pdf_url + pdf_generated_at. Returns the storage path. */
export async function buildAndStorePvPdf(pvId: string): Promise<string> {
  const { data: pv } = await supabaseAdmin
    .from("pv")
    .select("id,numero,type,status,reception_date,description,observations,client_signature,company_signature,signed_at,company_id,client_id,chantier_id,created_at")
    .eq("id", pvId)
    .maybeSingle();
  if (!pv?.company_id) throw new Error("PV introuvable.");

  const [{ data: company }, clientRes, chantierRes, photosRes, reservesRes] = await Promise.all([
    supabaseAdmin.from("companies").select("name,address,phone,email,siret,logo_url").eq("id", pv.company_id).maybeSingle(),
    pv.client_id
      ? supabaseAdmin.from("clients").select("name,email,phone,address").eq("id", pv.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
    pv.chantier_id
      ? supabaseAdmin.from("chantiers").select("name,address").eq("id", pv.chantier_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin.from("pv_photos").select("id,url,caption").eq("pv_id", pvId).order("created_at"),
    supabaseAdmin.from("pv_reserves").select("id,description,severity,status").eq("pv_id", pvId).order("created_at"),
  ]);

  // Fetch photo bytes from storage (private bucket) — limit to 12 to keep PDF size sane.
  const photos: { caption: string | null; bytes: Uint8Array }[] = [];
  for (const p of (photosRes.data ?? []).slice(0, 12)) {
    const { data: f } = await supabaseAdmin.storage.from("pv-assets").download(p.url);
    if (f) photos.push({ caption: p.caption, bytes: new Uint8Array(await f.arrayBuffer()) });
  }

  const pdfBytes = await generatePvPdfBytes({
    pv,
    company: company ?? undefined,
    client: (clientRes as any).data ?? undefined,
    chantier: (chantierRes as any).data ?? undefined,
    reserves: reservesRes.data ?? [],
    photos,
  });

  const path = `${pv.company_id}/pv/${pvId}/PV-${pv.numero}-signed.pdf`;
  const { error: upErr } = await supabaseAdmin.storage
    .from("pv-assets")
    .upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
  if (upErr) throw new Error(`Échec upload PDF: ${upErr.message}`);

  const { error: updErr } = await supabaseAdmin
    .from("pv")
    .update({ pdf_url: path, pdf_generated_at: new Date().toISOString() } as any)
    .eq("id", pvId);
  if (updErr) throw new Error(updErr.message);

  return path;
}

const PathSchema = z.object({ pvId: z.string().uuid() });

/** Returns a short-lived signed URL for the current signed PDF (auth required). */
export const getPvPdfSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => PathSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: pv } = await supabaseAdmin
      .from("pv")
      .select("id,company_id,pdf_url")
      .eq("id", data.pvId)
      .maybeSingle();
    if (!pv?.company_id || !pv.pdf_url) throw new Error("PDF indisponible.");
    const { data: m } = await supabaseAdmin
      .from("company_members")
      .select("id")
      .eq("company_id", pv.company_id)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (!m) throw new Error("Accès refusé.");
    const { data: s, error } = await supabaseAdmin.storage.from("pv-assets").createSignedUrl(pv.pdf_url, 300);
    if (error || !s) throw new Error("PDF indisponible.");
    return { url: s.signedUrl };
  });






const PublicSchema = z.object({ pvId: z.string().uuid(), publicKey: z.string().min(10).max(128) });

/**
 * Public PDF download: client must present (pvId + publicKey) returned by `signPvByToken`.
 * The `publicKey` is a fresh one-time-ish token persisted into pv.sign_token at sign time,
 * scoped to PDF download only and valid for 24h.
 */
export const getSignedPvPdfPublic = createServerFn({ method: "POST" })
  .inputValidator((input) => PublicSchema.parse(input))
  .handler(async ({ data }) => {
    const { data: pv } = await supabaseAdmin
      .from("pv")
      .select("id,pdf_url,sign_token,sign_token_expires_at")
      .eq("id", data.pvId)
      .maybeSingle();
    if (!pv) throw new Error("PV introuvable.");
    if (!pv.sign_token || pv.sign_token !== data.publicKey) throw new Error("Accès refusé.");
    if (pv.sign_token_expires_at && new Date(pv.sign_token_expires_at) < new Date())
      throw new Error("Lien expiré.");
    if (!pv.pdf_url) throw new Error("PDF en cours de génération.");
    const { data: s, error } = await supabaseAdmin.storage.from("pv-assets").createSignedUrl(pv.pdf_url, 600);
    if (error || !s) throw new Error("PDF indisponible.");
    return { url: s.signedUrl };
  });
