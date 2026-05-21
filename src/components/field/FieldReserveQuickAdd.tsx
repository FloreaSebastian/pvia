import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Plus, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { addFieldReserve } from "@/lib/field.functions";
import { enqueue } from "@/lib/field-offline";
import { useOnlineStatus } from "@/hooks/use-online-status";

const SEV = [
  { value: "mineure", label: "Mineure", color: "bg-emerald-100 text-emerald-700" },
  { value: "majeure", label: "Majeure", color: "bg-amber-100 text-amber-700" },
  { value: "bloquante", label: "Bloquante", color: "bg-red-100 text-red-700" },
] as const;
type Sev = (typeof SEV)[number]["value"];

export type FieldReserve = { id: string; description: string; severity: string; status: string; created_at?: string };

export function FieldReserveQuickAdd({
  pvId,
  reserves,
  onAdd,
}: {
  pvId: string;
  reserves: FieldReserve[];
  onAdd: (r: FieldReserve) => void;
}) {
  const [text, setText] = useState("");
  const [sev, setSev] = useState<Sev>("mineure");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [hasSpeech, setHasSpeech] = useState(false);
  const recogRef = useRef<any>(null);
  const online = useOnlineStatus();
  const addReserveFn = useServerFn(addFieldReserve);

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setHasSpeech(!!SR);
  }, []);

  function toggleDictation() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    if (recording) {
      recogRef.current?.stop();
      setRecording(false);
      return;
    }
    const r = new SR();
    r.lang = "fr-FR";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e: any) => {
      let t = "";
      for (let i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript;
      setText((prev) => (prev ? prev + " " : "") + t);
    };
    r.onend = () => setRecording(false);
    r.onerror = () => setRecording(false);
    recogRef.current = r;
    r.start();
    setRecording(true);
  }

  async function submit() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      if (!online) {
        const op = await enqueue({ type: "reserve", pvId, description: text.trim(), severity: sev });
        onAdd({ id: op.id, description: text.trim(), severity: sev, status: "ouverte" });
        toast.success("Réserve enregistrée hors ligne");
      } else {
        const res = await addReserveFn({ data: { pvId, description: text.trim(), severity: sev } });
        onAdd(res.reserve as FieldReserve);
        toast.success("Réserve ajoutée");
      }
      setText("");
      setSev("mineure");
    } catch (e: any) {
      const op = await enqueue({ type: "reserve", pvId, description: text.trim(), severity: sev });
      onAdd({ id: op.id, description: text.trim(), severity: sev, status: "ouverte" });
      toast.message("Hors ligne — réserve en file d'attente");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Décrire la réserve…"
          rows={3}
          className="mb-3 text-base"
        />
        <div className="mb-3 flex flex-wrap gap-2">
          {SEV.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setSev(s.value)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                sev === s.value ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/70"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {hasSpeech ? (
            <Button
              type="button"
              variant={recording ? "destructive" : "outline"}
              size="lg"
              className="h-12 flex-1"
              onClick={toggleDictation}
            >
              {recording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              {recording ? "Stop" : "Dictée"}
            </Button>
          ) : null}
          <Button
            type="button"
            size="lg"
            className="h-12 flex-1"
            onClick={submit}
            disabled={busy || !text.trim()}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Ajouter
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {reserves.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Aucune réserve
          </div>
        ) : (
          reserves.map((r) => {
            const sevDef = SEV.find((s) => s.value === r.severity);
            return (
              <div key={r.id} className="flex items-start gap-3 rounded-xl border border-border bg-card p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{r.description}</p>
                  <div className="mt-1 flex gap-1.5">
                    <Badge className={sevDef?.color}>{sevDef?.label ?? r.severity}</Badge>
                    <Badge variant="outline">{r.status}</Badge>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
