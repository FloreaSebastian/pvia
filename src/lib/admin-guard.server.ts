import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ALLOWED_ADMIN_DOMAIN = "@pvia.fr";

export function isPlatformAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase().endsWith(ALLOWED_ADMIN_DOMAIN);
}

/**
 * Server-side guard plateforme — règle FINALE (post-cleanup) :
 *  - email se terminant par "@pvia.fr"
 *  - user_roles.role = 'platform_admin'
 *
 * Le rôle 'admin' n'est plus accepté pour le cockpit plateforme.
 * Loggue un audit en cas de refus.
 */
export async function requirePlatformAdmin(userId: string): Promise<void> {
  const DENY = "Accès réservé à l'équipe PVIA.";
  if (!userId) throw new Error(DENY);

  const [{ data: userRes }, { data: roleRow, error: roleErr }] = await Promise.all([
    supabaseAdmin.auth.admin.getUserById(userId),
    supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "platform_admin")
      .maybeSingle(),
  ]);

  if (roleErr) throw new Error(roleErr.message);

  const email = userRes?.user?.email ?? null;
  const emailOk = isPlatformAdminEmail(email);
  const roleOk = !!roleRow;

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

