import { useRef, useState } from "react";
import { Camera, Loader2, Trash2, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { addFieldPhoto } from "@/lib/field.functions";
import { enqueue } from "@/lib/field-offline";
import { useOnlineStatus } from "@/hooks/use-online-status";

const KINDS = [
  { value: "avant", label: "Avant" },
  { value: "apres", label: "Après" },
  { value: "reserve", label: "Réserve" },
  { value: "autre", label: "Autre" },
] as const;
type Kind = (typeof KINDS)[number]["value"];

export type FieldPhoto = { id: string; signedUrl: string | null; kind?: string | null; caption?: string | null; localUrl?: string };

async function compressToDataUrl(file: File, maxSide = 1600, quality = 0.78): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }
  const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * ratio);
  const h = Math.round(bitmap.height * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

export function FieldPhotoCapture({
  pvId,
  photos,
  onAdd,
}: {
  pvId: string;
  photos: FieldPhoto[];
  onAdd: (p: FieldPhoto) => void;
}) {
  const [kind, setKind] = useState<Kind>("avant");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const online = useOnlineStatus();
  const addPhotoFn = useServerFn(addFieldPhoto);

  async function handleFile(file: File) {
    setBusy(true);
    try {
      const dataUrl = await compressToDataUrl(file);
      if (!online) {
        const op = await enqueue({ type: "photo", pvId, dataUrl, kind, caption: caption || null });
        onAdd({ id: op.id, signedUrl: null, kind, caption, localUrl: dataUrl });
        toast.success("Photo enregistrée hors ligne — sera synchronisée");
      } else {
        const res = await addPhotoFn({ data: { pvId, dataUrl, kind, caption: caption || null } });
        onAdd({ ...res.photo, localUrl: dataUrl } as FieldPhoto);
        toast.success("Photo ajoutée");
      }
      setCaption("");
    } catch (e: any) {
      // Network failure → enqueue
      try {
        const dataUrl = await compressToDataUrl(file);
        const op = await enqueue({ type: "photo", pvId, dataUrl, kind, caption: caption || null });
        onAdd({ id: op.id, signedUrl: null, kind, caption, localUrl: dataUrl });
        toast.message("Hors ligne — photo en file d'attente");
      } catch (err: any) {
        toast.error(e?.message || err?.message || "Échec de l'upload");
      }
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              onClick={() => setKind(k.value)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                kind === k.value ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/70"
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <Input
          placeholder="Légende (optionnelle)"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          className="mb-3 h-11"
        />
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            size="lg"
            className="h-14 text-base"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
            Prendre une photo
          </Button>
          <Button
            type="button"
            size="lg"
            variant="outline"
            className="h-14 text-base"
            disabled={busy}
            onClick={() => {
              if (inputRef.current) {
                inputRef.current.removeAttribute("capture");
                inputRef.current.click();
                setTimeout(() => inputRef.current?.setAttribute("capture", "environment"), 100);
              }
            }}
          >
            <ImageIcon className="h-5 w-5" /> Galerie
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {photos.length === 0 ? (
          <div className="col-span-full rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Aucune photo pour l'instant
          </div>
        ) : (
          photos.map((p) => (
            <div key={p.id} className="relative overflow-hidden rounded-xl border border-border bg-muted">
              <div className="aspect-square w-full">
                {p.signedUrl || p.localUrl ? (
                  <img src={p.signedUrl || p.localUrl} alt={p.caption || ""} className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full w-full place-items-center text-xs text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                )}
              </div>
              {p.kind ? (
                <Badge variant="secondary" className="absolute left-2 top-2 text-[10px]">
                  {p.kind}
                </Badge>
              ) : null}
              {p.caption ? (
                <div className="bg-foreground/70 px-2 py-1 text-[11px] text-background">{p.caption}</div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
