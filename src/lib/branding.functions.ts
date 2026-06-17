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
  logo_url: z.string().trim().max(2000).optional().nullable().or(z.literal("")),
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
    if (!m || (m.role !== "owner" && m.role !== "admin")) {
      throw new Error("Seuls les administrateurs peuvent modifier l'entreprise.");
    }

    // Load previous to detect what changed (for audit categorization + legacy address)
    const { data: prev } = await supabaseAdmin
      .from("companies")
      .select("name,legal_form,siren,siret,vat_number,address_line1,address_line2,postal_code,city,country,phone,email,website,logo_url")
      .eq("id", data.companyId)
      .maybeSingle();

    const address_line1 = empty(data.address_line1);
    const address_line2 = empty(data.address_line2);
    const postal_code = empty(data.postal_code);
    const city = empty(data.city);
    const country = empty(data.country) ?? "FR";

    // Keep legacy `address` in sync from structured fields (back-compat)
    const composedAddress = [
      address_line1,
      address_line2,
      [postal_code, city].filter(Boolean).join(" ").trim() || null,
      country,
    ].filter(Boolean).join(", ");

    const update = {
      name: data.name,
      legal_form: empty(data.legal_form),
      siren: empty(data.siren),
      siret: empty(data.siret),
      vat_number: empty(data.vat_number),
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

    // Audit — categorize change
    const legalFields = ["name", "legal_form", "siren", "siret", "vat_number"] as const;
    const legalChanged = !prev || legalFields.some((k) => (prev as any)[k] !== (update as any)[k]);
    const logoChanged = !prev || prev.logo_url !== update.logo_url;

    if (logoChanged) {
      await writeAuditLog({
        companyId: data.companyId, userId, entityType: "auth",
        action: "company.logo_updated",
        metadata: { has_logo: !!update.logo_url },
        actor: "user",
      });
    }
    if (legalChanged) {
      await writeAuditLog({
        companyId: data.companyId, userId, entityType: "auth",
        action: "company.legal_info_updated",
        metadata: { siren: update.siren, siret: update.siret, vat: update.vat_number, legal_form: update.legal_form },
        actor: "user",
      });
    }
    await writeAuditLog({
      companyId: data.companyId, userId, entityType: "auth",
      action: "company.branding_updated",
      actor: "user",
    });

    return { ok: true };
  });
