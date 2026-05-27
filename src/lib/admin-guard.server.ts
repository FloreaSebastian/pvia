import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ALLOWED_ADMIN_DOMAIN = "@pvia.fr";

export function isPlatformAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase().endsWith(ALLOWED_ADMIN_DOMAIN);
}

/**
 * Server-side guard: throws if the user is not a platform admin.
 * Requires BOTH:
 *  - user_roles.role = 'admin'
 *  - email ending with @pvia.fr
 * Logs an audit entry on denial.
 */
export async function requirePlatformAdmin(userId: string): Promise<void> {
  const DENY = "Accès réservé à l'équipe PVIA.";
  if (!userId) throw new Error(DENY);

  // Fetch user (for email) and role in parallel
  const [{ data: userRes }, { data: roleRow, error: roleErr }] = await Promise.all([
    supabaseAdmin.auth.admin.getUserById(userId),
    supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle(),
  ]);

  if (roleErr) throw new Error(roleErr.message);

  const email = userRes?.user?.email ?? null;
  const emailOk = isPlatformAdminEmail(email);
  const roleOk = !!roleRow;

  if (!emailOk || !roleOk) {
    // Best-effort audit log; never block on logging failure
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
