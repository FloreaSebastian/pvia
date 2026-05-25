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

/* ============================================================
 * Branding settings (visual + email + PDF)
 * Loaded from company_settings, used by PDF + email + UI.
 * ============================================================ */

export type CompanyBrandingSettings = {
  brand_color: string;
  pdf_brand_color: string;
  email_brand_color: string;
  pdf_footer: string;
  pdf_watermark: string;
  email_footer: string;       // legacy: short footer line
  email_signature: string;    // new: full signature block
};

export const DEFAULT_BRANDING_SETTINGS: CompanyBrandingSettings = {
  brand_color: "#3B82F6",
  pdf_brand_color: "#1E3A8A",
  email_brand_color: "#1E40AF",
  pdf_footer: "Document généré par PVIA.",
  pdf_watermark: "",
  email_footer: "Cet email a été envoyé par PVIA.",
  email_signature: "",
};

/** Validate + normalize a hex color (#RGB or #RRGGBB). Returns fallback if invalid. */
export function normalizeHex(input: string | null | undefined, fallback: string): string {
  if (!input) return fallback;
  const s = input.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return s;
  return fallback;
}

/** Convert "#RRGGBB" to [r,g,b] in 0..1 for pdf-lib `rgb()`. */
export function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0.12, 0.23, 0.54];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export async function getCompanyBrandingSettings(companyId: string): Promise<CompanyBrandingSettings> {
  const { data } = await supabaseAdmin
    .from("company_settings")
    .select("brand_color,pdf_brand_color,email_brand_color,pdf_footer,pdf_watermark,email_footer,email_signature")
    .eq("company_id", companyId)
    .maybeSingle();
  const d = DEFAULT_BRANDING_SETTINGS;
  const brand = normalizeHex(data?.brand_color, d.brand_color);
  return {
    brand_color: brand,
    pdf_brand_color: normalizeHex(data?.pdf_brand_color, brand),
    email_brand_color: normalizeHex(data?.email_brand_color, brand),
    pdf_footer: data?.pdf_footer || d.pdf_footer,
    pdf_watermark: data?.pdf_watermark ?? "",
    email_footer: data?.email_footer || d.email_footer,
    email_signature: data?.email_signature ?? "",
  };
}

