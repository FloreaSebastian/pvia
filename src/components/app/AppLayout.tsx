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
  Sparkles,
  AlertCircle,
  Building2,
  UsersRound,
  ShieldCheck,
  BarChart3,
  CreditCard,
  Calendar,
  Settings,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { CompanySwitcher } from "@/components/app/CompanySwitcher";
import { NotificationsBell } from "@/components/app/NotificationsBell";
import { InstallPrompt } from "@/components/app/InstallPrompt";
import { BottomNav } from "@/components/app/BottomNav";
import { SuspensionBanner } from "@/components/app/SuspensionBanner";
import { useCompany } from "@/hooks/use-company";
import { useSuspension } from "@/hooks/use-suspension";

const mainNav = [
  { to: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { to: "/pv", label: "Procès-verbaux", icon: FileText },
  { to: "/clients", label: "Clients", icon: Users },
  { to: "/chantiers", label: "Chantiers", icon: HardHat },
  { to: "/chantiers/calendrier", label: "Calendrier chantier", icon: Calendar },
  { to: "/reserves", label: "Réserves", icon: AlertCircle },
  { to: "/historique", label: "Historique", icon: ShieldCheck },
  { to: "/statistiques", label: "Statistiques", icon: BarChart3 },
  { to: "/parametres", label: "Paramètres", icon: Settings },
] as const;

const secondaryNav = [
  { to: "/entreprise", label: "Entreprise", icon: Building2 },
  { to: "/equipe", label: "Équipe", icon: UsersRound },
  { to: "/billing", label: "Facturation", icon: CreditCard },
  { to: "/dashboard", label: "Aide & support", icon: HelpCircle },
] as const;


export function AppLayout({ children, userEmail }: { children: React.ReactNode; userEmail?: string | null }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { activeCompanyId } = useCompany();
  const { suspended } = useSuspension();

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


  return (
    <div className="min-h-screen bg-muted/30">
      {/* Mobile overlay */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-foreground/50 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform lg:translate-x-0 ${
          open ? "translate-x-0 shadow-elevation-xl" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {/* Brand header */}
        <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-5">
          <BrandLogo withLink />
          <button
            onClick={() => setOpen(false)}
            className="lg:hidden rounded-md p-1.5 text-muted-foreground transition hover:bg-sidebar-accent hover:text-foreground"
            aria-label="Fermer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-3 pt-4">
          <CompanySwitcher />
        </div>

        <div className="px-3 pt-3">
          <Link to="/pv/new" onClick={() => setOpen(false)}>
            <Button className="w-full shadow-brand" size="sm">
              <Plus className="h-4 w-4" /> Nouveau PV
            </Button>
          </Link>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
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
                className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
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

          <p className="px-3 pb-1.5 pt-5 font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Configuration
          </p>
          {secondaryNav.map((i, idx) => {
            const active = isActive(i.to);
            const Icon = i.icon;
            return (
              <Link
                key={idx}
                to={i.to}
                onClick={() => setOpen(false)}
                className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                  active
                    ? "bg-sidebar-accent text-foreground"
                    : "text-foreground/70 hover:bg-sidebar-accent hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{i.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer / Upgrade card + profile */}
        <div className="border-t border-sidebar-border p-3">
          <div className="mb-3 overflow-hidden rounded-xl border border-primary/20 bg-brand-gradient p-3 text-primary-foreground shadow-brand">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider">
              <Sparkles className="h-3.5 w-3.5" /> Essai Pro
            </div>
            <p className="mt-1 text-[11px] leading-snug text-primary-foreground/85">
              14 jours offerts — toutes les fonctionnalités premium.
            </p>
            <Link to="/billing" onClick={() => setOpen(false)} className="mt-2 inline-flex items-center text-[11px] font-semibold text-primary-foreground underline-offset-2 hover:underline">
              Activer l'abonnement →
            </Link>
          </div>

          <div className="flex items-center gap-2 rounded-lg p-1.5 transition hover:bg-sidebar-accent">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-brand-gradient text-sm font-semibold text-primary-foreground shadow-elevation-sm">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-foreground">{userEmail ?? "Utilisateur"}</p>
              <p className="text-[10px] text-muted-foreground">Administrateur</p>
            </div>
            <button
              onClick={signOut}
              className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-destructive"
              aria-label="Déconnexion"
              title="Déconnexion"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md lg:px-8">
          <button
            onClick={() => setOpen(true)}
            className="rounded-md p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground lg:hidden"
            aria-label="Ouvrir le menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="relative hidden max-w-md flex-1 md:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Rechercher un PV, chantier, client…"
              className="h-9 border-border bg-muted/40 pl-9 focus-visible:bg-background"
            />
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 select-none items-center gap-0.5 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground lg:inline-flex">
              ⌘K
            </kbd>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {!suspended && (
              <Link to="/pv/new" className="hidden sm:block">
                <Button size="sm" className="shadow-elevation-sm">
                  <Plus className="h-4 w-4" /> Créer un PV
                </Button>
              </Link>
            )}
            <NotificationsBell />

            <div className="grid h-8 w-8 place-items-center rounded-full bg-brand-gradient text-xs font-semibold text-primary-foreground shadow-elevation-sm">
              {initial}
            </div>
          </div>
        </header>

        <SuspensionBanner />

        <main className="mx-auto w-full max-w-[1400px] p-4 pb-[max(5rem,env(safe-area-inset-bottom))] lg:p-8 lg:pb-12">
          {children}
        </main>
      </div>
      <BottomNav />
      <InstallPrompt companyId={activeCompanyId} />
    </div>
  );
}
