import { useEffect, useRef, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
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
  const { loading, activeRole, memberships } = useCompany();
  const navigate = useNavigate();
  const denied = useRef(false);

  const isAllowed = !!activeRole && (allow as readonly string[]).includes(activeRole);

  useEffect(() => {
    if (loading) return;
    // No active company / no role at all → let other flows handle it
    if (!activeRole && memberships.length === 0) return;
    if (!isAllowed && !denied.current) {
      denied.current = true;
      toast.error("Vous n'avez pas les droits nécessaires pour accéder à cette page.");
      navigate({ to: redirectTo });
    }
  }, [loading, activeRole, memberships.length, isAllowed, navigate, redirectTo]);

  if (loading || !isAllowed) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <>{children}</>;
}
