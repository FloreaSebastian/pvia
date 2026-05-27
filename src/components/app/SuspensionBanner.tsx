import { Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { useSuspension } from "@/hooks/use-suspension";

/**
 * Sticky banner shown across the company workspace when the company
 * has been suspended by a platform admin. Provides a quick link to the
 * dedicated suspension page.
 */
export function SuspensionBanner() {
  const { suspended, reason } = useSuspension();
  if (!suspended) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
      <ShieldAlert className="h-4 w-4 shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="font-semibold">Compte suspendu — lecture seule.</span>{" "}
        {reason ? <span className="text-destructive/80">{reason}</span> : null}
      </div>
      <Link
        to="/account-suspended"
        className="rounded-md border border-destructive/40 bg-background/60 px-3 py-1 font-medium text-destructive hover:bg-background"
      >
        Détails
      </Link>
    </div>
  );
}
