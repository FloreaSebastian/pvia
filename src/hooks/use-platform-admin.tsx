import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isPlatformAdminEmail } from "@/lib/platform-admin";

/**
 * Client-side helper to gate UI for platform administrators only
 * (PVIA team). Authoritative checks remain on the server side.
 */
export function useIsPlatformAdmin() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !isPlatformAdminEmail(user.email)) {
          if (!cancelled) { setIsAdmin(false); setLoading(false); }
          return;
        }
        const { data } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("role", "platform_admin")
          .maybeSingle();
        if (!cancelled) { setIsAdmin(!!data); setLoading(false); }
      } catch {
        if (!cancelled) { setIsAdmin(false); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { isPlatformAdmin: isAdmin, loading };
}
