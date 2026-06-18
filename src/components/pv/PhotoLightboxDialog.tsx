import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, MapPin, MapPinOff, Calendar, Smartphone, Tag } from "lucide-react";
import { StatusPill } from "@/components/ui/status-pill";

export type LightboxPhoto = {
  id: string;
  url: string | null;
  label?: string | null;
  fileName?: string | null;
  takenAt?: string | null;
  uploadedAt?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
  deviceInfo?: string | null;
  photoType?: "initial" | "before" | "after" | "legacy" | string | null;
};

export type LightboxContext = {
  reserveNumero?: string | null;
  reserveDescription?: string | null;
  reserveStatus?: string | null;
  reserveSeverity?: string | null;
  /** When false, hide raw GPS coordinates (client-facing view). */
  showExactGps?: boolean;
};

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  } catch { return iso; }
}

function typeLabel(t?: string | null): string {
  switch (t) {
    case "initial": return "Constat initial";
    case "before": return "Avant levée";
    case "after": return "Après levée";
    case "legacy": return "Archivée";
    default: return "Photo";
  }
}

export function PhotoLightboxDialog({
  open, onOpenChange, photos, startIndex = 0, context,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  photos: LightboxPhoto[];
  startIndex?: number;
  context?: LightboxContext;
}) {
  const [idx, setIdx] = useState(startIndex);

  useEffect(() => { if (open) setIdx(Math.max(0, Math.min(startIndex, photos.length - 1))); },
    [open, startIndex, photos.length]);

  const prev = useCallback(() => setIdx((i) => (photos.length ? (i - 1 + photos.length) % photos.length : 0)), [photos.length]);
  const next = useCallback(() => setIdx((i) => (photos.length ? (i + 1) % photos.length : 0)), [photos.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, prev, next]);

  if (!photos.length) return null;
  const p = photos[idx];
  const hasGps = p.latitude !== null && p.latitude !== undefined && p.longitude !== null && p.longitude !== undefined;
  const showExact = context?.showExactGps !== false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl p-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
            <span>{typeLabel(p.photoType)}</span>
            {p.label && (
              <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                <Tag className="h-3 w-3" /> {p.label}
              </span>
            )}
            <span className="text-xs font-normal text-muted-foreground">
              {idx + 1} / {photos.length}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="relative grid gap-3 bg-background p-3 md:grid-cols-[1fr_280px]">
          <div className="relative flex items-center justify-center rounded-md bg-black/95 min-h-[300px] md:min-h-[480px]">
            {p.url ? (
              <img src={p.url} alt={p.label ?? ""} className="max-h-[70vh] w-full object-contain" />
            ) : (
              <div className="text-xs text-muted-foreground">Image indisponible</div>
            )}
            {photos.length > 1 && (
              <>
                <Button
                  size="icon" variant="secondary"
                  className="absolute left-2 top-1/2 -translate-y-1/2 opacity-90"
                  onClick={prev} aria-label="Précédent">
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <Button
                  size="icon" variant="secondary"
                  className="absolute right-2 top-1/2 -translate-y-1/2 opacity-90"
                  onClick={next} aria-label="Suivant">
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </>
            )}
          </div>

          <aside className="space-y-3 text-xs">
            {context && (
              <section className="space-y-1.5 rounded border border-border p-2">
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Réserve</div>
                {context.reserveNumero && <div className="font-mono text-[11px]">{context.reserveNumero}</div>}
                <div className="flex flex-wrap gap-1.5">
                  {context.reserveSeverity && (
                    <StatusPill size="sm" tone={context.reserveSeverity === "majeure" ? "destructive" : "neutral"}>
                      {context.reserveSeverity}
                    </StatusPill>
                  )}
                  {context.reserveStatus && (
                    <StatusPill size="sm" tone="neutral" dot>{context.reserveStatus}</StatusPill>
                  )}
                </div>
                {context.reserveDescription && (
                  <p className="line-clamp-4 text-muted-foreground">{context.reserveDescription}</p>
                )}
              </section>
            )}

            <section className="space-y-1.5 rounded border border-border p-2">
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Photo</div>
              {p.fileName && <div className="break-all text-[11px] text-muted-foreground">{p.fileName}</div>}
              <div className="flex items-start gap-1.5">
                <Calendar className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                <div>
                  <div>Prise : {fmtDate(p.takenAt)}</div>
                  <div className="text-muted-foreground">Upload : {fmtDate(p.uploadedAt)}</div>
                </div>
              </div>
              {p.deviceInfo && (
                <div className="flex items-start gap-1.5">
                  <Smartphone className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                  <div className="break-all text-muted-foreground">{p.deviceInfo}</div>
                </div>
              )}
            </section>

            <section className="space-y-1.5 rounded border border-border p-2">
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Géolocalisation</div>
              {hasGps ? (
                <>
                  <div className="flex items-center gap-1.5 text-emerald-700">
                    <MapPin className="h-3 w-3" /> Photo géolocalisée
                    {p.accuracy != null && <span className="text-muted-foreground">±{Math.round(p.accuracy)}m</span>}
                  </div>
                  {showExact && (
                    <>
                      <div className="font-mono text-[11px]">
                        {(p.latitude as number).toFixed(6)}, {(p.longitude as number).toFixed(6)}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <Button asChild size="sm" variant="outline" className="h-7 px-2">
                          <a href={`https://www.google.com/maps?q=${p.latitude},${p.longitude}`} target="_blank" rel="noopener noreferrer">Google Maps</a>
                        </Button>
                        <Button asChild size="sm" variant="outline" className="h-7 px-2">
                          <a href={`https://www.openstreetmap.org/?mlat=${p.latitude}&mlon=${p.longitude}#map=18/${p.latitude}/${p.longitude}`} target="_blank" rel="noopener noreferrer">OSM</a>
                        </Button>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-1.5 text-amber-700">
                  <MapPinOff className="h-3 w-3" /> Photo non géolocalisée
                </div>
              )}
            </section>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
