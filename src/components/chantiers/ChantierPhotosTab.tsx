import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, MapPin, MapPinOff, Plus, Trash2, Upload, Download, X, Loader2, Image as ImageIcon, FolderOpen } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { listChantierPhotos, createChantierPhoto, deleteChantierPhoto } from "@/lib/chantier-photos.functions";
import { tryGetGps, readExif, sanitizeExifForUpload } from "@/lib/photo-exif";
import { compressImageFile } from "@/lib/image-compress";

type PhotoType = "before" | "during" | "after";
type Photo = {
  id: string;
  photo_type: PhotoType;
  label: string | null;
  caption: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  taken_at: string | null;
  storage_path: string;
  signed_url: string | null;
  uploader_name: string | null;
  file_name: string | null;
  created_at: string;
};

const SECTIONS: { type: PhotoType; title: string; emptyLabel: string }[] = [
  { type: "before", title: "Avant travaux", emptyLabel: "Aucune photo avant travaux" },
  { type: "during", title: "Pendant travaux", emptyLabel: "Aucune photo pendant travaux" },
  { type: "after", title: "Fin de chantier", emptyLabel: "Aucune photo de fin de chantier" },
];

function fmtShort(iso: string | null | undefined) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }); }
  catch { return ""; }
}
function fmtFull(iso: string | null | undefined) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }); }
  catch { return ""; }
}

async function sha256Hex(file: File): Promise<string | null> {
  try {
    const buf = await file.arrayBuffer();
    const hash = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch { return null; }
}

export function ChantierPhotosTab({
  companyId, chantierId, canWrite,
}: { companyId: string; chantierId: string; canWrite: boolean }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [defaultType, setDefaultType] = useState<PhotoType>("before");
  const [lightbox, setLightbox] = useState<Photo | null>(null);

  const listFn = useServerFn(listChantierPhotos);
  const createFn = useServerFn(createChantierPhoto);
  const deleteFn = useServerFn(deleteChantierPhoto);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listFn({ data: { companyId, chantierId } });
      setPhotos(r.photos as Photo[]);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Chargement impossible"); }
    finally { setLoading(false); }
  }, [listFn, companyId, chantierId]);

  useEffect(() => { void reload(); }, [reload]);

  function openUpload(type: PhotoType) { setDefaultType(type); setUploadOpen(true); }

  async function handleDelete(p: Photo) {
    if (!confirm(`Supprimer la photo ${p.label ?? ""} ?`)) return;
    try {
      await deleteFn({ data: { companyId, id: p.id } });
      toast.success("Photo supprimée");
      setLightbox(null);
      await reload();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Suppression impossible"); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Photos chantier</h2>
        {canWrite && (
          <Button size="sm" onClick={() => openUpload("during")}>
            <Plus className="h-4 w-4" /> Ajouter photo
          </Button>
        )}
      </div>

      {loading ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
        </Card>
      ) : photos.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-muted">
            <Camera className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium">Aucune photo chantier</p>
            <p className="mt-1 text-xs text-muted-foreground">Ajoutez des photos avant, pendant ou en fin de chantier.</p>
          </div>
          {canWrite && (
            <Button size="sm" onClick={() => openUpload("during")}>
              <Plus className="h-4 w-4" /> Ajouter des photos
            </Button>
          )}
        </Card>
      ) : (
        SECTIONS.map((s) => {
          const items = photos.filter((p) => p.photo_type === s.type);
          return (
            <section key={s.type}>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{s.title} <span className="text-xs font-normal text-muted-foreground">({items.length})</span></h3>
                {canWrite && items.length > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => openUpload(s.type)} className="h-7 gap-1 px-2 text-xs">
                    <Plus className="h-3.5 w-3.5" /> Ajouter
                  </Button>
                )}
              </div>
              {items.length === 0 ? (
                <Card className="flex items-center justify-between gap-2 p-3 text-xs text-muted-foreground">
                  <span>{s.emptyLabel}</span>
                  {canWrite && (
                    <Button size="sm" variant="outline" onClick={() => openUpload(s.type)} className="h-7 gap-1 px-2">
                      <Plus className="h-3.5 w-3.5" /> Ajouter
                    </Button>
                  )}
                </Card>
              ) : (
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  {items.map((p) => {
                    const hasGps = p.latitude !== null && p.longitude !== null;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setLightbox(p)}
                        className="group relative aspect-square overflow-hidden rounded-md border border-border bg-muted/30 text-left active:scale-[0.98] transition"
                      >
                        {p.signed_url ? (
                          <img src={p.signed_url} alt={p.label ?? ""} loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-muted-foreground"><Camera className="h-6 w-6" /></div>
                        )}
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1.5 text-[10px] text-white">
                          <div className="flex items-center justify-between gap-1">
                            <span className="truncate font-mono">{p.label ?? "—"}</span>
                            <span className="shrink-0">{fmtShort(p.taken_at ?? p.created_at)}</span>
                          </div>
                        </div>
                        <div className="absolute right-1 top-1">
                          {hasGps ? (
                            <span className="inline-flex items-center gap-0.5 rounded bg-emerald-600/90 px-1 py-0.5 text-[9px] font-medium text-white"><MapPin className="h-2.5 w-2.5" /> GPS</span>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 rounded bg-amber-600/90 px-1 py-0.5 text-[9px] font-medium text-white"><MapPinOff className="h-2.5 w-2.5" /></span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })
      )}

      {canWrite && (
        <UploadSheet
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          defaultType={defaultType}
          companyId={companyId}
          chantierId={chantierId}
          onUploaded={async () => { setUploadOpen(false); await reload(); }}
          createFn={createFn}
        />
      )}

      <LightboxDialog
        photo={lightbox}
        onClose={() => setLightbox(null)}
        onDelete={canWrite ? handleDelete : undefined}
      />
    </div>
  );
}

function UploadSheet({
  open, onOpenChange, defaultType, companyId, chantierId, onUploaded, createFn,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultType: PhotoType;
  companyId: string;
  chantierId: string;
  onUploaded: () => Promise<void>;
  createFn: ReturnType<typeof useServerFn<typeof createChantierPhoto>>;
}) {
  const [type, setType] = useState<PhotoType>(defaultType);
  const [caption, setCaption] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setType(defaultType); setCaption(""); setFiles([]); setProgress(0); } }, [open, defaultType]);

  function appendFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
  }
  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (uploading) return;
    if (files.length === 0) { toast.error("Sélectionnez au moins une photo"); return; }
    setUploading(true);
    setProgress(0);

    const browserGps = await tryGetGps();
    const deviceInfo = typeof navigator !== "undefined" ? navigator.userAgent : "";
    let ok = 0; let fail = 0;

    for (let i = 0; i < files.length; i++) {
      const raw = files[i];
      try {
        const { file } = await compressImageFile(raw, { maxWidth: 1600, maxHeight: 1600 });
        const exif = await readExif(raw);
        let latitude = browserGps.latitude;
        let longitude = browserGps.longitude;
        let accuracy = browserGps.accuracy;
        if (latitude === null && exif) {
          const exLat = typeof exif.latitude === "number" ? exif.latitude as number : null;
          const exLng = typeof exif.longitude === "number" ? exif.longitude as number : null;
          if (exLat !== null && exLng !== null) { latitude = exLat; longitude = exLng; }
        }
        let takenAt: string | null = null;
        const ed: any = exif?.DateTimeOriginal ?? exif?.CreateDate;
        if (ed instanceof Date && !isNaN(ed.getTime())) takenAt = ed.toISOString();
        else if (typeof ed === "string") { const d = new Date(ed); if (!isNaN(d.getTime())) takenAt = d.toISOString(); }

        const hash = await sha256Hex(file);
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storagePath = `${companyId}/chantiers/${chantierId}/photos/${type}/${Date.now()}-${i}-${safeName}`;
        const { error: upErr } = await supabase.storage.from("pv-assets").upload(storagePath, file, {
          contentType: file.type || "image/jpeg",
          upsert: false,
        });
        if (upErr) throw upErr;

        await createFn({
          data: {
            companyId, chantierId,
            photo_type: type,
            storage_path: storagePath,
            file_name: file.name,
            file_size: file.size,
            file_hash: hash,
            caption: caption || null,
            latitude, longitude, accuracy,
            taken_at: takenAt,
            device_info: { ua: deviceInfo },
            exif_metadata: sanitizeExifForUpload(exif),
          },
        });
        ok++;
      } catch (err) {
        fail++;
        console.error("Upload failed", err);
      }
      setProgress(Math.round(((i + 1) / files.length) * 100));
    }

    if (ok > 0) toast.success(`${ok} photo(s) ajoutée(s)${fail ? ` — ${fail} échec(s)` : ""}`);
    else toast.error("Aucune photo n'a pu être uploadée");
    setUploading(false);
    if (ok > 0) await onUploaded();
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!uploading) onOpenChange(o); }}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
        <SheetHeader><SheetTitle>Ajouter des photos chantier</SheetTitle></SheetHeader>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <Label>Type de photo</Label>
            <Select value={type} onValueChange={(v) => setType(v as PhotoType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="before">Avant travaux</SelectItem>
                <SelectItem value="during">Pendant travaux</SelectItem>
                <SelectItem value="after">Fin de chantier</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Photos *</Label>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              className="block w-full text-sm file:mr-2 file:rounded file:border-0 file:bg-primary file:px-3 file:py-2 file:text-primary-foreground"
            />
            {files.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{files.length} fichier(s) sélectionné(s)</p>}
          </div>
          <div>
            <Label>1. Type de photo</Label>
            <Select value={type} onValueChange={(v) => setType(v as PhotoType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="before">Avant travaux</SelectItem>
                <SelectItem value="during">Pendant travaux</SelectItem>
                <SelectItem value="after">Fin de chantier</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>2. Source des photos</Label>
            <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Button type="button" variant="outline" className="h-auto justify-start gap-2 py-3" onClick={() => cameraRef.current?.click()} disabled={uploading}>
                <Camera className="h-4 w-4" />
                <span className="text-left text-xs leading-tight">Prendre<br />une photo</span>
              </Button>
              <Button type="button" variant="outline" className="h-auto justify-start gap-2 py-3" onClick={() => galleryRef.current?.click()} disabled={uploading}>
                <ImageIcon className="h-4 w-4" />
                <span className="text-left text-xs leading-tight">Choisir depuis<br />la galerie</span>
              </Button>
              <Button type="button" variant="outline" className="h-auto justify-start gap-2 py-3" onClick={() => fileRef.current?.click()} disabled={uploading}>
                <FolderOpen className="h-4 w-4" />
                <span className="text-left text-xs leading-tight">Choisir un<br />fichier image</span>
              </Button>
            </div>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { appendFiles(e.target.files); e.target.value = ""; }} />
            <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { appendFiles(e.target.files); e.target.value = ""; }} />
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { appendFiles(e.target.files); e.target.value = ""; }} />
            {files.length > 0 && (
              <ul className="mt-2 space-y-1">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded border border-border bg-muted/30 p-1.5 text-xs">
                    <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate flex-1">{f.name}</span>
                    <span className="text-muted-foreground">{Math.round(f.size / 1024)} Ko</span>
                    <button type="button" onClick={() => removeFile(i)} disabled={uploading} className="text-muted-foreground hover:text-destructive">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <Label>3. Commentaire (optionnel)</Label>
            <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={2000} rows={3} placeholder="Description, contexte, etc." />
          </div>
          {uploading && (
            <div className="rounded bg-muted p-2 text-xs">Upload en cours… {progress}%</div>
          )}
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={uploading}>Annuler</Button>
            <Button type="submit" disabled={uploading || files.length === 0}>
              {uploading ? <><Loader2 className="h-4 w-4 animate-spin" /> Upload…</> : <><Upload className="h-4 w-4" /> Uploader {files.length > 0 ? `(${files.length})` : ""}</>}
            </Button>
          </DialogFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function LightboxDialog({
  photo, onClose, onDelete,
}: { photo: Photo | null; onClose: () => void; onDelete?: (p: Photo) => void }) {
  if (!photo) return null;
  const hasGps = photo.latitude !== null && photo.longitude !== null;
  const typeLabel = photo.photo_type === "before" ? "Avant travaux" : photo.photo_type === "during" ? "Pendant travaux" : "Fin de chantier";
  return (
    <Dialog open={!!photo} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl p-0">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
            <span>{typeLabel}</span>
            {photo.label && <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{photo.label}</span>}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 p-3 md:grid-cols-[1fr_240px]">
          <div className="flex items-center justify-center rounded bg-black/95 min-h-[260px]">
            {photo.signed_url ? (
              <img src={photo.signed_url} alt={photo.label ?? ""} className="max-h-[70vh] w-full object-contain" />
            ) : <span className="text-xs text-muted-foreground">Image indisponible</span>}
          </div>
          <aside className="space-y-2 text-xs">
            <div className="rounded border border-border p-2">
              <div className="text-[10px] font-medium uppercase text-muted-foreground">Photo</div>
              {photo.file_name && <div className="break-all text-[11px] text-muted-foreground">{photo.file_name}</div>}
              <div>Prise : {fmtFull(photo.taken_at)}</div>
              <div className="text-muted-foreground">Upload : {fmtFull(photo.created_at)}</div>
              {photo.uploader_name && <div className="text-muted-foreground">Par : {photo.uploader_name}</div>}
            </div>
            {photo.caption && (
              <div className="rounded border border-border p-2">
                <div className="text-[10px] font-medium uppercase text-muted-foreground">Commentaire</div>
                <p className="whitespace-pre-wrap">{photo.caption}</p>
              </div>
            )}
            <div className="rounded border border-border p-2">
              <div className="text-[10px] font-medium uppercase text-muted-foreground">Géolocalisation</div>
              {hasGps ? (
                <>
                  <div className="flex items-center gap-1 text-emerald-700"><MapPin className="h-3 w-3" /> Géolocalisée{photo.accuracy != null && <span className="text-muted-foreground"> ±{Math.round(photo.accuracy)}m</span>}</div>
                  <div className="font-mono text-[11px]">{photo.latitude!.toFixed(6)}, {photo.longitude!.toFixed(6)}</div>
                  <Button asChild size="sm" variant="outline" className="mt-1 h-7 px-2">
                    <a href={`https://www.google.com/maps?q=${photo.latitude},${photo.longitude}`} target="_blank" rel="noopener noreferrer">Voir sur la carte</a>
                  </Button>
                </>
              ) : (
                <div className="flex items-center gap-1 text-amber-700"><MapPinOff className="h-3 w-3" /> Non géolocalisée</div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {photo.signed_url && (
                <Button asChild size="sm" variant="outline" className="h-8 gap-1">
                  <a href={photo.signed_url} download={photo.file_name ?? photo.label ?? "photo.jpg"} target="_blank" rel="noopener noreferrer">
                    <Download className="h-3.5 w-3.5" /> Télécharger
                  </a>
                </Button>
              )}
              {onDelete && (
                <Button size="sm" variant="destructive" className="h-8 gap-1" onClick={() => onDelete(photo)}>
                  <Trash2 className="h-3.5 w-3.5" /> Supprimer
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-8 gap-1" onClick={onClose}>
                <X className="h-3.5 w-3.5" /> Fermer
              </Button>
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
