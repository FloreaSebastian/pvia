import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "motion/react";
import { LogOut, FileSignature } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logoutClientSession } from "@/lib/client-auth.functions";
import { toast } from "sonner";
import type { ReactNode } from "react";

export function ClientShell({
  email,
  children,
}: {
  email: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const logout = useServerFn(logoutClientSession);

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
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link to="/client/dashboard" className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <FileSignature className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">PVIA</div>
              <div className="text-[11px] leading-tight text-muted-foreground">Espace client</div>
            </div>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:inline">{email}</span>
            <Button size="sm" variant="ghost" onClick={onLogout} className="gap-1.5">
              <LogOut className="h-3.5 w-3.5" /> Se déconnecter
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
    </div>
  );
}
