import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import SignaturePad from "react-signature-canvas";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Loader2, ArrowLeft, ChevronRight, Save, Send, MapPin, MapPinOff, X } from "lucide-react";
import { toast } from "sonner";
import { createReserveLift } from "@/lib/reserve-lift.functions";
import { fileToBase64 } from "@/lib/file-upload";
import { tryGetGps, readExif, sanitizeExifForUpload, type PhotoEntry } from "@/lib/photo-exif";

export const Route = createFileRoute("/_authenticated/pv/$id/levee-reserves")({
  component: LeveeReserves,
  validateSearch: (s: Record<string, unknown>) => ({
    reserveId: typeof s.reserveId === "string" ? s.reserveId : undefined,
  }),
  head: () => ({ meta: [{ title: "Levée de réserves — PVIA" }] }),
});

type Reserve = { id: string; description: string; severity: string; status: string };

type PhotoEntry = {
  file: File;
  previewUrl: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  takenAt: string;
  deviceInfo: string;
  exifMetadata: Record<string, unknown> | null;
  gpsSource: "browser" | "exif" | "none";
};

/** Try to get GPS coords. Resolves with null fields if permission denied / unsupported. */
function tryGetGps(): Promise<{ latitude: number | null; longitude: number | null; accuracy: number | null }> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ latitude: null, longitude: null, accuracy: null });
      return;
    }
    const timer = setTimeout(() => resolve({ latitude: null, longitude: null, accuracy: null }), 8000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
        });
      },
      () => {
        clearTimeout(timer);
        resolve({ latitude: null, longitude: null, accuracy: null });
      },
      { enableHighAccuracy: true, timeout: 7000, maximumAge: 30_000 },
    );
  });
}

/** Read EXIF tags (GPS, dates, camera) from a file. Never throws. */
async function readExif(file: File): Promise<Record<string, unknown> | null> {
  try {
    const exif = await exifr.parse(file, {
      gps: true,
      tiff: true,
      exif: true,
      pick: [
        "latitude", "longitude", "GPSAltitude", "GPSHPositioningError",
        "DateTimeOriginal", "CreateDate", "ModifyDate",
        "Make", "Model", "Software", "Orientation", "LensModel",
      ],
    });
    return (exif as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}

/** Convert exif into a JSON-safe object (Date → ISO string). Limits depth & keys. */
function sanitizeExifForUpload(exif: Record<string, unknown> | null): Record<string, any> | null {
  if (!exif) return null;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(exif)) {
    if (v == null) continue;
    if (v instanceof Date) out[k] = v.toISOString();
    else if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") out[k] = v;
    else if (typeof v === "object") {
      try { out[k] = JSON.parse(JSON.stringify(v)); } catch { /* skip */ }
    }
  }
  return out;
}

function LeveeReserves() {
  const { id: pvId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const createFn = useServerFn(createReserveLift);

  const [pvNumero, setPvNumero] = useState<string>("");
  const [reserves, setReserves] = useState<Reserve[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [itemComment, setItemComment] = useState<Record<string, string>>({});
  const [itemPhotosBefore, setItemPhotosBefore] = useState<Record<string, PhotoEntry[]>>({});
  const [itemPhotosAfter, setItemPhotosAfter] = useState<Record<string, PhotoEntry[]>>({});
  const [globalComment, setGlobalComment] = useState("");
  const [technicianName, setTechnicianName] = useState("");
  const [includeTechnicianSig, setIncludeTechnicianSig] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const companySigRef = useRef<SignaturePad>(null);
  const technicianSigRef = useRef<SignaturePad>(null);

  useEffect(() => {
    (async () => {
      const [pvRes, resRes] = await Promise.all([
        supabase.from("pv").select("numero").eq("id", pvId).maybeSingle(),
        supabase.from("pv_reserves").select("id,description,severity,status").eq("pv_id", pvId).in("status", ["ouverte", "en_cours", "rejetee"]).order("created_at"),
      ]);
      setPvNumero(pvRes.data?.numero ?? "");
      const rs = (resRes.data ?? []) as Reserve[];
      setReserves(rs);
      if (search.reserveId && rs.some((r) => r.id === search.reserveId)) {
        setSelected({ [search.reserveId]: true });
      }
      setLoading(false);
    })();
  }, [pvId, search.reserveId]);

  async function handleFilesPicked(
    rid: string,
    kind: "before" | "after",
    files: FileList | null,
  ) {
    if (!files || files.length === 0) return;
    const browserGps = await tryGetGps();
    const deviceInfo = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 400) : "";
    let warnedNoGps = false;
    const entries: PhotoEntry[] = await Promise.all(
      Array.from(files).map(async (file) => {
        const exif = await readExif(file);
        // GPS priority: browser → EXIF → none
        let latitude = browserGps.latitude;
        let longitude = browserGps.longitude;
        let accuracy = browserGps.accuracy;
        let gpsSource: PhotoEntry["gpsSource"] = browserGps.latitude !== null ? "browser" : "none";
        if (latitude === null && exif) {
          const exLat = typeof exif.latitude === "number" ? (exif.latitude as number) : null;
          const exLng = typeof exif.longitude === "number" ? (exif.longitude as number) : null;
          if (exLat !== null && exLng !== null) {
            latitude = exLat;
            longitude = exLng;
            const hpe = (exif as any).GPSHPositioningError;
            accuracy = typeof hpe === "number" ? hpe : null;
            gpsSource = "exif";
          }
        }
        if (latitude === null && !warnedNoGps) {
          toast.message("Photo non géolocalisée (GPS refusé et EXIF absent).");
          warnedNoGps = true;
        }
        // taken_at: EXIF DateTimeOriginal > now
        let takenAt = new Date().toISOString();
        const exifDate = exif?.DateTimeOriginal ?? exif?.CreateDate;
        if (exifDate instanceof Date && !isNaN(exifDate.getTime())) {
          takenAt = exifDate.toISOString();
        } else if (typeof exifDate === "string") {
          const d = new Date(exifDate);
          if (!isNaN(d.getTime())) takenAt = d.toISOString();
        }
        return {
          file,
          previewUrl: URL.createObjectURL(file),
          latitude,
          longitude,
          accuracy,
          takenAt,
          deviceInfo,
          exifMetadata: exif ? { ...exif, gps_source: gpsSource, browser_gps: browserGps } : { gps_source: gpsSource, browser_gps: browserGps },
          gpsSource,
        };
      }),
    );
    const setter = kind === "before" ? setItemPhotosBefore : setItemPhotosAfter;
    setter((prev) => ({ ...prev, [rid]: [...(prev[rid] ?? []), ...entries] }));
  }

  function removePhoto(rid: string, kind: "before" | "after", idx: number) {
    const setter = kind === "before" ? setItemPhotosBefore : setItemPhotosAfter;
    setter((prev) => {
      const list = [...(prev[rid] ?? [])];
      const removed = list.splice(idx, 1);
      removed.forEach((e) => URL.revokeObjectURL(e.previewUrl));
      return { ...prev, [rid]: list };
    });
  }

  async function onSubmit(status: "brouillon" | "signe") {
    const ids = Object.keys(selected).filter((id) => selected[id]);
    if (ids.length === 0) return toast.error("Sélectionnez au moins une réserve.");
    if (status === "signe" && companySigRef.current?.isEmpty()) return toast.error("Signature entreprise obligatoire.");

    setSaving(true);
    try {
      const items = await Promise.all(
        ids.map(async (rid) => {
          const before = itemPhotosBefore[rid] ?? [];
          const after = itemPhotosAfter[rid] ?? [];
          const allPhotos = await Promise.all(
            [...before.map((e) => ({ e, t: "before" as const })), ...after.map((e) => ({ e, t: "after" as const }))]
              .map(async ({ e, t }) => ({
                base64: await fileToBase64(e.file),
                mimeType: e.file.type || "image/jpeg",
                fileName: e.file.name,
                photoType: t,
                latitude: e.latitude,
                longitude: e.longitude,
                accuracy: e.accuracy,
                takenAt: e.takenAt,
                deviceInfo: e.deviceInfo,
                exifMetadata: sanitizeExifForUpload(e.exifMetadata),
              })),
          );
          return { reserveId: rid, comment: itemComment[rid] || "", photos: allPhotos };
        }),
      );
      const res = await createFn({
        data: {
          pvId,
          status,
          comment: globalComment,
          requireClientSignature: false,
          items,
          companySignature: status === "signe" && !companySigRef.current?.isEmpty()
            ? companySigRef.current!.toDataURL("image/png") : null,
          clientSignature: null,
          technicianSignature: status === "signe" && includeTechnicianSig && !technicianSigRef.current?.isEmpty()
            ? technicianSigRef.current!.toDataURL("image/png") : null,
          technicianName: technicianName.trim() || null,
        },
      });
      toast.success(`Levée ${res.numero} ${status === "signe" ? "signée" : "enregistrée"}.`);
      navigate({ to: "/pv/$id", params: { id: pvId } });
    } catch (e: any) {
      toast.error(e?.message || "Échec de la création.");
    } finally {
      setSaving(false);
    }
  }

  function PhotoZone({
    rid, kind, label,
  }: { rid: string; kind: "before" | "after"; label: string }) {
    const list = (kind === "before" ? itemPhotosBefore : itemPhotosAfter)[rid] ?? [];
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">{label}</Label>
          <span className="text-[10px] text-muted-foreground">{list.length} photo(s)</span>
        </div>
        <input
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            void handleFilesPicked(rid, kind, e.target.files);
            e.target.value = "";
          }}
          className="block w-full text-xs"
        />
        {list.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
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
                      <>
                        <MapPin className="h-2.5 w-2.5 text-green-300" />
                        {p.accuracy ? `±${Math.round(p.accuracy)}m` : "GPS"}
                      </>
                    ) : (
                      <>
                        <MapPinOff className="h-2.5 w-2.5 text-amber-300" />
                        Non géoloc.
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  if (loading) return <div className="grid h-64 place-items-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link to="/pv" className="hover:text-foreground">PV</Link>
          <ChevronRight className="h-3 w-3" />
          <Link to="/pv/$id" params={{ id: pvId }} className="hover:text-foreground">{pvNumero}</Link>
          <ChevronRight className="h-3 w-3" />
          <span>Levée de réserves</span>
        </div>
        <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Créer une levée de réserves</h1>
        {reserves.length > 0 && (
          <p className="mt-0.5 text-xs text-muted-foreground">PV {pvNumero} · {reserves.length} réserve(s) à traiter</p>
        )}
      </div>

      {reserves.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
          Aucune réserve à lever sur ce PV.
          <Link to="/pv/$id" params={{ id: pvId }}><Button variant="outline" size="sm"><ArrowLeft className="h-4 w-4" /> Retour au PV</Button></Link>
        </Card>
      ) : (
        <Card className="space-y-2 p-4">
          <h2 className="text-sm font-semibold">Réserves à lever</h2>
          <p className="text-[11px] text-muted-foreground">
            La géolocalisation des photos est conservée comme preuve d'intervention. Son absence n'invalide ni la réserve ni sa levée.
          </p>
          <div className="space-y-2">
            {reserves.map((r) => (
              <div key={r.id} className="space-y-2 rounded-md border border-border p-2.5">
                <div className="flex items-start gap-2.5">
                  <Checkbox checked={!!selected[r.id]} onCheckedChange={(v) => setSelected((s) => ({ ...s, [r.id]: !!v }))} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug">{r.description}</p>
                    <p className="mt-0.5 text-[11px] uppercase tracking-wider text-muted-foreground">Sévérité : {r.severity}</p>
                  </div>
                </div>
                {selected[r.id] && (
                  <div className="ml-6 space-y-3">
                    <Textarea
                      placeholder="Intervention réalisée (optionnel)…"
                      rows={2}
                      value={itemComment[r.id] ?? ""}
                      onChange={(e) => setItemComment((c) => ({ ...c, [r.id]: e.target.value }))}
                    />
                    <PhotoZone rid={r.id} kind="before" label="Photos AVANT intervention" />
                    <PhotoZone rid={r.id} kind="after" label="Photos APRÈS intervention" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {reserves.length > 0 && (
        <>
          <Card className="space-y-2 p-4">
            <Label className="text-xs">Commentaire général (optionnel)</Label>
            <Textarea rows={2} value={globalComment} onChange={(e) => setGlobalComment(e.target.value)} placeholder="Conditions d'intervention, observations…" />
          </Card>

          <Card className="space-y-3 p-4">
            <div>
              <Label className="mb-1.5 block text-xs">Signature entreprise *</Label>
              <div className="rounded-md border border-border bg-background">
                <SignaturePad ref={companySigRef} canvasProps={{ className: "w-full h-28" }} />
              </div>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => companySigRef.current?.clear()}>Effacer</Button>
              <p className="mt-2 text-[11px] text-muted-foreground">
                La signature client sera collectée à distance, depuis l'espace client, lors de la validation de la levée.
              </p>
            </div>

            <div className="space-y-2 rounded-md border border-dashed border-border p-3">
              <div className="text-xs font-medium">Technicien intervenant (optionnel, PDF interne)</div>
              <Input
                placeholder="Nom du technicien sur site"
                value={technicianName}
                onChange={(e) => setTechnicianName(e.target.value)}
                className="h-8 text-sm"
              />
              <div className="flex items-center gap-2">
                <Switch checked={includeTechnicianSig} onCheckedChange={setIncludeTechnicianSig} />
                <Label className="!mt-0 text-xs">Collecter la signature du technicien</Label>
              </div>
              {includeTechnicianSig && (
                <div>
                  <div className="rounded-md border border-border bg-background">
                    <SignaturePad ref={technicianSigRef} canvasProps={{ className: "w-full h-24" }} />
                  </div>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => technicianSigRef.current?.clear()}>Effacer</Button>
                </div>
              )}
            </div>
          </Card>

          <div className="sticky bottom-0 -mx-4 flex flex-wrap justify-end gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
            <Link to="/pv/$id" params={{ id: pvId }} className="hidden sm:inline-block"><Button variant="ghost"><ArrowLeft className="h-4 w-4" /> Annuler</Button></Link>
            <Button variant="outline" disabled={saving} onClick={() => onSubmit("brouillon")}>
              <Save className="h-4 w-4" /> Brouillon
            </Button>
            <Button disabled={saving} onClick={() => onSubmit("signe")}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Signer et générer le PDF
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
