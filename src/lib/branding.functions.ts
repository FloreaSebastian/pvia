import { createServerFn } from "@tanstack/react-start";
import { ADMIN_ROLES, OWNER_ROLES, SIGN_ROLES, isAdminRole, isManageRole } from "@/lib/roles";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getCompanyBranding } from "./branding.server";
import { writeAuditLog } from "./audit.server";

const GetSchema = z.object({ companyId: z.string().uuid() });

export const getCompanyBrandingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => GetSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { data: m } = await supabaseAdmin
      .from("company_members")
      .select("id")
      .eq("company_id", data.companyId)
      .eq("user_id", context.userId)
      .eq("status", "active")
      .maybeSingle();
    if (!m) throw new Error("Accès refusé.");
    return getCompanyBranding(data.companyId);
  });

/* ---------------- Update branding (Entreprise page) ---------------- */

const UpdateSchema = z.object({
  companyId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  legal_form: z.string().trim().max(120).optional().nullable(),
  siren: z.string().trim().regex(/^\d{9}$/, "SIREN : 9 chiffres").optional().nullable().or(z.literal("")),
  siret: z.string().trim().regex(/^\d{14}$/, "SIRET : 14 chiffres").optional().nullable().or(z.literal("")),
  vat_number: z.string().trim().max(20).regex(/^[A-Z0-9]*$/i, "TVA invalide").optional().nullable().or(z.literal("")),
  address_line1: z.string().trim().max(200).optional().nullable(),
  address_line2: z.string().trim().max(200).optional().nullable(),
  postal_code: z.string().trim().max(10).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  country: z.string().trim().max(60).optional().nullable(),
  phone: z.string().trim().max(30).regex(/^[\d\s+().-]*$/, "Téléphone invalide").optional().nullable().or(z.literal("")),
  email: z.string().trim().email("Email invalide").max(200).optional().nullable().or(z.literal("")),
  website: z.string().trim().url("URL invalide").max(300).optional().nullable().or(z.literal("")),
  logo_url: z
    .string()
    .trim()
    .max(2000)
    .url("URL invalide")
    .refine(
      (v) => {
        try {
          const u = new URL(v);
          if (u.protocol !== "https:") return false;
          // Only allow the project's Supabase public storage host for company-logos
          const supaUrl = process.env.SUPABASE_URL;
          if (!supaUrl) return false;
          const supaHost = new URL(supaUrl).host;
          return (
            u.host === supaHost &&
            u.pathname.startsWith("/storage/v1/object/public/company-logos/")
          );
        } catch {
          return false;
        }
      },
      { message: "URL de logo non autorisée." },
    )
    .optional()
    .nullable()
    .or(z.literal("")),
});

const empty = (v: string | null | undefined) => (v && v.length > 0 ? v : null);

export const updateCompanyBranding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => UpdateSchema.parse(i))
  .handler(async ({ data, context }) => {
    const userId = context.userId;

    // Verify admin/owner
    const { data: m } = await supabaseAdmin
      .from("company_members")
      .select("role,status")
      .eq("company_id", data.companyId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (!m || (!isAdminRole(m.role))) {
      throw new Error("Seuls les administrateurs peuvent modifier l'entreprise.");
    }

    // Load previous to detect what changed (for audit categorization + legacy address)
    const { data: prev } = await supabaseAdmin
      .from("companies")
      .select("name,legal_form,siren,siret,vat_number,address_line1,address_line2,postal_code,city,country,phone,email,website,logo_url,company_verified")
      .eq("id", data.companyId)
      .maybeSingle();

    const isVerified = !!prev?.company_verified;

    // Une fois validée, les champs officiels deviennent immuables et ne sont
    // mis à jour qu'via `syncCompanyFromSiren` ou un admin plateforme.
    // On garde les valeurs précédentes côté serveur, peu importe le payload du client.
    const legalFields = ["name", "legal_form", "siren", "siret", "vat_number", "address_line1", "postal_code", "city"] as const;
    const triedLegalChange = isVerified && prev && legalFields.some(
      (k) => ((data as any)[k] ?? null) !== ((prev as any)[k] ?? null) &&
             ((data as any)[k] ?? "") !== "" // ignore champs vides envoyés par défaut
    );

    const name = isVerified ? (prev?.name ?? data.name) : data.name;
    const legal_form = isVerified ? (prev?.legal_form ?? null) : empty(data.legal_form);
    const siren = isVerified ? (prev?.siren ?? null) : empty(data.siren);
    const siret = isVerified ? (prev?.siret ?? null) : empty(data.siret);
    const vat_number = isVerified ? (prev?.vat_number ?? null) : empty(data.vat_number);
    const address_line1 = isVerified ? (prev?.address_line1 ?? null) : empty(data.address_line1);
    const postal_code = isVerified ? (prev?.postal_code ?? null) : empty(data.postal_code);
    const city = isVerified ? (prev?.city ?? null) : empty(data.city);

    const address_line2 = empty(data.address_line2);
    const country = empty(data.country) ?? "FR";

    // Keep legacy `address` in sync from structured fields (back-compat)
    const composedAddress = [
      address_line1,
      address_line2,
      [postal_code, city].filter(Boolean).join(" ").trim() || null,
      country,
    ].filter(Boolean).join(", ");

    const update = {
      name,
      legal_form,
      siren,
      siret,
      vat_number,
      address_line1,
      address_line2,
      postal_code,
      city,
      country,
      address: composedAddress || null,
      phone: empty(data.phone),
      email: empty(data.email),
      website: empty(data.website),
      logo_url: empty(data.logo_url),
    };

    const { error } = await supabaseAdmin.from("companies").update(update).eq("id", data.companyId);
    if (error) throw new Error(error.message);

    if (triedLegalChange) {
      await writeAuditLog({
        companyId: data.companyId, userId, entityType: "auth",
        action: "company.official_fields_update_denied",
        metadata: { reason: "company_verified", attempted_keys: legalFields },
        actor: "user",
      });
    }
    // Audit — categorize change
    const logoChanged = !prev || prev.logo_url !== update.logo_url;
    if (logoChanged) {
      await writeAuditLog({
        companyId: data.companyId, userId, entityType: "auth",
        action: "company.logo_updated",
        metadata: { has_logo: !!update.logo_url },
        actor: "user",
      });
    }
    if (!isVerified) {
      // Legal info is only mutable while not verified
      const legalChanged = !prev || legalFields.some((k) => (prev as any)[k] !== (update as any)[k]);
      if (legalChanged) {
        await writeAuditLog({
          companyId: data.companyId, userId, entityType: "auth",
          action: "company.legal_info_updated",
          metadata: { siren: update.siren, siret: update.siret, vat: update.vat_number, legal_form: update.legal_form },
          actor: "user",
        });
      }
    }
    await writeAuditLog({
      companyId: data.companyId, userId, entityType: "auth",
      action: "company.contact_updated",
      actor: "user",
    });

    return { ok: true, locked: isVerified };
  });

/* ---------------- Sync officielle depuis le registre SIRENE ---------------- */

const SyncSchema = z.object({
  companyId: z.string().uuid(),
  query: z.string().trim().min(9).max(20),
});

export const syncCompanyFromSiren = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => SyncSchema.parse(i))
  .handler(async ({ data, context }) => {
    const userId = context.userId;

    const { data: m } = await supabaseAdmin
      .from("company_members")
      .select("role,status")
      .eq("company_id", data.companyId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (!m || !isAdminRole(m.role)) {
      throw new Error("Seuls les administrateurs peuvent synchroniser l'entreprise.");
    }

    const cleaned = data.query.replace(/\s+/g, "");
    if (!/^\d{9}$|^\d{14}$/.test(cleaned)) {
      throw new Error("Numéro invalide (SIREN 9 chiffres ou SIRET 14 chiffres).");
    }
    const siren = cleaned.length === 14 ? cleaned.slice(0, 9) : cleaned;

    // Si l'entreprise a déjà un SIRET/SIREN enregistré, on n'autorise QUE la
    // resynchronisation depuis ce même identifiant. Impossible de "changer
    // d'entreprise" en saisissant un autre SIRET.
    const { data: existing } = await supabaseAdmin
      .from("companies")
      .select("siret,siren")
      .eq("id", data.companyId)
      .maybeSingle();
    if (existing?.siret && cleaned.length === 14 && cleaned !== existing.siret) {
      await writeAuditLog({
        companyId: data.companyId, userId, entityType: "auth",
        action: "company.siret_change_attempt_blocked",
        metadata: { current_siret: existing.siret, attempted: cleaned },
        actor: "user",
      });
      throw new Error("Le SIRET enregistré ne peut pas être remplacé. Contactez le support pour un changement d'entreprise.");
    }
    if (existing?.siret && cleaned.length === 9 && existing.siret.slice(0, 9) !== cleaned) {
      throw new Error("Le SIREN ne correspond pas à l'entreprise enregistrée.");
    }
    if (!existing?.siret && existing?.siren && existing.siren !== siren) {
      throw new Error("Le SIREN ne correspond pas à l'entreprise enregistrée.");
    }

    const url = `https://recherche-entreprises.api.gouv.fr/search?q=${siren}&page=1&per_page=1`;

    const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "PVIA/1.0 (+https://pvia.fr)" } });
    if (!res.ok) throw new Error("Service de recherche officiel indisponible.");
    const payload: any = await res.json();
    const result = payload?.results?.[0];
    if (!result) throw new Error("Aucune entreprise officielle trouvée pour ce numéro.");

    const siege = result.siege ?? {};
    let siret: string | null = siege.siret ?? null;
    let addr = siege;
    if (cleaned.length === 14) {
      siret = cleaned;
      const match = (result.matching_etablissements ?? []).find((e: any) => e.siret === cleaned);
      if (match) addr = match;
    }

    const officialName = result.nom_complet || result.nom_raison_sociale || "";
    if (!officialName) throw new Error("Réponse officielle incomplète.");

    const { data: prev } = await supabaseAdmin
      .from("companies")
      .select("address_line2,country,phone,email,website,logo_url")
      .eq("id", data.companyId)
      .maybeSingle();

    const address_line1 = addr?.adresse || null;
    const postal_code = addr?.code_postal || null;
    const city = addr?.libelle_commune || null;
    const country = prev?.country ?? "FR";
    const composedAddress = [address_line1, prev?.address_line2, [postal_code, city].filter(Boolean).join(" ").trim() || null, country]
      .filter(Boolean).join(", ");

    const { error } = await supabaseAdmin.from("companies").update({
      name: officialName,
      legal_form: result.nature_juridique || null,
      siren: result.siren ?? siren,
      siret,
      address_line1,
      postal_code,
      city,
      address: composedAddress || null,
      company_verified: true,
      company_verified_at: new Date().toISOString(),
      company_verification_source: "siret_sync",
    }).eq("id", data.companyId);
    if (error) throw new Error(error.message);

    await writeAuditLog({
      companyId: data.companyId, userId, entityType: "auth",
      action: "company.synced_from_siren",
      metadata: { siren: result.siren ?? siren, siret },
      actor: "user",
    });
    await writeAuditLog({
      companyId: data.companyId, userId, entityType: "auth",
      action: "company.verified",
      metadata: { source: "siret_sync" },
      actor: "user",
    });

    return {
      ok: true,
      name: officialName,
      siren: result.siren ?? siren,
      siret,
      legal_form: result.nature_juridique || null,
      address_line1,
      postal_code,
      city,
    };
  });

