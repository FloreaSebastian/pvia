import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { CalendarDays, FileText, HardHat, Loader2, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { useQueryClient } from "@tanstack/react-query";
import { SubcontractorNotifications } from "@/components/subcontractor/SubcontractorNotifications";

/**
 * Enveloppe mobile-first de l'espace Sous-traitant.
 *
 * Cet espace est TOTALEMENT séparé de l'application professionnelle : aucun
 * accès au tableau de bord, à la facturation, à l'équipe ni aux clients.
 */
export function SubcontractorShell({
  children,
  requireAuth = true,
  title,
}: {
  children: ReactNode;
  requireAuth?: boolean;
  title?: string;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [ready, setReady] = useState(!requireAuth);

  useEffect(() => {
    if (!requireAuth) return;
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      if (!data.user) navigate({ to: "/login", search: { type: "subcontractor" } });
      else setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [requireAuth, navigate]);

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/login", search: { type: "subcontractor" }, replace: true });
  }

  return (
    <div className="min-h-[100dvh] bg-muted/30 pb-[max(env(safe-area-inset-bottom),1rem)]">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-2 px-3">
          <Link to="/sous-traitant" className="flex min-h-11 items-center gap-2">
            <BrandLogo />
          </Link>
          <div className="flex items-center gap-1">
            <span className="hidden text-xs text-muted-foreground sm:inline">Espace sous-traitant</span>
            {requireAuth && ready && <SubcontractorNotifications />}
            {requireAuth && (
              <Button variant="ghost" size="icon" className="h-11 w-11" onClick={signOut} aria-label="Se déconnecter">
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-3 py-4">
        {title ? <h1 className="mb-3 font-display text-xl font-bold tracking-tight">{title}</h1> : null}
        {ready ? (
          children
        ) : (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </main>

      {requireAuth && (
        <nav
          aria-label="Navigation sous-traitant"
          className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
        >
          <div className="mx-auto flex max-w-3xl">
            <Link
              to="/sous-traitant"
              className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs text-muted-foreground [&.active]:text-primary"
            >
              <CalendarDays className="h-5 w-5" aria-hidden="true" />
              Mes interventions
            </Link>
            <Link
              to="/sous-traitant/chantiers"
              className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs text-muted-foreground [&.active]:text-primary"
            >
              <HardHat className="h-5 w-5" aria-hidden="true" />
              Mes chantiers
            </Link>
            <Link
              to="/sous-traitant/documents"
              className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs text-muted-foreground [&.active]:text-primary"
            >
              <FileText className="h-5 w-5" aria-hidden="true" />
              Mes documents
            </Link>
          </div>
        </nav>
      )}
    </div>
  );
}
