import { Link, useLocation } from "@tanstack/react-router";
import { LayoutDashboard, Smartphone, FileText, AlertCircle, Bell } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/use-company";
import { vibrate } from "@/lib/pwa";

const items = [
  { to: "/dashboard", label: "Accueil", icon: LayoutDashboard },
  { to: "/terrain", label: "Terrain", icon: Smartphone },
  { to: "/pv", label: "PV", icon: FileText },
  { to: "/reserves", label: "Réserves", icon: AlertCircle },
  { to: "/dashboard", label: "Alertes", icon: Bell, badge: true },
] as const;

/** Native-feel mobile bottom nav. Hidden on lg+. */
export function BottomNav() {
  const location = useLocation();
  const { activeCompanyId } = useCompany();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!activeCompanyId) return;
    let cancelled = false;
    const load = async () => {
      const { count } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("company_id", activeCompanyId)
        .eq("read", false);
      if (!cancelled) setUnread(count ?? 0);
    };
    load();
    const ch = supabase
      .channel(`bn-${activeCompanyId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `company_id=eq.${activeCompanyId}` },
        () => load(),
      )
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [activeCompanyId]);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-background/95 backdrop-blur-md lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Navigation principale"
    >
      {items.map((it, idx) => {
        const Icon = it.icon;
        const active = location.pathname === it.to || location.pathname.startsWith(it.to + "/");
        const showBadge = "badge" in it && it.badge && unread > 0;
        return (
          <Link
            key={idx}
            to={it.to}
            onClick={() => vibrate(15)}
            className={`relative flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition ${
              active ? "text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-5 w-5" />
            <span>{it.label}</span>
            {showBadge && (
              <span className="absolute right-[22%] top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
            {active && <span className="absolute inset-x-6 top-0 h-0.5 rounded-b-full bg-primary" />}
          </Link>
        );
      })}
    </nav>
  );
}
