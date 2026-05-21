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
  Smartphone,
  ShieldCheck,
  BarChart3,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Logo } from "@/components/landing/Logo";
import { CompanySwitcher } from "@/components/app/CompanySwitcher";
import { NotificationsBell } from "@/components/app/NotificationsBell";


const mainNav = [
  { to: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { to: "/terrain", label: "Mode terrain", icon: Smartphone },
  { to: "/pv", label: "Procès-verbaux", icon: FileText },
  { to: "/reserves", label: "Réserves", icon: AlertCircle },
  { to: "/chantiers", label: "Chantiers", icon: HardHat },
  { to: "/clients", label: "Clients", icon: Users },
] as const;

const secondaryNav = [
  { to: "/entreprise", label: "Entreprise", icon: Building2 },
  { to: "/equipe", label: "Équipe", icon: UsersRound },
  { to: "/statistiques", label: "Statistiques", icon: BarChart3 },
  { to: "/historique", label: "Historique entreprise", icon: ShieldCheck },
  { to: "/dashboard", label: "Aide & support", icon: HelpCircle },
] as const;

export function AppLayout({ children, userEmail }: { children: React.ReactNode; userEmail?: string | null }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  async function signOut() {
    await supabase.auth.signOut();
    toast.success("Déconnecté avec succès");
    navigate({ to: "/login" });
  }

  const initial = (userEmail ?? "U").slice(0, 1).toUpperCase();

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Mobile overlay */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-foreground/40 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-border bg-sidebar text-sidebar-foreground shadow-xl transition-transform lg:translate-x-0 lg:shadow-none ${
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-5">
          <Logo />
          <button
            onClick={() => setOpen(false)}
            className="lg:hidden rounded-md p-1 hover:bg-sidebar-accent"
            aria-label="Fermer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-3 pt-3">
          <CompanySwitcher />
        </div>

        <div className="px-3 pt-3">
          <Link to="/pv/new" onClick={() => setOpen(false)}>
            <Button className="w-full shadow-md shadow-primary/20" size="sm">
              <Plus className="h-4 w-4" /> Nouveau PV
            </Button>
          </Link>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          <p className="px-3 pb-2 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Navigation
          </p>
          {mainNav.map((i) => {
            const active = location.pathname === i.to || location.pathname.startsWith(i.to + "/");
            const Icon = i.icon;
            return (
              <Link
                key={i.to}
                to={i.to}
                onClick={() => setOpen(false)}
                className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                  active
                    ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                    : "text-foreground/80 hover:bg-sidebar-accent hover:text-foreground"
                }`}
              >
                <Icon className={`h-4 w-4 transition-transform group-hover:scale-110 ${active ? "" : "text-muted-foreground"}`} />
                <span className="flex-1">{i.label}</span>
              </Link>
            );
          })}

          <p className="px-3 pb-2 pt-5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Configuration
          </p>
          {secondaryNav.map((i, idx) => {
            const Icon = i.icon;
            return (
              <Link
                key={idx}
                to={i.to}
                onClick={() => setOpen(false)}
                className="group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-foreground/70 transition-all hover:bg-sidebar-accent hover:text-foreground"
              >
                <Icon className="h-4 w-4 text-muted-foreground" />
                {i.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <div className="mb-2 rounded-xl border border-primary/20 bg-gradient-to-br from-primary/10 to-transparent p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-primary">
              <Sparkles className="h-3.5 w-3.5" /> Essai Pro · 14 jours
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Profitez de toutes les fonctionnalités premium.
            </p>
          </div>

          <div className="flex items-center gap-2 rounded-lg p-2 hover:bg-sidebar-accent">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-primary to-primary/60 text-sm font-semibold text-primary-foreground">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{userEmail ?? "Utilisateur"}</p>
              <p className="text-[10px] text-muted-foreground">Administrateur</p>
            </div>
            <button
              onClick={signOut}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
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
            className="rounded-md p-2 hover:bg-muted lg:hidden"
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
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Link to="/pv/new" className="hidden sm:block">
              <Button size="sm" className="shadow-sm">
                <Plus className="h-4 w-4" /> Créer un PV
              </Button>
            </Link>
            <NotificationsBell />

            <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-primary to-primary/60 text-xs font-semibold text-primary-foreground">
              {initial}
            </div>
          </div>
        </header>

        <main className="p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
