import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Webhook, KeyRound, BookOpen, Plus, Copy, Trash2, RefreshCw, Send,
  CheckCircle2, XCircle, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useCompany } from "@/hooks/use-company";
import {
  listApiKeys, createApiKey, revokeApiKey,
  listWebhooks, createWebhook, updateWebhook, rotateWebhookSecret,
  deleteWebhook, sendTestWebhook, listDeliveries, retryDelivery, drainCompanyWebhooks,
} from "@/lib/webhooks.functions";

export const Route = createFileRoute("/_authenticated/parametres/api")({
  component: ApiSettings,
  head: () => ({ meta: [{ title: "API & Webhooks — Paramètres PVIA" }] }),
});

type ApiKey = { id: string; name: string; prefix: string; scopes: string[]; last_used_at: string | null; revoked_at: string | null; created_at: string };
type Hook = { id: string; url: string; events: string[]; enabled: boolean; description: string | null; last_delivery_at: string | null; last_status: number | null; failure_count: number; created_at: string };
type Delivery = { id: string; webhook_id: string; event: string; status: string; attempts: number; response_code: number | null; error: string | null; delivered_at: string | null; created_at: string; next_attempt_at: string };

function ApiSettings() {
  const { activeCompanyId, can } = useCompany();
  const isAdmin = !!can?.("admin");

  const listKeysFn = useServerFn(listApiKeys);
  const createKeyFn = useServerFn(createApiKey);
  const revokeKeyFn = useServerFn(revokeApiKey);

  const listHooksFn = useServerFn(listWebhooks);
  const createHookFn = useServerFn(createWebhook);
  const updateHookFn = useServerFn(updateWebhook);
  const rotateSecretFn = useServerFn(rotateWebhookSecret);
  const deleteHookFn = useServerFn(deleteWebhook);
  const testHookFn = useServerFn(sendTestWebhook);
  const listDeliveriesFn = useServerFn(listDeliveries);
  const retryFn = useServerFn(retryDelivery);
  const drainFn = useServerFn(drainCompanyWebhooks);

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);

  // create key form
  const [keyName, setKeyName] = useState("");
  const [keyScopes, setKeyScopes] = useState<"read" | "read_write">("read");
  const [newSecret, setNewSecret] = useState<string | null>(null);

  // create hook form
  const [hookUrl, setHookUrl] = useState("");
  const [hookDesc, setHookDesc] = useState("");
  const [hookEvents, setHookEvents] = useState<string[]>([]);
  const [newHookSecret, setNewHookSecret] = useState<string | null>(null);

  const reload = async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    try {
      const [k, w, d] = await Promise.all([
        listKeysFn({ data: { companyId: activeCompanyId } }),
        listHooksFn({ data: { companyId: activeCompanyId } }),
        listDeliveriesFn({ data: { companyId: activeCompanyId, limit: 25 } }),
      ]);
      setKeys(k.keys as ApiKey[]);
      setHooks(w.webhooks as Hook[]);
      setEvents(w.availableEvents as string[]);
      setDeliveries(d.deliveries as Delivery[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur de chargement");
    } finally { setLoading(false); }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [activeCompanyId]);

  const copy = async (s: string) => {
    await navigator.clipboard.writeText(s);
    toast.success("Copié");
  };

  const onCreateKey = async () => {
    if (!activeCompanyId || !keyName.trim()) return;
    try {
      const r = await createKeyFn({
        data: {
          companyId: activeCompanyId,
          name: keyName.trim(),
          scopes: keyScopes === "read_write" ? ["read", "write"] : ["read"],
        },
      });
      setNewSecret(r.secret);
      setKeyName("");
      reload();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
  };

  const onRevokeKey = async (id: string) => {
    if (!activeCompanyId) return;
    if (!confirm("Révoquer cette clé ? Elle deviendra immédiatement invalide.")) return;
    await revokeKeyFn({ data: { companyId: activeCompanyId, id } });
    toast.success("Clé révoquée");
    reload();
  };

  const toggleEvent = (e: string) =>
    setHookEvents((prev) => prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]);

  const onCreateHook = async () => {
    if (!activeCompanyId) return;
    if (!hookUrl.startsWith("https://")) { toast.error("URL HTTPS requise"); return; }
    if (!hookEvents.length) { toast.error("Sélectionnez au moins un événement"); return; }
    try {
      const r = await createHookFn({
        data: {
          companyId: activeCompanyId,
          url: hookUrl.trim(),
          events: hookEvents as never,
          description: hookDesc.trim() || undefined,
        },
      });
      setNewHookSecret(r.secret);
      setHookUrl(""); setHookDesc(""); setHookEvents([]);
      reload();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
  };

  const onToggle = async (h: Hook) => {
    if (!activeCompanyId) return;
    await updateHookFn({ data: { companyId: activeCompanyId, id: h.id, enabled: !h.enabled } });
    reload();
  };

  const onRotate = async (h: Hook) => {
    if (!activeCompanyId) return;
    if (!confirm("Régénérer le secret ? L'ancien deviendra invalide.")) return;
    const r = await rotateSecretFn({ data: { companyId: activeCompanyId, id: h.id } });
    setNewHookSecret(r.secret);
  };

  const onDelete = async (h: Hook) => {
    if (!activeCompanyId) return;
    if (!confirm("Supprimer ce webhook ?")) return;
    await deleteHookFn({ data: { companyId: activeCompanyId, id: h.id } });
    toast.success("Webhook supprimé");
    reload();
  };

  const onTest = async (h: Hook) => {
    if (!activeCompanyId) return;
    const r = await testHookFn({ data: { companyId: activeCompanyId, id: h.id } });
    if (r.ok) toast.success(`Livré (${r.status})`);
    else toast.error(`Échec: ${r.error ?? r.status ?? "réseau"}`);
    reload();
  };

  const onRetry = async (id: string) => {
    if (!activeCompanyId) return;
    const r = await retryFn({ data: { companyId: activeCompanyId, id } });
    if (r.ok) toast.success("Livré"); else toast.error("Échec");
    reload();
  };

  const onDrain = async () => {
    if (!activeCompanyId) return;
    const r = await drainFn({ data: { companyId: activeCompanyId } });
    toast.success(`${r.processed} livraison(s) traitée(s)`);
    reload();
  };

  return (
    <div className="space-y-6">
      {/* API KEYS */}
      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Clés API</h2>
          </div>
          <Badge variant="secondary">{keys.filter((k) => !k.revoked_at).length} active(s)</Badge>
        </div>

        {newSecret && (
          <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
            <div className="mb-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
              Copiez cette clé maintenant — elle ne sera plus jamais affichée.
            </div>
            <div className="flex items-center gap-2">
              <Input readOnly value={newSecret} className="font-mono" />
              <Button variant="outline" size="sm" onClick={() => copy(newSecret)}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" onClick={() => setNewSecret(null)}>OK</Button>
            </div>
          </div>
        )}

        {isAdmin && (
          <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_160px_auto]">
            <Input placeholder="Nom de la clé (ex: Intégration Zapier)" value={keyName}
              onChange={(e) => setKeyName(e.target.value)} />
            <select className="rounded-md border border-input bg-background px-3 text-sm"
              value={keyScopes} onChange={(e) => setKeyScopes(e.target.value as never)}>
              <option value="read">Lecture seule</option>
              <option value="read_write">Lecture + écriture</option>
            </select>
            <Button onClick={onCreateKey} disabled={!keyName.trim()}>
              <Plus className="mr-1 h-4 w-4" />Créer
            </Button>
          </div>
        )}

        <div className="divide-y divide-border rounded-md border border-border">
          {loading ? (
            <div className="p-4 text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-3 w-3 animate-spin" />Chargement…</div>
          ) : keys.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">Aucune clé pour l'instant.</div>
          ) : keys.map((k) => (
            <div key={k.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {k.name}
                  {k.revoked_at && <Badge variant="destructive">révoquée</Badge>}
                  <span className="text-xs text-muted-foreground">{k.scopes.join("+")}</span>
                </div>
                <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                  {k.prefix}…
                  {k.last_used_at && <span className="ml-3">utilisée {new Date(k.last_used_at).toLocaleString()}</span>}
                </div>
              </div>
              {isAdmin && !k.revoked_at && (
                <Button variant="ghost" size="sm" onClick={() => onRevokeKey(k.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* WEBHOOKS */}
      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Webhook className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Webhooks</h2>
          </div>
          <Button variant="outline" size="sm" onClick={onDrain}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" />Traiter la file
          </Button>
        </div>

        {newHookSecret && (
          <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
            <div className="mb-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
              Secret de signature — à conserver pour vérifier le header <code>x-pvia-signature</code>.
            </div>
            <div className="flex items-center gap-2">
              <Input readOnly value={newHookSecret} className="font-mono" />
              <Button variant="outline" size="sm" onClick={() => copy(newHookSecret)}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" onClick={() => setNewHookSecret(null)}>OK</Button>
            </div>
          </div>
        )}

        {isAdmin && (
          <div className="mb-4 space-y-3 rounded-md border border-border p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">URL HTTPS</Label>
                <Input placeholder="https://votre-app.com/webhooks/pvia"
                  value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Description (optionnelle)</Label>
                <Input value={hookDesc} onChange={(e) => setHookDesc(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Événements</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {events.map((e) => {
                  const on = hookEvents.includes(e);
                  return (
                    <button key={e} type="button" onClick={() => toggleEvent(e)}
                      className={`rounded-md border px-2 py-1 font-mono text-[11px] transition ${
                        on ? "border-primary bg-primary/10 text-primary"
                           : "border-border bg-card/40 text-muted-foreground hover:border-primary/40"
                      }`}>
                      {e}
                    </button>
                  );
                })}
              </div>
            </div>
            <Button onClick={onCreateHook}>
              <Plus className="mr-1 h-4 w-4" />Ajouter
            </Button>
          </div>
        )}

        <div className="divide-y divide-border rounded-md border border-border">
          {hooks.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">Aucun webhook configuré.</div>
          ) : hooks.map((h) => (
            <div key={h.id} className="space-y-2 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-sm">{h.url}</span>
                    {h.enabled
                      ? <Badge variant="secondary">activé</Badge>
                      : <Badge variant="outline">désactivé</Badge>}
                    {h.last_status != null && (
                      <Badge variant={h.last_status < 300 ? "secondary" : "destructive"}>
                        {h.last_status}
                      </Badge>
                    )}
                  </div>
                  {h.description && <div className="mt-0.5 text-xs text-muted-foreground">{h.description}</div>}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {h.events.map((e) => (
                      <span key={e} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{e}</span>
                    ))}
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="sm" onClick={() => onTest(h)} title="Envoyer un test">
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onToggle(h)} title={h.enabled ? "Désactiver" : "Activer"}>
                      {h.enabled ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onRotate(h)} title="Régénérer secret">
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onDelete(h)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* DELIVERIES */}
      <Card className="p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Dernières livraisons</h2>
          <Button variant="ghost" size="sm" onClick={reload}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="divide-y divide-border rounded-md border border-border">
          {deliveries.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">Aucune livraison.</div>
          ) : deliveries.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs">{d.event}</span>
                  <Badge variant={
                    d.status === "delivered" ? "secondary" :
                    d.status === "failed" ? "destructive" : "outline"
                  }>{d.status}</Badge>
                  {d.response_code != null && (
                    <span className="text-xs text-muted-foreground">HTTP {d.response_code}</span>
                  )}
                  <span className="text-xs text-muted-foreground">tentatives: {d.attempts}</span>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {new Date(d.created_at).toLocaleString()}
                  {d.error && <span className="ml-2 text-destructive">{d.error}</span>}
                </div>
              </div>
              {isAdmin && d.status !== "delivered" && (
                <Button variant="ghost" size="sm" onClick={() => onRetry(d.id)}>
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* DOCS */}
      <Card className="p-6">
        <div className="mb-2 flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Vérifier les signatures</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Chaque requête envoyée par PVIA inclut un header <code className="font-mono">x-pvia-signature</code> au format
          <code className="font-mono"> t=&lt;timestamp&gt;,v1=&lt;hmac&gt;</code>. Calculez
          <code className="font-mono"> HMAC-SHA256(secret, "$&#123;timestamp&#125;.$&#123;body&#125;")</code> et comparez la
          valeur hex en temps constant. Rejetez les requêtes de plus de 5 minutes.
        </p>
        <Textarea readOnly className="mt-3 font-mono text-xs"
          rows={6}
          value={`// Node.js
import crypto from "node:crypto";
const [t, v1] = req.headers["x-pvia-signature"].split(",").map(p => p.split("=")[1]);
const expected = crypto.createHmac("sha256", SECRET).update(\`\${t}.\${rawBody}\`).digest("hex");
if (!crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected))) throw new Error("bad sig");`}
        />
      </Card>
    </div>
  );
}
