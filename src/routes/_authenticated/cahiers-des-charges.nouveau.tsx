import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Check, Loader2, Search, Sun, Snowflake, Droplets } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/use-company";
import { RouteRoleGuard } from "@/components/auth/RouteRoleGuard";
import { MANAGE_ROLES } from "@/lib/roles";
import { createStudy } from "@/lib/etudes.functions";
import { STUDY_TYPE_OPTIONS } from "@/lib/etudes/templates";
import type { StudyType } from "@/lib/etudes/types";

export const Route = createFileRoute("/_authenticated/cahiers-des-charges/nouveau")({
  head: () => ({
    meta: [
      { title: "Nouveau cahier des charges — PVIA" },
      { name: "description", content: "Créez une pré-étude avant-vente : choisissez le métier puis le client concerné." },
      { property: "og:title", content: "Nouveau cahier des charges — PVIA" },
      { property: "og:description", content: "Choisissez le métier et le client pour démarrer une pré-étude avant-vente." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <RouteRoleGuard allow={MANAGE_ROLES} redirectTo="/cahiers-des-charges">
      <NewStudyPage />
    </RouteRoleGuard>
  ),
});

const TYPE_ICON: Record<StudyType, typeof Sun> = {
  photovoltaique: Sun,
  pac_air_eau: Droplets,
  pac_air_air: Snowflake,
};

type ClientRow = {
  id: string;
  name: string;
  company_name: string | null;
  client_type: string | null;
  email: string | null;
  city: string | null;
  address: string | null;
  postal_code: string | null;
};

function NewStudyPage() {
  const { activeCompanyId } = useCompany();
  const navigate = useNavigate();
  const create = useServerFn(createStudy);

  const [step, setStep] = useState<1 | 2>(1);
  const [type, setType] = useState<StudyType | null>(null);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [clientId, setClientId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!activeCompanyId || step !== 2) return;
    let cancelled = false;
    setLoading(true);
    supabase
      .from("clients")
      .select("id,name,company_name,client_type,email,city,address,postal_code")
      .eq("company_id", activeCompanyId)
      .is("archived_at", null)
      .order("name")
      .limit(500)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) toast.error("Chargement des clients impossible.");
        setClients((data ?? []) as ClientRow[]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeCompanyId, step]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return clients;
    return clients.filter((c) =>
      [c.name, c.company_name, c.email, c.city].filter(Boolean).some((v) => String(v).toLowerCase().includes(s)),
    );
  }, [clients, search]);

  async function submit() {
    if (!activeCompanyId || !type || !clientId) return;
    setSubmitting(true);
    try {
      const res = await create({ data: { companyId: activeCompanyId, study_type: type, client_id: clientId } });
      toast.success(`Cahier des charges ${res.reference} créé.`);
      navigate({ to: "/cahiers-des-charges/$id", params: { id: res.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Création impossible.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl p-4 pb-[calc(env(safe-area-inset-bottom,0px)+5rem)] lg:p-8">
      <Button
        variant="ghost"
        className="mb-3 min-h-11 gap-2 px-2"
        onClick={() => (step === 2 ? setStep(1) : navigate({ to: "/cahiers-des-charges" }))}
      >
        <ArrowLeft className="h-4 w-4" />
        {step === 2 ? "Métier" : "Cahiers des charges"}
      </Button>

      <h1 className="text-2xl font-bold tracking-tight">Nouveau cahier des charges</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">
        Étape {step} sur 2 — {step === 1 ? "choix du métier" : "choix du client"}. Aucun chantier n'est créé à ce stade.
      </p>

      {step === 1 ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {STUDY_TYPE_OPTIONS.map((o) => {
            const Icon = TYPE_ICON[o.value as StudyType];
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => { setType(o.value as StudyType); setStep(2); }}
                className="min-h-11 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary hover:bg-muted/40"
              >
                <Icon className="mb-2 h-6 w-6 text-primary" />
                <div className="font-medium">{o.label}</div>
                <div className="mt-1 text-xs text-muted-foreground">{o.tagline}</div>
                <div className="mt-2 text-[11px] text-muted-foreground">{o.stepCount} étapes</div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="client-search">Client</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="client-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Nom, société, e-mail, ville…"
                className="h-11 pl-8"
              />
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              Aucun client trouvé. Créez d'abord la fiche client depuis la page Clients.
            </Card>
          ) : (
            <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
              {filtered.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setClientId(c.id)}
                    className={cn(
                      "flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors",
                      clientId === c.id ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/40",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {c.client_type === "professionnel" ? c.company_name || c.name : c.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[c.email, c.city].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </span>
                    {clientId === c.id && <Check className="h-4 w-4 shrink-0 text-primary" />}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <Button className="min-h-11 w-full" disabled={!clientId || submitting} onClick={() => void submit()}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Créer le cahier des charges
          </Button>
        </div>
      )}
    </div>
  );
}
