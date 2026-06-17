import { createServerFn } from "@tanstack/react-start";
import { ADMIN_ROLES, OWNER_ROLES, SIGN_ROLES, isAdminRole, isManageRole } from "@/lib/roles";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAuditLog } from "./audit.server";
import { getCompanyBrandingSettings } from "./branding.server";

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

const SettingsSchema = z.object({
  companyId: z.string().uuid(),
  brand_color: z.string().regex(HEX),
  pdf_brand_color: z.string().regex(HEX).optional().nullable(),
  email_brand_color: z.string().regex(HEX).optional().nullable(),
  pdf_footer: z.string().max(500),
  pdf_watermark: z.string().max(40),
  email_footer: z.string().max(500),
  email_signature: z.string().max(2000).optional().nullable(),
  label: z.string().max(80).optional(),
});

async function requireAdmin(companyId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from("company_members")
    .select("role,status")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (!data || (!isAdminRole(data.role))) {
    throw new Error("Réservé aux administrateurs.");
  }
  const { assertSubscriptionUsable } = await import("./plan-guard.server");
  await assertSubscriptionUsable(companyId, userId);
}

export const publishBrandingSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => SettingsSchema.parse(i))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    await requireAdmin(data.companyId, userId);

    // Snapshot current state BEFORE update for rollback history.
    const prev = await getCompanyBrandingSettings(data.companyId);
    await supabaseAdmin.from("company_branding_versions").insert({
      company_id: data.companyId,
      settings_snapshot: prev,
      label: data.label ?? null,
      created_by: userId,
    });

    const update = {
      company_id: data.companyId,
      brand_color: data.brand_color,
      pdf_brand_color: data.pdf_brand_color || data.brand_color,
      email_brand_color: data.email_brand_color || data.brand_color,
      pdf_footer: data.pdf_footer,
      pdf_watermark: data.pdf_watermark,
      email_footer: data.email_footer,
      email_signature: data.email_signature || null,
      updated_by: userId,
    };
    const { error } = await supabaseAdmin
      .from("company_settings")
      .upsert(update, { onConflict: "company_id" });
    if (error) throw new Error(error.message);

    const changed = Object.keys(update).filter(
      (k) => k !== "company_id" && k !== "updated_by" && (prev as any)[k] !== (update as any)[k],
    );

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "settings",
      action: "branding.published",
      oldValues: prev as any,
      newValues: update as any,
      metadata: { changed_fields: changed, label: data.label ?? null },
      actor: "user",
    });
    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "settings",
      action: "settings.saved",
      metadata: { section: "branding", changed_fields: changed },
      actor: "user",
    });

    return { ok: true, changed };
  });

export const listBrandingVersions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), limit: z.number().min(1).max(50).default(20) }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: m } = await supabaseAdmin
      .from("company_members")
      .select("id")
      .eq("company_id", data.companyId)
      .eq("user_id", context.userId)
      .eq("status", "active")
      .maybeSingle();
    if (!m) throw new Error("Accès refusé.");
    const { data: rows } = await supabaseAdmin
      .from("company_branding_versions")
      .select("id,label,created_at,created_by,settings_snapshot")
      .eq("company_id", data.companyId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    return { versions: rows ?? [] };
  });

export const restoreBrandingVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), versionId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    await requireAdmin(data.companyId, userId);

    const { data: version } = await supabaseAdmin
      .from("company_branding_versions")
      .select("settings_snapshot")
      .eq("id", data.versionId)
      .eq("company_id", data.companyId)
      .maybeSingle();
    if (!version) throw new Error("Version introuvable.");
    const snap = version.settings_snapshot as any;

    // Snapshot current before overwriting
    const prev = await getCompanyBrandingSettings(data.companyId);
    await supabaseAdmin.from("company_branding_versions").insert({
      company_id: data.companyId,
      settings_snapshot: prev,
      label: "Avant restauration",
      created_by: userId,
    });

    const update = {
      company_id: data.companyId,
      brand_color: snap.brand_color,
      pdf_brand_color: snap.pdf_brand_color || snap.brand_color,
      email_brand_color: snap.email_brand_color || snap.brand_color,
      pdf_footer: snap.pdf_footer,
      pdf_watermark: snap.pdf_watermark ?? "",
      email_footer: snap.email_footer,
      email_signature: snap.email_signature || null,
      updated_by: userId,
    };
    const { error } = await supabaseAdmin
      .from("company_settings")
      .upsert(update, { onConflict: "company_id" });
    if (error) throw new Error(error.message);

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "settings",
      action: "branding.rollback",
      newValues: update as any,
      metadata: { version_id: data.versionId },
      actor: "user",
    });

    return { ok: true };
  });
