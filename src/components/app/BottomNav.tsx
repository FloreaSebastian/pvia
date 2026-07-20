import { Link, useLocation } from "@tanstack/react-router";
import {
  CalendarDays,
  HardHat,
  AlertCircle,
  FileText,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/use-company";
import { vibrate } from "@/lib/pwa";
import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  icon: LucideIcon;
  href: string;
  match: readonly string[];
  exclude?: readonly string[];
  badge?: boolean;
};

const mobileNavigationItems: readonly NavItem[] = [
  {
    label: "Calendrier",
    icon: CalendarDays,
    href: "/chantiers/calendrier",
    match: ["/chantiers/calendrier"],
  },
  {
    label: "Chantiers",
    icon: HardHat,
    href: "/chantiers",
    match: ["/chantiers"],
    exclude: ["/chantiers/calendrier"],
  },
  {
    label: "PV",
    icon: FileText,
    href: "/pv",
    match: ["/pv"],
  },
  {
    label: "Réserves",
    icon: AlertCircle,
    href: "/reserves",
    match: ["/reserves"],
    badge: true,
  },
  {
    label: "Clients",
    icon: Users,
    href: "/clients",
    match: ["/clients"],
  },
] as const;

function isActive(item: NavItem, path: string): boolean {
  const matched = item.match.some((m) => path === m || path.startsWith(m + "/"));
  if (!matched) return false;
  if (item.exclude?.some((e) => path === e || path.startsWith(e + "/"))) return false;
  return true;
}

/** Native-feel mobile bottom nav: horizontal scrollable, active item auto-centered. Hidden on lg+. */
export function BottomNav() {
  const location = useLocation();
  const { activeCompanyId } = useCompany();
  const [unread, setUnread] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLAnchorElement | null>>({});

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

  // Determine active
  const path = location.pathname;
  const activeItem = mobileNavigationItems.find((it) => isActive(it, path));
  const activeKey = activeItem?.href ?? null;

  // Center the active item — after route change or first mount.
  useEffect(() => {
    if (!activeKey) return;
    const el = itemRefs.current[activeKey];
    const scroller = scrollerRef.current;
    if (!el || !scroller) return;

    // Compute manually so we scroll only the horizontal scroller (not the page).
    const scrollerRect = scroller.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const currentLeft = scroller.scrollLeft;
    const delta =
      elRect.left - scrollerRect.left - (scrollerRect.width / 2 - elRect.width / 2);
    const target = Math.max(0, currentLeft + delta);

    // Instant on first paint to avoid a visible jump, smooth on later route changes.
    const behavior: ScrollBehavior = scroller.dataset.initialized ? "smooth" : "auto";
    scroller.scrollTo({ left: target, behavior });
    scroller.dataset.initialized = "1";
  }, [activeKey]);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur-md lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Navigation principale"
    >
      <div
        ref={scrollerRef}
        className="no-scrollbar flex snap-x snap-proximity overflow-x-auto overscroll-x-contain"
        style={{ scrollbarWidth: "none" }}
      >
        {/* Left spacer so the first item can center */}
        <div aria-hidden className="shrink-0" style={{ width: "40vw" }} />

        {mobileNavigationItems.map((it) => {
          const Icon = it.icon;
          const active = activeKey === it.href;
          const showBadge = it.badge && unread > 0;

          return (
            <Link
              key={it.href}
              to={it.href}
              ref={(el) => { itemRefs.current[it.href] = el; }}
              aria-label={it.label}
              aria-current={active ? "page" : undefined}
              onClick={() => vibrate(12)}
              className={cn(
                "relative flex shrink-0 snap-center flex-col items-center justify-center gap-1 px-3 py-2 min-w-[80px] min-h-[56px] outline-none",
                "transition-colors",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <motion.span
                animate={active ? { scale: 1.08 } : { scale: 1 }}
                transition={{ type: "spring", stiffness: 380, damping: 26 }}
                className={cn(
                  "relative grid place-items-center rounded-full transition-colors",
                  active
                    ? "h-10 w-10 bg-primary/12 text-primary"
                    : "h-9 w-9 text-muted-foreground",
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
                  "max-w-full truncate text-[11px] leading-none",
                  active ? "font-semibold" : "font-medium",
                )}
              >
                {it.label}
              </span>
              {active && (
                <motion.span
                  layoutId="bn-active-underline"
                  className="absolute bottom-1 h-0.5 w-6 rounded-full bg-primary"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
            </Link>
          );
        })}

        {/* Right spacer so the last item can center */}
        <div aria-hidden className="shrink-0" style={{ width: "40vw" }} />
      </div>
    </nav>
  );
}
