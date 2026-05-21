import { useRef, useState } from "react";
import SignatureCanvas from "react-signature-canvas";
import { Eraser, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export function FieldSignaturePad({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (dataUrl: string | null) => void;
  value?: string | null;
}) {
  const ref = useRef<SignatureCanvas>(null);
  const [hasInk, setHasInk] = useState(!!value);

  function clear() {
    ref.current?.clear();
    setHasInk(false);
    onChange(null);
  }

  function commit() {
    if (!ref.current || ref.current.isEmpty()) {
      onChange(null);
      setHasInk(false);
      return;
    }
    const dataUrl = ref.current.getTrimmedCanvas().toDataURL("image/png");
    onChange(dataUrl);
    setHasInk(true);
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        {hasInk ? <span className="text-[11px] text-emerald-600">✓ Signé</span> : null}
      </div>
      <div className="overflow-hidden rounded-xl border border-dashed border-border bg-background">
        {value && !hasInk ? (
          <img src={value} alt={label} className="h-40 w-full object-contain" />
        ) : (
          <SignatureCanvas
            ref={ref}
            penColor="#0f172a"
            backgroundColor="rgba(255,255,255,1)"
            canvasProps={{ className: "w-full h-40 touch-none" }}
            onEnd={commit}
          />
        )}
      </div>
      <div className="mt-2 flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={clear} className="flex-1">
          <Eraser className="h-4 w-4" /> Effacer
        </Button>
        <Button type="button" size="sm" onClick={commit} className="flex-1" disabled={!ref.current}>
          <Check className="h-4 w-4" /> Valider
        </Button>
      </div>
    </div>
  );
}
