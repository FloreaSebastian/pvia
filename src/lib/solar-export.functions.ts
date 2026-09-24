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
import { fetchLogoSafely } from "./solar/logo-policy";
import { runSolarExport } from "./solar/export-pipeline";

const ExportSchema = z.object({
  companyId: z.string().uuid(),
  studyId: z.string().uuid(),
  variant: z.enum(["client", "technique"]),
});

export const exportSolarPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ExportSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const variant = data.variant as SolarPdfVariant;
    let modelId = "";
    let reference: string | null = null;

    return runSolarExport({
      assertMember: () => assertSolarMember(supabase, data.companyId, userId),
      // Un export écrit un fichier : abonnement utilisable obligatoire (lecture des résultats inchangée).
      assertSubscription: async () => {
        const { assertSubscriptionUsable } = await import("./plan-guard.server");
        await assertSubscriptionUsable(data.companyId, userId);
      },
      build: async () => {
        const { data: modelRef } = await supabase
          .from("solar_models")
          .select("id")
          .eq("company_id", data.companyId)
          .eq("study_id", data.studyId)
          .maybeSingle();
        if (!modelRef) throw new Error("Aucune étude d'implantation à exporter pour ce dossier.");
        modelId = modelRef.id;

        const payload = await loadFullModel(supabase, data.companyId, modelRef.id);

        const { data: study } = await supabase
          .from("technical_studies")
          .select("reference")
          .eq("company_id", data.companyId)
          .eq("id", data.studyId)
          .maybeSingle();
        reference = (study as { reference?: string } | null)?.reference ?? null;

        const report = resultsFromModel(payload);
        const drawing = drawingFromModel(payload, {
          title: "Plan d'implantation photovoltaïque",
          subtitle: formatModelAddress(payload.model),
        });

        // Branding visuel (logo, couleur, pied de page) : uniquement si la formule l'inclut.
        // Le nom de l'entreprise reste une mention d'identité, pas du branding.
        const guard = await import("./plan-guard.server");
        const branding = await import("./branding.server");
        const allowBranding = await guard.hasPlanFeature(data.companyId, "branding");
        const company = await branding.getCompanyBranding(data.companyId);
        const settings = await branding.getCompanyBrandingSettings(data.companyId);
        const projectUrl = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? null;
        const logo = allowBranding
          ? await fetchLogoSafely(company?.logo_url ?? null, { projectUrl })
          : null;

        return renderSolarPdf({
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
      },
      upload: async (bytes) => {
        const fileName = planExportFileName(reference, new Date(), "pdf").replace(
          "plan-photovoltaique",
          variant === "client" ? "etude-implantation" : "dossier-technique",
        );
        const path = `${data.companyId}/solar/${modelId}/${variant}.pdf`;
        const { error } = await supabase.storage.from("pv-assets").upload(path, bytes, {
          contentType: "application/pdf",
          upsert: true,
        });
        if (error) throw new Error("Génération du document impossible. Réessayez dans un instant.");

        const { data: signed } = await supabase.storage.from("pv-assets").createSignedUrl(path, 300);
        if (!signed?.signedUrl) throw new Error("Lien de téléchargement indisponible. Réessayez.");
        return { url: signed.signedUrl, fileName };
      },
    });
  });
