import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAuditLog } from "./audit.server";
import {
  deliverOne,
  drainPending,
  generateApiKey,
  generateSecret,
  hashApiKey,
} from "./webhooks.server";

const EVENTS = [
  "pv.created",
  "pv.signed",
  "pv.sent_to_client",
  "pv.all_reserves_lifted",
  "reserve.created",
  "reserve.lifted",
  "reserve_lift.created",
  "reserve_lift.signed",
  "reserve_lift.client_validated",
  "member.invited",
  "member.joined",
  "subscription.updated",
] as const;

async function assertAdmin(companyId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from("company_members")
    .select("role")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  const role = data?.role as string | undefined;
  if (role !== "owner" && role !== "admin") throw new Error("Accès refusé.");
  const { assertSubscriptionUsable } = await import("./plan-guard.server");
  await assertSubscriptionUsable(companyId, userId);
}
async function assertMember(companyId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from("company_members")
    .select("id")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (!data) throw new Error("Accès refusé.");
}

/* ----------------------------- API KEYS ----------------------------- */

const CompanySchema = z.object({ companyId: z.string().uuid() });

export const listApiKeys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => CompanySchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertMember(data.companyId, context.userId);
    const { data: rows } = await supabaseAdmin
      .from("api_keys")
      .select("id,name,prefix,scopes,last_used_at,revoked_at,created_at")
      .eq("company_id", data.companyId)
      .order("created_at", { ascending: false });
    return { keys: rows ?? [] };
  });

export const createApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      companyId: z.string().uuid(),
      name: z.string().trim().min(1).max(80),
      scopes: z.array(z.enum(["read", "write"])).min(1).default(["read"]),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(data.companyId, context.userId);
    const { full, prefix, hash } = generateApiKey();
    const { data: row, error } = await supabaseAdmin
      .from("api_keys")
      .insert({
        company_id: data.companyId,
        created_by: context.userId,
        name: data.name,
        prefix,
        key_hash: hash,
        scopes: data.scopes,
      })
      .select("id,name,prefix,scopes,created_at")
      .single();
    if (error) throw new Error(error.message);
    await writeAuditLog({
      action: "company.api_key_created" as never,
      entityType: "api_key",
      entityId: row.id,
      companyId: data.companyId,
      userId: context.userId,
      metadata: { name: data.name, prefix },
    }).catch(() => null);
    return { key: row, secret: full };
  });

export const revokeApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(data.companyId, context.userId);
    const { error } = await supabaseAdmin
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("company_id", data.companyId);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      action: "company.api_key_revoked" as never,
      entityType: "api_key",
      entityId: data.id,
      companyId: data.companyId,
      userId: context.userId,
    }).catch(() => null);
    return { ok: true };
  });

/* ----------------------------- WEBHOOKS ----------------------------- */

export const listWebhooks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => CompanySchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertMember(data.companyId, context.userId);
    const { data: rows } = await supabaseAdmin
      .from("webhooks")
      .select("id,url,events,enabled,description,delivery_format,last_delivery_at,last_status,failure_count,created_at")
      .eq("company_id", data.companyId)
      .order("created_at", { ascending: false });
    return { webhooks: rows ?? [], availableEvents: EVENTS as readonly string[] };
  });

export const createWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      companyId: z.string().uuid(),
      url: z.string().url().startsWith("https://", { message: "HTTPS requis" }).max(500),
      events: z.array(z.enum(EVENTS)).min(1),
      description: z.string().trim().max(200).optional(),
      delivery_format: z.enum(["raw", "slack", "discord"]).default("raw"),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(data.companyId, context.userId);
    const secret = generateSecret();
    const { data: row, error } = await supabaseAdmin
      .from("webhooks")
      .insert({
        company_id: data.companyId,
        created_by: context.userId,
        url: data.url,
        secret,
        events: data.events,
        description: data.description ?? null,
        delivery_format: data.delivery_format,
      })
      .select("id,url,events,enabled,description,delivery_format,created_at")
      .single();

    if (error) throw new Error(error.message);
    await writeAuditLog({
      action: "company.webhook_created" as never,
      entityType: "webhook",
      entityId: row.id,
      companyId: data.companyId,
      userId: context.userId,
      metadata: { url: data.url, events: data.events },
    }).catch(() => null);
    return { webhook: row, secret };
  });

export const updateWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      companyId: z.string().uuid(),
      id: z.string().uuid(),
      url: z.string().url().startsWith("https://").max(500).optional(),
      events: z.array(z.enum(EVENTS)).min(1).optional(),
      enabled: z.boolean().optional(),
      description: z.string().trim().max(200).nullable().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(data.companyId, context.userId);
    const patch: {
      url?: string; events?: string[]; enabled?: boolean; description?: string | null;
    } = {};
    if (data.url !== undefined) patch.url = data.url;
    if (data.events !== undefined) patch.events = data.events as string[];
    if (data.enabled !== undefined) patch.enabled = data.enabled;
    if (data.description !== undefined) patch.description = data.description;
    const { error } = await supabaseAdmin
      .from("webhooks").update(patch)
      .eq("id", data.id).eq("company_id", data.companyId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const rotateWebhookSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(data.companyId, context.userId);
    const secret = generateSecret();
    const { error } = await supabaseAdmin
      .from("webhooks").update({ secret })
      .eq("id", data.id).eq("company_id", data.companyId);
    if (error) throw new Error(error.message);
    return { secret };
  });

export const deleteWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(data.companyId, context.userId);
    const { error } = await supabaseAdmin
      .from("webhooks").delete()
      .eq("id", data.id).eq("company_id", data.companyId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const sendTestWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(data.companyId, context.userId);
    const { data: hook } = await supabaseAdmin
      .from("webhooks").select("id,company_id")
      .eq("id", data.id).eq("company_id", data.companyId).maybeSingle();
    if (!hook) throw new Error("Webhook introuvable.");
    const { data: del, error } = await supabaseAdmin
      .from("webhook_deliveries")
      .insert({
        webhook_id: hook.id,
        company_id: hook.company_id,
        event: "webhook.test",
        payload: {
          event: "webhook.test",
          occurred_at: new Date().toISOString(),
          message: "Test depuis PVIA",
        },
      })
      .select("id").single();
    if (error) throw new Error(error.message);
    const res = await deliverOne(del.id);
    return res;
  });

export const listDeliveries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      companyId: z.string().uuid(),
      webhookId: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(100).default(25),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertMember(data.companyId, context.userId);
    let q = supabaseAdmin
      .from("webhook_deliveries")
      .select("id,webhook_id,event,status,attempts,response_code,error,delivered_at,created_at,next_attempt_at")
      .eq("company_id", data.companyId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.webhookId) q = q.eq("webhook_id", data.webhookId);
    const { data: rows } = await q;
    return { deliveries: rows ?? [] };
  });

export const retryDelivery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(data.companyId, context.userId);
    const { error } = await supabaseAdmin
      .from("webhook_deliveries")
      .update({ status: "pending", next_attempt_at: new Date().toISOString(), error: null })
      .eq("id", data.id).eq("company_id", data.companyId);
    if (error) throw new Error(error.message);
    const res = await deliverOne(data.id);
    return res;
  });

export const drainCompanyWebhooks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => CompanySchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertMember(data.companyId, context.userId);
    const processed = await drainPending(data.companyId, 25);
    return { processed };
  });

/* ---------------- API key validation (server-only helper) ---------------- */

export async function validateApiKeyHeader(authHeader: string | null): Promise<{
  companyId: string; keyId: string; scopes: string[];
} | null> {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(pvia_[A-Za-z0-9_-]+)$/);
  if (!m) return null;
  const hash = hashApiKey(m[1]);
  const { data } = await supabaseAdmin
    .from("api_keys")
    .select("id,company_id,scopes,revoked_at")
    .eq("key_hash", hash)
    .maybeSingle();
  if (!data || data.revoked_at) return null;
  await supabaseAdmin.from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);
  return { companyId: data.company_id as string, keyId: data.id as string, scopes: (data.scopes as string[]) ?? [] };
}
