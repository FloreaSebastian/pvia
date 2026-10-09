import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Bot, Check, ListChecks, Loader2, Mic, MicOff, Send, Square, Volume2, Wand2, FileText, Compass } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { askVisitAssistant } from "@/lib/visites-ai.functions";
import { ASSISTANT_LIMITS, type AssistantAction, type AssistantProposal } from "@/lib/visites/assistant";
import type { AnswerValue, VisitPhase } from "@/lib/visites/types";

interface Turn {
  id: number;
  role: "user" | "assistant";
  text: string;
  questions?: string[];
  proposals?: AssistantProposal[];
  rejected?: number;
  studyRequired?: boolean;
  error?: boolean;
}

export interface VisitAssistantSheetProps {
  companyId: string;
  visitId: string;
  phase?: VisitPhase | null;
  sectionKey?: string | null;
  /** Saisie autorisée (mode terrain, droits d'édition) : active dictée → propositions. */
  canApply: boolean;
  /** Valeurs actuelles à l'écran, pour signaler un remplacement au moment d'appliquer. */
  currentAnswers?: Record<string, AnswerValue>;
  onApply?: (entries: { section_key: string; field_key: string; value: AnswerValue }[]) => void;
  triggerClassName?: string;
}

// Web Speech API (préfixée selon le navigateur).
type SR = {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: any) => void) | null; onerror: ((e: any) => void) | null; onend: (() => void) | null;
};
function getRecognition(): (new () => SR) | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const DICTATION_MAX_MS = 90_000;

export function VisitAssistantSheet(props: VisitAssistantSheetProps) {
  const ask = useServerFn(askVisitAssistant);
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<AssistantAction | null>(null);
  const [listening, setListening] = useState(false);
  const [speechOk, setSpeechOk] = useState<boolean | null>(null);
  const [ttsOk, setTtsOk] = useState(false);
  const [speakingId, setSpeakingId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [applied, setApplied] = useState<Record<string, boolean>>({});
  const [confirmOverwrite, setConfirmOverwrite] = useState<AssistantProposal[] | null>(null);
  const recRef = useRef<SR | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baseText = useRef("");
  const idRef = useRef(1);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSpeechOk(!!getRecognition());
    setTtsOk(typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);

  const stopListening = useCallback(() => {
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = null;
    try { recRef.current?.stop(); } catch { /* déjà arrêté */ }
    recRef.current = null;
    setListening(false);
  }, []);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeakingId(null);
  }, []);

  // Fermeture / navigation : micro et lecture coupés.
  useEffect(() => {
    if (!open) { stopListening(); stopSpeaking(); }
  }, [open, stopListening, stopSpeaking]);
  useEffect(() => () => { stopListening(); stopSpeaking(); }, [stopListening, stopSpeaking]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [turns, busy]);

  function startListening() {
    const Ctor = getRecognition();
    if (!Ctor) { setSpeechOk(false); return; }
    stopSpeaking();
    const rec = new Ctor();
    rec.lang = "fr-FR";
    rec.continuous = true;
    rec.interimResults = true;
    baseText.current = text ? `${text.trimEnd()} ` : "";
    rec.onresult = (e: any) => {
      let finalT = "";
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalT += r[0].transcript;
        else interim += r[0].transcript;
      }
      setText((baseText.current + finalT + interim).slice(0, ASSISTANT_LIMITS.messageMax));
    };
    rec.onerror = (e: any) => {
      const code = e?.error;
      toast.error(
        code === "not-allowed" || code === "service-not-allowed"
          ? "Micro refusé par le navigateur. Autorisez-le ou saisissez au clavier."
          : code === "no-speech"
            ? "Aucune parole détectée. Réessayez ou saisissez au clavier."
            : "Dictée interrompue. Vous pouvez continuer au clavier.",
      );
      stopListening();
    };
    rec.onend = () => { setListening(false); recRef.current = null; };
    try {
      rec.start();
      recRef.current = rec;
      setListening(true);
      stopTimer.current = setTimeout(() => { stopListening(); toast.info("Dictée arrêtée après 90 s. Relisez puis envoyez."); }, DICTATION_MAX_MS);
    } catch {
      toast.error("Impossible de démarrer la dictée. Saisissez au clavier.");
    }
  }

  function speak(turn: Turn) {
    if (!ttsOk) return;
    if (speakingId === turn.id) { stopSpeaking(); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance([turn.text, ...(turn.questions ?? [])].join(". "));
    u.lang = "fr-FR";
    u.onend = () => setSpeakingId(null);
    u.onerror = () => setSpeakingId(null);
    setSpeakingId(turn.id);
    window.speechSynthesis.speak(u);
  }

  async function run(action: AssistantAction) {
    if (busy) return;
    stopListening();
    const message = action === "dictee" || action === "question" ? text.trim() : "";
    if ((action === "dictee" || action === "question") && message.length < 2) {
      toast.error("Saisissez ou dictez un texte d'abord.");
      return;
    }
    const history = turns
      .filter((t) => !t.error)
      .slice(-ASSISTANT_LIMITS.historyTurns)
      .map((t) => ({ role: t.role, text: t.text.slice(0, ASSISTANT_LIMITS.historyItemMax) }));
    const label = message || ({ guide: "Guide-moi pour cette étape", manque: "Que manque-t-il ?", synthese: "Prépare la synthèse", dictee: "", question: "" } as const)[action];
    setTurns((prev) => [...prev, { id: idRef.current++, role: "user", text: label }]);
    if (message) setText("");
    setBusy(action);
    try {
      const res = await ask({
        data: {
          companyId: props.companyId,
          visitId: props.visitId,
          action,
          phase: props.phase ?? null,
          sectionKey: props.sectionKey ?? null,
          message,
          history,
        },
      });
      if (!res.ok) {
        setTurns((prev) => [...prev, { id: idRef.current++, role: "assistant", text: res.message, error: true }]);
        return;
      }
      const sel: Record<string, boolean> = {};
      for (const p of res.proposals) sel[p.field_key] = !p.overwrites && !p.hypothesis;
      setSelected((prev) => ({ ...prev, ...sel }));
      setTurns((prev) => [
        ...prev,
        {
          id: idRef.current++,
          role: "assistant",
          text: res.reply || "Pas de réponse exploitable.",
          questions: res.questions,
          proposals: res.proposals,
          rejected: res.rejectedProposals,
          studyRequired: res.studyRequired,
        },
      ]);
    } catch (e) {
      const msg = e instanceof Error && e.message.length < 200 ? e.message : "Assistant indisponible. Réessayez.";
      setTurns((prev) => [...prev, { id: idRef.current++, role: "assistant", text: msg, error: true }]);
    } finally {
      setBusy(null);
    }
  }

  function doApply(list: AssistantProposal[]) {
    if (!props.onApply || list.length === 0) return;
    props.onApply(list.map((p) => ({ section_key: p.section_key, field_key: p.field_key, value: p.proposed })));
    setApplied((prev) => {
      const n = { ...prev };
      for (const p of list) n[p.field_key] = true;
      return n;
    });
    toast.success(`${list.length} relevé${list.length > 1 ? "s" : ""} appliqué${list.length > 1 ? "s" : ""} — enregistrement automatique en cours.`);
  }

  function applyFrom(turn: Turn) {
    const chosen = (turn.proposals ?? []).filter((p) => selected[p.field_key] && !applied[p.field_key]);
    if (chosen.length === 0) { toast.error("Cochez au moins une proposition."); return; }
    // Remplacement : relu sur la valeur affichée maintenant, pas celle du moment de la demande.
    const live = chosen.map((p) => {
      const cur = props.currentAnswers?.[p.field_key];
      const has = cur !== undefined && cur !== null && cur !== "" && !(Array.isArray(cur) && cur.length === 0);
      return { ...p, overwrites: has && JSON.stringify(cur) !== JSON.stringify(p.proposed) };
    });
    if (live.some((p) => p.overwrites)) setConfirmOverwrite(live);
    else doApply(live);
  }

  const actionBtn = (a: AssistantAction, Icon: typeof Bot, label: string, disabled = false) => (
    <Button
      type="button"
      variant="outline"
      className="h-auto min-h-11 justify-start whitespace-normal text-left"
      onClick={() => void run(a)}
      disabled={!!busy || disabled}
    >
      {busy === a ? <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> : <Icon className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" />}
      {label}
    </Button>
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" className={props.triggerClassName ?? "h-11"} aria-label="Ouvrir l'assistant de visite">
          <Bot className="mr-2 h-4 w-4" aria-hidden="true" />
          Assistant
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b p-4 text-left">
          <SheetTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" aria-hidden="true" /> Assistant de visite
          </SheetTitle>
          <SheetDescription className="text-xs">
            Vos demandes, dictées et les relevés de cette visite sont envoyés au service IA de PVIA pour répondre. L'audio n'est pas enregistré. Rien n'est enregistré dans la visite sans votre clic sur « Appliquer ».
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
            {actionBtn("guide", Compass, "Guide-moi pour cette étape")}
            {actionBtn("manque", ListChecks, "Que manque-t-il ?")}
            {actionBtn("synthese", FileText, "Prépare la synthèse")}
            {actionBtn("dictee", Wand2, "Comprends ma dictée", !props.canApply || text.trim().length < 2)}
          </div>
          {!props.canApply ? (
            <p className="text-xs text-muted-foreground">« Comprends ma dictée » est disponible en mode terrain, avec le droit de modifier la visite.</p>
          ) : null}

          {turns.length === 0 && !busy ? (
            <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
              Choisissez une action ou dictez vos constats (ex. « Garage 3,20 m de large, tableau électrique non vérifié »), relisez, puis « Comprends ma dictée ».
            </p>
          ) : null}

          <ul className="space-y-3" aria-live="polite">
            {turns.map((t) => (
              <li key={t.id} className={t.role === "user" ? "ml-8 rounded-lg bg-primary p-3 text-sm text-primary-foreground" : "space-y-2 text-sm"}>
                {t.role === "user" ? (
                  <p className="whitespace-pre-wrap break-words">{t.text}</p>
                ) : (
                  <>
                    <p className={`whitespace-pre-wrap break-words ${t.error ? "text-destructive" : ""}`}>{t.text}</p>
                    {t.questions?.length ? (
                      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                        {t.questions.map((q, i) => <li key={i}>{q}</li>)}
                      </ul>
                    ) : null}
                    {t.studyRequired ? <Badge variant="outline">Étude technique requise</Badge> : null}
                    {t.proposals && t.proposals.length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-xs font-medium">Relevés proposés — cochez puis appliquez :</p>
                        {t.proposals.map((p) => (
                          <label key={p.field_key} className="flex min-h-11 cursor-pointer gap-3 rounded-md border p-3">
                            <Checkbox
                              className="mt-0.5 h-5 w-5"
                              checked={!!selected[p.field_key]}
                              disabled={!!applied[p.field_key]}
                              onCheckedChange={(v) => setSelected((s) => ({ ...s, [p.field_key]: v === true }))}
                              aria-label={`Sélectionner ${p.label}`}
                            />
                            <span className="min-w-0 flex-1 space-y-1">
                              <span className="block font-medium break-words">{p.label}</span>
                              <span className="block break-words text-xs text-muted-foreground">
                                Actuel : {p.currentText}
                              </span>
                              <span className="block break-words">
                                Proposé : <strong>{p.proposedText}</strong>
                              </span>
                              {p.rationale ? <span className="block break-words text-xs text-muted-foreground">{p.rationale}</span> : null}
                              <span className="flex flex-wrap gap-1">
                                {p.hypothesis ? <Badge variant="outline">Hypothèse à vérifier</Badge> : null}
                                {p.overwrites ? <Badge variant="destructive">Remplace une valeur</Badge> : null}
                                {applied[p.field_key] ? <Badge><Check className="mr-1 h-3 w-3" aria-hidden="true" />Appliqué</Badge> : null}
                              </span>
                            </span>
                          </label>
                        ))}
                        <Button type="button" className="h-11 w-full" onClick={() => applyFrom(t)} disabled={!props.onApply}>
                          <Check className="mr-2 h-4 w-4" aria-hidden="true" /> Appliquer la sélection
                        </Button>
                      </div>
                    ) : null}
                    {t.rejected ? (
                      <p className="text-xs text-muted-foreground">{t.rejected} proposition(s) écartée(s) : champ inconnu, valeur hors modèle ou identique.</p>
                    ) : null}
                    {!t.error && ttsOk ? (
                      <Button type="button" variant="ghost" size="sm" className="h-11" onClick={() => speak(t)}>
                        {speakingId === t.id ? <Square className="mr-2 h-4 w-4" aria-hidden="true" /> : <Volume2 className="mr-2 h-4 w-4" aria-hidden="true" />}
                        {speakingId === t.id ? "Arrêter la lecture" : "Lire à voix haute"}
                      </Button>
                    ) : null}
                  </>
                )}
              </li>
            ))}
          </ul>
          {busy ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> L'assistant réfléchit…
            </p>
          ) : null}
          <div ref={endRef} />
        </div>

        <div className="space-y-2 border-t p-3">
          {listening ? (
            <p className="flex items-center gap-2 text-xs font-medium text-destructive" role="status">
              <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" aria-hidden="true" /> Micro actif — touchez « Stop » pour terminer
            </p>
          ) : null}
          {speechOk === false ? (
            <p className="text-xs text-muted-foreground">Dictée vocale non disponible sur ce navigateur : utilisez le clavier (ou la dictée du clavier du téléphone).</p>
          ) : null}
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, ASSISTANT_LIMITS.messageMax))}
            placeholder="Votre question ou vos constats dictés…"
            rows={3}
            className="text-base"
            aria-label="Texte pour l'assistant"
          />
          <div className="flex gap-2">
            {speechOk ? (
              <Button
                type="button"
                variant={listening ? "destructive" : "outline"}
                className="h-11 shrink-0"
                onClick={() => (listening ? stopListening() : startListening())}
                aria-pressed={listening}
              >
                {listening ? <MicOff className="mr-2 h-4 w-4" aria-hidden="true" /> : <Mic className="mr-2 h-4 w-4" aria-hidden="true" />}
                {listening ? "Stop" : "Dicter"}
              </Button>
            ) : null}
            <Button type="button" className="h-11 min-w-0 flex-1" onClick={() => void run("question")} disabled={!!busy || text.trim().length < 2}>
              <Send className="mr-2 h-4 w-4" aria-hidden="true" /> Demander
            </Button>
          </div>
        </div>

        <AlertDialog open={!!confirmOverwrite} onOpenChange={(o) => !o && setConfirmOverwrite(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remplacer des valeurs existantes ?</AlertDialogTitle>
              <AlertDialogDescription>
                {confirmOverwrite?.filter((p) => p.overwrites).map((p) => p.label).join(", ")} : la valeur déjà saisie sera remplacée par la proposition.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                className="h-11"
                onClick={() => {
                  const keep = (confirmOverwrite ?? []).filter((p) => !p.overwrites);
                  setConfirmOverwrite(null);
                  if (keep.length) doApply(keep);
                }}
              >
                Appliquer sans remplacer
              </AlertDialogCancel>
              <AlertDialogAction className="h-11" onClick={() => { const l = confirmOverwrite ?? []; setConfirmOverwrite(null); doApply(l); }}>
                Remplacer
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
