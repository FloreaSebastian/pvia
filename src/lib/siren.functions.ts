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
 * Single-result lookup by SIREN or SIRET (used by onboarding).
 */
export const lookupCompanyBySirenOrSiret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => LookupSchema.parse(i))
  .handler(async ({ data, context }): Promise<SirenLookupResult> => {
    const cleaned = data.query.replace(/\s+/g, "");
    if (!/^\d{9}$|^\d{14}$/.test(cleaned)) {
      return { found: false, error: "Numéro invalide (SIREN: 9 chiffres, SIRET: 14 chiffres)." };
    }

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
      if (!res.ok) return { found: false, error: "Service de recherche indisponible. Saisie manuelle possible." };
      payload = await res.json();
    } catch {
      return { found: false, error: "Impossible de joindre le service de recherche." };
    }

    const result = payload?.results?.[0];
    if (!result) return { found: false, error: "Aucune entreprise trouvée pour ce numéro." };

    const siege = result.siege ?? {};
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

/* ─────────────────────────────────────────────────────────────────────────
 * Multi-result search by SIRET / SIREN / company name.
 * Used by the Client form (type = entreprise) to pre-fill fields.
 * ───────────────────────────────────────────────────────────────────────── */

const SearchSchema = z.object({
  query: z.string().trim().min(2).max(120),
});

export type FrenchCompanyHit = {
  name: string;
  siren: string;
  siret: string | null;
  legal_form: string | null;
  vat_number: string | null;
  naf_code: string | null;
  naf_label: string | null;
  address_line1: string | null;
  postal_code: string | null;
  city: string | null;
};

export type FrenchCompanySearchResult =
  | { ok: true; hits: FrenchCompanyHit[] }
  | { ok: false; error: string };

function computeFrenchVat(siren: string): string | null {
  if (!/^\d{9}$/.test(siren)) return null;
  const n = BigInt(siren);
  const key = Number((12n + (3n * (n % 97n)) % 97n) % 97n);
  return `FR${key.toString().padStart(2, "0")}${siren}`;
}

export const searchFrenchCompanies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => SearchSchema.parse(i))
  .handler(async ({ data, context }): Promise<FrenchCompanySearchResult> => {
    const raw = data.query.trim();
    const cleaned = raw.replace(/\s+/g, "");
    const isNumeric = /^\d{9}$|^\d{14}$/.test(cleaned);

    try {
      const req = getRequest();
      const ip = getClientIp(req);
      await enforceRateLimit({ bucket: "siren_lookup", key: `${context.userId}:${ip}`, limit: 30, windowSec: 60 });
    } catch (e) {
      if ((e as { name?: string })?.name === "RateLimitError") {
        return { ok: false, error: (e as Error).message };
      }
    }

    const q = isNumeric ? (cleaned.length === 14 ? cleaned.slice(0, 9) : cleaned) : raw;
    const url = `https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(q)}&page=1&per_page=10`;

    let payload: any = null;
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) return { ok: false, error: "Service de recherche indisponible." };
      payload = await res.json();
    } catch {
      return { ok: false, error: "Impossible de joindre le service de recherche." };
    }

    const results: any[] = Array.isArray(payload?.results) ? payload.results : [];
    const hits: FrenchCompanyHit[] = results.slice(0, 10).map((r) => {
      const siege = r.siege ?? {};
      const siren: string = r.siren ?? siege.siren ?? "";
      let siret: string | null = siege.siret ?? null;
      let addr = siege;
      if (isNumeric && cleaned.length === 14) {
        const m = (r.matching_etablissements ?? []).find((e: any) => e.siret === cleaned);
        if (m) { siret = cleaned; addr = m; }
      }
      return {
        name: r.nom_complet || r.nom_raison_sociale || "",
        siren,
        siret,
        legal_form: r.nature_juridique || null,
        vat_number: computeFrenchVat(siren),
        naf_code: r.activite_principale || null,
        naf_label: r.activite_principale_libelle || r.libelle_activite_principale || null,
        address_line1: addr?.adresse || null,
        postal_code: addr?.code_postal || null,
        city: addr?.libelle_commune || null,
      };
    });

    return { ok: true, hits };
  });
