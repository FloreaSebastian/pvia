import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ALLOWED_ADMIN_DOMAIN = "@pvia.fr";

/** Rôles considérés comme administrateur plateforme (transition). */
const PLATFORM_ADMIN_ROLES = ["platform_admin", "admin"] as const satisfies ReadonlyArray<"platform_admin" | "admin">;

export function isPlatformAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase().endsWith(ALLOWED_ADMIN_DOMAIN);
}

/**
 * Server-side guard: throws if the user is not a platform admin.
 *
 * Conditions cumulatives:
 *  - email se terminant par "@pvia.fr"
 *  - user_roles.role IN ('platform_admin','admin')
 *    ('admin' accepté en transition — voir migration de promotion contact@pvia.fr)
 *
 * Loggue une entrée d'audit en cas de refus.
 */
export async function requirePlatformAdmin(userId: string): Promise<void> {
  const DENY = "Accès réservé à l'équipe PVIA.";
  if (!userId) throw new Error(DENY);

  const [{ data: userRes }, { data: roleRows, error: roleErr }] = await Promise.all([
    supabaseAdmin.auth.admin.getUserById(userId),
    supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .in("role", PLATFORM_ADMIN_ROLES as unknown as string[]),
  ]);

  if (roleErr) throw new Error(roleErr.message);

  const email = userRes?.user?.email ?? null;
  const emailOk = isPlatformAdminEmail(email);
  const roleOk = Array.isArray(roleRows) && roleRows.length > 0;

  if (!emailOk || !roleOk) {
    try {
      await supabaseAdmin.from("audit_logs").insert({
        user_id: userId,
        action: "admin.access_denied_domain",
        entity_type: "platform_admin",
        metadata: { email, role_ok: roleOk, email_ok: emailOk },
      });
    } catch {}
    throw new Error(DENY);
  }
}
