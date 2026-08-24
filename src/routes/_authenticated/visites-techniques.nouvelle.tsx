import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ArrowRight, Check, Loader2, Sun, Wind, Droplets, AlertTriangle, Search,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/use-company";
import { isManageRole } from "@/lib/roles";
import { createTechnicalVisit, listVisitAssignees } from "@/lib/visites.functions";
import { VISIT_TYPE_OPTIONS } from "@/lib/visites/templates";
import type { VisitType } from "@/lib/visites/types";

export const Route = createFileRoute("/_authenticated/visites-techniques/nouvelle")({
  head: () => ({
    meta: [
      { title: "Nouvelle visite technique — PVIA" },
      {
        name: "description",
        content: "Créez une visite technique photovoltaïque ou pompe à chaleur : client, chantier et planification en 4 étapes.",
      },
      { property: "og:title", content: "Nouvelle visite technique — PVIA" },
      { property: "og:description", content: "Création guidée d'une visite technique PV ou PAC avec chantier automatique." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NouvelleVisitePage,
});

const TYPE_ICON: Record<VisitType, typeof Sun> = {
  photovoltaique: Sun,
  pac_air_air: Wind,
  pac_air_eau: Droplets,
};

type ClientRow = {
  id: string;
  name: string;
  company_name: string | null;
  client_type: string | null;
  address_line1: string | null;
  postal_code: string | null;
  city: string | null;
};

type ChantierRow = {
  id: string;
  reference: string | null;
  name: string;
  address: string | null;
  status: string;
  type: string | null;
};

type Duplicate = { id: string; reference: string | null; name: string; status: string; reason: string };

const STEPS = ["Métier", "Client", "Chantier", "Planification"] as const;

function NouvelleVisitePage() {
  const navigate = useNavigate();
  const { activeCompanyId, activeRole } = useCompany();
  const canManage = isManageRole(activeRole);

  const createFn = useServerFn(createTechnicalVisit);
  const assigneesFn = useServerFn(listVisitAssignees);

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [idemKey] = useState(() => `vt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

  const [visitType, setVisitType] = useState<VisitType | null>(null);

  const [clients, setClients] = useState<ClientRow[]>([]);
  const [clientQuery, setClientQuery] = useState("");
  const [clientId, setClientId] = useState<string | null>(null);

  const [chantiers, setChantiers] = useState<ChantierRow[]>([]);
  const [chantierMode, setChantierMode] = useState<"new" | "existing">("new");
  const [chantierId, setChantierId] = useState<string | null>(null);
  const [newChantier, setNewChantier] = useState({ name: "", address_line1: "", postal_code: "", city: "" });
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [forceNew, setForceNew] = useState(false);

  const [assignees, setAssignees] = useState<{ id: string; name: string }[]>([]);
  const [planning, setPlanning] = useState({
    assigned_to: "" as string,
    scheduled_date: "",
    scheduled_time: "09:00",
    site_contact_name: "",
    site_contact_phone: "",
    prep_notes: "",
  });

  useEffect(() => {
    if (!activeCompanyId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("clients")
        .select("id,name,company_name,client_type,address_line1,postal_code,city")
        .eq("company_id", activeCompanyId)
        .is("archived_at", null)
        .order("name", { ascending: true })
        .limit(500);
      if (!cancelled) setClients((data ?? []) as ClientRow[]);
      const r = await assigneesFn({ data: { companyId: activeCompanyId } }).catch(() => null);
      if (!cancelled && r) setAssignees(r.assignees.map((a) => ({ id: a.id, name: a.name })));
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCompanyId, assigneesFn]);

  const selectedClient = useMemo(() => clients.find((c) => c.id === clientId) ?? null, [clients, clientId]);

  useEffect(() => {
    if (!activeCompanyId || !clientId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("chantiers")
        .select("id,reference,name,address,status,type")
        .eq("company_id", activeCompanyId)
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (!cancelled) setChantiers((data ?? []) as ChantierRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCompanyId, clientId]);

  useEffect(() => {
    if (!selectedClient) return;
    setNewChantier((prev) => ({
      ...prev,
      address_line1: prev.address_line1 || selectedClient.address_line1 || "",
      postal_code: prev.postal_code || selectedClient.postal_code || "",
      city: prev.city || selectedClient.city || "",
    }));
  }, [selectedClient]);

  const filteredClients = useMemo(() => {
    const q = clientQuery.trim().toLowerCase();
    if (!q) return clients.slice(0, 40);
    return clients
      .filter((c) => `${c.name} ${c.company_name ?? ""} ${c.city ?? ""}`.toLowerCase().includes(q))
      .slice(0, 40);
  }, [clients, clientQuery]);

  if (!canManage) {
    return (
      <div className="mx-auto w-full max-w-2xl px-3 py-8">
        <Card className="p-6 text-center">
          <p className="font-medium">Accès restreint</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Seuls les rôles de gestion peuvent créer une visite technique.
          </p>
          <Button asChild variant="outline" className="mt-4 h-11">
            <Link to="/visites-techniques">Retour aux visites</Link>
          </Button>
        </Card>
      </div>
    );
  }

  const canNext =
    step === 0 ? !!visitType : step === 1 ? !!clientId : step === 2 ? chantierMode === "new" || !!chantierId : true;

  async function submit(force: boolean) {
    if (!activeCompanyId || !visitType || !clientId) return;
    setSubmitting(true);
    try {
      const scheduledAt =
        planning.scheduled_date
          ? new Date(`${planning.scheduled_date}T${planning.scheduled_time || "09:00"}:00`).toISOString()
          : null;
      const res = await createFn({
        data: {
          companyId: activeCompanyId,
          visit_type: visitType,
          client_id: clientId,
          chantier_id: chantierMode === "existing" ? chantierId : null,
          new_chantier: chantierMode === "new" ? newChantier : undefined,
          force_new_chantier: force,
          planning: {
            assigned_to: planning.assigned_to || null,
            scheduled_at: scheduledAt,
            site_contact_name: planning.site_contact_name,
            site_contact_phone: planning.site_contact_phone,
            prep_notes: planning.prep_notes,
          },
          idempotency_key: idemKey,
        },
      });

      if (res.ok === false) {
        setDuplicates(res.duplicates as Duplicate[]);
        setForceNew(false);
        toast.warning("Un chantier similaire existe déjà pour ce client.");
        return;
      }
      toast.success(`Visite ${res.reference} créée`);
      navigate({ to: "/visites-techniques/$id", params: { id: res.id } });
    } catch (e: any) {
      toast.error(e?.message ?? "Création impossible");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl min-w-0 space-y-4 px-3 pb-28 pt-3 sm:px-4 sm:pb-10">
      <div className="flex min-w-0 items-center gap-2">
        <Button asChild variant="ghost" size="icon" className="h-11 w-11 shrink-0">
          <Link to="/visites-techniques" aria-label="Retour aux visites techniques">
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </Link>
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold sm:text-xl">Nouvelle visite technique</h1>
          <p className="text-xs text-muted-foreground">
            Étape {step + 1} / {STEPS.length} — {STEPS[step]}
          </p>
        </div>
      </div>

      <Progress value={((step + 1) / STEPS.length) * 100} className="h-1.5" aria-label="Progression de la création" />

      {step === 0 ? (
        <div className="grid min-w-0 gap-3 sm:grid-cols-3">
          {VISIT_TYPE_OPTIONS.map((o) => {
            const Icon = TYPE_ICON[o.value as VisitType];
            const active = visitType === o.value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => setVisitType(o.value as VisitType)}
                aria-pressed={active}
                className={`min-w-0 rounded-xl border p-4 text-left transition ${
                  active ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-primary/40"
                }`}
              >
                <Icon className="h-6 w-6 text-primary" aria-hidden="true" />
                <p className="mt-2 break-words font-medium">{o.label}</p>
                <p className="mt-1 break-words text-xs text-muted-foreground">{o.tagline}</p>
                <Badge variant="outline" className="mt-2">
                  {o.stepCount} étapes
                </Badge>
              </button>
            );
          })}
        </div>
      ) : null}

      {step === 1 ? (
        <div className="min-w-0 space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={clientQuery}
              onChange={(e) => setClientQuery(e.target.value)}
              placeholder="Rechercher un client…"
              aria-label="Rechercher un client"
              className="h-11 pl-9"
            />
          </div>
          {filteredClients.length === 0 ? (
            <Card className="p-4 text-sm text-muted-foreground">
              Aucun client trouvé.{" "}
              <Link to="/clients" className="underline">
                Créer un client
              </Link>
            </Card>
          ) : (
            <ul className="space-y-2">
              {filteredClients.map((c) => {
                const active = clientId === c.id;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setClientId(c.id)}
                      aria-pressed={active}
                      className={`flex min-h-11 w-full min-w-0 items-center justify-between gap-2 rounded-xl border p-3 text-left transition ${
                        active ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block break-words text-sm font-medium">
                          {c.client_type === "professionnel" ? c.company_name || c.name : c.name}
                        </span>
                        <span className="block break-words text-xs text-muted-foreground">
                          {[c.address_line1, c.postal_code, c.city].filter(Boolean).join(" · ") || "Adresse non renseignée"}
                        </span>
                      </span>
                      {active ? <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {step === 2 ? (
        <div className="min-w-0 space-y-4">
          <div className="flex gap-2">
            <Button
              type="button"
              variant={chantierMode === "new" ? "default" : "outline"}
              className="h-11 flex-1"
              onClick={() => setChantierMode("new")}
            >
              Nouveau chantier
            </Button>
            <Button
              type="button"
              variant={chantierMode === "existing" ? "default" : "outline"}
              className="h-11 flex-1"
              onClick={() => setChantierMode("existing")}
              disabled={chantiers.length === 0}
            >
              Chantier existant
            </Button>
          </div>

          {chantierMode === "new" ? (
            <Card className="min-w-0 space-y-3 p-3 sm:p-4">
              <p className="text-xs text-muted-foreground">
                Le chantier est créé automatiquement avec une référence unique. Laissez le nom vide pour le générer.
              </p>
              <div className="space-y-2">
                <Label htmlFor="ch-name">Nom du chantier (optionnel)</Label>
                <Input
                  id="ch-name"
                  className="h-11"
                  value={newChantier.name}
                  onChange={(e) => setNewChantier((n) => ({ ...n, name: e.target.value }))}
                  placeholder="Généré automatiquement"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ch-addr">Adresse</Label>
                <Input
                  id="ch-addr"
                  className="h-11"
                  value={newChantier.address_line1}
                  onChange={(e) => setNewChantier((n) => ({ ...n, address_line1: e.target.value }))}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ch-cp">Code postal</Label>
                  <Input
                    id="ch-cp"
                    inputMode="numeric"
                    className="h-11"
                    value={newChantier.postal_code}
                    onChange={(e) => setNewChantier((n) => ({ ...n, postal_code: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ch-city">Ville</Label>
                  <Input
                    id="ch-city"
                    className="h-11"
                    value={newChantier.city}
                    onChange={(e) => setNewChantier((n) => ({ ...n, city: e.target.value }))}
                  />
                </div>
              </div>
            </Card>
          ) : (
            <ul className="space-y-2">
              {chantiers.map((c) => {
                const active = chantierId === c.id;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setChantierId(c.id)}
                      aria-pressed={active}
                      className={`flex min-h-11 w-full min-w-0 items-center justify-between gap-2 rounded-xl border p-3 text-left ${
                        active ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block break-words text-sm font-medium">{c.name}</span>
                        <span className="block break-words text-xs text-muted-foreground">
                          {c.reference ? `${c.reference} · ` : ""}
                          {c.address ?? "Adresse non renseignée"}
                        </span>
                      </span>
                      {active ? <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {duplicates.length > 0 ? (
            <Card className="min-w-0 space-y-3 border-amber-300 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/20">
              <p className="flex items-start gap-2 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                <span className="min-w-0">
                  Chantier(s) similaire(s) détecté(s) pour ce client. Réutilisez-en un ou confirmez la création.
                </span>
              </p>
              <ul className="space-y-2">
                {duplicates.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setChantierMode("existing");
                        setChantierId(d.id);
                        setDuplicates([]);
                      }}
                      className="w-full min-w-0 rounded-lg border bg-background p-2 text-left text-sm hover:bg-muted/40"
                    >
                      <span className="block break-words font-medium">{d.name}</span>
                      <span className="block break-words text-xs text-muted-foreground">
                        {d.reference ?? "—"} · {d.reason}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full"
                onClick={() => {
                  setForceNew(true);
                  setDuplicates([]);
                  toast.info("Création d'un nouveau chantier confirmée.");
                }}
              >
                Créer quand même un nouveau chantier
              </Button>
            </Card>
          ) : null}
        </div>
      ) : null}

      {step === 3 ? (
        <Card className="min-w-0 space-y-3 p-3 sm:p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="p-date">Date de visite</Label>
              <Input
                id="p-date"
                type="date"
                className="h-11"
                value={planning.scheduled_date}
                onChange={(e) => setPlanning((p) => ({ ...p, scheduled_date: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-time">Heure</Label>
              <Input
                id="p-time"
                type="time"
                className="h-11"
                value={planning.scheduled_time}
                onChange={(e) => setPlanning((p) => ({ ...p, scheduled_time: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="p-assignee">Technicien</Label>
            <Select
              value={planning.assigned_to || "none"}
              onValueChange={(v) => setPlanning((p) => ({ ...p, assigned_to: v === "none" ? "" : v }))}
            >
              <SelectTrigger id="p-assignee" className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="min-h-11">
                  Non assignée
                </SelectItem>
                {assignees.map((a) => (
                  <SelectItem key={a.id} value={a.id} className="min-h-11">
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="p-contact">Contact sur site</Label>
              <Input
                id="p-contact"
                className="h-11"
                value={planning.site_contact_name}
                onChange={(e) => setPlanning((p) => ({ ...p, site_contact_name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-phone">Téléphone</Label>
              <Input
                id="p-phone"
                type="tel"
                inputMode="tel"
                className="h-11"
                value={planning.site_contact_phone}
                onChange={(e) => setPlanning((p) => ({ ...p, site_contact_phone: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="p-notes">Notes de préparation</Label>
            <Textarea
              id="p-notes"
              rows={3}
              value={planning.prep_notes}
              onChange={(e) => setPlanning((p) => ({ ...p, prep_notes: e.target.value }))}
              placeholder="Accès, code portail, matériel à prévoir…"
            />
          </div>
        </Card>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t bg-background/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur sm:static sm:z-auto sm:border-0 sm:bg-transparent sm:p-0 sm:pb-0">
        <Button
          type="button"
          variant="outline"
          className="h-12 flex-1"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || submitting}
        >
          <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
          Précédent
        </Button>
        {step < STEPS.length - 1 ? (
          <Button type="button" className="h-12 flex-1" onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
            Suivant
            <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
          </Button>
        ) : (
          <Button type="button" className="h-12 flex-1" onClick={() => submit(forceNew)} disabled={submitting}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="mr-2 h-4 w-4" aria-hidden="true" />}
            Créer la visite
          </Button>
        )}
      </div>
    </div>
  );
}
