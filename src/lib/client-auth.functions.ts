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
  padToMinDuration,
  CLIENT_LOGIN_MIN_RESPONSE_MS,
  readClientCookieToken,
  setClientCookie,
  sha256Hex,
  timingSafeEqual, toInetOrNull } from "@/lib/client-auth.server";
import { sendClientLoginCodeEmail } from "@/lib/email.server";
import {
  findIdentityByEmail,
  listIdentityRelations,
  loadCompanyLabels,
  markIdentityLogin,
} from "@/lib/client-identity.server";
import {
  companyKey,
  fetchPvForClientScope,
  requireClientScope,
} from "@/lib/client-access.server";
import { LIFT_SIGNED_STATUSES } from "@/lib/reserve-lift-status";

// ─── send code ────────────────────────────────────────────────────────────────
export const sendClientLoginCode = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ email: z.string().email().max(255) }).parse(d))
  .handler(async ({ data }) => {
    const startedAt = Date.now();
    const email = normalizeEmail(data.email);
    const ip = getClientIp() ?? "unknown";
    const ua = getClientUA();

    // Réponse neutre commune (anti-énumération) — l'UI ne doit jamais savoir
    // si l'email existe ou pourquoi un envoi a échoué.
    // Le temps de réponse est également nivelé : sans ce palier, un email
    // connu (envoi SMTP réel) répondait en ~1,6 s contre ~0,3 s pour un email
    // inconnu, ce qui suffit à énumérer la base au chronomètre.
    const NEUTRAL = { ok: true as const, neutral: true as const };
    const neutral = async () => {
      await padToMinDuration(startedAt, CLIENT_LOGIN_MIN_RESPONSE_MS);
      return NEUTRAL;
    };


    // Trace systématique de la tentative pour monitoring/admin.
    await writeAuditLog({
      companyId: null,
      entityType: "client_auth",
      action: "client.login_code_attempt",
      metadata: { email, ip },
      actor: "client",
    });

    // Rate limit. UI toujours neutre.
    try {
      await enforceRateLimit({ bucket: "client_login_send_email", key: email, limit: 3, windowSec: 900 });
      await enforceRateLimit({ bucket: "client_login_send_ip", key: ip, limit: 10, windowSec: 3600 });
    } catch (e: any) {
      if (e?.name === "RateLimitError") {
        await writeAuditLog({
          companyId: null,
          entityType: "client_auth",
          action: "client.login_code_rate_limited",
          metadata: { email, ip, bucket: "send" },
          actor: "client",
        });
        return await neutral();
      }
      throw e;
    }

    // Résolution multi-entreprises : une même adresse peut être cliente de
    // plusieurs entreprises. On ne cherche donc JAMAIS une ligne unique par
    // email — on passe par l'identité globale (sans la créer ici : la création
    // d'identité appartient au workflow entreprise, pas à un visiteur).
    const identity = await findIdentityByEmail(email);
    const [{ data: clientRows }, { data: pvRows }] = await Promise.all([
      identity
        ? supabaseAdmin
            .from("clients")
            .select("id,company_id,name")
            .eq("client_identity_id", identity.id)
            .is("portal_suspended_at", null)
            .limit(20)
        : Promise.resolve({ data: [] as any[] }),
      supabaseAdmin.from("pv").select("id,company_id").ilike("sent_to_email", email).limit(1),
    ]);
    const clientRow = (clientRows ?? [])[0] ?? null;
    const pvRow = (pvRows ?? [])[0] ?? null;

    const knownCompanyId = clientRow?.company_id ?? pvRow?.company_id ?? null;

    if (!clientRow && !pvRow) {
      await writeAuditLog({
        companyId: null,
        entityType: "client_auth",
        action: "client.login_code_ignored_unknown_email",
        metadata: { email, ip },
        actor: "client",
      });
      return await neutral();
    }

    // Invalide les codes précédents non utilisés
    await supabaseAdmin
      .from("client_auth_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("email", email)
      .is("used_at", null);

    const code = generateNumericCode();
    const expiresAt = new Date(Date.now() + CLIENT_CODE_TTL_SEC * 1000).toISOString();
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("client_auth_codes")
      .insert({
        client_id: clientRow?.id ?? null,
        client_identity_id: identity?.id ?? null,
        email,
        code_hash: "pending",
        expires_at: expiresAt,
        attempts: 0,
        ip_address: ip,
        user_agent: ua,
      })
      .select("id")
      .single();
    if (insErr || !inserted) {
      console.error("client_auth_codes insert failed:", insErr);
      await writeAuditLog({
        companyId: knownCompanyId,
        entityType: "client_auth",
        action: "client.login_code_send_failed",
        metadata: { email, ip, reason: "code_persist_failed", error: insErr?.message ?? null },
        actor: "client",
      });
      return await neutral();
    }

    const hash = await sha256Hex(code + ":" + inserted.id);
    await supabaseAdmin.from("client_auth_codes").update({ code_hash: hash }).eq("id", inserted.id);

    // Envoi email — échec loggé explicitement (email_logs + audit), mais
    // réponse UI toujours neutre.
    let sent = true;
    let sendError: string | null = null;
    try {
      await sendClientLoginCodeEmail({
        to: email,
        code,
        ip,
        device: describeUA(ua),
        companyId: knownCompanyId,
      });
    } catch (e: any) {
      sent = false;
      sendError = e?.message ?? String(e);
      console.error("sendClientLoginCodeEmail failed:", e);
    }

    await writeAuditLog({
      companyId: knownCompanyId,
      entityType: "client_auth",
      action: sent ? "client.login_code_sent" : "client.login_code_send_failed",
      metadata: {
        email,
        has_client: !!clientRow,
        has_pv: !!pvRow,
        ip,
        ...(sendError ? { error: sendError } : {}),
      },
      actor: "client",
    });

    return await neutral();
  });

// ─── verify ───────────────────────────────────────────────────────────────────
export const verifyClientLoginCode = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        email: z.string().email().max(255),
        code: z.string().regex(/^\d{6}$/, "Code à 6 chiffres requis"),
        remember: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const email = normalizeEmail(data.email);
    const ip = getClientIp() ?? "unknown";
    const ua = getClientUA();

    // Le message brut de RateLimitError contient le nom interne du bucket
    // ("client_login_verify_ip") : jamais montré à un client externe.
    try {
      await enforceRateLimit({ bucket: "client_login_verify_ip", key: ip, limit: 10, windowSec: 600 });
      await enforceRateLimit({ bucket: "client_login_verify_email", key: email, limit: 15, windowSec: 600 });
    } catch (e: any) {
      if (e?.name === "RateLimitError") {
        const min = Math.max(1, Math.ceil((e.retryAfterSec ?? 600) / 60));
        await writeAuditLog({
          companyId: null,
          entityType: "client_auth",
          action: "client.login_verify_rate_limited",
          metadata: { email, ip },
          actor: "client",
        });
        throw new Error(`Trop de tentatives. Réessayez dans ${min} minute${min > 1 ? "s" : ""}.`);
      }
      throw e;
    }


    // Dernier code actif
    const { data: row } = await supabaseAdmin
      .from("client_auth_codes")
      .select("id,client_id,client_identity_id,code_hash,expires_at,attempts,used_at")
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

    // Authentifie l'IDENTITÉ globale, plus une ligne `clients` unique.
    const identityId =
      (row as any).client_identity_id ?? (await findIdentityByEmail(email))?.id ?? null;
    const relations = await listIdentityRelations(identityId);
    // client_id reste renseigné (compatibilité anciennes sessions / audit).
    const clientId = (row.client_id as string | null) ?? relations[0]?.clientId ?? null;

    // Crée la session
    const remember = data.remember !== false; // default: persistent 30 days
    const ttlSec = remember ? CLIENT_SESSION_TTL_SEC : 60 * 60 * 8; // 8h if not remembered
    const token = generateSessionToken();
    const tokenHash = await sha256Hex(token);
    const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString();
    await supabaseAdmin.from("client_sessions").insert({
      token_hash: tokenHash,
      client_id: clientId,
      client_identity_id: identityId,
      email,
      expires_at: expiresAt,
      ip_address: ip,
      user_agent: ua,
    });
    setClientCookie(token, ttlSec, remember);
    await markIdentityLogin(identityId);

    await writeAuditLog({
      companyId: null,
      entityType: "client_auth",
      action: "client.login_success",
      metadata: { email, has_client: relations.length > 0, companies: relations.length, ip },
      actor: "client",
    });

    return { ok: true as const, hasClient: relations.length > 0 };

  });

// ─── session lookup ───────────────────────────────────────────────────────────
type ClientSession = {
  sessionId: string;
  /** @deprecated compat : une identité peut être liée à plusieurs `clients`. */
  clientId: string | null;
  identityId: string | null;
  email: string;
  expiresAt: string;
} | null;

async function loadSessionFromCookie(): Promise<ClientSession> {
  const token = readClientCookieToken();
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const { data } = await supabaseAdmin
    .from("client_sessions")
    .select("id,client_id,client_identity_id,email,expires_at,revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (!data) return null;
  if (data.revoked_at) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;

  // Migration douce : une session créée avant le modèle multi-entreprises n'a
  // pas d'identité. On la résout et on la répare — sans déconnecter personne.
  let identityId = (data as any).client_identity_id as string | null;
  if (!identityId) {
    identityId = (await findIdentityByEmail(data.email))?.id ?? null;
    if (identityId) {
      void supabaseAdmin
        .from("client_sessions")
        .update({ client_identity_id: identityId } as never)
        .eq("id", data.id);
    }
  }

  // sliding last_seen update (best effort, no await needed)
  void supabaseAdmin
    .from("client_sessions")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", data.id);
  return {
    sessionId: data.id,
    clientId: data.client_id,
    identityId,
    email: data.email,
    expiresAt: data.expires_at,
  };
}

/**
 * Périmètre d'accès réel d'une session : identité globale → relations clients
 * autorisées → identifiants de lignes `clients`. L'email reste accepté en
 * compatibilité (anciens PV `sent_to_email` sans relation établie), mais n'est
 * plus le mécanisme d'autorisation principal.
 */
async function sessionScope(s: NonNullable<ClientSession>) {
  const relations = await listIdentityRelations(s.identityId);
  const clientIds = new Set(relations.map((r) => r.clientId));
  // Compat : session ancienne encore rattachée à une ligne client précise.
  if (s.clientId) clientIds.add(s.clientId);
  return { relations, clientIds: Array.from(clientIds) };
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
/** Périmètre autorisé : identité globale → relations clients → documents. */


/** Statuts de levée sur lesquels le client a réellement une action à faire. */
const LIFT_CLIENT_ACTIONABLE = new Set<string>([...LIFT_SIGNED_STATUSES]);


/**
 * Documents accessibles au client connecté, toutes entreprises confondues.
 *
 * Le serveur fait autorité : il résout identité → relations → PV, calcule les
 * états dérivés (isSigned / canSign / signExpired) et n'expose AUCUNE donnée
 * interne (sign_token, company_id/chantier_id/client_id, chemin de stockage).
 * L'entreprise émettrice est identifiée par son nom + une clé opaque servant
 * uniquement au filtre de l'interface.
 */
const CLIENT_SIGNABLE_STATUSES = new Set(["en_attente", "en_attente_signature", "envoye"]);

export const getClientPvList = createServerFn({ method: "GET" }).handler(async () => {
  const scope = await requireClientScope();

  const filters: string[] = [];
  if (scope.clientIds.length) filters.push(`client_id.in.(${scope.clientIds.join(",")})`);
  // Compat anciens PV adressés par email sans relation établie.
  filters.push(`sent_to_email.eq."${scope.email.replace(/"/g, "")}"`);

  const { data, error } = await supabaseAdmin
    .from("pv")
    .select(
      "id,numero,status,type,reception_date,signed_at,sent_to_client_at,created_at,pdf_url,sign_token_expires_at,client_signature,company_id,chantier_id",
    )
    // Un brouillon n'a jamais été adressé au client : il ne doit pas apparaître.
    .neq("status", "brouillon")
    .or(filters.join(","))
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    console.error("getClientPvList failed:", error);
    throw new Error("Impossible de charger vos procès-verbaux pour le moment.");
  }

  const rows = data ?? [];
  const companyIds = rows.map((r: any) => r.company_id).filter(Boolean) as string[];
  const chantierIds = Array.from(new Set(rows.map((r: any) => r.chantier_id).filter(Boolean))) as string[];
  const [companyNames, chantierRows] = await Promise.all([
    loadCompanyLabels(companyIds),
    chantierIds.length
      ? supabaseAdmin.from("chantiers").select("id,name").in("id", chantierIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const chantierNames = new Map<string, string>(
    ((chantierRows as any).data ?? []).map((c: any) => [c.id as string, (c.name ?? "") as string]),
  );

  // Levées en attente d'action client, sur les PV accessibles.
  const pvIds = rows.map((r: any) => r.id as string);
  const { data: liftRows } = pvIds.length
    ? await supabaseAdmin
        .from("reserve_lift_reports")
        .select("id,numero,pv_id,status,created_at,client_validated_at,client_rejected_at")
        .in("pv_id", pvIds)
        .is("client_validated_at", null)
        .is("client_rejected_at", null)
        .order("created_at", { ascending: false })
    : { data: [] as any[] };

  const now = Date.now();
  const pvs = await Promise.all(
    rows.map(async (pv: any) => {
      const isSigned = pv.status === "signe" || !!pv.client_signature || !!pv.signed_at;
      const signExpired =
        !!pv.sign_token_expires_at && new Date(pv.sign_token_expires_at).getTime() < now;
      return {
        id: pv.id as string,
        numero: (pv.numero ?? "") as string,
        status: pv.status as string,
        type: (pv.type ?? null) as string | null,
        reception_date: (pv.reception_date ?? null) as string | null,
        signed_at: (pv.signed_at ?? null) as string | null,
        sent_to_client_at: (pv.sent_to_client_at ?? null) as string | null,
        created_at: (pv.created_at ?? null) as string | null,
        companyName: pv.company_id ? companyNames.get(pv.company_id) ?? null : null,
        companyKey: await companyKey(pv.company_id ?? null),
        chantierName: pv.chantier_id ? chantierNames.get(pv.chantier_id) ?? null : null,
        hasPdf: !!pv.pdf_url,
        isSigned,
        // "Lien expiré" n'a de sens que pour un PV qui, sinon, serait signable.
        signExpired: !isSigned && signExpired && CLIENT_SIGNABLE_STATUSES.has(pv.status),
        canSign: !isSigned && !signExpired && CLIENT_SIGNABLE_STATUSES.has(pv.status),
      };
    }),
  );

  const pvById = new Map(rows.map((r: any) => [r.id as string, r]));
  const lifts = await Promise.all(
    ((liftRows as any[]) ?? [])
      .filter((l: any) => LIFT_CLIENT_ACTIONABLE.has(l.status))
      .map(async (l: any) => {
        const parent = pvById.get(l.pv_id);
        return {
          id: l.id as string,
          pvId: l.pv_id as string,
          numero: (l.numero ?? "") as string,
          pvNumero: (parent?.numero ?? "") as string,
          created_at: (l.created_at ?? null) as string | null,
          companyName: parent?.company_id ? companyNames.get(parent.company_id) ?? null : null,
          companyKey: await companyKey(parent?.company_id ?? null),
          chantierName: parent?.chantier_id ? chantierNames.get(parent.chantier_id) ?? null : null,
        };
      }),
  );

  // Entreprises réellement liées au client (pour le filtre du dashboard).
  const companies = await Promise.all(
    Array.from(new Set(rows.map((r: any) => r.company_id).filter(Boolean))).map(async (id: any) => ({
      key: (await companyKey(id)) as string,
      name: companyNames.get(id) ?? "Entreprise",
    })),
  );

  return { pvs, lifts, companies: companies.sort((a, b) => a.name.localeCompare(b.name, "fr")) };
});

async function fetchPvForClient(pvId: string, scope: Awaited<ReturnType<typeof requireClientScope>>) {
  return fetchPvForClientScope(pvId, scope);
}


export const getClientPvDetail = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ pvId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const s = await requireClientScope();
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

    // Ne jamais renvoyer de données sensibles au navigateur du client externe
    const { sign_token: _t, company_id: _c, client_id: _cl, chantier_id: _ch, ...safePv } = pv as any;

    return { pv: safePv, company, chantier, reserves: reserves ?? [], photos: signedPhotos };
  });

export const getClientPdfSignedUrl = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ pvId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const s = await requireClientScope();
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
    const s = await requireClientScope();
    const ip = getClientIp() ?? "unknown";
    const userAgent = (getClientUA() ?? "").slice(0, 500);
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

    // Persist signature + reissue token as short-lived download key.
    // Only the SHA-256 hash is stored; the raw key is returned once.
    const { generateSignToken, sha256Hex, SIGN_CONSENT_TEXT_V1 } = await import("./sign-token.server");
    const downloadKey = generateSignToken();
    const downloadKeyHash = await sha256Hex(downloadKey);
    const downloadExpires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const nowIso = new Date().toISOString();
    const ua = userAgent;

    const { error: updErr } = await supabaseAdmin
      .from("pv")
      .update({
        client_signature: data.signatureDataUrl,
        status: "signe",
        signed_at: nowIso,
        sign_token: null,
        sign_token_hash: downloadKeyHash,
        sign_token_expires_at: downloadExpires,
        client_signature_ip: toInetOrNull(ip),
        client_signature_user_agent: ua || null,
        consent_text: SIGN_CONSENT_TEXT_V1,
        consent_at: nowIso,
      } as never)
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
/**
 * Actions autorisées dans l'historique client.
 * Liste blanche stricte : aucun événement interne entreprise (pv.*, reserve.*,
 * member.*, settings.*) ne doit pouvoir remonter à un client externe.
 */
const CLIENT_HISTORY_ACTIONS = [
  "client.login_code_sent",
  "client.login_success",
  "client.login_failed",
  "client.logout",
  "client.pv_viewed",
  "client.pdf_downloaded",
  "client.pv_signed",
  "client.session_revoked",
  "client.all_sessions_revoked",
] as const;

export const CLIENT_HISTORY_PAGE_SIZE = 50;

/**
 * Historique d'activité du client connecté.
 *
 * Cloisonnement : on ne retient QUE les événements dont l'acteur est l'email de
 * la session (`metadata.actor_email` pour les actions applicatives,
 * `metadata.email` pour les événements de login). L'ancien filtre incluait
 * aussi `pv_id in (<PV du client>)`, ce qui faisait remonter les événements
 * d'UN AUTRE client ayant accès au même PV — avec son IP et son user-agent.
 *
 * Le DTO n'expose ni IP, ni user-agent, ni metadata brute : uniquement
 * action / date / (pv_id + numéro si le PV appartient bien au client).
 */
export const getClientActivity = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({ offset: z.number().int().min(0).max(10_000).optional() })
      .parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const s = await requireClientScope();
    const offset = data.offset ?? 0;

    // PV réellement accessibles au client (identité → relations → documents) :
    // sert uniquement à décider si on peut exposer un numéro, l'entreprise
    // émettrice et un lien de navigation.
    const filters: string[] = [];
    if (s.clientIds.length) filters.push(`client_id.in.(${s.clientIds.join(",")})`);
    filters.push(`sent_to_email.eq."${s.email.replace(/"/g, "")}"`);
    const { data: ownPvs } = await supabaseAdmin
      .from("pv")
      .select("id,numero,company_id")
      .neq("status", "brouillon")
      .or(filters.join(","));
    const companyNames = await loadCompanyLabels(
      (ownPvs ?? []).map((p: any) => p.company_id).filter(Boolean),
    );
    const pvMap = new Map<string, { numero: string; companyName: string | null }>(
      (ownPvs ?? []).map((p: any) => [
        p.id as string,
        {
          numero: (p.numero ?? "") as string,
          companyName: p.company_id ? companyNames.get(p.company_id) ?? null : null,
        },
      ]),
    );


    // Valeurs entre guillemets : l'email vient de la session mais reste une
    // donnée d'origine utilisateur injectée dans un filtre PostgREST.
    const orExpr = [
      `metadata->>actor_email.eq."${s.email}"`,
      `metadata->>email.eq."${s.email}"`,
    ].join(",");

    const { data: rows, error, count } = await supabaseAdmin
      .from("audit_logs")
      .select("id,action,created_at,pv_id", { count: "exact" })
      .or(orExpr)
      .in("action", CLIENT_HISTORY_ACTIONS as unknown as string[])
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + CLIENT_HISTORY_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);

    const events = (rows ?? []).map((r: any) => {
      const pv = r.pv_id ? pvMap.get(r.pv_id) ?? null : null;
      return {
        id: r.id as string,
        action: r.action as string,
        created_at: r.created_at as string,
        // Pas de lien/numéro si le PV n'appartient pas (ou plus) au client.
        pv_id: pv ? (r.pv_id as string) : null,
        pv_numero: pv?.numero ?? null,
        companyName: pv?.companyName ?? null,
      };
    });


    const total = count ?? offset + events.length;
    return {
      events,
      total,
      offset,
      pageSize: CLIENT_HISTORY_PAGE_SIZE,
      hasMore: offset + events.length < total,
    };
  });


// ─── client profile / sessions ────────────────────────────────────────────────
export const getClientProfile = createServerFn({ method: "GET" }).handler(async () => {
  const s = await requireClientScope();
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
  // Ne jamais renvoyer le message Postgres brut au navigateur du client externe.
  if (error) {
    console.error("[client-profile] sessions query failed", error);
    throw new Error("Impossible de charger vos sessions pour le moment.");
  }

  // DTO minimal : ni token_hash, ni user-agent brut (deviceLabel suffit à l'UI).
  const sessions = (data ?? []).map((row: any) => ({
    id: row.id,
    isCurrent: currentHash !== null && row.token_hash === currentHash,
    ip: row.ip_address,
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
    const s = await requireClientScope();
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
  const s = await requireClientScope();

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
