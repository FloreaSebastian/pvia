/**
 * PV numbering settings server functions.
 * Manages `company_settings.pv_number_*` columns.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAuditLog } from "./audit.server";

const NumberingSchema = z.object({
  companyId: z.string().uuid(),
  pv_number_prefix: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/, "Préfixe invalide (lettres, chiffres, - ou _)"),
  pv_number_include_year: z.boolean(),
  pv_number_next: z.number().int().min(1).max(9_999_999),
  pv_number_digits: z.number().int().min(1).max(8),
  pv_number_separator: z.string().min(0).max(3),
});

async function requireAdmin(companyId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from("company_members")
    .select("role,status")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (!data || (data.role !== "owner" && data.role !== "admin")) {
    throw new Error("Réservé aux administrateurs.");
  }
}

export const getPvNumberingSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: m } = await supabaseAdmin
      .from("company_members")
      .select("id")
      .eq("company_id", data.companyId)
      .eq("user_id", context.userId)
      .eq("status", "active")
      .maybeSingle();
    if (!m) throw new Error("Accès refusé.");

    const { data: row } = await supabaseAdmin
      .from("company_settings")
      .select("pv_number_prefix,pv_number_include_year,pv_number_next,pv_number_digits,pv_number_separator")
      .eq("company_id", data.companyId)
      .maybeSingle();

    return {
      pv_number_prefix: (row as any)?.pv_number_prefix ?? "PV",
      pv_number_include_year: (row as any)?.pv_number_include_year ?? true,
      pv_number_next: (row as any)?.pv_number_next ?? 1,
      pv_number_digits: (row as any)?.pv_number_digits ?? 5,
      pv_number_separator: (row as any)?.pv_number_separator ?? "-",
    };
  });

export const savePvNumberingSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => NumberingSchema.parse(i))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    await requireAdmin(data.companyId, userId);

    const update: Record<string, unknown> = {
      company_id: data.companyId,
      pv_number_prefix: data.pv_number_prefix,
      pv_number_include_year: data.pv_number_include_year,
      pv_number_next: data.pv_number_next,
      pv_number_digits: data.pv_number_digits,
      pv_number_separator: data.pv_number_separator,
      updated_by: userId,
    };

    const { error } = await supabaseAdmin
      .from("company_settings")
      .upsert(update as any, { onConflict: "company_id" });
    if (error) throw new Error(error.message);

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "settings",
      action: "settings.saved",
      metadata: { section: "pv_numbering", ...update },
      actor: "user",
    });

    return { ok: true };
  });
