import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StatusPill } from "@/components/ui/status-pill";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { updateReserveStatus } from "@/lib/reserves.functions";
import { listReserveLiftPhotos } from "@/lib/reserve-lift.functions";
import { getReserveHistory, type ReserveHistoryEntry } from "@/lib/reserve-history.functions";
import { MapPin, MapPinOff, Clock, Image as ImageIcon, FileText } from "lucide-react";
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

type AuditRow = ReserveHistoryEntry;

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
  const historyFn = useServerFn(getReserveHistory);
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
      try {
        const h = await historyFn({ data: { reserveId: reserve.id } });
        setHistory(h.entries);
      } catch {
        setHistory([]);
      }
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
    <>
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

          <Tabs defaultValue="photos" className="w-full">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="photos" className="gap-1.5">
                <ImageIcon className="h-3.5 w-3.5" /> Photos ({photos.length})
              </TabsTrigger>
              <TabsTrigger value="history" className="gap-1.5">
                <Clock className="h-3.5 w-3.5" /> Historique ({history.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="photos" className="mt-3">
              {photos.length === 0 ? (
                <p className="text-xs text-muted-foreground">Aucune photo.</p>
              ) : (
                <div className="space-y-2">
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
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="history" className="mt-3">
              {history.length === 0 ? (
                <p className="text-xs text-muted-foreground">Aucun événement.</p>
              ) : (
                <ol className="relative space-y-2 border-l border-border pl-4 text-xs">
                  {history.map((h, idx) => (
                    <li key={`${h.at}-${h.action}-${idx}`} className="relative">
                      <span className={`absolute -left-[19px] top-1 h-2 w-2 rounded-full ${
                        h.source === "lift" ? "bg-blue-500"
                        : h.source === "audit" ? "bg-amber-500"
                        : h.source === "notification" ? "bg-purple-500"
                        : "bg-emerald-500"
                      }`} />
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">{h.label}</div>
                          {h.details && (
                            <div className="text-muted-foreground line-clamp-2">{h.details}</div>
                          )}
                          <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                            <FileText className="h-2.5 w-2.5" />
                            <span className="font-mono">{h.action}</span>
                          </div>
                        </div>
                        <time className="shrink-0 text-[10px] text-muted-foreground">
                          {new Date(h.at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                        </time>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </TabsContent>
          </Tabs>
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
