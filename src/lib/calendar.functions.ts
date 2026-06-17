import { createServerFn } from "@tanstack/react-start";
import { ADMIN_ROLES, OWNER_ROLES, SIGN_ROLES, isAdminRole, isManageRole } from "@/lib/roles";
import { z } from "zod";
import crypto from "node:crypto";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAdmin(companyId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from("company_members")
    .select("role").eq("company_id", companyId).eq("user_id", userId)
    .eq("status", "active").maybeSingle();
  const role = data?.role as string | undefined;
  if (!isAdminRole(role)) throw new Error("Accès refusé.");
}
async function assertMember(companyId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from("company_members").select("id").eq("company_id", companyId)
    .eq("user_id", userId).eq("status", "active").maybeSingle();
  if (!data) throw new Error("Accès refusé.");
}

const CompanySchema = z.object({ companyId: z.string().uuid() });

export const listCalendarTokens = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => CompanySchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(data.companyId, context.userId);

    const { data: rows } = await supabaseAdmin
      .from("integration_calendar_tokens")
      .select("id,name,scope,token,revoked_at,last_accessed_at,created_at")
      .eq("company_id", data.companyId)
      .order("created_at", { ascending: false });
    const base = process.env.PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
    return {
      tokens: (rows ?? []).map((r) => ({
        ...r,
        url: `${base}/api/public/calendar/${r.token}.ics`,
      })),
    };
  });

export const createCalendarToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      companyId: z.string().uuid(),
      name: z.string().trim().min(1).max(80).default("Flux calendrier"),
      scope: z.enum(["all", "signed_only", "field_visits"]).default("all"),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(data.companyId, context.userId);
    const token = "cal_" + crypto.randomBytes(20).toString("base64url");
    const { data: row, error } = await supabaseAdmin
      .from("integration_calendar_tokens")
      .insert({
        company_id: data.companyId,
        created_by: context.userId,
        name: data.name,
        scope: data.scope,
        token,
      })
      .select("id,name,scope,token,created_at").single();
    if (error) throw new Error(error.message);
    const base = process.env.PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
    return { token: row, url: `${base}/api/public/calendar/${row.token}.ics` };
  });

export const revokeCalendarToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(data.companyId, context.userId);
    const { error } = await supabaseAdmin
      .from("integration_calendar_tokens").delete()
      .eq("id", data.id).eq("company_id", data.companyId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
