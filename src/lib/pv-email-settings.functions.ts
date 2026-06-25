import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isAdminRole } from "@/lib/roles";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAuditLog } from "./audit.server";

const CompanyIdSchema = z.object({ companyId: z.string().uuid() });

async function requireMember(companyId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from("company_members")
    .select("id,role")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (!data) throw new Error("Accès refusé.");
  return data;
}

export const getPvEmailSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => CompanyIdSchema.parse(i))
  .handler(async ({ data, context }) => {
    await requireMember(data.companyId, context.userId);
    const { data: row } = await supabaseAdmin
      .from("company_settings")
      .select("pv_email_recipients,pv_email_cc,send_signed_pv_to_company,company_signed_email")
      .eq("company_id", data.companyId)
      .maybeSingle();
    return {
      pv_email_recipients: ((row as any)?.pv_email_recipients ?? []) as string[],
      pv_email_cc: ((row as any)?.pv_email_cc ?? []) as string[],
      send_signed_pv_to_company: (row as any)?.send_signed_pv_to_company !== false,
      company_signed_email: ((row as any)?.company_signed_email ?? null) as string | null,
    };
  });

const emailListSchema = z
  .array(z.string().trim().toLowerCase().email().max(255))
  .max(10);

const UpdateSchema = z.object({
  companyId: z.string().uuid(),
  pv_email_recipients: emailListSchema.optional(),
  pv_email_cc: emailListSchema.optional(),
  send_signed_pv_to_company: z.boolean().optional(),
  company_signed_email: z.string().trim().toLowerCase().email().max(255).nullable().optional(),
});

export const updatePvEmailSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => UpdateSchema.parse(i))
  .handler(async ({ data, context }) => {
    const member = await requireMember(data.companyId, context.userId);
    const patch: Record<string, unknown> = {};
    if (data.pv_email_recipients !== undefined) patch.pv_email_recipients = data.pv_email_recipients;
    if (data.pv_email_cc !== undefined) patch.pv_email_cc = data.pv_email_cc;
    if (data.send_signed_pv_to_company !== undefined) patch.send_signed_pv_to_company = data.send_signed_pv_to_company;
    if (data.company_signed_email !== undefined) patch.company_signed_email = data.company_signed_email;

    // upsert based on existing row
    const { data: existing } = await supabaseAdmin
      .from("company_settings")
      .select("id,pv_email_recipients,pv_email_cc,send_signed_pv_to_company,company_signed_email")
      .eq("company_id", data.companyId)
      .maybeSingle();

    const oldValues = existing
      ? {
          pv_email_recipients: (existing as any).pv_email_recipients ?? [],
          pv_email_cc: (existing as any).pv_email_cc ?? [],
          send_signed_pv_to_company: (existing as any).send_signed_pv_to_company !== false,
          company_signed_email: (existing as any).company_signed_email ?? null,
        }
      : null;

    if (existing) {
      const { error } = await supabaseAdmin
        .from("company_settings")
        .update(patch as never)
        .eq("company_id", data.companyId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("company_settings")
        .insert({ company_id: data.companyId, ...patch } as never);
      if (error) throw new Error(error.message);
    }

    await writeAuditLog({
      companyId: data.companyId,
      userId: context.userId,
      entityType: "company_settings",
      entityId: data.companyId,
      action: "pv_email_settings.updated",
      oldValues,
      newValues: patch as Record<string, unknown>,
      metadata: { role: (member as any).role ?? null, fields: Object.keys(patch) },
      actor: "user",
    });

    return { ok: true };
  });
