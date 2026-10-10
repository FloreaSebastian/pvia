import { useEffect, useRef, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Loader2, RotateCcw, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useCompany } from "@/hooks/use-company";
import type { CompanyRoleValue } from "@/lib/roles";

type Props = {
  allow: readonly CompanyRoleValue[];
  children: ReactNode;
  /** Path to redirect to when access is denied (default: /dashboard) */
  redirectTo?: string;
};

/**
 * Route-level role guard. Renders children only if the current active role
 * is in the `allow` list. Otherwise, shows a toast and redirects.
 *
 * Complements the UI masking done in AppLayout — this enforces access at the
 * route level, blocking direct URL navigation.
 */
export function RouteRoleGuard({ allow, children, redirectTo = "/dashboard" }: Props) {
  const { loading, activeRole, memberships, status, refresh } = useCompany();
  const navigate = useNavigate();
  const denied = useRef(false);

  const isAllowed = !!activeRole && (allow as readonly string[]).includes(activeRole);

  useEffect(() => {
    if (loading || status === "error") return;
    // No active company / no role at all → let other flows handle it
    if (!activeRole && memberships.length === 0) return;
    if (!isAllowed && !denied.current) {
      denied.current = true;
      toast.error("Vous n'avez pas les droits nécessaires pour accéder à cette page.");
      navigate({ to: redirectTo });
    }
  }, [loading, status, activeRole, memberships.length, isAllowed, navigate, redirectTo]);

  // Erreur de lecture des accès : le bandeau de la mise en page affiche déjà le
  // message et « Réessayer » ; aucun contenu protégé, aucune redirection.
  if (status === "error") return null;

  // Adhésions confirmées mais aucune active (accès retiré/suspendu) : état
  // explicite, aucune écriture, plutôt qu'un chargement infini.
  if (!loading && status === "ready" && memberships.length === 0 && !activeRole) {
    return <NoCompanyAccess onRetry={() => void refresh()} />;
  }

  if (loading || !isAllowed) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <>{children}</>;
}

export function NoCompanyAccess({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="mx-auto my-10 max-w-md rounded-xl border border-border bg-card p-6 text-center"
    >
      <ShieldOff className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
      <h2 className="mt-3 text-base font-semibold">Aucun accès entreprise actif</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Votre accès a peut-être été suspendu ou retiré. Contactez un administrateur de votre
        entreprise, ou utilisez son lien d'invitation pour rejoindre l'équipe.
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button className="h-11" onClick={onRetry}>
          <RotateCcw className="h-4 w-4" aria-hidden /> Vérifier à nouveau
        </Button>
        <Button asChild variant="outline" className="h-11">
          <Link to="/parametres">Mon compte</Link>
        </Button>
      </div>
    </div>
  );
}
