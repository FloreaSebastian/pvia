/**
 * Centralised signature OTP helper.
 *
 * Used by BOTH onsite signature (sign-onsite.functions.ts) and remote
 * signature (sign.functions.ts) flows. Persists OTPs in
 * `pv_signature_otps` with a `signature_mode` discriminator ('onsite' | 'remote').
 *
 * Security:
 *  - Codes are stored hashed (SHA-256), never in clear.
 *  - Expiry: 10 min, max 5 verification attempts.
 *  - Caller is responsible for rate limiting + membership/token checks.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getRequest } from "@tanstack/react-start/server";
import { sha256Hex, generateNumericCode, normalizeEmail, getClientUA } from "./client-auth.server";
import { getClientIp } from "./rate-limit.server";

export type SignatureMode = "onsite" | "remote";

export type SignatureOtpRow = {
  id: string;
  pv_id: string | null;
  company_id: string;
  email: string;
  code_hash: string;
  attempts: number;
  expires_at: string;
  used_at: string | null;
  ip_address: string | null;
  user_agent: string | null;
  signature_mode: SignatureMode;
  created_at: string;
};

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export function maskEmail(email: string): string {
  return email.replace(/(.).+(@.+)/, "$1***$2");
}

/** Create a new signature OTP, return its id, the 6-digit code, and expiry. */
export async function createSignatureOtp(opts: {
  companyId: string;
  pvId?: string | null;
  email: string;
  mode: SignatureMode;
}): Promise<{ id: string; code: string; expiresAt: string }> {
  const code = generateNumericCode();
  const codeHash = await sha256Hex(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
  const ip = getClientIp(getRequest());
  const ua = getClientUA();

  const { data, error } = await supabaseAdmin
    .from("pv_signature_otps")
    .insert({
      company_id: opts.companyId,
      pv_id: opts.pvId ?? null,
      email: normalizeEmail(opts.email),
      code_hash: codeHash,
      expires_at: expiresAt,
      ip_address: ip,
      user_agent: ua,
      signature_mode: opts.mode,
    } as never)
    .select("id")
    .single();
  if (error || !data) throw new Error(`OTP : ${error?.message ?? "inconnue"}`);
  return { id: data.id, code, expiresAt };
}

/** Fetch an OTP row by id, or throw if not found. */
export async function getSignatureOtp(otpId: string): Promise<SignatureOtpRow> {
  const { data } = await supabaseAdmin
    .from("pv_signature_otps")
    .select("*")
    .eq("id", otpId)
    .maybeSingle();
  if (!data) throw new Error("Code introuvable.");
  return data as SignatureOtpRow;
}

/**
 * Verify a code against an OTP id. Increments attempts on failure, marks
 * `used_at` on success.
 */
export async function verifySignatureOtp(opts: {
  otpId: string;
  code: string;
  expectedPvId?: string | null;
  expectedCompanyId?: string | null;
  expectedMode?: SignatureMode;
}): Promise<SignatureOtpRow> {
  // Atomic consume via RPC (row lock + verify + mark used in one tx).
  // Prevents OTP reuse and brute-force attempt-counter bypass under concurrency.
  const codeHash = await sha256Hex(opts.code);
  const { data, error } = await supabaseAdmin.rpc("consume_signature_otp" as never, {
    p_otp_id: opts.otpId,
    p_code_hash: codeHash,
  } as never);
  if (error) throw new Error(`Vérification OTP : ${error.message}`);
  const res = data as { ok: boolean; reason?: string; company_id?: string; pv_id?: string | null; signature_mode?: SignatureMode; email?: string; used_at?: string };
  if (!res?.ok) {
    // Audit reuse / brute-force attempts so they are traceable.
    if (res?.reason === "already_used" || res?.reason === "too_many_attempts" || res?.reason === "expired") {
      const { writeAuditLog } = await import("./audit.server");
      await writeAuditLog({
        companyId: opts.expectedCompanyId ?? null,
        pvId: opts.expectedPvId ?? null,
        entityType: "pv_signature_otp",
        entityId: opts.otpId,
        action: "pv.otp_reuse_blocked",
        metadata: { reason: res.reason, expected_mode: opts.expectedMode ?? null },
        actor: "client",
      });
    }
    switch (res?.reason) {
      case "not_found": throw new Error("Code introuvable.");
      case "already_used": throw new Error("Code déjà utilisé.");
      case "expired": throw new Error("Code expiré. Renvoyez un nouveau code.");
      case "too_many_attempts": throw new Error("Trop de tentatives. Renvoyez un nouveau code.");
      case "bad_code": throw new Error("Code invalide.");
      default: throw new Error("Vérification d'identité impossible.");
    }
  }
  // Optional post-conditions on company / pv / mode.
  if (opts.expectedCompanyId && res.company_id !== opts.expectedCompanyId)
    throw new Error("Code invalide pour cette entreprise.");
  if (opts.expectedPvId && res.pv_id && res.pv_id !== opts.expectedPvId)
    throw new Error("Code invalide pour ce PV.");
  if (opts.expectedMode && res.signature_mode !== opts.expectedMode)
    throw new Error("Mode de vérification incorrect.");

  return {
    id: opts.otpId,
    pv_id: res.pv_id ?? null,
    company_id: res.company_id!,
    email: res.email!,
    code_hash: codeHash,
    attempts: 0,
    expires_at: new Date().toISOString(),
    used_at: res.used_at ?? new Date().toISOString(),
    ip_address: null,
    user_agent: null,
    signature_mode: res.signature_mode!,
    created_at: new Date().toISOString(),
  };
}

/**
 * Assert an OTP has been verified (used_at is set) and matches the given
 * company/pv/mode constraints. Used at signature time.
 */
export async function assertSignatureOtpVerified(opts: {
  otpId: string;
  expectedPvId?: string | null;
  expectedCompanyId?: string | null;
  expectedMode?: SignatureMode;
  /** Max age (ms) between OTP verification (used_at) and signature. Default 30 min. */
  maxAgeMs?: number;
}): Promise<SignatureOtpRow> {
  const otp = await getSignatureOtp(opts.otpId);
  if (opts.expectedCompanyId && otp.company_id !== opts.expectedCompanyId)
    throw new Error("OTP invalide pour cette entreprise.");
  if (opts.expectedPvId && otp.pv_id && otp.pv_id !== opts.expectedPvId)
    throw new Error("OTP invalide pour ce PV.");
  if (opts.expectedMode && otp.signature_mode !== opts.expectedMode)
    throw new Error("Mode OTP incorrect.");
  if (!otp.used_at) throw new Error("Vérification d'identité non validée.");

  // F-12 — Freshness window: refuse a stale OTP (replay window).
  const maxAge = opts.maxAgeMs ?? 30 * 60 * 1000;
  const usedAtMs = new Date(otp.used_at).getTime();
  if (!Number.isFinite(usedAtMs) || Date.now() - usedAtMs > maxAge) {
    throw new Error("Vérification d'identité expirée. Veuillez recommencer.");
  }
  return otp;
}

/** Link a (typically onsite, pre-creation) OTP to its newly-created PV. */
export async function linkSignatureOtpToPv(otpId: string, pvId: string): Promise<void> {
  await supabaseAdmin
    .from("pv_signature_otps")
    .update({ pv_id: pvId } as never)
    .eq("id", otpId);
}

/** Delete OTPs older than 24h (background cleanup helper). */
export async function cleanupExpiredSignatureOtps(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("pv_signature_otps")
    .delete()
    .lt("expires_at", cutoff)
    .select("id");
  if (error) {
    console.error("cleanupExpiredSignatureOtps:", error.message);
    return 0;
  }
  return data?.length ?? 0;
}
