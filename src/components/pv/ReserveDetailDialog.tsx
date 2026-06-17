import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill } from "@/components/ui/status-pill";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { updateReserveStatus } from "@/lib/reserves.functions";
import { listReserveLiftPhotos } from "@/lib/reserve-lift.functions";
import { MapPin, MapPinOff } from "lucide-react";
import {
  RESERVE_STATUSES, reserveStatusLabel, reserveStatusTone,
  RESERVE_PRIORITY_LABEL, isReserveOverdue, type ReserveStatusValue,
} from "@/lib/reserve-status";
import { useCompany } from "@/hooks/use-company";

export type ReserveDetail = {
  id: string;
  description: string;
  severity: string;
  status: string;
  priority?: string | null;
  nature?: string | null;
  work_to_execute?: string | null;
  due_date?: string | null;
  assigned_to?: string | null;
  lifted_at?: string | null;
  validated_at?: string | null;
  created_at: string;
  pv_id: string;
  company_id: string | null;
};

type AuditRow = { id: string; action: string; created_at: string; metadata: any };

const STATUS_ACTIONS: Array<{ value: ReserveStatusValue; label: string }> = [
  { value: "en_cours", label: "Passer en cours" },
  { value: "levee", label: "Marquer levée" },
  { value: "en_attente_validation", label: "Attente validation client" },
  { value: "validee", label: "Valider" },
  { value: "rejetee", label: "Rejeter" },
];

export function ReserveDetailDialog({
  open, onOpenChange, reserve, onChanged,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  reserve: ReserveDetail | null;
  onChanged?: () => void;
}) {
  const { activeRole } = useCompany();
  const updateFn = useServerFn(updateReserveStatus);
  const listPhotosFn = useServerFn(listReserveLiftPhotos);
  const [history, setHistory] = useState<AuditRow[]>([]);
  const [photos, setPhotos] = useState<Array<{
    id: string; photoType: "before" | "after" | "legacy"; url: string | null;
    latitude: number | null; longitude: number | null; accuracy: number | null;
    takenAt: string | null; uploadedAt: string | null;
  }>>([]);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [mapPhoto, setMapPhoto] = useState<{ latitude: number | null; longitude: number | null; url: string | null } | null>(null);

  const canManage = activeRole && ["directeur", "responsable_exploitation", "conducteur_travaux", "technicien"].includes(activeRole);
  const canValidate = activeRole && ["directeur", "responsable_exploitation", "conducteur_travaux"].includes(activeRole);

  useEffect(() => {
    if (!open || !reserve) return;
    (async () => {
      const { data } = await supabase
        .from("audit_logs")
        .select("id,action,created_at,metadata")
        .eq("entity_type", "reserve")
        .eq("entity_id", reserve.id)
        .order("created_at", { ascending: false })
        .limit(30);
      setHistory((data ?? []) as AuditRow[]);
      try {
        const res = await listPhotosFn({ data: { reserveId: reserve.id } });
        setPhotos(res.photos);
      } catch {
        setPhotos([]);
      }
    })();
  }, [open, reserve?.id]);

  if (!reserve) return null;
  const overdue = isReserveOverdue(reserve.due_date, reserve.status);

  async function setStatus(next: ReserveStatusValue) {
    if (!reserve || !reserve.company_id) return;
    if (next === "rejetee" && !rejectReason.trim()) {
      toast.error("Motif de rejet obligatoire.");
      return;
    }
    setBusy(true);
    try {
      await updateFn({
        data: {
          companyId: reserve.company_id,
          id: reserve.id,
          status: next,
          reason: next === "rejetee" ? rejectReason : undefined,
        },
      });
      toast.success("Statut mis à jour");
      setRejectReason("");
      onChanged?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Mise à jour impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Détail réserve</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={reserve.severity === "majeure" ? "destructive" : "neutral"} size="sm">
              {reserve.severity}
            </StatusPill>
            <StatusPill tone={reserveStatusTone(reserve.status) as any} size="sm" dot>
              {reserveStatusLabel(reserve.status)}
            </StatusPill>
            {reserve.priority && reserve.priority !== "normal" && (
              <span className="rounded bg-muted px-2 py-0.5 text-xs">
                Priorité {RESERVE_PRIORITY_LABEL[reserve.priority] ?? reserve.priority}
              </span>
            )}
            {overdue && <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">En retard</span>}
          </div>

          {reserve.nature && (
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Nature</div>
              <div>{reserve.nature}</div>
            </div>
          )}
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Description</div>
            <p className="whitespace-pre-wrap">{reserve.description}</p>
          </div>
          {reserve.work_to_execute && (
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Travaux à exécuter</div>
              <p className="whitespace-pre-wrap">{reserve.work_to_execute}</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <div>Créée : {new Date(reserve.created_at).toLocaleDateString("fr-FR")}</div>
            {reserve.due_date && (
              <div className={overdue ? "font-semibold text-red-600" : ""}>
                Échéance : {new Date(reserve.due_date).toLocaleDateString("fr-FR")}
              </div>
            )}
            {reserve.lifted_at && <div>Levée : {new Date(reserve.lifted_at).toLocaleDateString("fr-FR")}</div>}
            {reserve.validated_at && <div>Validée : {new Date(reserve.validated_at).toLocaleDateString("fr-FR")}</div>}
          </div>

          {canManage && reserve.status !== "validee" && (
            <div className="space-y-2 rounded border border-border p-2">
              <div className="text-xs font-medium">Actions</div>
              <div className="flex flex-wrap gap-1">
                {STATUS_ACTIONS.filter((a) => {
                  if (a.value === reserve.status) return false;
                  if (!canValidate && (a.value === "validee" || a.value === "en_attente_validation")) return false;
                  if (activeRole === "technicien" && !["en_cours", "levee"].includes(a.value)) return false;
                  return true;
                }).map((a) => (
                  <Button
                    key={a.value}
                    size="sm"
                    variant={a.value === "rejetee" ? "destructive" : "outline"}
                    disabled={busy}
                    onClick={() => setStatus(a.value)}
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
              <div>
                <label className="mb-1 block text-xs">Motif (requis pour rejet)</label>
                <Textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Motif du rejet ou commentaire…"
                  className="min-h-[60px]"
                />
              </div>
            </div>
          )}

          {photos.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium">Photos d'intervention ({photos.length})</div>
              {(["before", "after", "legacy"] as const).map((kind) => {
                const subset = photos.filter((p) => p.photoType === kind);
                if (subset.length === 0) return null;
                const title = kind === "before" ? "Avant intervention" : kind === "after" ? "Après intervention" : "Non catégorisées";
                return (
                  <div key={kind}>
                    <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{title} ({subset.length})</div>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {subset.map((p) => {
                        const hasGeo = p.latitude !== null && p.longitude !== null;
                        return (
                          <div key={p.id} className="relative overflow-hidden rounded border border-border">
                            <a href={p.url ?? "#"} target="_blank" rel="noopener noreferrer" className="block">
                              {p.url ? <img src={p.url} alt="" className="aspect-square w-full object-cover" /> : <div className="aspect-square w-full bg-muted" />}
                            </a>
                            <div className="absolute bottom-1 left-1 flex items-center gap-1 rounded bg-black/60 px-1 py-0.5 text-[9px] text-white">
                              {hasGeo ? (
                                <>
                                  <MapPin className="h-2.5 w-2.5 text-green-300" />
                                  {p.accuracy ? `±${Math.round(p.accuracy)}m` : "GPS"}
                                </>
                              ) : (
                                <>
                                  <MapPinOff className="h-2.5 w-2.5 text-amber-300" />
                                  Non géo.
                                </>
                              )}
                            </div>
                            {p.uploadedAt && (
                              <div className="absolute right-1 top-1 rounded bg-black/60 px-1 py-0.5 text-[9px] text-white">
                                {new Date(p.uploadedAt).toLocaleDateString("fr-FR")}
                              </div>
                            )}
                            {hasGeo && (
                              <button
                                type="button"
                                onClick={(e) => { e.preventDefault(); setMapPhoto(p); }}
                                className="absolute bottom-1 right-1 rounded bg-primary px-1.5 py-0.5 text-[9px] font-medium text-primary-foreground hover:opacity-90"
                              >
                                Voir sur carte
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {subset.some((p) => p.latitude !== null) && (
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {subset
                          .filter((p) => p.latitude !== null)
                          .slice(0, 1)
                          .map((p) => (
                            <span key={p.id}>Coordonnées disponibles (visibles uniquement côté entreprise).</span>
                          ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}


          <div>
            <div className="mb-1 text-xs font-medium">Historique ({history.length})</div>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded border border-border p-2 text-xs">
              {history.length === 0 && <p className="text-muted-foreground">Aucun événement.</p>}
              {history.map((h) => (
                <div key={h.id} className="flex items-start justify-between gap-2 border-b border-border/50 pb-1 last:border-0">
                  <span className="font-mono text-[10px]">{h.action}</span>
                  <span className="text-muted-foreground">
                    {new Date(h.created_at).toLocaleString("fr-FR")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fermer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {mapPhoto && mapPhoto.latitude !== null && mapPhoto.longitude !== null && (
      <Dialog open={!!mapPhoto} onOpenChange={(o) => !o && setMapPhoto(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Position de la photo</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="overflow-hidden rounded border border-border">
              <iframe
                title="Carte"
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${mapPhoto.longitude - 0.005}%2C${mapPhoto.latitude - 0.003}%2C${mapPhoto.longitude + 0.005}%2C${mapPhoto.latitude + 0.003}&layer=mapnik&marker=${mapPhoto.latitude}%2C${mapPhoto.longitude}`}
                className="h-72 w-full"
              />
            </div>
            <div className="text-xs text-muted-foreground">
              Coordonnées : {mapPhoto.latitude.toFixed(6)}, {mapPhoto.longitude.toFixed(6)}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <a href={`https://www.google.com/maps?q=${mapPhoto.latitude},${mapPhoto.longitude}`} target="_blank" rel="noopener noreferrer">Google Maps</a>
              </Button>
              <Button asChild size="sm" variant="outline">
                <a href={`https://www.openstreetmap.org/?mlat=${mapPhoto.latitude}&mlon=${mapPhoto.longitude}#map=18/${mapPhoto.latitude}/${mapPhoto.longitude}`} target="_blank" rel="noopener noreferrer">OpenStreetMap</a>
              </Button>
              <Button asChild size="sm">
                <a href={`https://www.google.com/maps/dir/?api=1&destination=${mapPhoto.latitude},${mapPhoto.longitude}`} target="_blank" rel="noopener noreferrer">Itinéraire</a>
              </Button>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setMapPhoto(null)}>Fermer</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    )}
  </>
  );
}

export { RESERVE_STATUSES };
