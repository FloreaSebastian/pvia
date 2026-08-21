import { Link, useLocation } from "@tanstack/react-router";
import {
  CalendarDays,
  HardHat,
  AlertCircle,
  FileText,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/use-company";
import { vibrate } from "@/lib/pwa";
import { cn } from "@/lib/utils";
import { useImmersive } from "@/hooks/use-immersive";

type NavItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  href: string;
  /** Route path prefixes that should mark this item active. */
  matches: readonly string[];
  badge?: boolean;
};

const navigationItems: readonly NavItem[] = [
  { key: "calendrier", label: "Calendrier", icon: CalendarDays, href: "/chantiers/calendrier", matches: ["/chantiers/calendrier"] },
  { key: "chantiers",  label: "Chantiers",  icon: HardHat,      href: "/chantiers",             matches: ["/chantiers"] },
  { key: "pv",         label: "PV",         icon: FileText,     href: "/pv",                    matches: ["/pv"] },
  { key: "reserves",   label: "Réserves",   icon: AlertCircle,  href: "/reserves",              matches: ["/reserves"], badge: true },
  { key: "clients",    label: "Clients",    icon: Users,        href: "/clients",               matches: ["/clients"] },
] as const;

/** Return the parent nav item for the current pathname. Order matters: more-specific matches first. */
function getActiveMobileNavItem(pathname: string): NavItem | null {
  // Calendrier must win over Chantiers because /chantiers/calendrier starts with /chantiers.
  const ordered = [
    navigationItems[0], // calendrier
    navigationItems[2], // pv
    navigationItems[3], // reserves
    navigationItems[4], // clients
    navigationItems[1], // chantiers (catch-all last among /chantiers/*)
  ];
  for (const it of ordered) {
    if (it.matches.some((m) => pathname === m || pathname.startsWith(m + "/"))) return it;
  }
  return null;
}

export function BottomNav() {
  const location = useLocation();
  const { activeCompanyId } = useCompany();
  const [unread, setUnread] = useState(0);
  // Vue immersive active (plein écran calendrier, etc.) : la barre s'efface.
  const { immersive } = useImmersive();

  // Réserves badge
  useEffect(() => {
    if (!activeCompanyId) return;
    let cancelled = false;

    const load = async () => {
      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes.user?.id;
      if (!userId) { if (!cancelled) setUnread(0); return; }
      const actionableStatuses = ["ouverte", "en_cours", "en_attente_validation"];
      const { count } = await supabase
        .from("pv_reserves")
        .select("id", { count: "exact", head: true })
        .eq("company_id", activeCompanyId)
        .in("status", actionableStatuses)
        .or(`assigned_to.eq.${userId},assigned_to.is.null`);
      if (!cancelled) setUnread(count ?? 0);
    };

    load();
    const ch = supabase
      .channel(`bn-reserves-${activeCompanyId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pv_reserves", filter: `company_id=eq.${activeCompanyId}` },
        () => load(),
      )
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [activeCompanyId]);

  const activeItem = getActiveMobileNavItem(location.pathname);
  if (immersive) return null;
  const activeKey = activeItem?.key ?? null;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur-md lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Navigation principale"
    >
      <ul className="mx-auto grid w-full max-w-3xl grid-cols-5 list-none p-0 m-0">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const active = activeKey === item.key;
          const showBadge = item.badge && unread > 0;

          return (
            <li key={item.key} className="min-w-0">
              <Link
                to={item.href}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                onClick={() => vibrate(12)}
                className={cn(
                  "relative flex w-full min-w-0 flex-col items-center justify-center gap-1 px-1 py-2 min-h-[60px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <motion.span
                  animate={active ? { scale: 1.04 } : { scale: 1 }}
                  transition={{ type: "spring", stiffness: 380, damping: 26 }}
                  className={cn(
                    "relative grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors",
                    active ? "bg-primary/12 text-primary" : "text-muted-foreground",
                  )}
                >
                  <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 2} />
                  {showBadge && (
                    <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[9px] font-semibold text-destructive-foreground ring-2 ring-background">
                      {unread > 9 ? "9+" : unread}
                    </span>
                  )}
                </motion.span>
                <span
                  className={cn(
                    "max-w-full truncate text-[10px] leading-none sm:text-[11px]",
                    active ? "font-semibold" : "font-medium",
                  )}
                >
                  {item.label}
                </span>
                {active && (
                  <motion.span
                    layoutId="bn-active-underline"
                    className="absolute bottom-1 h-0.5 w-6 rounded-full bg-primary"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
