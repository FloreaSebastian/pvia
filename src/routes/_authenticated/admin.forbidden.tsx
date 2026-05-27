import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/admin/forbidden")({
  component: Page,
  head: () => ({ meta: [{ title: "Accès refusé — PVIA" }, { name: "robots", content: "noindex" }] }),
});

function Page() {
  return (
    <div className="grid min-h-[60vh] place-items-center px-4">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/15 text-destructive">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-bold">403 — Accès refusé</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Accès réservé à l'équipe PVIA. Seuls les comptes <span className="font-mono">@pvia.fr</span> peuvent
          ouvrir le cockpit plateforme.
        </p>
        <Button asChild className="mt-6"><Link to="/dashboard">Retour au tableau de bord</Link></Button>
      </div>
    </div>
  );
}
