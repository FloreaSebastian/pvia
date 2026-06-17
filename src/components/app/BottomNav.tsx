import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, HardHat, AlertCircle, Bell, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/use-company";
import { vibrate } from "@/lib/pwa";

const items = [
  { to: "/dashboard", label: "Accueil", icon: LayoutDashboard },
  { to: "/chantiers", label: "Chantiers", icon: HardHat },
  { center: true, to: "/pv/new", label: "Nouveau PV", icon: Plus },
  { to: "/reserves", label: "Réserves", icon: AlertCircle },
  { to: "/dashboard", label: "Alertes", icon: Bell, badge: true },
] as const;

/** Native-feel mobile bottom nav with central "+ PV" FAB. Hidden on lg+. */
export function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
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
        const isCenter = "center" in it && it.center;
        const active = !isCenter && (location.pathname === it.to || location.pathname.startsWith(it.to + "/"));
        const showBadge = "badge" in it && it.badge && unread > 0;

        if (isCenter) {
          return (
            <button
              key={idx}
              type="button"
              aria-label="Créer un nouveau PV"
              onClick={() => { vibrate([10, 20, 15]); navigate({ to: it.to }); }}
              className="relative flex flex-col items-center justify-end pb-2"
            >
              <motion.span
                whileTap={{ scale: 0.92 }}
                whileHover={{ scale: 1.04 }}
                className="absolute -top-5 grid h-14 w-14 place-items-center rounded-full bg-brand-gradient text-primary-foreground shadow-brand ring-4 ring-background"
              >
                <Icon className="h-6 w-6" strokeWidth={2.5} />
              </motion.span>
              <span className="mt-9 text-[10px] font-semibold text-foreground">PV</span>
            </button>
          );
        }

        return (
          <Link
            key={idx}
            to={it.to}
            onClick={() => vibrate(12)}
            className={`relative flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition ${
              active ? "text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <motion.span
              animate={active ? { y: -2, scale: 1.05 } : { y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 380, damping: 26 }}
            >
              <Icon className="h-5 w-5" />
            </motion.span>
            <span>{it.label}</span>
            {showBadge && (
              <span className="absolute right-[22%] top-1 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[9px] font-semibold text-destructive-foreground">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
            {active && (
              <motion.span
                layoutId="bn-active"
                className="absolute inset-x-6 top-0 h-0.5 rounded-b-full bg-primary"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
