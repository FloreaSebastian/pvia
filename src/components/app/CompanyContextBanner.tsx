import { useState } from "react";
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/hooks/use-company";

/** Erreur de lecture des accès entreprise : jamais une redirection, toujours une reprise. */
export function CompanyContextError({ compact = false }: { compact?: boolean }) {
  const { status, error, refresh } = useCompany();
  const [busy, setBusy] = useState(false);
  if (status !== "error") return null;
  return (
    <div
      role="alert"
      className={
        compact
          ? "flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
          : "pvia-container flex flex-wrap items-center gap-3 border-b border-destructive/30 bg-destructive/5 py-3 text-sm"
      }
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-medium">
          {error ?? "Impossible de vérifier vos accès entreprise."}
        </span>{" "}
        <span className="text-muted-foreground">
          Les actions restent fermées tant que vos accès ne sont pas confirmés.
        </span>
      </p>
      <Button
        size="sm"
        variant="outline"
        className="h-11"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await refresh();
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <RotateCcw className="h-4 w-4" aria-hidden />
        )}
        Réessayer
      </Button>
    </div>
  );
}
