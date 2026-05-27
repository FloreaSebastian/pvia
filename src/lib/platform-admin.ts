/**
 * Client-safe helper. The authoritative check lives in
 * `requirePlatformAdmin` (server-side). This is only used to
 * decide UI redirects so that non-PVIA users never land on /admin/*.
 */
export const ALLOWED_ADMIN_DOMAIN = "@pvia.fr";

export function isPlatformAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase().endsWith(ALLOWED_ADMIN_DOMAIN);
}
