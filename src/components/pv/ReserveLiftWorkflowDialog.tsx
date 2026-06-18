/**
 * Reserve Lift Workflow popup — guided step-by-step UI to process a reserve
 * directly from the PV sheet. Replaces navigation to /pv/:id/levee-reserves
 * for the common single-reserve flow.
 *
 * Desktop: large Dialog. Mobile: bottom Sheet.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import SignaturePad from "react-signature-canvas";
import { useServerFn } from "@tanstack/react-start";
import {
  ChevronLeft, ChevronRight, Loader2, MapPin, MapPinOff, X,
  Camera, FileSignature, Send, Check,
} from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";

import { useIsMobile } from "@/hooks/use-mobile";
import { createReserveLift } from "@/lib/reserve-lift.functions";
import { fileToBase64 } from "@/lib/file-upload";
import { compressImageFile, PHOTO_BASE64_MAX } from "@/lib/image-compress";
import {
  tryGetGps, buildPhotoEntry, sanitizeExifForUpload, type PhotoEntry,
} from "@/lib/photo-exif";

export type LiftDialogReserve = {
  id: string;
  description: string;
  severity: string;
  status: string;
  priority?: string | null;
  due_date?: string | null;
  work_to_execute?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pvId: string;
  pvNumero: string;
  reserves: LiftDialogReserve[];
  preselectedReserveId?: string | null;
  chantierLabel?: string | null;
  clientLabel?: string | null;
  onCompleted?: (reportId: string, numero: string) => void;
};

type StepId = "select" | "before" | "intervention" | "after" | "tech" | "company" | "review";

const STEPS: { id: StepId; label: string; short: string; icon: any }[] = [
  { id: "select",       label: "Réserves",      short: "1", icon: Check },
  { id: "before",       label: "Photos avant",  short: "2", icon: Camera },
  { id: "intervention", label: "Intervention",  short: "3", icon: FileSignature },
  { id: "after",        label: "Photos après",  short: "4", icon: Camera },
  { id: "tech",         label: "Technicien",    short: "5", icon: FileSignature },
  { id: "company",      label: "Entreprise",    short: "6", icon: FileSignature },
  { id: "review",       label: "Envoi",         short: "7", icon: Send },
];

export function ReserveLiftWorkflowDialog(props: Props) {
  const { open, onOpenChange, pvId, pvNumero, reserves, preselectedReserveId, chantierLabel, clientLabel, onCompleted } = props;
  const isMobile = useIsMobile();
  const createFn = useServerFn(createReserveLift);

  // State
  const [stepIdx, setStepIdx] = useState(0);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [photosBefore, setPhotosBefore] = useState<Record<string, PhotoEntry[]>>({});
  const [photosAfter, setPhotosAfter] = useState<Record<string, PhotoEntry[]>>({});
  const [technicianName, setTechnicianName] = useState("");
  const [includeTechnicianSig, setIncludeTechnicianSig] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingKind, setUploadingKind] = useState<null | "before" | "after">(null);
  const techSigRef = useRef<SignaturePad>(null);
  const companySigRef = useRef<SignaturePad>(null);
  // Persist signatures across step navigation (SignaturePad unmounts otherwise).
  const [techSigData, setTechSigData] = useState<string | null>(null);
  const [companySigData, setCompanySigData] = useState<string | null>(null);

  // Init selection from preselected
  useEffect(() => {
    if (!open) return;
    if (preselectedReserveId && reserves.some((r) => r.id === preselectedReserveId)) {
      setSelected({ [preselectedReserveId]: true });
    } else if (reserves.length === 1) {
      setSelected({ [reserves[0].id]: true });
    } else {
      setSelected({});
    }
    setStepIdx(0);
  }, [open, preselectedReserveId, reserves]);

  // Cleanup preview URLs on close/unmount
  useEffect(() => {
    if (open) return;
    const all = [...Object.values(photosBefore).flat(), ...Object.values(photosAfter).flat()];
    all.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    setPhotosBefore({}); setPhotosAfter({}); setComments({});
    setTechnicianName(""); setIncludeTechnicianSig(true);
    setTechSigData(null); setCompanySigData(null);
    setStepIdx(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selectedIds = useMemo(() => Object.keys(selected).filter((k) => selected[k]), [selected]);
  const selectedReserves = useMemo(
    () => reserves.filter((r) => selected[r.id]),
    [reserves, selected],
  );

  const step = STEPS[stepIdx];

  // --- Photo upload handler with compression
  async function handleFiles(rid: string, kind: "before" | "after", files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadingKind(kind);
    try {
      const browserGps = await tryGetGps();
      const deviceInfo = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 400) : "";
      const list = Array.from(files);
      const entries: PhotoEntry[] = [];
      let compressedCount = 0;
      for (const raw of list) {
        const { file, compressed } = await compressImageFile(raw);
        if (compressed) compressedCount++;
        entries.push(await buildPhotoEntry(file, browserGps, deviceInfo));
      }
      if (compressedCount > 0) toast.success(`${compressedCount} photo(s) optimisée(s).`);
      const setter = kind === "before" ? setPhotosBefore : setPhotosAfter;
      setter((prev) => ({ ...prev, [rid]: [...(prev[rid] ?? []), ...entries] }));
    } catch (e: any) {
      toast.error(e?.message || "Échec d'import photo.");
    } finally {
      setUploadingKind(null);
    }
  }

  function removePhoto(rid: string, kind: "before" | "after", idx: number) {
    const setter = kind === "before" ? setPhotosBefore : setPhotosAfter;
    setter((prev) => {
      const list = [...(prev[rid] ?? [])];
      const removed = list.splice(idx, 1);
      removed.forEach((e) => URL.revokeObjectURL(e.previewUrl));
      return { ...prev, [rid]: list };
    });
  }

  // --- Validation per step
  function validateStep(id: StepId): { ok: boolean; msg?: string } {
    switch (id) {
      case "select":
        if (selectedIds.length === 0) return { ok: false, msg: "Sélectionnez au moins une réserve." };
        return { ok: true };
      case "before": {
        const missing = selectedReserves.filter((r) => (photosBefore[r.id]?.length ?? 0) === 0);
        if (missing.length > 0) return { ok: false, msg: "Au moins 1 photo AVANT par réserve sélectionnée." };
        return { ok: true };
      }
      case "intervention": {
        const missing = selectedReserves.filter((r) => !(comments[r.id] ?? "").trim());
        if (missing.length > 0) return { ok: false, msg: "Décrivez les travaux réalisés pour chaque réserve." };
        return { ok: true };
      }
      case "after": {
        const missing = selectedReserves.filter((r) => (photosAfter[r.id]?.length ?? 0) === 0);
        if (missing.length > 0) return { ok: false, msg: "Au moins 1 photo APRÈS par réserve sélectionnée." };
        return { ok: true };
      }
      case "tech":
        if (includeTechnicianSig) {
          if (!technicianName.trim()) return { ok: false, msg: "Nom du technicien obligatoire." };
          // Read current pad if mounted, else fallback to stored
          const sig = techSigRef.current && !techSigRef.current.isEmpty()
            ? techSigRef.current.toDataURL("image/png") : techSigData;
          if (!sig) return { ok: false, msg: "Signature du technicien obligatoire." };
        }
        return { ok: true };
      case "company": {
        const sig = companySigRef.current && !companySigRef.current.isEmpty()
          ? companySigRef.current.toDataURL("image/png") : companySigData;
        if (!sig) return { ok: false, msg: "Signature entreprise obligatoire." };
        return { ok: true };
      }
      case "review":
        return { ok: true };
    }
  }

  function persistSigBeforeNav() {
    if (techSigRef.current && !techSigRef.current.isEmpty()) {
      setTechSigData(techSigRef.current.toDataURL("image/png"));
    }
    if (companySigRef.current && !companySigRef.current.isEmpty()) {
      setCompanySigData(companySigRef.current.toDataURL("image/png"));
    }
  }

  function goNext() {
    persistSigBeforeNav();
    const v = validateStep(step.id);
    if (!v.ok) { toast.error(v.msg!); return; }
    setStepIdx((i) => Math.min(STEPS.length - 1, i + 1));
  }
  function goPrev() {
    persistSigBeforeNav();
    setStepIdx((i) => Math.max(0, i - 1));
  }

  // --- Finalize
  async function handleFinalize() {
    persistSigBeforeNav();
    // Re-run all validations
    for (const s of STEPS) {
      const v = validateStep(s.id);
      if (!v.ok) {
        toast.error(v.msg!);
        const idx = STEPS.findIndex((x) => x.id === s.id);
        setStepIdx(idx);
        return;
      }
    }
    const companySig = companySigRef.current && !companySigRef.current.isEmpty()
      ? companySigRef.current.toDataURL("image/png") : companySigData;
    const techSig = includeTechnicianSig
      ? (techSigRef.current && !techSigRef.current.isEmpty()
          ? techSigRef.current.toDataURL("image/png") : techSigData)
      : null;
    if (!companySig) { toast.error("Signature entreprise obligatoire."); return; }

    setSubmitting(true);
    try {
      const items = await Promise.all(
        selectedReserves.map(async (r) => {
          const before = photosBefore[r.id] ?? [];
          const after = photosAfter[r.id] ?? [];
          const all = await Promise.all(
            [
              ...before.map((e) => ({ e, t: "before" as const })),
              ...after.map((e) => ({ e, t: "after" as const })),
            ].map(async ({ e, t }) => {
              const base64 = await fileToBase64(e.file);
              if (base64.length > PHOTO_BASE64_MAX) {
                throw new Error("Une photo reste trop volumineuse après compression. Réessayez avec une photo plus petite.");
              }
              return {
                base64,
                mimeType: e.file.type || "image/jpeg",
                fileName: e.file.name,
                photoType: t,
                latitude: e.latitude,
                longitude: e.longitude,
                accuracy: e.accuracy,
                takenAt: e.takenAt,
                deviceInfo: e.deviceInfo,
                exifMetadata: sanitizeExifForUpload(e.exifMetadata),
              };
            }),
          );
          return { reserveId: r.id, comment: (comments[r.id] ?? "").trim(), photos: all };
        }),
      );
      const res = await createFn({
        data: {
          pvId,
          status: "signe",
          comment: "",
          requireClientSignature: false,
          items,
          companySignature: companySig,
          clientSignature: null,
          technicianSignature: techSig,
          technicianName: technicianName.trim() || null,
        },
      });
      toast.success(`Levée ${res.numero} envoyée au client.`);
      onCompleted?.(res.reportId, res.numero);
      onOpenChange(false);
    } catch (e: any) {
      const code = e?.code;
      if (code === "PHOTO_TOO_LARGE") {
        toast.error("Photo trop volumineuse — réduisez la taille puis réessayez.");
        const beforeIdx = STEPS.findIndex((s) => s.id === "before");
        setStepIdx(beforeIdx);
      } else {
        toast.error(e?.message || "Échec de la création de la levée.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  // --- UI parts
  const HeaderInfo = (
    <div className="space-y-1 text-xs text-muted-foreground">
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        <span><span className="font-medium text-foreground">PV :</span> {pvNumero}</span>
        {chantierLabel && <span><span className="font-medium text-foreground">Chantier :</span> {chantierLabel}</span>}
        {clientLabel && <span><span className="font-medium text-foreground">Client :</span> {clientLabel}</span>}
      </div>
    </div>
  );

  const Stepper = (
    <div className="flex items-center gap-1 overflow-x-auto pb-2">
      {STEPS.map((s, idx) => {
        const active = idx === stepIdx;
        const done = idx < stepIdx;
        return (
          <div key={s.id} className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => { persistSigBeforeNav(); setStepIdx(idx); }}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                active ? "bg-primary text-primary-foreground"
                : done ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground"
              }`}
            >
              <span className={`grid h-4 w-4 place-items-center rounded-full text-[10px] ${
                active ? "bg-primary-foreground/20" : done ? "bg-primary/20" : "bg-background"
              }`}>{done ? "✓" : s.short}</span>
              <span className="hidden sm:inline">{s.label}</span>
            </button>
            {idx < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground/40" />}
          </div>
        );
      })}
    </div>
  );

  const PhotoZone = ({ rid, kind }: { rid: string; kind: "before" | "after" }) => {
    const list = (kind === "before" ? photosBefore : photosAfter)[rid] ?? [];
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">{kind === "before" ? "Photos avant" : "Photos après"} <span className="text-destructive">*</span></Label>
          <span className="text-[10px] text-muted-foreground">{list.length} photo(s)</span>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp"
            capture="environment"
            onChange={(e) => { void handleFiles(rid, kind, e.target.files); e.target.value = ""; }}
            className="h-9 text-xs"
          />
          {uploadingKind === kind && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        {list.length > 0 && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {list.map((p, idx) => {
              const geo = p.latitude !== null && p.longitude !== null;
              return (
                <div key={idx} className="relative overflow-hidden rounded border border-border">
                  <img src={p.previewUrl} alt="" className="aspect-square w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removePhoto(rid, kind, idx)}
                    className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
                    aria-label="Supprimer"
                  >
                    <X className="h-3 w-3" />
                  </button>
                  <div className="absolute bottom-1 left-1 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-white">
                    {geo ? (
                      <><MapPin className="h-2.5 w-2.5 text-green-300" />{p.accuracy ? `±${Math.round(p.accuracy)}m` : "GPS"}</>
                    ) : (
                      <><MapPinOff className="h-2.5 w-2.5 text-amber-300" />Non géoloc.</>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const ReserveCard = ({ r, children }: { r: LiftDialogReserve; children?: React.ReactNode }) => (
    <div className="rounded-md border border-border p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <Badge variant={r.severity === "majeure" ? "destructive" : "secondary"} className="text-[10px]">{r.severity}</Badge>
            {r.priority && r.priority !== "normal" && (
              <Badge variant="outline" className="text-[10px]">P. {r.priority}</Badge>
            )}
            {r.due_date && (
              <span className="text-[10px] text-muted-foreground">📅 {new Date(r.due_date).toLocaleDateString("fr-FR")}</span>
            )}
          </div>
          <p className="text-sm leading-snug">{r.description}</p>
          {r.work_to_execute && (
            <p className="mt-1 text-[11px] text-muted-foreground"><span className="font-medium">Travaux prévus :</span> {r.work_to_execute}</p>
          )}
        </div>
      </div>
      {children}
    </div>
  );

  const Body = (
    <div className="space-y-4">
      {HeaderInfo}
      {Stepper}

      {/* Step content */}
      {step.id === "select" && (
        <div className="space-y-2">
          {reserves.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune réserve ouverte à lever.</p>
          ) : reserves.map((r) => (
            <label key={r.id} className="flex items-start gap-2 rounded-md border border-border p-2.5 cursor-pointer hover:bg-muted/50">
              <Checkbox
                checked={!!selected[r.id]}
                onCheckedChange={(v) => setSelected((s) => ({ ...s, [r.id]: !!v }))}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                  <Badge variant={r.severity === "majeure" ? "destructive" : "secondary"} className="text-[10px]">{r.severity}</Badge>
                  <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                </div>
                <p className="text-sm leading-snug">{r.description}</p>
              </div>
            </label>
          ))}
        </div>
      )}

      {step.id === "before" && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Documentez l'état initial avant l'intervention (au moins 1 photo par réserve).</p>
          {selectedReserves.map((r) => (
            <ReserveCard key={r.id} r={r}>
              <PhotoZone rid={r.id} kind="before" />
            </ReserveCard>
          ))}
        </div>
      )}

      {step.id === "intervention" && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Décrivez les travaux réalisés pour chaque réserve.</p>
          {selectedReserves.map((r) => (
            <ReserveCard key={r.id} r={r}>
              <div>
                <Label className="text-xs">Travaux réalisés <span className="text-destructive">*</span></Label>
                <Textarea
                  rows={3}
                  placeholder="Ex. Remplacement du micro-onduleur, contrôle de production et vérification du serrage."
                  value={comments[r.id] ?? ""}
                  onChange={(e) => setComments((c) => ({ ...c, [r.id]: e.target.value }))}
                />
              </div>
            </ReserveCard>
          ))}
        </div>
      )}

      {step.id === "after" && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Photos preuves après intervention (au moins 1 photo par réserve).</p>
          {selectedReserves.map((r) => (
            <ReserveCard key={r.id} r={r}>
              <PhotoZone rid={r.id} kind="after" />
            </ReserveCard>
          ))}
        </div>
      )}

      {step.id === "tech" && (
        <div className="space-y-3 rounded-md border border-border p-3">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Signature technicien intervenant</Label>
              <p className="text-[11px] text-muted-foreground">Trace l'auteur de l'intervention sur site.</p>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={includeTechnicianSig} onCheckedChange={setIncludeTechnicianSig} />
              <Label className="!mt-0 text-xs">Inclure</Label>
            </div>
          </div>
          {includeTechnicianSig && (
            <>
              <div>
                <Label className="text-xs">Nom du technicien <span className="text-destructive">*</span></Label>
                <Input
                  value={technicianName}
                  onChange={(e) => setTechnicianName(e.target.value)}
                  placeholder="Nom Prénom"
                  className="h-9"
                />
              </div>
              <div>
                <Label className="text-xs">Signature <span className="text-destructive">*</span></Label>
                <div className="rounded-md border border-border bg-background">
                  <SignaturePad
                    ref={techSigRef}
                    canvasProps={{ className: "w-full h-28" }}
                    onEnd={() => {
                      if (techSigRef.current && !techSigRef.current.isEmpty()) {
                        setTechSigData(techSigRef.current.toDataURL("image/png"));
                      }
                    }}
                  />
                </div>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs"
                  onClick={() => { techSigRef.current?.clear(); setTechSigData(null); }}>
                  Effacer
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {step.id === "company" && (
        <div className="space-y-3 rounded-md border border-border p-3">
          <div>
            <Label className="text-sm">Signature entreprise <span className="text-destructive">*</span></Label>
            <p className="text-[11px] text-muted-foreground">
              Validation interne. Le client signera à distance via l'email qui lui sera envoyé.
            </p>
          </div>
          <div className="rounded-md border border-border bg-background">
            <SignaturePad
              ref={companySigRef}
              canvasProps={{ className: "w-full h-32" }}
              onEnd={() => {
                if (companySigRef.current && !companySigRef.current.isEmpty()) {
                  setCompanySigData(companySigRef.current.toDataURL("image/png"));
                }
              }}
            />
          </div>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs"
            onClick={() => { companySigRef.current?.clear(); setCompanySigData(null); }}>
            Effacer
          </Button>
        </div>
      )}

      {step.id === "review" && (
        <div className="space-y-3">
          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
            <p className="font-medium mb-1">Récapitulatif</p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>• {selectedReserves.length} réserve(s) à lever</li>
              <li>• {selectedReserves.reduce((n, r) => n + (photosBefore[r.id]?.length ?? 0), 0)} photo(s) avant</li>
              <li>• {selectedReserves.reduce((n, r) => n + (photosAfter[r.id]?.length ?? 0), 0)} photo(s) après</li>
              <li>• Signature entreprise : {companySigData ? "✓" : "—"}</li>
              <li>• Technicien : {includeTechnicianSig ? `${technicianName || "—"} ${techSigData ? "(signé)" : ""}` : "Non inclus"}</li>
            </ul>
          </div>
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
            En finalisant, un PV de levée est généré (PDF client + interne) et le client recevra un email
            pour valider et signer la levée depuis son espace.
          </div>
        </div>
      )}
    </div>
  );

  const Footer = (
    <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
      <Button
        variant="outline" size="sm"
        onClick={goPrev}
        disabled={stepIdx === 0 || submitting}
      >
        <ChevronLeft className="h-4 w-4" /> Précédent
      </Button>
      <span className="text-[11px] text-muted-foreground">Étape {stepIdx + 1} / {STEPS.length}</span>
      {step.id === "review" ? (
        <Button size="sm" onClick={handleFinalize} disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Finaliser et envoyer
        </Button>
      ) : (
        <Button size="sm" onClick={goNext} disabled={submitting}>
          Suivant <ChevronRight className="h-4 w-4" />
        </Button>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[92vh] overflow-y-auto flex flex-col">
          <SheetHeader>
            <SheetTitle>Levée de réserve</SheetTitle>
            <SheetDescription>Workflow guidé pour traiter et envoyer la levée au client.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto py-3">{Body}</div>
          {Footer}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Levée de réserve</DialogTitle>
          <DialogDescription>Workflow guidé pour traiter et envoyer la levée au client.</DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto pr-1">{Body}</div>
        {Footer}
      </DialogContent>
    </Dialog>
  );
}
