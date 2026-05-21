import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "motion/react";
import { LogOut, LayoutDashboard, History, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { logoutClientSession } from "@/lib/client-auth.functions";
import { toast } from "sonner";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/client/dashboard", label: "Mes PV", icon: LayoutDashboard },
  { to: "/client/historique", label: "Historique", icon: History },
  { to: "/client/profil", label: "Profil", icon: User },
] as const;

export function ClientShell({
  email,
  children,
}: {
  email: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const logout = useServerFn(logoutClientSession);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  async function onLogout() {
    try {
      await logout();
      toast.success("Déconnecté");
      navigate({ to: "/client/login" });
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur lors de la déconnexion");
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 pb-20 sm:pb-0">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link to="/client/dashboard" className="flex items-center gap-2.5">
            <BrandLogo variant="compact" />
            <span className="hidden text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground sm:inline">
              Espace client
            </span>
          </Link>

          <nav className="hidden items-center gap-1 sm:flex">
            {NAV.map((item) => {
              const active = pathname === item.to;
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground shadow-brand"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" /> {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <span className="hidden max-w-[160px] truncate text-xs text-muted-foreground md:inline">
              {email}
            </span>
            <Button size="sm" variant="ghost" onClick={onLogout} className="gap-1.5">
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Se déconnecter</span>
            </Button>
          </div>
        </div>
      </header>

      <motion.main
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12"
      >
        {children}
      </motion.main>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border/60 bg-background/95 backdrop-blur sm:hidden">
        <div className="mx-auto grid max-w-5xl grid-cols-3">
          {NAV.map((item) => {
            const active = pathname === item.to;
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex flex-col items-center gap-0.5 py-2.5 text-[11px]",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
