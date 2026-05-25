import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type CompanyBranding = {
  id: string;
  name: string;
  legal_form: string | null;
  siren: string | null;
  siret: string | null;
  vat_number: string | null;
  address: string | null;
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  logo_url: string | null;
};

/**
 * Central helper returning all branding/legal info for a company.
 * Used by PDF generation, transactional emails, client portal header,
 * audit exports, etc. — single source of truth.
 */
export async function getCompanyBranding(companyId: string): Promise<CompanyBranding | null> {
  const { data, error } = await supabaseAdmin
    .from("companies")
    .select(
      "id,name,legal_form,siren,siret,vat_number,address,address_line1,address_line2,postal_code,city,country,email,phone,website,logo_url",
    )
    .eq("id", companyId)
    .maybeSingle();
  if (error || !data) return null;
  return data as CompanyBranding;
}

/** Returns the fully-formatted postal address (multi-line). */
export function formatBrandingAddress(b: Pick<CompanyBranding, "address" | "address_line1" | "address_line2" | "postal_code" | "city" | "country">): string {
  if (b.address_line1) {
    return [b.address_line1, b.address_line2, `${b.postal_code ?? ""} ${b.city ?? ""}`.trim(), b.country]
      .filter(Boolean)
      .join("\n");
  }
  return b.address ?? "";
}
