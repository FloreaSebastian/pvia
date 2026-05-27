import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * SSRF guard. Block requests targeting internal/loopback/link-local/cloud
 * metadata ranges, regardless of how DNS resolves the hostname.
 */
function isBlockedIp(ip: string): boolean {
  if (!ip) return true;
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local + AWS/GCP metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80:")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
    if (lower.startsWith("ff")) return true; // multicast
    // IPv4-mapped IPv6 ::ffff:a.b.c.d
    const m = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isBlockedIp(m[1]);
    return false;
  }
  return true;
}

async function assertSafeWebhookUrl(rawUrl: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error("URL invalide");
  }
  if (u.protocol !== "https:") throw new Error("HTTPS requis");
  const host = u.hostname.toLowerCase();
  if (!host) throw new Error("Hôte invalide");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new Error("Hôte interne refusé");
  }
  // If literal IP, check directly; else resolve all A/AAAA and reject any private.
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new Error("Adresse IP interne refusée");
    return;
  }
  let addrs: { address: string; family: number }[] = [];
  try {
    addrs = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("Résolution DNS impossible");
  }
  if (!addrs.length) throw new Error("Résolution DNS impossible");
  for (const a of addrs) {
    if (isBlockedIp(a.address)) throw new Error("Cible réseau interne refusée");
  }
}


const MAX_ATTEMPTS = 5;
const TIMEOUT_MS = 8000;

export function generateSecret(prefix = "whsec_"): string {
  return prefix + crypto.randomBytes(24).toString("base64url");
}

export function generateApiKey(): { full: string; prefix: string; hash: string } {
  const raw = crypto.randomBytes(28).toString("base64url");
  const full = `pvia_${raw}`;
  return {
    full,
    prefix: full.slice(0, 10),
    hash: crypto.createHash("sha256").update(full).digest("hex"),
  };
}

export function hashApiKey(full: string): string {
  return crypto.createHash("sha256").update(full).digest("hex");
}

/**
 * Enqueue a webhook delivery for every enabled webhook in `companyId`
 * subscribed to `event`. Never throws — webhook dispatch must not break
 * business logic.
 */
export async function dispatchWebhookEvent(
  companyId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const { data: hooks } = await supabaseAdmin
      .from("webhooks")
      .select("id")
      .eq("company_id", companyId)
      .eq("enabled", true)
      .contains("events", [event]);
    if (!hooks?.length) return;
    const body = {
      event,
      occurred_at: new Date().toISOString(),
      company_id: companyId,
      ...payload,
    };
    await supabaseAdmin.from("webhook_deliveries").insert(
      hooks.map((h: any) => ({
        webhook_id: h.id,
        company_id: companyId,
        event,
        payload: body,
      })),
    );
    // Best-effort drain (don't await)
    void drainPending(companyId, 10).catch(() => null);
  } catch (e) {
    console.error("dispatchWebhookEvent failed:", e);
  }
}

function signPayload(secret: string, ts: number, body: string): string {
  const mac = crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  return `t=${ts},v1=${mac}`;
}

function backoffSeconds(attempts: number): number {
  // 30s, 2min, 10min, 1h, 6h
  return [30, 120, 600, 3600, 21600][Math.min(attempts, 4)];
}

const EVENT_LABEL: Record<string, string> = {
  "pv.created": "Nouveau PV créé",
  "pv.signed": "PV signé",
  "pv.sent_to_client": "PV envoyé au client",
  "pv.all_reserves_lifted": "Toutes les réserves levées",
  "reserve.created": "Nouvelle réserve",
  "reserve.lifted": "Réserve levée",
  "reserve_lift.created": "Levée de réserves créée",
  "reserve_lift.signed": "Levée de réserves signée",
  "reserve_lift.client_validated": "Levée de réserves validée par le client",
  "webhook.test": "Test PVIA",
};

function formatForChat(format: string, event: string, payload: Record<string, unknown>): unknown {
  const title = EVENT_LABEL[event] ?? event;
  const pv = (payload?.pv ?? {}) as Record<string, unknown>;
  const reserve = (payload?.reserve ?? {}) as Record<string, unknown>;
  const numero = (pv.numero ?? "") as string;
  const status = (pv.status ?? "") as string;
  const desc = (reserve.description ?? "") as string;
  const lines = [
    `*${title}*`,
    numero ? `PV: \`${numero}\`${status ? ` — ${status}` : ""}` : null,
    desc ? `Réserve: ${desc.slice(0, 200)}` : null,
  ].filter(Boolean).join("\n");

  if (format === "discord") {
    return { content: lines };
  }
  // slack
  return { text: lines };
}


export async function deliverOne(deliveryId: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  const { data: d } = await supabaseAdmin
    .from("webhook_deliveries")
    .select("id,webhook_id,event,payload,attempts,status")
    .eq("id", deliveryId)
    .maybeSingle();
  if (!d || d.status !== "pending") return { ok: false, error: "not_pending" };

  const { data: hook } = await supabaseAdmin
    .from("webhooks")
    .select("id,url,secret,enabled,company_id,delivery_format")
    .eq("id", d.webhook_id)
    .maybeSingle();
  if (!hook || !hook.enabled) {
    await supabaseAdmin
      .from("webhook_deliveries")
      .update({ status: "failed", error: "webhook_disabled" })
      .eq("id", d.id);
    return { ok: false, error: "webhook_disabled" };
  }

  const format = (hook.delivery_format as string | null) ?? "raw";
  const body = format === "raw"
    ? JSON.stringify(d.payload)
    : JSON.stringify(formatForChat(format, d.event as string, d.payload as Record<string, unknown>));
  const ts = Math.floor(Date.now() / 1000);
  const sig = signPayload(hook.secret, ts, body);
  const attempts = (d.attempts ?? 0) + 1;

  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let status: number | undefined;
  let responseBody = "";
  let errorMsg: string | undefined;
  try {
    const res = await fetch(hook.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "PVIA-Webhooks/1.0",
        "x-pvia-event": d.event as string,
        "x-pvia-delivery": d.id as string,
        "x-pvia-signature": sig,
      },
      body,
      signal: ac.signal,
    });
    status = res.status;
    responseBody = (await res.text().catch(() => "")).slice(0, 2000);

  } catch (e) {
    errorMsg = e instanceof Error ? e.message : String(e);
  } finally {
    clearTimeout(to);
  }

  const ok = !!status && status >= 200 && status < 300;

  if (ok) {
    await supabaseAdmin.from("webhook_deliveries").update({
      status: "delivered",
      attempts,
      response_code: status,
      response_body: responseBody,
      delivered_at: new Date().toISOString(),
      error: null,
    }).eq("id", d.id);
    await supabaseAdmin.from("webhooks").update({
      last_delivery_at: new Date().toISOString(),
      last_status: status,
      failure_count: 0,
    }).eq("id", hook.id);
    return { ok: true, status };
  }

  const giveUp = attempts >= MAX_ATTEMPTS;
  const nextAt = giveUp ? null : new Date(Date.now() + backoffSeconds(attempts) * 1000).toISOString();
  await supabaseAdmin.from("webhook_deliveries").update({
    status: giveUp ? "failed" : "pending",
    attempts,
    response_code: status ?? null,
    response_body: responseBody,
    error: errorMsg ?? null,
    next_attempt_at: nextAt ?? new Date().toISOString(),
  }).eq("id", d.id);
  await supabaseAdmin.from("webhooks").update({
    last_delivery_at: new Date().toISOString(),
    last_status: status ?? null,
    failure_count: attempts,
  }).eq("id", hook.id);

  return { ok: false, status, error: errorMsg };
}

export async function drainPending(companyId: string, max = 20): Promise<number> {
  const { data: rows } = await supabaseAdmin
    .from("webhook_deliveries")
    .select("id")
    .eq("company_id", companyId)
    .eq("status", "pending")
    .lte("next_attempt_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(max);
  if (!rows?.length) return 0;
  let n = 0;
  for (const r of rows) {
    await deliverOne(r.id as string).catch(() => null);
    n++;
  }
  return n;
}
