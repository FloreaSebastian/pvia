/**
 * Authentification de l'espace Sous-traitant.
 *
 * Parcours volontairement distinct du parcours professionnel interne :
 * `sendEnterpriseLoginCode` exige un `company_members` actif, ce qu'un
 * sous-traitant n'a jamais. Ici l'éligibilité repose uniquement sur une
 * relation sous-traitant active (ou invitée).
 *
 * Mêmes garanties que les autres parcours : code 6 chiffres haché, TTL 10 min,
 * rate limiting, anti-énumération (réponse neutre) et audit.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { writeAuditLog } from "@/lib/audit.server";
import { enforceRateLimit } from "@/lib/rate-limit.server";
import {
  describeUA,
  generateNumericCode,
  getClientIp,
  getClientUA,
  normalizeEmail,
  sha256Hex,
  timingSafeEqual,
  padToMinDuration,
} from "@/lib/client-auth.server";
import { sendSubcontractorLoginCodeEmail } from "@/lib/subcontractor-email.server";
import { getPublicAppUrl } from "./app-url.server";

const CODE_TTL_SEC = 600;
const MAX_ATTEMPTS = 5;
const MIN_RESPONSE_MS = 2200;
const NEUTRAL = { ok: true as const, neutral: true as const };

async function findAuthUserByEmail(email: string) {
  const perPage = 1000;
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const user = data.users.find((u) => u.email?.toLowerCase() === email);
    if (user) return user;
    if (data.users.length < perPage) break;
  }
  return null;
}

async function eligibleMembership(email: string) {
  const { data: identity } = await supabaseAdmin
    .from("subcontractor_users")
    .select("id,user_id")
    .ilike("email", email)
    .maybeSingle();
  if (!identity) return null;
  const { data: membership } = await supabaseAdmin
    .from("subcontractor_memberships")
    .select("id,company_id,status")
    .eq("subcontractor_user_id", identity.id)
    .in("status", ["active", "invited"])
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();
  if (!membership) return null;
  return { identity, membership };
}

async function runSend(data: { email: string }) {
  const email = normalizeEmail(data.email);
  const ip = getClientIp() ?? "unknown";
  const ua = getClientUA();

  await enforceRateLimit({ bucket: "subcontractor_login_send_email", key: email, limit: 3, windowSec: 900 });
  await enforceRateLimit({ bucket: "subcontractor_login_send_ip", key: ip, limit: 10, windowSec: 3600 });

  const eligible = await eligibleMembership(email);
  if (!eligible) {
    await writeAuditLog({
      companyId: null,
      userId: null,
      entityType: "auth",
      action: "user.login_failed" as never,
      metadata: { email, reason: "not_active_subcontractor", ip },
    });
    return NEUTRAL;
  }

  const user = await findAuthUserByEmail(email);
  if (!user) return NEUTRAL;

  const appUrl = getPublicAppUrl();
  const { data: linkData, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${appUrl}/sous-traitant/verify?email=${encodeURIComponent(email)}` },
  });
  const tokenHash = linkData?.properties?.hashed_token;
  if (error || !tokenHash) return NEUTRAL;

  const code = generateNumericCode();
  const codeHash = await sha256Hex(code);

  await supabaseAdmin
    .from("enterprise_auth_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("email", email)
    .is("used_at", null);

  const { error: insErr } = await supabaseAdmin.from("enterprise_auth_codes").insert({
    email,
    code_hash: codeHash,
    token_hash: tokenHash,
    expires_at: new Date(Date.now() + CODE_TTL_SEC * 1000).toISOString(),
  });
  if (insErr) return NEUTRAL;

  try {
    await sendSubcontractorLoginCodeEmail({
      to: email,
      code,
      device: describeUA(ua),
      companyId: eligible.membership.company_id,
    });
  } catch {
    return NEUTRAL;
  }

  await writeAuditLog({
    companyId: eligible.membership.company_id,
    userId: user.id,
    entityType: "subcontractor",
    action: "user.login_code_sent" as never,
    metadata: { email, method: "subcontractor_otp_6digits", ip },
  });
  return NEUTRAL;
}

export const sendSubcontractorLoginCode = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ email: z.string().email().max(255) }).parse(d))
  .handler(async ({ data }) => {
    const startedAt = Date.now();
    const res = await runSend(data);
    await padToMinDuration(startedAt, MIN_RESPONSE_MS);
    return res;
  });

export const verifySubcontractorLoginCode = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({ email: z.string().email().max(255), code: z.string().regex(/^\d{6}$/) })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const email = normalizeEmail(data.email);
    const ip = getClientIp() ?? "unknown";
    await enforceRateLimit({ bucket: "subcontractor_login_verify_email", key: email, limit: 10, windowSec: 900 });
    await enforceRateLimit({ bucket: "subcontractor_login_verify_ip", key: ip, limit: 30, windowSec: 900 });

    const { data: row } = await supabaseAdmin
      .from("enterprise_auth_codes")
      .select("id, code_hash, token_hash, expires_at, attempts, used_at")
      .eq("email", email)
      .is("used_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!row) throw new Error("Code invalide ou expiré.");
    if (new Date(row.expires_at).getTime() < Date.now()) throw new Error("Code expiré. Demandez-en un nouveau.");
    if ((row.attempts ?? 0) >= MAX_ATTEMPTS) throw new Error("Trop de tentatives. Demandez un nouveau code.");

    const hash = await sha256Hex(data.code);
    if (!timingSafeEqual(hash, row.code_hash)) {
      await supabaseAdmin
        .from("enterprise_auth_codes")
        .update({ attempts: (row.attempts ?? 0) + 1 })
        .eq("id", row.id);
      throw new Error("Code invalide.");
    }

    await supabaseAdmin
      .from("enterprise_auth_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("id", row.id);

    return { ok: true as const, tokenHash: row.token_hash, email };
  });

/** Détail public minimal d'une invitation (aucune donnée sensible). */
export const peekSubcontractorInvite = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: z.string().min(20).max(200) }).parse(d))
  .handler(async ({ data }) => {
    await enforceRateLimit({
      bucket: "subcontractor_invite_peek_ip",
      key: getClientIp() ?? "unknown",
      limit: 30,
      windowSec: 900,
    });
    const tokenHash = await sha256Hex(data.token);
    const { data: invite } = await supabaseAdmin
      .from("subcontractor_invites")
      .select("id,email,expires_at,used_at,revoked_at,company_id,membership_id")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (!invite || invite.revoked_at) return { valid: false as const, reason: "invalid" as const };
    if (invite.used_at) return { valid: false as const, reason: "used" as const };
    if (new Date(invite.expires_at).getTime() < Date.now())
      return { valid: false as const, reason: "expired" as const };

    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("name")
      .eq("id", invite.company_id)
      .maybeSingle();

    return {
      valid: true as const,
      email: invite.email,
      companyName: company?.name ?? "Entreprise",
    };
  });

/**
 * Consomme l'invitation pour le compte CONNECTÉ.
 *
 * L'email de la session doit correspondre à celui de l'invitation : un jeton
 * volé ne permet donc pas d'ouvrir un accès sur un autre compte. Une
 * invitation déjà utilisée n'est jamais rejouable — un compte existant peut en
 * revanche recevoir une NOUVELLE invitation pour une NOUVELLE relation.
 */
export const acceptSubcontractorInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ token: z.string().min(20).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const sessionEmail = normalizeEmail(String(context.claims["email"] ?? ""));
    if (!sessionEmail) throw new Error("Session invalide.");

    await enforceRateLimit({
      bucket: "subcontractor_invite_accept",
      key: userId,
      limit: 10,
      windowSec: 900,
    });

    const tokenHash = await sha256Hex(data.token);
    const { data: invite } = await supabaseAdmin
      .from("subcontractor_invites")
      .select("id,email,expires_at,used_at,revoked_at,company_id,membership_id")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (!invite || invite.revoked_at || invite.used_at) throw new Error("Invitation invalide.");
    if (new Date(invite.expires_at).getTime() < Date.now()) throw new Error("Invitation expirée.");
    if (normalizeEmail(invite.email) !== sessionEmail)
      throw new Error("Cette invitation concerne une autre adresse email.");

    const { data: membership } = await supabaseAdmin
      .from("subcontractor_memberships")
      .select("id,company_id,subcontractor_user_id,status")
      .eq("id", invite.membership_id)
      .maybeSingle();
    if (!membership) throw new Error("Invitation invalide.");

    const nowIso = new Date().toISOString();

    // Compare-and-set : l'invitation est consommée AVANT toute autre écriture.
    // Deux acceptations concurrentes ne peuvent donc pas aboutir toutes les deux.
    const { data: claimed } = await supabaseAdmin
      .from("subcontractor_invites")
      .update({ used_at: nowIso })
      .eq("id", invite.id)
      .is("used_at", null)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle();
    if (!claimed) throw new Error("Invitation invalide.");

    await supabaseAdmin
      .from("subcontractor_users")
      .update({ user_id: userId, last_login_at: nowIso })
      .eq("id", membership.subcontractor_user_id);

    await supabaseAdmin
      .from("subcontractor_memberships")
      .update({ status: "active", accepted_at: nowIso, revoked_at: null, suspended_at: null })
      .eq("id", membership.id);

    await writeAuditLog({
      companyId: membership.company_id,
      userId,
      entityType: "subcontractor",
      entityId: membership.id,
      action: "member.joined" as never,
      metadata: { scope: "subcontractor", email: sessionEmail },
    });

    return { ok: true as const, companyId: membership.company_id };
  });
