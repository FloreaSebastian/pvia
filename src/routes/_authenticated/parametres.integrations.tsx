import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Calendar, MessageSquare, Webhook, CreditCard, Mail, Plus, Copy, Trash2, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useCompany } from "@/hooks/use-company";
import {
  listCalendarTokens, createCalendarToken, revokeCalendarToken,
} from "@/lib/calendar.functions";
import { createWebhook } from "@/lib/webhooks.functions";

export const Route = createFileRoute("/_authenticated/parametres/integrations")({
  component: IntegrationsSettings,
  head: () => ({ meta: [{ title: "Intégrations — Paramètres PVIA" }] }),
});

type CalToken = { id: string; name: string; scope: string; token: string; url: string; revoked_at: string | null; last_accessed_at: string | null; created_at: string };

const SLACK_EVENTS = ["pv.created", "pv.signed", "pv.sent_to_client", "reserve.created", "reserve.lifted"] as const;

function IntegrationsSettings() {
  const { activeCompanyId, can } = useCompany();
  const isAdmin = !!can?.("admin");

  const listFn = useServerFn(listCalendarTokens);
  const createFn = useServerFn(createCalendarToken);
  const revokeFn = useServerFn(revokeCalendarToken);
  const createHookFn = useServerFn(createWebhook);

  const [tokens, setTokens] = useState<CalToken[]>([]);
  const [calName, setCalName] = useState("Flux PVIA");
  const [calScope, setCalScope] = useState<"all" | "signed_only" | "field_visits">("all");

  const [slackUrl, setSlackUrl] = useState("");
  const [discordUrl, setDiscordUrl] = useState("");

  const reload = async () => {
    if (!activeCompanyId) return;
    try {
      const r = await listFn({ data: { companyId: activeCompanyId } });
      setTokens(r.tokens as CalToken[]);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [activeCompanyId]);

  const copy = async (s: string) => { await navigator.clipboard.writeText(s); toast.success("Copié"); };

  const onCreateCal = async () => {
    if (!activeCompanyId) return;
    try {
      const r = await createFn({ data: { companyId: activeCompanyId, name: calName, scope: calScope } });
      toast.success("Flux créé");
      copy(r.url);
      reload();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
  };

  const onRevoke = async (id: string) => {
    if (!activeCompanyId) return;
    if (!confirm("Révoquer ce flux calendrier ?")) return;
    await revokeFn({ data: { companyId: activeCompanyId, id } });
    toast.success("Révoqué");
    reload();
  };

  const onConnectChat = async (format: "slack" | "discord", url: string) => {
    if (!activeCompanyId) return;
    const ok = format === "slack"
      ? url.startsWith("https://hooks.slack.com/")
      : url.startsWith("https://discord.com/api/webhooks/") || url.startsWith("https://discordapp.com/api/webhooks/");
    if (!ok) { toast.error("URL de webhook invalide"); return; }
    try {
      await createHookFn({
        data: {
          companyId: activeCompanyId,
          url,
          events: SLACK_EVENTS as unknown as never,
          description: format === "slack" ? "Slack" : "Discord",
          delivery_format: format,
        },
      });
      toast.success(`${format === "slack" ? "Slack" : "Discord"} connecté`);
      if (format === "slack") setSlackUrl(""); else setDiscordUrl("");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
  };

  return (
    <div className="space-y-6">
      {/* CALENDRIER */}
      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Flux Calendrier (iCal)</h2>
          </div>
          <Badge variant="secondary">Google Calendar · Apple · Outlook</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Générez un lien <code>.ics</code> à coller dans n'importe quel agenda pour suivre vos PV et visites de chantier.
        </p>

        {isAdmin && (
          <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_180px_auto]">
            <Input placeholder="Nom du flux" value={calName} onChange={(e) => setCalName(e.target.value)} />
            <select className="rounded-md border border-input bg-background px-3 text-sm"
              value={calScope} onChange={(e) => setCalScope(e.target.value as never)}>
              <option value="all">Tous les PV</option>
              <option value="signed_only">Signés uniquement</option>
              <option value="field_visits">Visites datées</option>
            </select>
            <Button onClick={onCreateCal}><Plus className="mr-1 h-4 w-4" />Créer</Button>
          </div>
        )}

        <div className="mt-4 divide-y divide-border rounded-md border border-border">
          {tokens.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">Aucun flux créé.</div>
          ) : tokens.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {t.name}
                  <Badge variant="outline">{t.scope}</Badge>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <Input readOnly value={t.url} className="font-mono text-xs" />
                </div>
                {t.last_accessed_at && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    Dernier accès: {new Date(t.last_accessed_at).toLocaleString()}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="sm" onClick={() => copy(t.url)} title="Copier">
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                {isAdmin && (
                  <Button variant="ghost" size="sm" onClick={() => onRevoke(t.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* SLACK / DISCORD */}
      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Notifications Slack / Discord</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Collez une URL d'<em>incoming webhook</em> Slack ou Discord. PVIA enverra un message à chaque événement clé
          (création, signature, envoi client, réserves).
        </p>

        <div className="mt-4 space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Slack Incoming Webhook</Label>
            <div className="flex gap-2">
              <Input placeholder="https://hooks.slack.com/services/..." value={slackUrl}
                onChange={(e) => setSlackUrl(e.target.value)} />
              <Button disabled={!isAdmin || !slackUrl} onClick={() => onConnectChat("slack", slackUrl)}>
                Connecter
              </Button>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Discord Webhook</Label>
            <div className="flex gap-2">
              <Input placeholder="https://discord.com/api/webhooks/..." value={discordUrl}
                onChange={(e) => setDiscordUrl(e.target.value)} />
              <Button disabled={!isAdmin || !discordUrl} onClick={() => onConnectChat("discord", discordUrl)}>
                Connecter
              </Button>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            Une fois connectés, ces webhooks apparaissent dans{" "}
            <Link to="/parametres/api" className="text-primary underline">API & Webhooks</Link> pour gestion fine, désactivation et historique de livraison.
          </div>
        </div>
      </Card>

      {/* ZAPIER / MAKE */}
      <Card className="p-6">
        <div className="mb-3 flex items-center gap-2">
          <Webhook className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Zapier · Make · n8n</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Créez un webhook au format brut depuis{" "}
          <Link to="/parametres/api" className="text-primary underline">API & Webhooks</Link>{" "}
          et collez l'URL fournie par Zapier / Make / n8n. Chaque payload est signé HMAC-SHA256 et inclut le type d'événement.
        </p>
        <div className="mt-3 flex gap-2 text-xs">
          <a href="https://zapier.com/apps/webhook/integrations" target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:bg-muted">
            Zapier <ExternalLink className="h-3 w-3" />
          </a>
          <a href="https://www.make.com/en/help/tools/webhooks" target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:bg-muted">
            Make <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </Card>

      {/* SERVICES NATIFS */}
      <Card className="p-6">
        <div className="mb-3 flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Services natifs</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card/40 p-4">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
                <CreditCard className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2"><span className="font-medium">Stripe</span><Badge>Actif</Badge></div>
                <p className="mt-0.5 text-xs text-muted-foreground">Paiements & abonnements PVIA.</p>
              </div>
            </div>
            {isAdmin ? (
              <Button asChild size="sm" variant="outline"><Link to="/parametres/facturation">Gérer</Link></Button>
            ) : (
              <Button size="sm" variant="outline" disabled title="Réservé aux directeurs / responsables d'exploitation">Gérer</Button>
            )}
          </div>
          <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card/40 p-4">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
                <Mail className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2"><span className="font-medium">Resend</span><Badge>Actif</Badge></div>
                <p className="mt-0.5 text-xs text-muted-foreground">Emails de signature et transactionnels.</p>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
