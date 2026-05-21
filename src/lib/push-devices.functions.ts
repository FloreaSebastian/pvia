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
      .select("id,endpoint,user_agent,last_seen_at,created_at,company_id")
      .eq("user_id", context.userId)
      .order("last_seen_at", { ascending: false });
    return { devices: data ?? [] };
  });

const DelSchema = z.object({ id: z.string().uuid() });
export const deleteMyPushDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => DelSchema.parse(i))
  .handler(async ({ data, context }) => {
    await supabaseAdmin
      .from("push_subscriptions")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
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
