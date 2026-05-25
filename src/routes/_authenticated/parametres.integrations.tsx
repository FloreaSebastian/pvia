import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CreditCard, Mail, Calendar, HardDrive, Zap, Workflow, Plug } from "lucide-react";

export const Route = createFileRoute("/_authenticated/parametres/integrations")({
  component: IntegrationsSettings,
  head: () => ({ meta: [{ title: "Intégrations — Paramètres PVIA" }] }),
});

type Integration = { name: string; desc: string; icon: any; status: "connected" | "available" | "soon" };

const ITEMS: Integration[] = [
  { name: "Stripe", desc: "Paiement des abonnements et facturation client.", icon: CreditCard, status: "connected" },
  { name: "Resend", desc: "Envoi des emails transactionnels et signatures.", icon: Mail, status: "connected" },
  { name: "Google Calendar", desc: "Synchronisez vos visites de chantier.", icon: Calendar, status: "soon" },
  { name: "Google Drive", desc: "Archivez automatiquement vos PV.", icon: HardDrive, status: "soon" },
  { name: "Zapier", desc: "Connectez PVIA à 5000+ apps.", icon: Zap, status: "soon" },
  { name: "Make", desc: "Automatisations visuelles avancées.", icon: Workflow, status: "soon" },
];

function IntegrationsSettings() {
  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <Plug className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Intégrations disponibles</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {ITEMS.map((it) => {
            const Icon = it.icon;
            return (
              <div key={it.name} className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card/40 p-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{it.name}</span>
                      {it.status === "connected" && <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15">Connecté</Badge>}
                      {it.status === "soon" && <Badge variant="secondary">Bientôt</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{it.desc}</p>
                  </div>
                </div>
                <Button size="sm" variant="outline" disabled={it.status !== "available"}>
                  {it.status === "connected" ? "Gérer" : it.status === "soon" ? "Bientôt" : "Connecter"}
                </Button>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
