/** Server fns for the user-facing "Notifications" settings page:
 *  list / delete the current user's push subscriptions, and wipe them
 *  all (used on logout to prevent stale fan-outs to a previous account). */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const listMyPushDevices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await supabaseAdmin
      .from("push_subscriptions")
      .select("id,user_agent,last_seen_at,created_at")
      .eq("user_id", context.userId)
      .order("last_seen_at", { ascending: false });
    // NB: l'endpoint push et l'entreprise ne sont jamais renvoyés au client
    // (donnée technique sensible, inutile à l'affichage).
    return { devices: data ?? [] };
  });

const DelSchema = z.object({ id: z.string().uuid() });
export const deleteMyPushDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => DelSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await supabaseAdmin
      .from("push_subscriptions")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) {
      console.error("[push-devices] delete failed", error);
      throw new Error("Impossible de supprimer cet appareil.");
    }
    return { ok: true };
  });

/** Used by the client right before signOut() to drop ALL the user's
 *  push subscriptions (any company), so the next account that signs in
 *  on the same device does not inherit the previous user's endpoints. */
export const wipeMyPushDevices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await supabaseAdmin
      .from("push_subscriptions")
      .delete()
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
