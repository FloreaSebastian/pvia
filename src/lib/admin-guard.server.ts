import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Server-side guard: throws if the user is not a platform admin.
 * Use in every server function exposing admin-only data.
 */
export async function requirePlatformAdmin(userId: string): Promise<void> {
  if (!userId) throw new Error("Accès réservé aux administrateurs de la plateforme.");
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Accès réservé aux administrateurs de la plateforme.");
}
