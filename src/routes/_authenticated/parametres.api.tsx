import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Webhook, KeyRound, BookOpen } from "lucide-react";

export const Route = createFileRoute("/_authenticated/parametres/api")({
  component: ApiSettings,
  head: () => ({ meta: [{ title: "API & Webhooks — Paramètres PVIA" }] }),
});

const EVENTS = [
  "pv.created", "pv.signed", "pv.sent_to_client",
  "reserve.created", "reserve.lifted",
  "member.invited", "member.joined",
  "subscription.updated",
];

function ApiSettings() {
  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Clés API</h2>
          </div>
          <Badge variant="secondary">Bientôt</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Générez des clés API personnelles pour automatiser PVIA depuis vos outils.
          L'accès programmatique sera disponible dans une prochaine version.
        </p>
        <div className="mt-4 flex items-center gap-2">
          <Input value="pvia_•••••••••••••••••••••••••••" disabled className="font-mono" />
          <Button variant="outline" disabled>Régénérer</Button>
        </div>
      </Card>

      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Webhook className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Webhooks</h2>
          </div>
          <Badge variant="secondary">Bientôt</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Recevez les événements PVIA sur votre endpoint HTTPS, en temps réel.
        </p>
        <div className="mt-4 flex items-center gap-2">
          <Input placeholder="https://votre-app.com/webhooks/pvia" disabled />
          <Button disabled>Ajouter</Button>
        </div>
        <div className="mt-5">
          <div className="mb-2 text-xs font-medium text-muted-foreground">Événements abonnables</div>
          <div className="flex flex-wrap gap-1.5">
            {EVENTS.map((e) => (
              <span key={e} className="rounded-md border border-border bg-card/40 px-2 py-1 font-mono text-[11px] text-muted-foreground">
                {e}
              </span>
            ))}
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="mb-2 flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Documentation</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          La documentation API REST et la référence des webhooks seront publiées avec l'ouverture publique.
        </p>
      </Card>
    </div>
  );
}
