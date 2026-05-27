import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard, Building2, LifeBuoy, Activity, CheckSquare, CreditCard,
  ShieldCheck, ArrowLeft, LogOut, Menu, X,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const items = [
  { to: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/companies", label: "Entreprises", icon: Building2 },
  { to: "/admin/billing", label: "Facturation", icon: CreditCard },
  { to: "/admin/support", label: "Support", icon: LifeBuoy },
  { to: "/admin/monitoring", label: "Monitoring", icon: Activity },
  { to: "/admin/launch-checklist", label: "Launch checklist", icon: CheckSquare },
] as const;

export function AdminLayout({
  children,
  userEmail,
}: {
  children: React.ReactNode;
  userEmail?: string | null;
}) {
  const loc = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const isActive = (to: string) =>
    loc.pathname === to || loc.pathname.startsWith(to + "/");

  async function signOut() {
    await supabase.auth.signOut();
    toast.success("Déconnecté");
    navigate({ to: "/login" });
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-amber-500/20 bg-zinc-900 transition-transform lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-amber-500/20 px-5">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-amber-500/20 text-amber-400">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-bold">PVIA Admin</div>
              <div className="text-[10px] uppercase tracking-wider text-amber-400/80">
                Plateforme
              </div>
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 lg:hidden"
            aria-label="Fermer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-3 pt-4">
          <Badge className="w-full justify-center border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/10">
            Mode administration
          </Badge>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          <p className="px-3 pb-1.5 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Cockpit
          </p>
          {items.map((i) => {
            const active = isActive(i.to);
            const Icon = i.icon;
            return (
              <Link
                key={i.to}
                to={i.to}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-amber-500/15 text-amber-300"
                    : "text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="flex-1 truncate">{i.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-amber-500/20 p-3">
          <Link
            to="/dashboard"
            className="mb-2 flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Retour espace entreprise
          </Link>
          <div className="flex items-center gap-2 rounded-lg p-1.5">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-amber-500/20 text-sm font-semibold text-amber-300">
              {(userEmail ?? "A").slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold">{userEmail ?? "Admin"}</p>
              <p className="text-[10px] text-amber-400/80">Admin plateforme</p>
            </div>
            <button
              onClick={signOut}
              className="rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-red-400"
              aria-label="Déconnexion"
              title="Déconnexion"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-amber-500/20 bg-zinc-900/80 px-4 backdrop-blur-md lg:px-8">
          <button
            onClick={() => setOpen(true)}
            className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 lg:hidden"
            aria-label="Menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-amber-400" />
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-300">
              Cockpit administration plateforme
            </span>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
