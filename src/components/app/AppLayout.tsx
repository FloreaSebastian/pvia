import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { FileSignature, LayoutDashboard, FileText, Users, HardHat, LogOut, Plus, Menu, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const nav = [
  { to: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { to: "/pv", label: "Procès-verbaux", icon: FileText },
  { to: "/chantiers", label: "Chantiers", icon: HardHat },
  { to: "/clients", label: "Clients", icon: Users },
] as const;

export function AppLayout({ children, userEmail }: { children: React.ReactNode; userEmail?: string | null }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  async function signOut() {
    await supabase.auth.signOut();
    toast.success("Déconnecté");
    navigate({ to: "/login" });
  }

  return (
    <div className="min-h-screen bg-muted/40">
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 flex-col border-r border-border bg-sidebar text-sidebar-foreground transition-transform lg:translate-x-0 lg:flex ${open ? "flex translate-x-0" : "-translate-x-full lg:translate-x-0"}`}>
        <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-5">
          <Link to="/dashboard" className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <FileSignature className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold">PV<span className="text-primary">Pro</span></span>
          </Link>
          <button onClick={() => setOpen(false)} className="lg:hidden"><X className="h-5 w-5" /></button>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {nav.map((i) => {
            const active = location.pathname.startsWith(i.to);
            const Icon = i.icon;
            return (
              <Link
                key={i.to}
                to={i.to}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${active ? "bg-primary text-primary-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent"}`}
              >
                <Icon className="h-4 w-4" />
                {i.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <Link to="/pv/new" className="mb-2 flex w-full">
            <Button className="w-full" size="sm">
              <Plus className="h-4 w-4" /> Nouveau PV
            </Button>
          </Link>
          <div className="rounded-md px-3 py-2 text-xs text-muted-foreground">{userEmail}</div>
          <button onClick={signOut} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent">
            <LogOut className="h-4 w-4" /> Déconnexion
          </button>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur lg:px-8">
          <button onClick={() => setOpen(true)} className="lg:hidden"><Menu className="h-5 w-5" /></button>
          <div className="ml-auto" />
        </header>
        <main className="p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
