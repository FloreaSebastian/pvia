/**
 * Solar Studio V2 — P1 : exports du dossier (PDF client et PDF technique).
 *
 * Règles :
 *  - lecture seule du modèle : aucun export ne modifie la géométrie ;
 *  - périmètre entreprise vérifié côté serveur (jamais seulement le bouton) ;
 *  - branding appliqué uniquement si la formule l'inclut ;
 *  - aucune ressource externe arbitraire n'est téléchargée.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertSolarMember, loadFullModel } from "./solar.server";
import { drawingFromModel, formatModelAddress, resultsFromModel } from "./solar/report-from-model";
import { renderSolarPdf, type SolarPdfVariant } from "./solar/pdf-doc";
import { planExportFileName } from "./solar/results";

const ExportSchema = z.object({
  companyId: z.string().uuid(),
  studyId: z.string().uuid(),
  variant: z.enum(["client", "technique"]),
});

/** Le logo n'est chargé que depuis le stockage PVIA, jamais depuis une URL tierce. */
async function loadLogo(
  url: string | null,
  storageOrigin: string,
): Promise<{ bytes: Uint8Array; type: "png" | "jpg" } | null> {
  if (!url || !url.startsWith(storageOrigin)) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const type = res.headers.get("content-type")?.includes("png") ? "png" : "jpg";
    return { bytes, type };
  } catch {
    return null;
  }
}

export const exportSolarPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ExportSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarMember(supabase, data.companyId, userId);

    const { data: modelRef } = await supabase
      .from("solar_models")
      .select("id")
      .eq("company_id", data.companyId)
      .eq("study_id", data.studyId)
      .maybeSingle();
    if (!modelRef) throw new Error("Aucune étude d'implantation à exporter pour ce dossier.");

    const payload = await loadFullModel(supabase, data.companyId, modelRef.id);

    const { data: study } = await supabase
      .from("technical_studies")
      .select("reference")
      .eq("company_id", data.companyId)
      .eq("id", data.studyId)
      .maybeSingle();
    const reference = (study as { reference?: string } | null)?.reference ?? null;

    const report = resultsFromModel(payload);
    const drawing = drawingFromModel(payload, {
      title: "Plan d'implantation photovoltaïque",
      subtitle: formatModelAddress(payload.model),
    });

    // Branding : uniquement si la formule l'inclut. Sinon, document neutre.
    const guard = await import("./plan-guard.server");
    const branding = await import("./branding.server");
    const allowBranding = await guard.hasPlanFeature(data.companyId, "branding");
    const company = await branding.getCompanyBranding(data.companyId);
    const settings = await branding.getCompanyBrandingSettings(data.companyId);
    const storageOrigin = `${process.env["VITE_SUPABASE_URL"] ?? ""}/storage/`;
    const logo = allowBranding ? await loadLogo(company?.logo_url ?? null, storageOrigin) : null;

    const variant = data.variant as SolarPdfVariant;
    const bytes = await renderSolarPdf({
      report,
      drawing,
      variant,
      meta: {
        reference,
        address: formatModelAddress(payload.model),
        date: new Date(),
        companyName: company?.name ?? null,
        brandColor: allowBranding ? settings.pdf_brand_color : "#1E3A8A",
        logo,
        footer: allowBranding ? settings.pdf_footer : "Document non contractuel",
      },
    });

    const fileName = planExportFileName(reference, new Date(), "pdf").replace(
      "plan-photovoltaique",
      variant === "client" ? "etude-implantation" : "dossier-technique",
    );
    const path = `${data.companyId}/solar/${modelRef.id}/${variant}.pdf`;
    const { error } = await supabase.storage.from("pv-assets").upload(path, bytes, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (error) throw new Error("Génération du document impossible. Réessayez dans un instant.");

    const { data: signed } = await supabase.storage.from("pv-assets").createSignedUrl(path, 300);
    if (!signed?.signedUrl) throw new Error("Lien de téléchargement indisponible. Réessayez.");

    return { url: signed.signedUrl, fileName };
  });
