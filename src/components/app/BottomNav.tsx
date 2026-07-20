import { Link, useLocation } from "@tanstack/react-router";
import {
  CalendarDays,
  HardHat,
  AlertCircle,
  FileText,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/use-company";
import { vibrate } from "@/lib/pwa";
import { cn } from "@/lib/utils";

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

// Three copies for the "infinite" illusion. The middle copy is the canonical one.
const COPIES = 3;
const MIDDLE_COPY = 1;

export function BottomNav() {
  const location = useLocation();
  const { activeCompanyId } = useCompany();
  const [unread, setUnread] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const didInitRef = useRef(false);
  const isRepositioningRef = useRef(false);

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
  const activeKey = activeItem?.key ?? null;

  /** Scroll so the active item in the middle copy sits at the exact horizontal center. */
  const centerActive = (behavior: ScrollBehavior) => {
    const scroller = scrollerRef.current;
    if (!scroller || !activeKey) return;
    const el = itemRefs.current[`${MIDDLE_COPY}:${activeKey}`];
    if (!el) return;
    const target = el.offsetLeft + el.offsetWidth / 2 - scroller.clientWidth / 2;
    isRepositioningRef.current = behavior === "auto";
    scroller.scrollTo({ left: Math.max(0, target), behavior });
    if (behavior === "auto") {
      // Release the flag on next frame — the scroll event fires synchronously.
      requestAnimationFrame(() => { isRepositioningRef.current = false; });
    }
  };

  // First paint: instant center — before browser paints — to avoid the "Calendrier first" flash.
  useLayoutEffect(() => {
    if (didInitRef.current) return;
    if (!activeKey) return;
    centerActive("auto");
    didInitRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  // Route change → smooth recentre.
  useEffect(() => {
    if (!didInitRef.current) return;
    centerActive("smooth");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  // Infinite loop: when the user scrolls into the first or last copy, jump silently to the middle copy.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const onScroll = () => {
      if (isRepositioningRef.current) return;
      const totalWidth = scroller.scrollWidth;
      const copyWidth = totalWidth / COPIES;
      const x = scroller.scrollLeft;
      // Reposition when past ~15% of a copy from either end.
      const threshold = copyWidth * 0.15;
      if (x < threshold) {
        isRepositioningRef.current = true;
        scroller.scrollLeft = x + copyWidth;
        requestAnimationFrame(() => { isRepositioningRef.current = false; });
      } else if (x > totalWidth - scroller.clientWidth - threshold) {
        isRepositioningRef.current = true;
        scroller.scrollLeft = x - copyWidth;
        requestAnimationFrame(() => { isRepositioningRef.current = false; });
      }
    };

    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);

  // Build the tripled list.
  const loopedItems: Array<{ copy: number; item: NavItem }> = [];
  for (let c = 0; c < COPIES; c++) {
    for (const item of navigationItems) loopedItems.push({ copy: c, item });
  }

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur-md lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Navigation principale"
    >
      <div
        ref={scrollerRef}
        className="no-scrollbar flex overflow-x-auto overscroll-x-contain"
        style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}
      >
        <ul className="flex" style={{ width: "max-content", margin: 0, padding: 0, listStyle: "none" }}>
          {loopedItems.map(({ copy, item }, idx) => {
            const Icon = item.icon;
            const active = activeKey === item.key;
            const showBadge = item.badge && unread > 0;
            const refKey = `${copy}:${item.key}`;

            return (
              <li key={`${copy}-${item.key}-${idx}`} className="shrink-0">
                <Link
                  to={item.href}
                  ref={(el) => { itemRefs.current[refKey] = el; }}
                  aria-label={item.label}
                  aria-current={active && copy === MIDDLE_COPY ? "page" : undefined}
                  onClick={() => vibrate(12)}
                  className={cn(
                    "relative flex flex-col items-center justify-center gap-1 py-2 min-h-[60px] outline-none transition-colors",
                    active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                  style={{ width: 88, minWidth: 88, flex: "0 0 88px" }}
                >
                  <motion.span
                    animate={active ? { scale: 1.04 } : { scale: 1 }}
                    transition={{ type: "spring", stiffness: 380, damping: 26 }}
                    className={cn(
                      "relative grid place-items-center rounded-full transition-colors",
                      active ? "h-9 w-9 bg-primary/12 text-primary" : "h-9 w-9 text-muted-foreground",
                    )}
                  >
                    <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 2} />
                    {showBadge && (
                      <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[9px] font-semibold text-destructive-foreground ring-2 ring-background">
                        {unread > 9 ? "9+" : unread}
                      </span>
                    )}
                  </motion.span>
                  <span className={cn("max-w-full truncate text-[11px] leading-none", active ? "font-semibold" : "font-medium")}>
                    {item.label}
                  </span>
                  {active && copy === MIDDLE_COPY && (
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
      </div>
    </nav>
  );
}
