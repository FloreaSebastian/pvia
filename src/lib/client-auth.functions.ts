/**
 * Passwordless client-area auth (magic 6-digit code by email) + scoped data access.
 *
 * Security model:
 *  - Codes & session tokens stored hashed (SHA-256 + id as salt for codes).
 *  - Cookie HttpOnly + Secure + SameSite=Lax (no JS access).
 *  - Rate-limited at multiple buckets (per email, per IP).
 *  - Audit logged: client.login_code_sent | client.login_success
 *    | client.login_failed | client.logout.
 *  - All reads scoped strictly by clientId / email — never trust client input.
 *  - Uses supabaseAdmin: client tables have RLS deny-all by design.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAuditLog } from "@/lib/audit.server";
import { enforceRateLimit } from "@/lib/rate-limit.server";
import { decodeAndValidateImage } from "@/lib/image-validate.server";
import { buildAndStorePvPdf } from "@/lib/pdf.server";
import { deliverSignedPv } from "@/lib/email.server";
import { firePushToCompany } from "@/lib/push.server";
import {
  CLIENT_CODE_MAX_ATTEMPTS,
  CLIENT_CODE_TTL_SEC,
  CLIENT_SESSION_TTL_SEC,
  clearClientCookie,
  describeUA,
  generateNumericCode,
  generateSessionToken,
  getClientIp,
  getClientUA,
  normalizeEmail,
  readClientCookieToken,
  setClientCookie,
  sha256Hex,
  timingSafeEqual,
} from "@/lib/client-auth.server";
import { sendClientLoginCodeEmail } from "@/lib/email.server";

// ─── send code ────────────────────────────────────────────────────────────────
export const sendClientLoginCode = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ email: z.string().email().max(255) }).parse(d))
  .handler(async ({ data }) => {
    const email = normalizeEmail(data.email);
    const ip = getClientIp() ?? "unknown";
    const ua = getClientUA();

    // Rate limit (anti-abus). On accepte ce coût même si email inconnu, pour ne pas
    // donner d'info à l'attaquant.
    await enforceRateLimit({ bucket: "client_login_send_email", key: email, limit: 3, windowSec: 900 });
    await enforceRateLimit({ bucket: "client_login_send_ip", key: ip, limit: 10, windowSec: 3600 });

    // Cherche un client matchant (par email). Optionnel : si pas trouvé, on envoie
    // quand même un code (l'utilisateur verra un dashboard vide).
    const { data: clientRow } = await supabaseAdmin
      .from("clients")
      .select("id,email,company_id,name")
      .ilike("email", email)
      .maybeSingle();

    // Invalide les codes précédents non utilisés
    await supabaseAdmin
      .from("client_auth_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("email", email)
      .is("used_at", null);

    // Insert + hash
    const code = generateNumericCode();
    const expiresAt = new Date(Date.now() + CLIENT_CODE_TTL_SEC * 1000).toISOString();
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("client_auth_codes")
      .insert({
        client_id: clientRow?.id ?? null,
        email,
        code_hash: "pending",
        expires_at: expiresAt,
        attempts: 0,
        ip_address: ip,
        user_agent: ua,
      })
      .select("id")
      .single();
    if (insErr || !inserted) throw new Error("Impossible de générer un code pour le moment.");

    const hash = await sha256Hex(code + ":" + inserted.id);
    await supabaseAdmin.from("client_auth_codes").update({ code_hash: hash }).eq("id", inserted.id);

    // Envoi email — best-effort; on log mais on ne révèle pas l'échec.
    try {
      await sendClientLoginCodeEmail({
        to: email,
        code,
        ip,
        device: describeUA(ua),
      });
    } catch (e) {
      console.error("sendClientLoginCodeEmail failed:", e);
    }

    await writeAuditLog({
      companyId: clientRow?.company_id ?? null,
      entityType: "client_auth",
      action: "client.login_code_sent",
      metadata: { email, has_client: !!clientRow, ip },
      actor: "client",
    });

    return { ok: true as const };
  });

// ─── verify ───────────────────────────────────────────────────────────────────
export const verifyClientLoginCode = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        email: z.string().email().max(255),
        code: z.string().regex(/^\d{6}$/, "Code à 6 chiffres requis"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const email = normalizeEmail(data.email);
    const ip = getClientIp() ?? "unknown";
    const ua = getClientUA();

    await enforceRateLimit({ bucket: "client_login_verify_ip", key: ip, limit: 10, windowSec: 600 });
    await enforceRateLimit({ bucket: "client_login_verify_email", key: email, limit: 15, windowSec: 600 });

    // Dernier code actif
    const { data: row } = await supabaseAdmin
      .from("client_auth_codes")
      .select("id,client_id,code_hash,expires_at,attempts,used_at")
      .eq("email", email)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .lt("attempts", CLIENT_CODE_MAX_ATTEMPTS)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!row) {
      await writeAuditLog({
        companyId: null,
        entityType: "client_auth",
        action: "client.login_failed",
        metadata: { email, reason: "no_active_code", ip },
        actor: "client",
      });
      throw new Error("Code expiré ou invalide. Demandez un nouveau code.");
    }

    const expected = await sha256Hex(data.code + ":" + row.id);
    if (!timingSafeEqual(expected, row.code_hash)) {
      const nextAttempts = row.attempts + 1;
      await supabaseAdmin.from("client_auth_codes").update({ attempts: nextAttempts }).eq("id", row.id);
      await writeAuditLog({
        companyId: null,
        entityType: "client_auth",
        action: "client.login_failed",
        metadata: { email, reason: "bad_code", attempts: nextAttempts, ip },
        actor: "client",
      });
      const remaining = Math.max(0, CLIENT_CODE_MAX_ATTEMPTS - nextAttempts);
      throw new Error(
        remaining > 0
          ? `Code incorrect. ${remaining} tentative${remaining > 1 ? "s" : ""} restante${remaining > 1 ? "s" : ""}.`
          : "Trop de tentatives. Demandez un nouveau code.",
      );
    }

    // OK — marque consommé
    await supabaseAdmin
      .from("client_auth_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("id", row.id);

    // Résout le client_id à jour (au cas où il aurait été créé après l'envoi)
    let clientId = row.client_id;
    if (!clientId) {
      const { data: c } = await supabaseAdmin
        .from("clients")
        .select("id")
        .ilike("email", email)
        .maybeSingle();
      clientId = c?.id ?? null;
    }

    // Crée la session
    const token = generateSessionToken();
    const tokenHash = await sha256Hex(token);
    const expiresAt = new Date(Date.now() + CLIENT_SESSION_TTL_SEC * 1000).toISOString();
    await supabaseAdmin.from("client_sessions").insert({
      token_hash: tokenHash,
      client_id: clientId,
      email,
      expires_at: expiresAt,
      ip_address: ip,
      user_agent: ua,
    });
    setClientCookie(token);

    await writeAuditLog({
      companyId: null,
      entityType: "client_auth",
      action: "client.login_success",
      metadata: { email, has_client: !!clientId, ip },
      actor: "client",
    });

    return { ok: true as const, hasClient: !!clientId };
  });

// ─── session lookup ───────────────────────────────────────────────────────────
type ClientSession = {
  sessionId: string;
  clientId: string | null;
  email: string;
  expiresAt: string;
} | null;

async function loadSessionFromCookie(): Promise<ClientSession> {
  const token = readClientCookieToken();
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const { data } = await supabaseAdmin
    .from("client_sessions")
    .select("id,client_id,email,expires_at,revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (!data) return null;
  if (data.revoked_at) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;
  // sliding last_seen update (best effort, no await needed)
  void supabaseAdmin
    .from("client_sessions")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", data.id);
  return {
    sessionId: data.id,
    clientId: data.client_id,
    email: data.email,
    expiresAt: data.expires_at,
  };
}

export const getClientSession = createServerFn({ method: "GET" }).handler(async () => {
  const s = await loadSessionFromCookie();
  if (!s) return null;
  return { email: s.email, clientId: s.clientId, expiresAt: s.expiresAt };
});

export const logoutClientSession = createServerFn({ method: "POST" }).handler(async () => {
  const token = readClientCookieToken();
  if (token) {
    const tokenHash = await sha256Hex(token);
    const { data: s } = await supabaseAdmin
      .from("client_sessions")
      .select("id,email,client_id")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (s) {
      await supabaseAdmin
        .from("client_sessions")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", s.id);
      await writeAuditLog({
        companyId: null,
        entityType: "client_auth",
        action: "client.logout",
        metadata: { email: s.email, client_id: s.client_id },
        actor: "client",
      });
    }
  }
  clearClientCookie();
  return { ok: true as const };
});

// ─── data access (scoped) ─────────────────────────────────────────────────────
async function requireSession() {
  const s = await loadSessionFromCookie();
  if (!s) throw new Error("Session expirée. Reconnectez-vous.");
  return s;
}

export const getClientPvList = createServerFn({ method: "GET" }).handler(async () => {
  const s = await requireSession();
  // Match par client_id quand disponible, sinon par sent_to_email
  let query = supabaseAdmin
    .from("pv")
    .select(
      "id,numero,status,type,reception_date,signed_at,sent_to_client_at,created_at,pdf_url,sign_token,sign_token_expires_at,company_id,chantier_id",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (s.clientId) {
    query = query.or(`client_id.eq.${s.clientId},sent_to_email.eq.${s.email}`);
  } else {
    query = query.eq("sent_to_email", s.email);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return { pvs: data ?? [] };
});

async function fetchPvForClient(pvId: string, s: { email: string; clientId: string | null }) {
  const { data: pv } = await supabaseAdmin
    .from("pv")
    .select(
      "id,numero,status,type,description,observations,reception_date,signed_at,sent_to_client_at,sent_to_email,client_signature,company_signature,company_id,client_id,chantier_id,pdf_url,sign_token,sign_token_expires_at,created_at",
    )
    .eq("id", pvId)
    .maybeSingle();
  if (!pv) throw new Error("PV introuvable.");
  const owned =
    (s.clientId && pv.client_id === s.clientId) ||
    (pv.sent_to_email && pv.sent_to_email.toLowerCase() === s.email);
  if (!owned) throw new Error("Accès refusé.");
  return pv;
}

export const getClientPvDetail = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ pvId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const s = await requireSession();
    const pv = await fetchPvForClient(data.pvId, s);
    const [{ data: company }, { data: chantier }, { data: reserves }, { data: photos }] =
      await Promise.all([
        pv.company_id
          ? supabaseAdmin.from("companies").select("name,logo_url").eq("id", pv.company_id).maybeSingle()
          : Promise.resolve({ data: null }),
        pv.chantier_id
          ? supabaseAdmin.from("chantiers").select("name,address").eq("id", pv.chantier_id).maybeSingle()
          : Promise.resolve({ data: null }),
        supabaseAdmin
          .from("pv_reserves")
          .select("id,description,severity,status,created_at")
          .eq("pv_id", pv.id)
          .order("created_at", { ascending: false }),
        supabaseAdmin.from("pv_photos").select("id,url,caption,kind").eq("pv_id", pv.id),
      ]);

    // Sign photo URLs (private bucket)
    const signedPhotos = await Promise.all(
      (photos ?? []).map(async (p: any) => {
        const { data: su } = await supabaseAdmin.storage
          .from("pv-assets")
          .createSignedUrl(p.url, 3600);
        return { ...p, url: su?.signedUrl ?? p.url };
      }),
    );

    // Audit (non-blocking, but await to ensure persisted before navigation)
    await writeAuditLog({
      companyId: pv.company_id,
      pvId: pv.id,
      entityType: "pv",
      action: "client.pv_viewed",
      metadata: { actor_email: s.email, numero: pv.numero },
      actor: "client",
    });

    return { pv, company, chantier, reserves: reserves ?? [], photos: signedPhotos };
  });

export const getClientPdfSignedUrl = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ pvId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const s = await requireSession();
    const pv = await fetchPvForClient(data.pvId, s);
    if (!pv.pdf_url) throw new Error("PDF non encore disponible.");
    const { data: signed, error } = await supabaseAdmin.storage
      .from("pv-assets")
      .createSignedUrl(pv.pdf_url, 60 * 15);
    if (error || !signed) throw new Error("Impossible de générer le lien.");
    await writeAuditLog({
      companyId: pv.company_id,
      pvId: pv.id,
      entityType: "pv",
      action: "client.pdf_downloaded",
      metadata: { actor_email: s.email },
      actor: "client",
    });
    return { url: signed.signedUrl };
  });

// ─── inline signature from client area ────────────────────────────────────────
const SignClientSchema = z.object({
  pvId: z.string().uuid(),
  signatureDataUrl: z.string().startsWith("data:image/").max(2_000_000),
  consent: z.literal(true),
});

export const signPvAsClient = createServerFn({ method: "POST" })
  .inputValidator((d) => SignClientSchema.parse(d))
  .handler(async ({ data }) => {
    const s = await requireSession();
    const ip = getClientIp() ?? "unknown";
    await enforceRateLimit({
      bucket: "client_sign_submit",
      key: `${s.email}:${data.pvId}`,
      limit: 5,
      windowSec: 600,
    });
    decodeAndValidateImage(data.signatureDataUrl, { maxBytes: 2_000_000 });

    // Re-fetch PV with ownership check
    const pv = await fetchPvForClient(data.pvId, s);

    // Strict signature gate
    if (pv.status === "signe" || pv.client_signature) {
      throw new Error("Ce PV est déjà signé.");
    }
    if (pv.sign_token_expires_at && new Date(pv.sign_token_expires_at) < new Date()) {
      throw new Error("Le lien de signature a expiré. Contactez l'entreprise.");
    }
    // Only "pending" PVs are signable from client area
    const signableStatuses = new Set(["en_attente", "en_attente_signature", "envoye"]);
    if (!signableStatuses.has(pv.status)) {
      throw new Error("Ce PV n'est pas en attente de signature.");
    }

    // Persist signature + reissue token as short-lived download key
    const downloadKey =
      crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const downloadExpires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

    const { error: updErr } = await supabaseAdmin
      .from("pv")
      .update({
        client_signature: data.signatureDataUrl,
        status: "signe",
        signed_at: new Date().toISOString(),
        sign_token: downloadKey,
        sign_token_expires_at: downloadExpires,
      })
      .eq("id", pv.id);
    if (updErr) throw new Error(updErr.message);

    // Owner notification
    if (pv.company_id) {
      await supabaseAdmin.from("notifications").insert({
        company_id: pv.company_id,
        user_id: null,
        type: "pv_signed_remote",
        title: "PV signé par le client",
        body: `Le PV ${pv.numero} a été signé depuis l'espace client.`,
      });
    }

    await writeAuditLog({
      companyId: pv.company_id,
      pvId: pv.id,
      entityType: "pv",
      entityId: pv.id,
      action: "client.pv_signed",
      newValues: { status: "signe", signed_at: new Date().toISOString() },
      metadata: { numero: pv.numero, actor_email: s.email, ip, via: "client_area" },
      actor: "client",
    });

    if (pv.company_id) {
      firePushToCompany(pv.company_id, {
        title: "PV signé par le client",
        body: `${pv.numero} a été signé depuis l'espace client.`,
        url: `/pv/${pv.id}`,
        tag: `pv-signed-${pv.id}`,
        requireInteraction: true,
      });
    }

    // Generate final PDF + send by email (non-fatal)
    try {
      await buildAndStorePvPdf(pv.id);
      await writeAuditLog({
        companyId: pv.company_id,
        pvId: pv.id,
        entityType: "pv",
        entityId: pv.id,
        action: "pv.pdf_generated",
        metadata: { trigger: "auto_after_client_sign" },
        actor: "pdf",
      });
      try {
        await deliverSignedPv({ pvId: pv.id, trigger: "auto" });
      } catch (e) {
        console.error("Signed PV email delivery failed:", e);
      }
    } catch (e) {
      console.error("PDF generation failed after client sign:", e);
    }

    return { ok: true as const };
  });

// ─── client activity / history ────────────────────────────────────────────────
export const getClientActivity = createServerFn({ method: "GET" }).handler(async () => {
  const s = await requireSession();

  // Logs liés à cet email OU à ses PVs
  // 1. Récupère les PV ids du client
  let pvIds: string[] = [];
  if (s.clientId) {
    const { data } = await supabaseAdmin
      .from("pv")
      .select("id")
      .or(`client_id.eq.${s.clientId},sent_to_email.eq.${s.email}`);
    pvIds = (data ?? []).map((r: any) => r.id);
  } else {
    const { data } = await supabaseAdmin.from("pv").select("id").eq("sent_to_email", s.email);
    pvIds = (data ?? []).map((r: any) => r.id);
  }

  const orParts: string[] = [`metadata->>actor_email.eq.${s.email}`];
  if (pvIds.length > 0) orParts.push(`pv_id.in.(${pvIds.join(",")})`);

  const { data, error } = await supabaseAdmin
    .from("audit_logs")
    .select("id,action,created_at,metadata,pv_id,ip_address,user_agent")
    .or(orParts.join(","))
    .in("action", [
      "client.login_code_sent",
      "client.login_success",
      "client.login_failed",
      "client.logout",
      "client.pv_viewed",
      "client.pdf_downloaded",
      "client.pv_signed",
      "client.session_revoked",
      "client.all_sessions_revoked",
    ])
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);

  // Numero lookup for prettier display
  const pvIdsInLogs = Array.from(
    new Set((data ?? []).map((r: any) => r.pv_id).filter(Boolean)),
  ) as string[];
  let pvMap: Record<string, string> = {};
  if (pvIdsInLogs.length) {
    const { data: pvs } = await supabaseAdmin
      .from("pv")
      .select("id,numero")
      .in("id", pvIdsInLogs);
    pvMap = Object.fromEntries((pvs ?? []).map((p: any) => [p.id, p.numero]));
  }

  return {
    events: (data ?? []).map((r: any) => ({
      id: r.id,
      action: r.action,
      created_at: r.created_at,
      pv_id: r.pv_id,
      pv_numero: r.pv_id ? pvMap[r.pv_id] : null,
      ip: r.ip_address,
      ua: r.user_agent,
    })),
  };
});

// ─── client profile / sessions ────────────────────────────────────────────────
export const getClientProfile = createServerFn({ method: "GET" }).handler(async () => {
  const s = await requireSession();
  const token = readClientCookieToken();
  const currentHash = token ? await sha256Hex(token) : null;

  const { data, error } = await supabaseAdmin
    .from("client_sessions")
    .select("id,token_hash,ip_address,user_agent,created_at,last_seen_at,expires_at,revoked_at")
    .eq("email", s.email)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("last_seen_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);

  const sessions = (data ?? []).map((row: any) => ({
    id: row.id,
    isCurrent: currentHash !== null && row.token_hash === currentHash,
    ip: row.ip_address,
    ua: row.user_agent,
    deviceLabel: describeUA(row.user_agent),
    created_at: row.created_at,
    last_seen_at: row.last_seen_at,
    expires_at: row.expires_at,
  }));

  return { email: s.email, sessions };
});

export const revokeClientSession = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const s = await requireSession();
    const token = readClientCookieToken();
    const currentHash = token ? await sha256Hex(token) : null;

    const { data: row } = await supabaseAdmin
      .from("client_sessions")
      .select("id,email,token_hash")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (!row || row.email !== s.email) throw new Error("Session introuvable.");

    await supabaseAdmin
      .from("client_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", row.id);

    await writeAuditLog({
      companyId: null,
      entityType: "client_auth",
      action: "client.session_revoked",
      metadata: { actor_email: s.email, session_id: row.id, was_current: row.token_hash === currentHash },
      actor: "client",
    });

    const isCurrent = row.token_hash === currentHash;
    if (isCurrent) clearClientCookie();
    return { ok: true as const, wasCurrent: isCurrent };
  });

export const revokeAllClientSessions = createServerFn({ method: "POST" }).handler(async () => {
  const s = await requireSession();

  await supabaseAdmin
    .from("client_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("email", s.email)
    .is("revoked_at", null);

  await writeAuditLog({
    companyId: null,
    entityType: "client_auth",
    action: "client.all_sessions_revoked",
    metadata: { actor_email: s.email },
    actor: "client",
  });

  clearClientCookie();
  return { ok: true as const };
});
