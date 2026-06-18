import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  HardHat,
  AlertCircle,
  Plus,
  Menu as MenuIcon,
  FileText,
  Calendar,
  Users,
  BarChart3,
  Settings,
  Building2,
  UsersRound,
  CreditCard,
  History,
  ShieldCheck,
  LogOut,
} from "lucide-react";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/use-company";
import { useIsPlatformAdmin } from "@/hooks/use-platform-admin";
import { vibrate } from "@/lib/pwa";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { toast } from "sonner";

const bottomItems = [
  { to: "/dashboard", label: "Accueil", icon: LayoutDashboard },
  { to: "/chantiers", label: "Chantiers", icon: HardHat },
  { center: true, to: "/pv/new", label: "Nouveau PV", icon: Plus },
  { to: "/reserves", label: "Réserves", icon: AlertCircle, badge: true },
  { menu: true, label: "Menu", icon: MenuIcon },
] as const;

const fullMenu = [
  { to: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { to: "/pv", label: "Procès-verbaux", icon: FileText },
  { to: "/reserves", label: "Réserves", icon: AlertCircle },
  { to: "/chantiers/calendrier", label: "Calendrier", icon: Calendar },
  { to: "/chantiers", label: "Chantiers", icon: HardHat },
  { to: "/clients", label: "Clients", icon: Users },
  { to: "/statistiques", label: "Statistiques", icon: BarChart3 },
] as const;

const companyMenu = [
  { to: "/parametres", label: "Paramètres", icon: Settings },
  { to: "/entreprise", label: "Entreprise", icon: Building2 },
  { to: "/equipe", label: "Équipe", icon: UsersRound },
  { to: "/billing", label: "Facturation", icon: CreditCard },
  { to: "/historique", label: "Historique", icon: History },
] as const;

/** Native-feel mobile bottom nav with central "+ PV" FAB. Hidden on lg+. */
export function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const { isPlatformAdmin } = useIsPlatformAdmin();
  const [unread, setUnread] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

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

  async function signOut() {
    try {
      const { wipeMyPushDevices } = await import("@/lib/push-devices.functions");
      await wipeMyPushDevices();
    } catch { /* best-effort */ }
    await supabase.auth.signOut();
    toast.success("Déconnecté avec succès");
    setMenuOpen(false);
    navigate({ to: "/login" });
  }

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-background/95 backdrop-blur-md lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Navigation principale"
      >
        {bottomItems.map((it, idx) => {
          const Icon = it.icon;
          const isCenter = "center" in it && it.center;
          const isMenu = "menu" in it && it.menu;
          const active =
            !isCenter && !isMenu &&
            "to" in it && (location.pathname === it.to || location.pathname.startsWith(it.to + "/"));
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

          if (isMenu) {
            return (
              <button
                key={idx}
                type="button"
                aria-label="Ouvrir le menu complet"
                onClick={() => { vibrate(12); setMenuOpen(true); }}
                className="relative flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium text-muted-foreground transition hover:text-foreground"
              >
                <Icon className="h-5 w-5" />
                <span>{it.label}</span>
              </button>
            );
          }

          return (
            <Link
              key={idx}
              to={(it as any).to}
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

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent
          side="right"
          className="w-[88vw] max-w-sm overflow-y-auto p-0"
        >
          <SheetHeader className="border-b border-border px-5 py-4">
            <SheetTitle>Menu</SheetTitle>
            <SheetDescription>Toutes les sections de PVIA</SheetDescription>
          </SheetHeader>

          <div className="p-3">
            <p className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Navigation
            </p>
            {fullMenu.map((i) => {
              const Icon = i.icon;
              const active = location.pathname === i.to || location.pathname.startsWith(i.to + "/");
              return (
                <Link
                  key={i.to}
                  to={i.to}
                  onClick={() => setMenuOpen(false)}
                  className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground/80 hover:bg-muted"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="flex-1 truncate">{i.label}</span>
                </Link>
              );
            })}

            <p className="px-3 pb-1.5 pt-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Entreprise
            </p>
            {companyMenu.map((i) => {
              const Icon = i.icon;
              return (
                <Link
                  key={i.to}
                  to={i.to}
                  onClick={() => setMenuOpen(false)}
                  className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground/80 transition hover:bg-muted"
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 truncate">{i.label}</span>
                </Link>
              );
            })}

            {isPlatformAdmin && (
              <>
                <p className="px-3 pb-1.5 pt-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Administration
                </p>
                <Link
                  to="/admin/dashboard"
                  onClick={() => setMenuOpen(false)}
                  className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground/80 transition hover:bg-muted"
                >
                  <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 truncate">Cockpit admin</span>
                </Link>
              </>
            )}

            <div className="mt-4 border-t border-border pt-3">
              <button
                onClick={signOut}
                className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-destructive transition hover:bg-destructive/10"
              >
                <LogOut className="h-4 w-4" />
                <span>Déconnexion</span>
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
