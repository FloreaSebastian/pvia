import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  FileText,
  Users,
  HardHat,
  LogOut,
  Plus,
  Menu,
  X,
  Search,
  HelpCircle,
  AlertCircle,
  Building2,
  UsersRound,
  ShieldCheck,
  BarChart3,
  CreditCard,
  Calendar,
  Settings,
  ChevronDown,
  Activity,
  Rocket,
  ClipboardCheck,
  Mail,
  Shield,
  History,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { CompanySwitcher } from "@/components/app/CompanySwitcher";
import { NotificationsBell } from "@/components/app/NotificationsBell";
import { InstallPrompt } from "@/components/app/InstallPrompt";
import { BottomNav } from "@/components/app/BottomNav";
import { SuspensionBanner } from "@/components/app/SuspensionBanner";
import { useCompany } from "@/hooks/use-company";
import { useViewport } from "@/hooks/use-viewport";
import { ImmersiveProvider, useImmersive } from "@/hooks/use-immersive";
import { GlobalSearch } from "@/components/app/GlobalSearch";
import { isAdminRole, isOwnerRole } from "@/lib/roles";
import { useSuspension } from "@/hooks/use-suspension";
import { useIsPlatformAdmin } from "@/hooks/use-platform-admin";
import { getCompanyVisualIdentity } from "@/lib/company-visual";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const mainNav = [
  { to: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { to: "/pv", label: "Procès-verbaux", icon: FileText },
  { to: "/reserves", label: "Réserves", icon: AlertCircle },
  { to: "/chantiers/calendrier", label: "Calendrier", icon: Calendar },
  { to: "/chantiers", label: "Chantiers", icon: HardHat },
  { to: "/clients", label: "Clients", icon: Users },
  { to: "/statistiques", label: "Statistiques", icon: BarChart3 },
] as const;

type CompanyMenuItem = {
  to: string;
  label: string;
  icon: typeof Settings;
  /** Restreint au directeur uniquement. */
  ownerOnly?: boolean;
  /** Restreint aux rôles administrateurs (directeur, responsable_exploitation). */
  adminOnly?: boolean;
};

const companyMenu: readonly CompanyMenuItem[] = [
  { to: "/parametres", label: "Paramètres", icon: Settings },
  { to: "/entreprise", label: "Entreprise", icon: Building2, adminOnly: true },
  { to: "/equipe", label: "Équipe", icon: UsersRound, adminOnly: true },
  { to: "/billing", label: "Facturation", icon: CreditCard, ownerOnly: true },
  { to: "/dashboard", label: "Aide & support", icon: HelpCircle },
] as const;

const adminMenu = [
  { to: "/admin/dashboard", label: "Cockpit admin", icon: ShieldCheck },
  { to: "/historique", label: "Historique entreprise", icon: History },
  { to: "/parametres/audit", label: "Audit", icon: Shield },
  { to: "/admin/monitoring", label: "Monitoring", icon: Activity },
  { to: "/admin/go-live", label: "Go Live", icon: Rocket },
  { to: "/admin/production-audit", label: "Production Audit", icon: ClipboardCheck },
  { to: "/admin/compliance", label: "Compliance", icon: ShieldCheck },
  { to: "/admin/emails", label: "Emails", icon: Mail },
] as const;


export function AppLayout({ children, userEmail }: { children: React.ReactNode; userEmail?: string | null }) {
  return (
    <ImmersiveProvider>
      <AppShell userEmail={userEmail}>{children}</AppShell>
    </ImmersiveProvider>
  );
}

function AppShell({ children, userEmail }: { children: React.ReactNode; userEmail?: string | null }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { activeCompanyId, can } = useCompany();
  const { suspended } = useSuspension();
  const { isCompact } = useViewport();
  const { immersive } = useImmersive();
  const asideRef = useRef<HTMLElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const canWrite = can("manage") && !suspended;

  // La sidebar n'est visible en permanence qu'à partir de `lg` (1024px) :
  // on aligne la fermeture automatique du tiroir sur ce même seuil pour ne
  // jamais laisser l'utilisateur sans navigation entre 900 et 1023px.
  const [hasFixedSidebar, setHasFixedSidebar] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => {
      setHasFixedSidebar(mq.matches);
      if (mq.matches) setOpen(false);
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Tiroir mobile : Échap ferme, scroll du corps verrouillé, focus déplacé
  // dans le tiroir puis restitué au bouton d'ouverture.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusables = () =>
      Array.from(
        asideRef.current?.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);

    focusables()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      const activeInside = asideRef.current?.contains(document.activeElement);
      if (!activeInside) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      (menuButtonRef.current ?? previous)?.focus?.();
    };
  }, [open]);

  // Raccourci global ⌘K / Ctrl+K — cohérent avec l'indicateur affiché.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function signOut() {
    try {
      const { wipeMyPushDevices } = await import("@/lib/push-devices.functions");
      await wipeMyPushDevices();
    } catch { /* network/offline — best-effort */ }
    await supabase.auth.signOut();
    toast.success("Déconnecté avec succès");
    navigate({ to: "/login" });
  }

  const initial = (userEmail ?? "U").slice(0, 1).toUpperCase();

  const isActive = (to: string) => {
    const p = location.pathname;
    if (to === "/chantiers") return p === "/chantiers" || (p.startsWith("/chantiers/") && !p.startsWith("/chantiers/calendrier"));
    return p === to || p.startsWith(to + "/");
  };

  // Hors écran (tiroir fermé sur mobile) ou masquée par une vue immersive :
  // la navigation latérale ne doit plus être atteignable au clavier.
  const asideInert = immersive || (!open && !hasFixedSidebar);

  return (
    <div className="min-h-dvh bg-muted/30">
      {/* Mobile overlay */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          aria-hidden="true"
          className="fixed inset-0 z-30 bg-foreground/50 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        ref={asideRef}
        aria-label="Navigation latérale"
        id="pvia-sidebar"
        {...(asideInert ? { inert: "" as unknown as boolean } : {})}
        className={`fixed inset-y-0 left-0 z-40 flex w-[min(18rem,88vw)] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform ${
          open ? "translate-x-0 shadow-elevation-xl" : "-translate-x-full"
        } ${immersive ? "lg:-translate-x-full" : "lg:translate-x-0"}`}
      >
        {/* Brand header */}
        <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-5">
          <BrandLogo withLink />
          <button
            onClick={() => setOpen(false)}
            className="touch-target grid place-items-center rounded-md text-muted-foreground transition hover:bg-sidebar-accent hover:text-foreground lg:hidden"
            aria-label="Fermer le menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-3 pt-4">
          <CompanySwitcher />
        </div>

        {canWrite && (
          <div className="px-3 pt-3">
            <Link to="/pv/new" search={{ fresh: 1 }} onClick={() => setOpen(false)} className="block">
              <Button className="min-h-11 w-full shadow-brand lg:min-h-9" size="sm">
                <Plus className="h-4 w-4" /> Nouveau PV
              </Button>
            </Link>
          </div>
        )}

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3" aria-label="Navigation principale (latérale)">
          <p className="px-3 pb-1.5 pt-3 font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Navigation
          </p>
          {mainNav.map((i) => {
            const active = isActive(i.to);
            const Icon = i.icon;
            return (
              <Link
                key={i.to}
                to={i.to}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={`group relative flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all lg:min-h-9 ${
                  active
                    ? "bg-primary text-primary-foreground shadow-brand"
                    : "text-foreground/75 hover:bg-sidebar-accent hover:text-foreground"
                }`}
              >
                {active && (
                  <span className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary" aria-hidden />
                )}
                <Icon className={`h-4 w-4 transition-transform group-hover:scale-110 ${active ? "" : "text-muted-foreground"}`} />
                <span className="flex-1 truncate">{i.label}</span>
              </Link>
            );
          })}

        </nav>

        {/* Footer: company menu */}
        <div className="border-t border-sidebar-border p-3">
          <CompanyMenu
            userEmail={userEmail}
            initial={initial}
            onPick={() => setOpen(false)}
            onSignOut={signOut}
          />
        </div>
      </aside>

      <div className={immersive ? "" : "lg:pl-72"}>
        <header className="sticky top-0 z-20 flex h-16 min-w-0 items-center gap-2 border-b border-border bg-background/80 px-3 pt-[env(safe-area-inset-top)] backdrop-blur-md sm:gap-3 sm:px-4 lg:px-8">
          <button
            ref={menuButtonRef}
            onClick={() => setOpen(true)}
            className="touch-target grid shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground lg:hidden"
            aria-label="Ouvrir le menu"
            aria-expanded={open}
            aria-controls="pvia-sidebar"
          >
            <Menu className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Rechercher un PV, un chantier ou un client"
            aria-keyshortcuts="Meta+K Control+K"
            className="relative hidden h-9 min-w-0 max-w-md flex-1 items-center rounded-md border border-border bg-muted/40 pl-9 pr-2.5 text-left text-sm text-muted-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:flex"
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">
              {isCompact ? "Rechercher…" : "Rechercher un PV, chantier, client…"}
            </span>
            <kbd className="pointer-events-none ml-2 hidden select-none items-center gap-0.5 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground lg:inline-flex">
              ⌘K
            </kbd>
          </button>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label="Rechercher"
              className="touch-target grid place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground md:hidden"
            >
              <Search className="h-5 w-5" />
            </button>
            {canWrite && (
              <Link to="/pv/new" search={{ fresh: 1 }} className="hidden xs:block">
                <Button size="sm" className="touch-target shadow-elevation-sm">
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">Créer un PV</span>
                </Button>
              </Link>
            )}
            <NotificationsBell />

            <div
              className="grid h-9 w-9 place-items-center rounded-full bg-brand-gradient text-xs font-semibold text-primary-foreground shadow-elevation-sm"
              title={userEmail ?? undefined}
              aria-hidden="true"
            >
              {initial}
            </div>
          </div>
        </header>

        <SuspensionBanner />

        <main className="pvia-container min-w-0 py-4 pb-[max(6rem,calc(5rem+env(safe-area-inset-bottom)))] lg:py-8 lg:pb-12">
          {children}
        </main>
      </div>
      <BottomNav />
      <InstallPrompt companyId={activeCompanyId} />
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}


function CompanyMenu({
  userEmail,
  initial,
  onPick,
  onSignOut,
}: {
  userEmail?: string | null;
  initial: string;
  onPick: () => void;
  onSignOut: () => void;
}) {
  const { memberships, activeCompanyId, activeRole } = useCompany();
  const isOwner = isOwnerRole(activeRole);
  const isAdmin = isAdminRole(activeRole);
  const visibleCompanyMenu = companyMenu.filter((i) => {
    if (i.ownerOnly && !isOwner) return false;
    if (i.adminOnly && !isAdmin) return false;
    return true;
  });
  const { isPlatformAdmin } = useIsPlatformAdmin();
  const active = memberships.find((m) => m.company_id === activeCompanyId);
  const companyName = active?.company.name ?? "Entreprise";
  // UI compacte → icône uniquement, jamais logo en remplacement.
  const logoUrl = getCompanyVisualIdentity(active?.company).displayIconUrl;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/40 px-2 py-2 text-left transition hover:bg-sidebar-accent">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="h-9 w-9 rounded-md object-cover" />
          ) : (
            <div className="grid h-9 w-9 place-items-center rounded-md bg-brand-gradient text-sm font-semibold text-primary-foreground">
              {initial}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-foreground">{companyName}</p>
            <p className="truncate text-[10px] text-muted-foreground">{userEmail ?? "Utilisateur"}</p>
          </div>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-64">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Entreprise
        </DropdownMenuLabel>
        {visibleCompanyMenu.map((i) => {
          const Icon = i.icon;
          return (
            <DropdownMenuItem key={i.to} asChild>
              <Link to={i.to} onClick={onPick} className="cursor-pointer">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span>{i.label}</span>
              </Link>
            </DropdownMenuItem>
          );
        })}

        {isPlatformAdmin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Administration PVIA
            </DropdownMenuLabel>
            {adminMenu.map((i) => {
              const Icon = i.icon;
              return (
                <DropdownMenuItem key={i.to} asChild>
                  <Link to={i.to} onClick={onPick} className="cursor-pointer">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span>{i.label}</span>
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onSignOut} className="cursor-pointer text-destructive focus:text-destructive">
          <LogOut className="h-4 w-4" />
          <span>Déconnexion</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
