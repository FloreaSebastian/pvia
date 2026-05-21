import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildAndStorePvPdf } from "./pdf.server";
import { writeAuditLog } from "./audit.server";

const Schema = z.object({ pvId: z.string().uuid() });

/** Regenerate the signed PDF for an authenticated company member (admin/manager-equivalent). */
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
    await writeAuditLog({
      companyId: pv.company_id,
      userId,
      pvId: pv.id,
      entityType: "pv",
      entityId: pv.id,
      action: "pv.pdf_generated",
      metadata: { trigger: "manual", path },
      actor: "pdf",
    });
    return { ok: true, pdfPath: path };
  });


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
    await writeAuditLog({
      companyId: pv.company_id,
      userId,
      pvId: pv.id,
      entityType: "pv",
      entityId: pv.id,
      action: "pv.pdf_downloaded",
      metadata: { path: pv.pdf_url },
      actor: "user",
    });
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
