import { createServerFn } from "@tanstack/react-start";
import { ADMIN_ROLES, OWNER_ROLES, SIGN_ROLES, isAdminRole, isManageRole } from "@/lib/roles";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAuditLog } from "./audit.server";

/* -------------------------- Onboarding status -------------------------- */

export type OnboardingStatus = {
  profileComplete: boolean;
  companyComplete: boolean;
  needsCompanyStep: boolean; // false if user is invited member of an already-complete company
  activeCompanyId: string | null;
  companyName: string | null;
  isAdmin: boolean;
};

export const getOnboardingStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OnboardingStatus> => {
    const userId = context.userId;

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("first_name,last_name,phone,job_title,onboarding_completed_at")
      .eq("id", userId)
      .maybeSingle();

    const profileComplete = !!(
      profile?.onboarding_completed_at &&
      profile?.first_name &&
      profile?.last_name &&
      profile?.phone &&
      profile?.job_title
    );

    // Find an active membership (prefer owner/admin)
    const { data: memberships } = await supabaseAdmin
      .from("company_members")
      .select("company_id,role")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: true });

    const primary =
      memberships?.find((m) => isAdminRole(m.role)) ?? memberships?.[0] ?? null;
    const activeCompanyId = primary?.company_id ?? null;
    const isAdmin = isAdminRole(primary?.role);

    let companyComplete = false;
    let companyName: string | null = null;
    if (activeCompanyId) {
      const { data: company } = await supabaseAdmin
        .from("companies")
        .select("name,siret,siren,address_line1,postal_code,city,onboarding_completed_at")
        .eq("id", activeCompanyId)
        .maybeSingle();
      companyName = company?.name ?? null;
      companyComplete = !!(
        company?.onboarding_completed_at &&
        company?.name &&
        (company?.siret || company?.siren) &&
        company?.address_line1 &&
        company?.postal_code &&
        company?.city
      );
    }

    // A non-admin member of a company already onboarded only needs profile
    const needsCompanyStep = isAdmin || !companyComplete;

    return { profileComplete, companyComplete, needsCompanyStep, activeCompanyId, companyName, isAdmin };
  });

/* -------------------------- Complete profile -------------------------- */

const ProfileSchema = z.object({
  first_name: z.string().trim().min(1).max(80),
  last_name: z.string().trim().min(1).max(80),
  phone: z.string().trim().min(6).max(30),
  job_title: z.string().trim().min(1).max(120),
  avatar_url: z.string().url().max(2000).optional().nullable(),
});

export const completeProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ProfileSchema.parse(i))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const full_name = `${data.first_name} ${data.last_name}`.trim();

    const { error } = await supabaseAdmin
      .from("profiles")
      .upsert(
        {
          id: userId,
          first_name: data.first_name,
          last_name: data.last_name,
          full_name,
          phone: data.phone,
          job_title: data.job_title,
          avatar_url: data.avatar_url ?? null,
          onboarding_completed_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );
    if (error) throw new Error(error.message);

    await writeAuditLog({
      companyId: null,
      userId,
      entityType: "auth",
      action: "onboarding.profile_completed",
      actor: "user",
    });

    return { ok: true };
  });

/* -------------------------- Complete company -------------------------- */

const CompanySchema = z
  .object({
    companyId: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
    legal_form: z.string().trim().max(120).optional().nullable(),
    siren: z
      .string()
      .trim()
      .regex(/^\d{9}$/, "SIREN: 9 chiffres")
      .optional()
      .nullable(),
    siret: z
      .string()
      .trim()
      .regex(/^\d{14}$/, "SIRET: 14 chiffres")
      .optional()
      .nullable(),
    vat_number: z.string().trim().max(20).optional().nullable(),
    address_line1: z.string().trim().min(1).max(200),
    address_line2: z.string().trim().max(200).optional().nullable(),
    postal_code: z.string().trim().min(2).max(10),
    city: z.string().trim().min(1).max(120),
    country: z.string().trim().min(2).max(60).default("FR"),
    phone: z.string().trim().max(30).optional().nullable(),
    email: z.string().trim().email().max(200).optional().nullable(),
    website: z.string().trim().url().max(300).optional().nullable(),
    logo_url: z.string().trim().url().max(2000).optional().nullable(),
    sourced_from_siren: z.boolean().optional(),
  })
  .refine((d) => d.siret || d.siren, { message: "SIRET ou SIREN requis" });

export const completeCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => CompanySchema.parse(i))
  .handler(async ({ data, context }) => {
    const userId = context.userId;

    // Verify the caller is admin/owner of that company
    const { data: m } = await supabaseAdmin
      .from("company_members")
      .select("role,status")
      .eq("company_id", data.companyId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (!m || (!isAdminRole(m.role))) {
      throw new Error("Seuls les administrateurs peuvent compléter l'entreprise.");
    }

    // Compose a legacy `address` field for back-compat with existing PDF/email code
    const composedAddress = [data.address_line1, data.address_line2, `${data.postal_code} ${data.city}`, data.country]
      .filter(Boolean)
      .join(", ");

    const { error } = await supabaseAdmin
      .from("companies")
      .update({
        name: data.name,
        legal_form: data.legal_form ?? null,
        siren: data.siren ?? null,
        siret: data.siret ?? null,
        vat_number: data.vat_number ?? null,
        address_line1: data.address_line1,
        address_line2: data.address_line2 ?? null,
        postal_code: data.postal_code,
        city: data.city,
        country: data.country,
        address: composedAddress,
        phone: data.phone ?? null,
        email: data.email ?? null,
        website: data.website ?? null,
        logo_url: data.logo_url ?? null,
        onboarding_completed_at: new Date().toISOString(),
      })
      .eq("id", data.companyId);
    if (error) throw new Error(error.message);

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "auth",
      action: data.sourced_from_siren ? "company.updated_from_siren" : "onboarding.company_completed",
      metadata: { siren: data.siren, siret: data.siret },
      actor: "user",
    });
    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "auth",
      action: "onboarding.completed",
      actor: "user",
    });

    return { ok: true };
  });
