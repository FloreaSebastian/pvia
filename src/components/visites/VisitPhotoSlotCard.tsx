import { useRef, useState } from "react";
import { Camera, Loader2, Trash2, Ban, MapPin, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { addVisitPhoto, deleteVisitPhoto, skipVisitPhoto, removeVisitPhotoSkip } from "@/lib/visites.functions";
import { compressImageFile } from "@/lib/image-compress";
import { readExif, sanitizeExifForUpload, tryGetGps } from "@/lib/photo-exif";
import { PHOTO_SKIP_REASON_LABEL, type PhotoSkipReason } from "@/lib/visites/types";
import type { ResolvedPhotoSlot } from "@/lib/visites/engine";

export interface VisitPhotoRow {
  id: string;
  section_key: string;
  slot_key: string;
  storage_path: string;
  caption: string | null;
  comment: string | null;
  latitude: number | null;
  longitude: number | null;
  taken_at: string | null;
  file_name: string | null;
  created_at?: string | null;
  signed_url?: string | null;
}

export interface VisitPhotoSkipRow {
  id: string;
  section_key: string;
  slot_key: string;
  reason: string;
  justification: string;
}

interface Props {
  companyId: string;
  visitId: string;
  sectionKey: string;
  slot: ResolvedPhotoSlot;
  photos: VisitPhotoRow[];
  skip: VisitPhotoSkipRow | null;
  canEdit: boolean;
  onChanged: () => void | Promise<void>;
}

async function fileHash(file: File): Promise<string | null> {
  try {
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

/** Carte photo terrain : capture appareil, GPS/EXIF, ou motif « impossible ». */
export function VisitPhotoSlotCard({
  companyId, visitId, sectionKey, slot, photos, skip, canEdit, onChanged,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);
  const [skipReason, setSkipReason] = useState<PhotoSkipReason>("inaccessible");
  const [skipText, setSkipText] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const addFn = useServerFn(addVisitPhoto);
  const delFn = useServerFn(deleteVisitPhoto);
  const skipFn = useServerFn(skipVisitPhoto);
  const unskipFn = useServerFn(removeVisitPhotoSkip);

  const done = photos.length > 0;
  const skipped = !!skip && !done;

  async function upload(list: FileList | null) {
    if (!list || list.length === 0 || busy) return;
    setBusy(true);
    const gps = await tryGetGps();
    let ok = 0;
    for (let i = 0; i < list.length; i++) {
      const raw = list[i];
      try {
        if (!raw.type.startsWith("image/")) throw new Error("Format non supporté.");
        const { file } = await compressImageFile(raw, { maxWidth: 1600, maxHeight: 1600 });
        const exif = await readExif(raw);
        let latitude = gps.latitude;
        let longitude = gps.longitude;
        let accuracy = gps.accuracy;
        if (latitude === null && exif) {
          const la = typeof exif.latitude === "number" ? (exif.latitude as number) : null;
          const lo = typeof exif.longitude === "number" ? (exif.longitude as number) : null;
          if (la !== null && lo !== null) {
            latitude = la;
            longitude = lo;
          }
        }
        let takenAt: string | null = null;
        const ed: any = exif?.DateTimeOriginal ?? exif?.CreateDate;
        if (ed instanceof Date && !Number.isNaN(ed.getTime())) takenAt = ed.toISOString();
        else if (typeof ed === "string") {
          const d = new Date(ed);
          if (!Number.isNaN(d.getTime())) takenAt = d.toISOString();
        }

        const safeName = (file.name || "photo.jpg").replace(/[^a-zA-Z0-9._-]/g, "_");
        const storagePath = `${companyId}/visites/${visitId}/${slot.answerKey}/${Date.now()}-${i}-${safeName}`;
        const { error: upErr } = await supabase.storage
          .from("pv-assets")
          .upload(storagePath, file, { contentType: file.type || "image/jpeg", upsert: false });
        if (upErr) throw upErr;

        await addFn({
          data: {
            companyId,
            visitId,
            photo: {
              section_key: sectionKey,
              slot_key: slot.answerKey,
              storage_path: storagePath,
              caption: slot.label.slice(0, 500),
              latitude,
              longitude,
              accuracy,
              taken_at: takenAt,
              exif_metadata: sanitizeExifForUpload(exif),
              file_hash: await fileHash(file),
              file_name: file.name?.slice(0, 300) ?? null,
              file_size: file.size,
            },
          },
        });
        ok++;
        if (!slot.multiple) break;
      } catch (e: any) {
        toast.error(e?.message ?? "Envoi de la photo impossible");
      }
    }
    if (inputRef.current) inputRef.current.value = "";
    setBusy(false);
    if (ok > 0) {
      toast.success(ok > 1 ? `${ok} photos ajoutées` : "Photo ajoutée");
      await onChanged();
    }
  }

  async function confirmSkip() {
    if (skipText.trim().length < 3) {
      toast.error("Précisez le motif (3 caractères minimum).");
      return;
    }
    setBusy(true);
    try {
      await skipFn({
        data: {
          companyId, visitId,
          section_key: sectionKey,
          slot_key: slot.answerKey,
          reason: skipReason,
          justification: skipText.trim(),
        },
      });
      setSkipOpen(false);
      setSkipText("");
      toast.success("Motif enregistré");
      await onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Enregistrement impossible");
    } finally {
      setBusy(false);
    }
  }

  async function undoSkip() {
    setBusy(true);
    try {
      await unskipFn({ data: { companyId, visitId, slot_key: slot.answerKey } });
      await onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Action impossible");
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto(photoId: string) {
    setBusy(true);
    try {
      await delFn({ data: { companyId, visitId, photoId } });
      setPendingDelete(null);
      await onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Suppression impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={cn(
        "min-w-0 rounded-xl border p-3",
        done ? "border-emerald-300 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20" : "border-border",
        skipped && "border-amber-300 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/20",
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-1 text-sm font-medium leading-snug">
            <span className="break-words">{slot.label}</span>
            {slot.required ? (
              <span className="text-destructive" aria-hidden="true">
                *
              </span>
            ) : null}
          </p>
          {slot.instruction ? (
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{slot.instruction}</p>
          ) : null}
        </div>
        {done ? (
          <Badge variant="secondary" className="shrink-0 border-0 bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
            <Check className="mr-1 h-3 w-3" aria-hidden="true" />
            {photos.length}
          </Badge>
        ) : skipped ? (
          <Badge variant="secondary" className="shrink-0 border-0 bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Non prise
          </Badge>
        ) : null}
      </div>

      {photos.length > 0 ? (
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {photos.map((p) => (
            <li key={p.id} className="group relative overflow-hidden rounded-lg border bg-muted">
              {p.signed_url ? (
                <img
                  src={p.signed_url}
                  alt={p.caption || slot.label}
                  loading="lazy"
                  className="aspect-square w-full object-cover"
                />
              ) : (
                <div className="flex aspect-square items-center justify-center text-xs text-muted-foreground">
                  Aperçu indisponible
                </div>
              )}
              {p.latitude !== null && p.longitude !== null ? (
                <span className="absolute left-1 top-1 rounded bg-background/85 p-1" title="Position GPS enregistrée">
                  <MapPin className="h-3 w-3" aria-hidden="true" />
                  <span className="sr-only">Position GPS enregistrée</span>
                </span>
              ) : null}
              {canEdit ? (
                <Button
                  type="button"
                  size="icon"
                  variant="destructive"
                  className="absolute right-1 top-1 h-9 w-9"
                  onClick={() => setPendingDelete(p.id)}
                  aria-label={`Supprimer la photo ${p.caption || slot.label}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {skipped && skip ? (
        <div className="mt-3 rounded-lg bg-background/60 p-2 text-xs">
          <p className="font-medium">{PHOTO_SKIP_REASON_LABEL[skip.reason as PhotoSkipReason] ?? skip.reason}</p>
          <p className="mt-0.5 break-words text-muted-foreground">{skip.justification}</p>
          {canEdit ? (
            <Button type="button" variant="ghost" size="sm" className="mt-1 h-9 px-2" onClick={undoSkip} disabled={busy}>
              <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Annuler le motif
            </Button>
          ) : null}
        </div>
      ) : null}

      {canEdit ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple={slot.multiple}
            className="hidden"
            onChange={(e) => upload(e.target.files)}
          />
          <Button
            type="button"
            size="sm"
            className="h-11 flex-1 min-w-[8rem]"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Camera className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {done ? (slot.multiple ? "Ajouter" : "Remplacer") : "Photographier"}
          </Button>
          {!done && !skipped ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-11"
              onClick={() => setSkipOpen(true)}
              disabled={busy}
            >
              <Ban className="mr-2 h-4 w-4" aria-hidden="true" />
              Impossible
            </Button>
          ) : null}
        </div>
      ) : null}

      <Dialog open={skipOpen} onOpenChange={setSkipOpen}>
        <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="break-words">Photo impossible — {slot.label}</DialogTitle>
            <DialogDescription>
              Le motif est conservé dans le rapport et l'historique de la visite.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor={`skip-reason-${slot.answerKey}`}>Motif</Label>
              <Select value={skipReason} onValueChange={(v) => setSkipReason(v as PhotoSkipReason)}>
                <SelectTrigger id={`skip-reason-${slot.answerKey}`} className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PHOTO_SKIP_REASON_LABEL).map(([v, l]) => (
                    <SelectItem key={v} value={v} className="min-h-11">
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`skip-text-${slot.answerKey}`}>Justification</Label>
              <Textarea
                id={`skip-text-${slot.answerKey}`}
                value={skipText}
                onChange={(e) => setSkipText(e.target.value)}
                rows={3}
                placeholder="Ex. toiture inaccessible sans nacelle"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" className="h-11" onClick={() => setSkipOpen(false)}>
              Annuler
            </Button>
            <Button type="button" className="h-11" onClick={confirmSkip} disabled={busy}>
              Enregistrer le motif
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Supprimer cette photo ?</DialogTitle>
            <DialogDescription>Cette action est définitive.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" className="h-11" onClick={() => setPendingDelete(null)}>
              Annuler
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-11"
              onClick={() => pendingDelete && removePhoto(pendingDelete)}
              disabled={busy}
            >
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
