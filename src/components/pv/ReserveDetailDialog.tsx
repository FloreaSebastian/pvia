import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StatusPill } from "@/components/ui/status-pill";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { updateReserveStatus } from "@/lib/reserves.functions";
import { listReserveLiftPhotos, getReserveLiftPdfUrl, resendValidatedReserveLiftEmail, resendReserveLiftClientEmail } from "@/lib/reserve-lift.functions";
import { listLiftsForReserve, type ReserveLinkedLift } from "@/lib/reserve-detail.functions";
import { exportReserveLiftExpertise } from "@/lib/reserve-lift-expertise.functions";
import { getReserveHistory, type ReserveHistoryEntry } from "@/lib/reserve-history.functions";
import { MapPin, MapPinOff, Clock, Image as ImageIcon, FileText, Tag, FileCheck2, FileLock2, Package, Send, ExternalLink, ListChecks, Columns } from "lucide-react";
import {
  RESERVE_STATUSES, reserveStatusLabel, reserveStatusTone,
  RESERVE_PRIORITY_LABEL, isReserveOverdue, type ReserveStatusValue,
} from "@/lib/reserve-status";
import { deriveDisplayStatus, STATUS_LABELS as LIFT_STATUS_LABELS, STATUS_TONES as LIFT_STATUS_TONES } from "@/lib/reserve-lift-status";
import { useCompany } from "@/hooks/use-company";
import { useIsMobile } from "@/hooks/use-mobile";
import { PhotoLightboxDialog, type LightboxPhoto } from "./PhotoLightboxDialog";

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

type PhotoItem = {
  id: string;
  photoType: "initial" | "before" | "after" | "legacy";
  url: string | null;
  label: string | null;
  fileName: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  takenAt: string | null;
  uploadedAt: string | null;
  uploadedBy: string | null;
  deviceInfo: string | null;
};

const STATUS_ACTIONS: Array<{ value: ReserveStatusValue; label: string }> = [
  { value: "en_cours", label: "Passer en cours" },
  { value: "levee", label: "Marquer levée" },
  { value: "en_attente_validation", label: "Attente validation client" },
  { value: "validee", label: "Valider" },
  { value: "rejetee", label: "Rejeter" },
];

const SECTIONS: Array<{ key: "initial" | "before" | "after" | "legacy"; title: string; hint?: string }> = [
  { key: "initial", title: "Constat initial", hint: "Photos prises à la création de la réserve." },
  { key: "before", title: "Avant levée" },
  { key: "after", title: "Après levée" },
  { key: "legacy", title: "Archivées / non catégorisées" },
];

type PhotoTileProps = {
  p: PhotoItem;
  onOpen: () => void;
};

function PhotoTile({ p, onOpen }: PhotoTileProps) {
  const hasGeo = p.latitude !== null && p.longitude !== null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative block overflow-hidden rounded border border-border text-left"
    >
      {p.url
        ? <img src={p.url} alt={p.label ?? ""} className="aspect-square w-full object-cover transition group-hover:opacity-90" />
        : <div className="aspect-square w-full bg-muted" />}
      <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between gap-1">
        <span className="flex items-center gap-1 rounded bg-black/60 px-1 py-0.5 text-[9px] text-white">
          {hasGeo
            ? <><MapPin className="h-2.5 w-2.5 text-green-300" />{p.accuracy ? `±${Math.round(p.accuracy)}m` : "GPS"}</>
            : <><MapPinOff className="h-2.5 w-2.5 text-amber-300" />Non géo.</>}
        </span>
      </div>
      {p.label && (
        <div className="absolute left-1 top-1 inline-flex items-center gap-1 rounded bg-black/70 px-1 py-0.5 font-mono text-[9px] text-white">
          <Tag className="h-2.5 w-2.5" />{p.label.replace(/^RES-\d+-/, "")}
        </div>
      )}
    </button>
  );
}

export function ReserveDetailDialog({
  open, onOpenChange, reserve, onChanged,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  reserve: ReserveDetail | null;
  onChanged?: () => void;
}) {
  const { activeRole } = useCompany();
  const isMobile = useIsMobile();
  const updateFn = useServerFn(updateReserveStatus);
  const listPhotosFn = useServerFn(listReserveLiftPhotos);
  const historyFn = useServerFn(getReserveHistory);
  const listLiftsFn = useServerFn(listLiftsForReserve);
  const getLiftPdfFn = useServerFn(getReserveLiftPdfUrl);
  const resendValidatedFn = useServerFn(resendValidatedReserveLiftEmail);
  const resendClientFn = useServerFn(resendReserveLiftClientEmail);
  const exportExpertiseFn = useServerFn(exportReserveLiftExpertise);

  const [history, setHistory] = useState<AuditRow[]>([]);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [lifts, setLifts] = useState<ReserveLinkedLift[]>([]);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [photoView, setPhotoView] = useState<"sections" | "compare">("sections");
  const [busyLiftId, setBusyLiftId] = useState<string | null>(null);

  const canManage = activeRole && ["directeur", "responsable_exploitation", "conducteur_travaux", "technicien"].includes(activeRole);
  const canValidate = activeRole && ["directeur", "responsable_exploitation", "conducteur_travaux"].includes(activeRole);
  const canExport = activeRole && ["directeur", "responsable_exploitation", "conducteur_travaux"].includes(activeRole);

  useEffect(() => {
    if (!open || !reserve) return;
    (async () => {
      try {
        const h = await historyFn({ data: { reserveId: reserve.id } });
        setHistory(h.entries);
      } catch { setHistory([]); }
      try {
        const res = await listPhotosFn({ data: { reserveId: reserve.id } });
        setPhotos(res.photos as PhotoItem[]);
      } catch { setPhotos([]); }
      try {
        const res = await listLiftsFn({ data: { reserveId: reserve.id } });
        setLifts(res.lifts);
      } catch { setLifts([]); }
    })();
  }, [open, reserve?.id]);

  const lightboxPhotos: LightboxPhoto[] = useMemo(
    () => photos.map((p) => ({
      id: p.id,
      url: p.url,
      label: p.label,
      fileName: p.fileName,
      takenAt: p.takenAt,
      uploadedAt: p.uploadedAt,
      latitude: p.latitude,
      longitude: p.longitude,
      accuracy: p.accuracy,
      deviceInfo: p.deviceInfo,
      photoType: p.photoType,
    })),
    [photos],
  );

  const photosBefore = useMemo(() => photos.filter((p) => p.photoType === "initial" || p.photoType === "before"), [photos]);
  const photosAfter = useMemo(() => photos.filter((p) => p.photoType === "after"), [photos]);

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

  async function openLiftPdf(reportId: string, variant: "client" | "internal") {
    setBusyLiftId(reportId);
    try {
      const res = await getLiftPdfFn({ data: { reportId, variant } });
      if (res?.url) window.open(res.url, "_blank", "noopener");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "PDF indisponible");
    } finally {
      setBusyLiftId(null);
    }
  }

  async function resendLiftEmail(reportId: string, status: string | null) {
    setBusyLiftId(reportId);
    try {
      if (status === "client_validated") {
        await resendValidatedFn({ data: { reportId } });
      } else {
        await resendClientFn({ data: { reportId } });
      }
      toast.success("Email renvoyé");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Envoi impossible");
    } finally {
      setBusyLiftId(null);
    }
  }

  async function exportExpertise(reportId: string) {
    setBusyLiftId(reportId);
    try {
      const res = await exportExpertiseFn({ data: { reportId } });
      const bin = atob(res.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = res.fileName; a.click();
      URL.revokeObjectURL(url);
      toast.success("Export prêt");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export impossible");
    } finally {
      setBusyLiftId(null);
    }
  }

  const body = (
    <div className="space-y-3 text-sm">
      {/* ───── Header / état ───── */}
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
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="photos" className="gap-1.5">
            <ImageIcon className="h-3.5 w-3.5" /> Photos ({photos.length})
          </TabsTrigger>
          <TabsTrigger value="lifts" className="gap-1.5">
            <ListChecks className="h-3.5 w-3.5" /> Levées ({lifts.length})
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <Clock className="h-3.5 w-3.5" /> Historique ({history.length})
          </TabsTrigger>
        </TabsList>

        {/* ───── Photos ───── */}
        <TabsContent value="photos" className="mt-3">
          {photos.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aucune photo.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">
                  {photosBefore.length} avant · {photosAfter.length} après
                </p>
                <div className="inline-flex overflow-hidden rounded border border-border">
                  <button
                    type="button"
                    onClick={() => setPhotoView("sections")}
                    className={`px-2 py-1 text-[11px] ${photoView === "sections" ? "bg-muted font-medium" : ""}`}
                  >
                    Sections
                  </button>
                  <button
                    type="button"
                    onClick={() => setPhotoView("compare")}
                    className={`flex items-center gap-1 px-2 py-1 text-[11px] ${photoView === "compare" ? "bg-muted font-medium" : ""}`}
                  >
                    <Columns className="h-3 w-3" /> Avant / Après
                  </button>
                </div>
              </div>

              {photoView === "sections" ? (
                SECTIONS.map((section) => {
                  const subset = photos.filter((p) => p.photoType === section.key);
                  if (subset.length === 0) return null;
                  return (
                    <div key={section.key}>
                      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        {section.title} ({subset.length})
                      </div>
                      {section.hint && (
                        <p className="mb-1 text-[10px] italic text-muted-foreground">{section.hint}</p>
                      )}
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                        {subset.map((p) => (
                          <PhotoTile
                            key={p.id}
                            p={p}
                            onOpen={() => setLightboxIdx(photos.findIndex((x) => x.id === p.id))}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className={`grid gap-3 ${isMobile ? "grid-cols-1" : "grid-cols-2"}`}>
                  <div>
                    <div className="mb-1 flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">Avant</span>
                      ({photosBefore.length})
                    </div>
                    {photosBefore.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground">Aucune photo avant.</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {photosBefore.map((p) => (
                          <PhotoTile
                            key={p.id}
                            p={p}
                            onOpen={() => setLightboxIdx(photos.findIndex((x) => x.id === p.id))}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="mb-1 flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800">Après</span>
                      ({photosAfter.length})
                    </div>
                    {photosAfter.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground">Aucune photo après.</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {photosAfter.map((p) => (
                          <PhotoTile
                            key={p.id}
                            p={p}
                            onOpen={() => setLightboxIdx(photos.findIndex((x) => x.id === p.id))}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* ───── Levées liées ───── */}
        <TabsContent value="lifts" className="mt-3">
          {lifts.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aucune levée pour cette réserve.</p>
          ) : (
            <div className="space-y-3">
              {lifts.map((l) => {
                const validated = !!l.client_validated_at;
                const rejected = !!l.client_rejected_at;
                const signed = !!l.signed_at || !!l.client_signature;
                const labelMode = l.client_signed_on_site
                  ? "Sur place"
                  : l.validation_mode === "remote"
                  ? "À distance"
                  : (l.validation_mode ?? "—");
                return (
                  <div key={l.id} className="rounded border border-border p-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-xs font-semibold">{l.numero ?? "—"}</span>
                        <StatusPill tone={reserveLiftStatusTone(l.status) as any} size="sm" dot>
                          {reserveLiftStatusLabel(l.status)}
                        </StatusPill>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(l.created_at).toLocaleDateString("fr-FR")}
                        </span>
                      </div>
                    </div>

                    <div className="mt-1.5 grid grid-cols-1 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground sm:grid-cols-2">
                      <div>Validation : <span className="text-foreground">{labelMode}</span></div>
                      {l.signer_name && (
                        <div>Intervenant : <span className="text-foreground">{l.signer_name}{l.signer_role ? ` (${l.signer_role})` : ""}</span></div>
                      )}
                      {!l.signer_name && l.technician_name && (
                        <div>Technicien : <span className="text-foreground">{l.technician_name}</span></div>
                      )}
                      {l.signer_signed_at && (
                        <div>Signée le : <span className="text-foreground">{new Date(l.signer_signed_at).toLocaleDateString("fr-FR")}</span></div>
                      )}
                      {validated && (
                        <div className="text-emerald-700">Validée client : {new Date(l.client_validated_at!).toLocaleDateString("fr-FR")}</div>
                      )}
                      {rejected && (
                        <div className="text-red-700">Rejet client : {new Date(l.client_rejected_at!).toLocaleDateString("fr-FR")}</div>
                      )}
                    </div>

                    {l.comment && (
                      <p className="mt-1.5 whitespace-pre-wrap rounded bg-muted/40 p-2 text-[11px]">{l.comment}</p>
                    )}

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(l.pdf_client_url || l.pdf_url) && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyLiftId === l.id}
                          onClick={() => openLiftPdf(l.id, "client")}
                          className="h-7 gap-1 text-[11px]"
                        >
                          <FileCheck2 className="h-3 w-3" /> PDF client
                        </Button>
                      )}
                      {l.pdf_internal_url && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyLiftId === l.id}
                          onClick={() => openLiftPdf(l.id, "internal")}
                          className="h-7 gap-1 text-[11px]"
                        >
                          <FileLock2 className="h-3 w-3" /> PDF interne
                        </Button>
                      )}
                      {signed && !validated && !rejected && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyLiftId === l.id}
                          onClick={() => resendLiftEmail(l.id, l.status)}
                          className="h-7 gap-1 text-[11px]"
                        >
                          <Send className="h-3 w-3" /> Renvoyer au client
                        </Button>
                      )}
                      {validated && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyLiftId === l.id}
                          onClick={() => resendLiftEmail(l.id, l.status)}
                          className="h-7 gap-1 text-[11px]"
                        >
                          <Send className="h-3 w-3" /> Renvoyer email validé
                        </Button>
                      )}
                      {canExport && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyLiftId === l.id}
                          onClick={() => exportExpertise(l.id)}
                          className="h-7 gap-1 text-[11px]"
                        >
                          <Package className="h-3 w-3" /> Export expertise
                        </Button>
                      )}
                      {reserve.pv_id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          asChild
                          className="h-7 gap-1 text-[11px]"
                        >
                          <a href={`/pv/${reserve.pv_id}/levee-reserves`}>
                            <ExternalLink className="h-3 w-3" /> Ouvrir levée
                          </a>
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ───── Historique ───── */}
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
  );

  return (
    <>
      {isMobile ? (
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent side="bottom" className="h-[92vh] overflow-y-auto p-4">
            <SheetHeader className="mb-2 text-left">
              <SheetTitle>Détail réserve</SheetTitle>
            </SheetHeader>
            {body}
            <div className="sticky bottom-0 -mx-4 mt-3 border-t bg-background/95 px-4 py-2 backdrop-blur">
              <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)}>Fermer</Button>
            </div>
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Détail réserve</DialogTitle>
            </DialogHeader>
            {body}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Fermer</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {lightboxIdx !== null && (
        <PhotoLightboxDialog
          open={lightboxIdx !== null}
          onOpenChange={(o) => !o && setLightboxIdx(null)}
          photos={lightboxPhotos}
          startIndex={lightboxIdx}
          context={{
            reserveDescription: reserve.description,
            reserveStatus: reserveStatusLabel(reserve.status),
            reserveSeverity: reserve.severity,
            showExactGps: true,
          }}
        />
      )}
    </>
  );
}

export { RESERVE_STATUSES };
