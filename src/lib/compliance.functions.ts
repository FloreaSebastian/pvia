import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requirePlatformAdmin } from "./admin-guard.server";

/**
 * Catalogue par défaut de la checklist AIPD / CNIL.
 * Les VALEURS juridiques (durées, base légale, DPO) restent en placeholder :
 * elles doivent être complétées par le DPO de l'entreprise.
 */
export const COMPLIANCE_CATALOG: Array<{
  category: string;
  item_key: string;
  title: string;
  description: string;
}> = [
  // Identification
  { category: "Identification", item_key: "dpo_designation",
    title: "Désignation du DPO / référent RGPD",
    description: "Nom, qualité, email du référent. À COMPLÉTER PAR LE DPO." },
  { category: "Identification", item_key: "responsable_traitement",
    title: "Responsable de traitement identifié",
    description: "Identité juridique exacte de l'entreprise utilisatrice. À COMPLÉTER." },

  // Données
  { category: "Données collectées", item_key: "data_signature",
    title: "Signatures électroniques",
    description: "Image manuscrite, IP, user-agent, horodatage, consentement versionné, token haché SHA-256." },
  { category: "Données collectées", item_key: "data_identity",
    title: "Identité du signataire",
    description: "Nom, prénom, email, téléphone (OTP terrain), qualité." },
  { category: "Données collectées", item_key: "data_photos",
    title: "Photos de chantier",
    description: "Géolocalisation possible des EXIF — vérifier si conservation/affichage." },

  // Finalité
  { category: "Finalité & base légale", item_key: "purpose",
    title: "Finalité du traitement",
    description: "Preuve de réception de travaux + opposabilité décennale (art. 1792 Code civil)." },
  { category: "Finalité & base légale", item_key: "legal_basis",
    title: "Base légale RGPD (art. 6)",
    description: "Exécution d'un contrat (6.1.b) + intérêt légitime (6.1.f). À VALIDER PAR LE DPO." },

  // Durée
  { category: "Conservation", item_key: "retention_signed_pv",
    title: "Durée de conservation — PV signés",
    description: "Recommandé : 10 ans (prescription décennale). À COMPLÉTER." },
  { category: "Conservation", item_key: "retention_audit_logs",
    title: "Durée de conservation — Journaux d'audit",
    description: "Recommandé : 6 ans. À COMPLÉTER." },
  { category: "Conservation", item_key: "retention_otp",
    title: "Durée de conservation — Codes OTP / sessions client",
    description: "Court terme (purgé par cron). Vérifier `cleanup_client_auth` actif." },

  // Sécurité
  { category: "Sécurité", item_key: "tls",
    title: "Chiffrement en transit (TLS 1.3)", description: "Vérifié sur tous les domaines." },
  { category: "Sécurité", item_key: "rls",
    title: "Row Level Security activée sur toutes les tables sensibles",
    description: "32/33 tables couvertes — voir audit technique." },
  { category: "Sécurité", item_key: "token_hash",
    title: "Tokens de signature hachés (SHA-256)",
    description: "Implémenté — le token clair n'est jamais stocké." },
  { category: "Sécurité", item_key: "backups",
    title: "Sauvegardes chiffrées et testées",
    description: "Supabase PITR. Tester un restore au moins 1x/an. À DOCUMENTER." },

  // Droits
  { category: "Droits des personnes", item_key: "rights_access",
    title: "Procédure d'accès / rectification / effacement",
    description: "Contact : contact@pvia.fr — délai 30j. À DOCUMENTER." },
  { category: "Droits des personnes", item_key: "rights_portability",
    title: "Portabilité (export PDF + JSON)",
    description: "Export PV PDF OK. Export JSON utilisateur À AJOUTER." },

  // Sous-traitance
  { category: "Sous-traitance", item_key: "subprocessors",
    title: "Liste des sous-traitants RGPD",
    description: "Supabase (UE), Cloudflare (UE), Resend (UE/US — clauses contractuelles types), Stripe. À MAINTENIR." },

  // AIPD
  { category: "AIPD", item_key: "aipd_required",
    title: "AIPD requise ?",
    description: "Traitement à grande échelle de données biométriques (signature manuscrite) → potentiellement OUI. À VALIDER." },
  { category: "AIPD", item_key: "aipd_document",
    title: "Document AIPD rédigé et validé",
    description: "À RÉDIGER PAR LE DPO. Modèle CNIL disponible." },
];

/**
 * Liste les entreprises à auditer (réservé platform admin).
 * Permet de sélectionner explicitement la cible de l'audit conformité,
 * au lieu d'utiliser silencieusement `activeCompanyId`.
 */
export const listComplianceCompanies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("companies")
      .select("id,name,email,created_at")
      .order("name", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getComplianceChecklist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { companyId: string }) => z.object({ companyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    // Conformité = outil plateforme : seul un platform_admin peut auditer
    await requirePlatformAdmin(context.userId);
    const { companyId } = data;

    const { data: existing } = await supabaseAdmin
      .from("compliance_checklist_items")
      .select("*").eq("company_id", companyId);
    const byKey = new Map((existing ?? []).map((r) => [r.item_key, r]));

    return COMPLIANCE_CATALOG.map((c) => {
      const row = byKey.get(c.item_key);
      return {
        ...c,
        id: row?.id ?? null,
        status: (row?.status as string) ?? "todo",
        value: row?.value ?? null,
        notes: row?.notes ?? null,
        updated_at: row?.updated_at ?? null,
      };
    });
  });

export const updateComplianceItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({
    companyId: z.string().uuid(),
    item_key: z.string().min(1).max(80),
    status: z.enum(["todo", "in_progress", "done", "na"]),
    value: z.string().max(2000).optional().nullable(),
    notes: z.string().max(4000).optional().nullable(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context.userId);
    const cat = COMPLIANCE_CATALOG.find((c) => c.item_key === data.item_key);
    if (!cat) throw new Error("Item inconnu");

    const { error } = await supabaseAdmin
      .from("compliance_checklist_items")
      .upsert({
        company_id: data.companyId,
        category: cat.category,
        item_key: data.item_key,
        title: cat.title,
        description: cat.description,
        status: data.status,
        value: data.value ?? null,
        notes: data.notes ?? null,
        updated_by: context.userId,
      }, { onConflict: "company_id,item_key" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
