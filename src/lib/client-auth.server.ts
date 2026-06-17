/**
 * Helpers for the passwordless client-area auth system.
 * Server-only: relies on `process.env`, Web Crypto, and getRequest().
 */
import { getRequest, getRequestHeader, setResponseHeader } from "@tanstack/react-start/server";

export const CLIENT_COOKIE_NAME = "pvia_client_session";
export const CLIENT_SESSION_TTL_SEC = 60 * 60 * 24 * 30; // 30 days
export const CLIENT_CODE_TTL_SEC = 60 * 10; // 10 minutes
export const CLIENT_CODE_MAX_ATTEMPTS = 5;

/** SHA-256 → lowercase hex */
export async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Timing-safe string comparison */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/** Generates a cryptographically strong 6-digit numeric code (zero-padded). */
export function generateNumericCode(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return (arr[0] % 1_000_000).toString().padStart(6, "0");
}

/** 256-bit opaque session token, base64url. */
export function generateSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // base64url
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Parse cookie header into a map. */
function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function readClientCookieToken(): string | null {
  try {
    const cookieHeader = getRequestHeader("cookie");
    const cookies = parseCookies(cookieHeader);
    return cookies[CLIENT_COOKIE_NAME] || null;
  } catch {
    return null;
  }
}

export function setClientCookie(
  token: string,
  maxAgeSec: number = CLIENT_SESSION_TTL_SEC,
  persistent: boolean = true,
) {
  // Detect prod-ish to set Secure flag. Always Secure in non-localhost.
  let secure = true;
  try {
    const host = getRequestHeader("host") ?? "";
    if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) secure = false;
  } catch {}
  const parts = [
    `${CLIENT_COOKIE_NAME}=${token}`,
    "HttpOnly",
    secure ? "Secure" : "",
    "SameSite=Lax",
    "Path=/",
    persistent ? `Max-Age=${maxAgeSec}` : "",
  ].filter(Boolean);
  setResponseHeader("set-cookie", parts.join("; "));
}

export function clearClientCookie() {
  setResponseHeader(
    "set-cookie",
    `${CLIENT_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
  );
}

export function getClientIp(): string | null {
  try {
    const r = getRequest();
    const h = r.headers;
    return (
      h.get("cf-connecting-ip") ||
      h.get("x-real-ip") ||
      (h.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
      null
    );
  } catch {
    return null;
  }
}

export function getClientUA(): string | null {
  try {
    return getRequestHeader("user-agent") || null;
  } catch {
    return null;
  }
}

/**
 * Very rough OS / browser guess from UA — only used for human-readable
 * "Connexion depuis Chrome sur macOS" hint in emails. Never used for security.
 */
export function describeUA(ua: string | null | undefined): string {
  if (!ua) return "appareil inconnu";
  const u = ua.toLowerCase();
  let os = "système inconnu";
  if (u.includes("iphone") || u.includes("ipad")) os = "iOS";
  else if (u.includes("android")) os = "Android";
  else if (u.includes("mac os")) os = "macOS";
  else if (u.includes("windows")) os = "Windows";
  else if (u.includes("linux")) os = "Linux";
  let br = "navigateur";
  if (u.includes("edg/")) br = "Edge";
  else if (u.includes("chrome/") && !u.includes("edg/")) br = "Chrome";
  else if (u.includes("firefox/")) br = "Firefox";
  else if (u.includes("safari/") && !u.includes("chrome/")) br = "Safari";
  return `${br} sur ${os}`;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
