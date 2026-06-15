import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/support")({
  component: () => <Outlet />,
  beforeLoad: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw redirect({ to: "/login" });
    const { isPlatformAdminEmail } = await import("@/lib/platform-admin");
    if (!isPlatformAdminEmail(user.email)) throw redirect({ to: "/admin/forbidden" });
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id).in("role", ["platform_admin","admin"]).limit(1).maybeSingle();
    if (!data) throw redirect({ to: "/admin/forbidden" });
  },
});
