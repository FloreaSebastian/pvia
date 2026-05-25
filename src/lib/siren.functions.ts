import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { enforceRateLimit, getClientIp } from "./rate-limit.server";
import { getRequest } from "@tanstack/react-start/server";
import { writeAuditLog } from "./audit.server";

const LookupSchema = z.object({
  query: z.string().min(9).max(20),
});

export type SirenLookupResult =
  | {
      found: true;
      name: string;
      siren: string;
      siret: string | null;
      legal_form: string | null;
      address_line1: string | null;
      postal_code: string | null;
      city: string | null;
      naf_label: string | null;
    }
  | { found: false; error: string };

/**
 * Looks up a French company by SIREN (9 digits) or SIRET (14 digits) using
 * the public API "Recherche d'Entreprises" (data.gouv.fr / INSEE Sirene).
 * Free, no API key, public data only. Falls back gracefully.
 */
export const lookupCompanyBySirenOrSiret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => LookupSchema.parse(i))
  .handler(async ({ data, context }): Promise<SirenLookupResult> => {
    const cleaned = data.query.replace(/\s+/g, "");
    if (!/^\d{9}$|^\d{14}$/.test(cleaned)) {
      return { found: false, error: "Numéro invalide (SIREN: 9 chiffres, SIRET: 14 chiffres)." };
    }

    // Per-IP rate limit
    try {
      const req = getRequest();
      const ip = getClientIp(req);
      await enforceRateLimit({ bucket: "siren_lookup", key: `${context.userId}:${ip}`, limit: 20, windowSec: 60 });
    } catch (e) {
      if ((e as { name?: string })?.name === "RateLimitError") {
        return { found: false, error: (e as Error).message };
      }
    }

    const siren = cleaned.length === 14 ? cleaned.slice(0, 9) : cleaned;
    const url = `https://recherche-entreprises.api.gouv.fr/search?q=${siren}&page=1&per_page=1`;

    let payload: any = null;
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) {
        return { found: false, error: "Service de recherche indisponible. Saisie manuelle possible." };
      }
      payload = await res.json();
    } catch {
      return { found: false, error: "Impossible de joindre le service de recherche." };
    }

    const result = payload?.results?.[0];
    if (!result) {
      return { found: false, error: "Aucune entreprise trouvée pour ce numéro." };
    }

    const siege = result.siege ?? {};
    // If user provided a SIRET, find the matching établissement (sinon = siège)
    let siret: string | null = siege.siret ?? null;
    let addr = siege;
    if (cleaned.length === 14) {
      siret = cleaned;
      const match = (result.matching_etablissements ?? []).find((e: any) => e.siret === cleaned);
      if (match) addr = match;
    }

    const out: SirenLookupResult = {
      found: true,
      name: result.nom_complet || result.nom_raison_sociale || "",
      siren: result.siren ?? siren,
      siret,
      legal_form: result.nature_juridique || null,
      address_line1: addr?.adresse || null,
      postal_code: addr?.code_postal || null,
      city: addr?.libelle_commune || null,
      naf_label: result.activite_principale || null,
    };

    // Best-effort audit (no companyId yet — that's during onboarding)
    try {
      await writeAuditLog({
        companyId: null,
        userId: context.userId,
        entityType: "auth",
        action: "onboarding.company_lookup",
        metadata: { query: cleaned, found: true, siren: out.siren },
        actor: "user",
      });
    } catch {
      /* ignore */
    }

    return out;
  });
