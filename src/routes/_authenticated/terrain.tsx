import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Smartphone, Plus, FileText, Loader2, RefreshCw, CloudOff, Wifi, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { useCompany } from "@/hooks/use-company";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useFieldQueue } from "@/hooks/use-field-queue";
import { createFieldDraft, listFieldDrafts } from "@/lib/field.functions";

export const Route = createFileRoute("/_authenticated/terrain")({
  head: () => ({
    meta: [
      { title: "Mode terrain — PVIA" },
      { name: "description", content: "Créez un PV directement sur chantier depuis votre mobile." },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
    ],
  }),
  component: FieldHomePage,
});

function FieldHomePage() {
  const { activeCompanyId, loading: cLoading } = useCompany();
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const { ops, flush, flushing } = useFieldQueue();
  const createFn = useServerFn(createFieldDraft);
  const listFn = useServerFn(listFieldDrafts);

  const [drafts, setDrafts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  async function loadDrafts() {
    if (!activeCompanyId) return;
    setLoading(true);
    try {
      const res = await listFn({ data: { companyId: activeCompanyId } });
      setDrafts(res.drafts);
    } catch (e: any) {
      toast.error(e?.message || "Impossible de charger les brouillons");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (activeCompanyId) loadDrafts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompanyId]);

  async function newDraft() {
    if (!activeCompanyId) return;
    if (!online) {
      toast.error("Connexion requise pour créer un brouillon");
      return;
    }
    setCreating(true);
    try {
      const res = await createFn({ data: { companyId: activeCompanyId } });
      toast.success(`Brouillon ${res.numero} créé`);
      navigate({ to: "/terrain/$id", params: { id: res.id } });
    } catch (e: any) {
      toast.error(e?.message || "Création impossible");
    } finally {
      setCreating(false);
    }
  }

  if (cLoading) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl bg-brand-gradient p-6 text-primary-foreground shadow-elevation-lg">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
        <div className="relative">
          <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]">
            <Smartphone className="h-3.5 w-3.5" /> Mode terrain
          </div>
          <h1 className="font-display text-2xl font-bold leading-tight">Créez un PV depuis le chantier</h1>
          <p className="mt-2 text-sm opacity-90">Photos, réserves, signature client — en quelques gestes.</p>
          <Button
            size="lg"
            variant="secondary"
            className="mt-4 h-14 w-full text-base font-semibold shadow-elevation-md"
            onClick={newDraft}
            disabled={creating}
          >
            {creating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
            Créer un PV terrain
          </Button>
          <div className="mt-3 flex items-center gap-2 text-[11px] opacity-90">
            {online ? <Wifi className="h-3.5 w-3.5" /> : <CloudOff className="h-3.5 w-3.5" />}
            {online ? "Connecté" : "Hors ligne — les actions seront synchronisées"}
          </div>
        </div>
      </div>

      {/* Sync pending */}
      {ops.length > 0 ? (
        <Card className="border-warning/40 bg-warning/10 p-4">
          <div className="flex items-start gap-3">
            <RefreshCw className={`mt-0.5 h-5 w-5 text-warning ${flushing ? "animate-spin" : ""}`} />
            <div className="flex-1">
              <div className="font-medium text-foreground">
                {ops.length} action{ops.length > 1 ? "s" : ""} en attente de synchronisation
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">Elles seront envoyées dès le retour de la connexion.</p>
            </div>
            <Button size="sm" variant="outline" onClick={flush} disabled={flushing || !online}>
              Synchroniser
            </Button>
          </div>
        </Card>
      ) : null}

      {/* Drafts */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Brouillons terrain</h2>
          <button onClick={loadDrafts} className="text-xs text-primary hover:underline">Actualiser</button>
        </div>
        {loading ? (
          <div className="grid place-items-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : drafts.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            Aucun brouillon en cours. Commencez par créer un PV terrain.
          </Card>
        ) : (
          <div className="space-y-2">
            {drafts.map((d) => (
              <Link
                key={d.id}
                to="/terrain/$id"
                params={{ id: d.id }}
                className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 transition hover:border-primary/50"
              >
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{d.numero}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {d.field_last_saved_at
                      ? `Modifié ${new Date(d.field_last_saved_at).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`
                      : "Non sauvegardé"}
                  </div>
                </div>
                <Badge variant="secondary">Brouillon</Badge>
              </Link>
            ))}
          </div>
        )}
      </section>

      <Card className="p-4">
        <div className="flex items-start gap-3">
          <MapPin className="mt-0.5 h-5 w-5 text-muted-foreground" />
          <div className="text-xs text-muted-foreground">
            Astuce : autorise la géolocalisation pour ajouter automatiquement la position GPS du chantier au PV.
          </div>
        </div>
      </Card>
    </div>
  );
}
