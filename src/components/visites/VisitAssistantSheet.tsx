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
import type { VisitPhase } from "@/lib/visites/types";
import {
  createRequestGate, proposalCardId, textAfterSuccess,
  type ApplyCandidate, type RejectedCandidate, type ReviewedCandidate,
} from "@/lib/visites/assistant-session";
import { createDictation, createSpeaker, type SpeechRecLike } from "@/lib/visites/assistant-voice";

interface Turn {
  id: number;
  role: "user" | "assistant";
  text: string;
  questions?: string[];
  proposals?: AssistantProposal[];
  rejected?: number;
  studyRequired?: boolean;
  error?: boolean;
  coverage?: { total: number; included: number; omitted: number; omittedSections: string[] };
}

export interface VisitAssistantSheetProps {
  companyId: string;
  visitId: string;
  phase?: VisitPhase | null;
  sectionKey?: string | null;
  /** Saisie autorisée (mode terrain, droits d'édition) : active dictée → propositions. */
  canApply: boolean;
  /** Avant toute demande : enregistre les saisies en attente ; refus = demande bloquée, texte conservé. */
  beforeAsk?: () => Promise<{ ok: true } | { ok: false; message: string }>;
  /** Relit l'état courant (visibilité, type, valeur actuelle) pour la confirmation. */
  review?: (list: ApplyCandidate[]) => { ok: ReviewedCandidate[]; rejected: RejectedCandidate[] };
  /** Applique ; seuls les champs retournés dans `accepted` sont marqués appliqués. */
  onApply?: (
    entries: (ApplyCandidate & { expectedCurrent: ReviewedCandidate["current"] })[],
  ) => { accepted: string[]; rejected: RejectedCandidate[] };
  triggerClassName?: string;
}

// Web Speech API (préfixée selon le navigateur).
function getRecognition(): (new () => SpeechRecLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SpeechRecLike) | null;
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
  const [confirmOverwrite, setConfirmOverwrite] = useState<{ turnId: number; list: ReviewedCandidate[] } | null>(null);
  const gateRef = useRef(createRequestGate());
  const idRef = useRef(1);
  const endRef = useRef<HTMLDivElement | null>(null);
  const dictRef = useRef<ReturnType<typeof createDictation> | null>(null);
  const speakerRef = useRef<ReturnType<typeof createSpeaker<SpeechSynthesisUtterance>> | null>(null);

  useEffect(() => {
    setSpeechOk(!!getRecognition());
    setTtsOk(typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);

  /** Coupure immédiate (fermeture, navigation, clavier) : les résultats tardifs sont ignorés. */
  const abortListening = useCallback(() => { dictRef.current?.abort(); }, []);
  /** Arrêt manuel : on attend les derniers mots reconnus avant de rendre la main. */
  const stopListeningGracefully = useCallback(() => dictRef.current?.stop() ?? Promise.resolve(), []);

  const stopSpeaking = useCallback(() => {
    if (speakerRef.current) speakerRef.current.stop();
    else setSpeakingId(null);
  }, []);

  // Fermeture / navigation : micro et lecture coupés, réponses tardives ignorées.
  useEffect(() => {
    if (!open) { abortListening(); stopSpeaking(); gateRef.current.invalidate(); setBusy(null); }
  }, [open, abortListening, stopSpeaking]);
  // Changement d'entreprise ou de visite : session entièrement réinitialisée.
  useEffect(() => {
    gateRef.current.invalidate();
    abortListening();
    stopSpeaking();
    setTurns([]); setText(""); setBusy(null); setSelected({}); setApplied({}); setConfirmOverwrite(null);
  }, [props.companyId, props.visitId, abortListening, stopSpeaking]);
  useEffect(() => () => { abortListening(); stopSpeaking(); }, [abortListening, stopSpeaking]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [turns, busy]);

  function startListening() {
    const Ctor = getRecognition();
    if (!Ctor) { setSpeechOk(false); return; }
    stopSpeaking();
    if (!dictRef.current) {
      dictRef.current = createDictation({
        Ctor,
        maxMs: DICTATION_MAX_MS,
        maxLength: ASSISTANT_LIMITS.messageMax,
        onText: setText,
        onListening: setListening,
        onTimeout: () => toast.info("Dictée arrêtée après 90 s. Relisez puis envoyez."),
        onError: (code) =>
          toast.error(
            code === "not-allowed" || code === "service-not-allowed"
              ? "Micro refusé par le navigateur. Autorisez-le ou saisissez au clavier."
              : code === "no-speech"
                ? "Aucune parole détectée. Réessayez ou saisissez au clavier."
                : code === "start-failed"
                  ? "Impossible de démarrer la dictée. Saisissez au clavier."
                  : "Dictée interrompue. Vous pouvez continuer au clavier.",
          ),
      });
    }
    dictRef.current.start(text);
  }

  function speak(turn: Turn) {
    if (!ttsOk) return;
    if (!speakerRef.current) {
      speakerRef.current = createSpeaker({
        synth: window.speechSynthesis,
        makeUtterance: (t) => new SpeechSynthesisUtterance(t),
        onSpeaking: setSpeakingId,
      });
    }
    speakerRef.current.speak(turn.id, [turn.text, ...(turn.questions ?? [])].join(". "));
  }

  async function run(action: AssistantAction) {
    if (busy) return;
    if (listening) {
      // Ne jamais envoyer avant les derniers mots : on arrête proprement, l'utilisateur relit.
      await stopListeningGracefully();
      toast.info("Dictée arrêtée : relisez le texte puis envoyez.");
      return;
    }
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
    const gen = gateRef.current.next();
    setBusy(action);
    try {
      if (props.beforeAsk) {
        const pre = await props.beforeAsk();
        if (!gateRef.current.isCurrent(gen)) return;
        if (!pre.ok) { toast.error(pre.message); return; }
      }
      setTurns((prev) => [...prev, { id: idRef.current++, role: "user", text: label }]);
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
      if (!gateRef.current.isCurrent(gen)) return; // réponse tardive (fermeture, autre visite)
      if (!res.ok) {
        setTurns((prev) => [...prev, { id: idRef.current++, role: "assistant", text: res.message, error: true }]);
        return;
      }
      // Succès seulement : on retire le texte envoyé, en gardant ce qui a été tapé entre-temps.
      if (message) setText((cur) => textAfterSuccess(cur, message));
      const turnId = idRef.current++;
      const sel: Record<string, boolean> = {};
      for (const p of res.proposals) sel[proposalCardId(turnId, p.field_key)] = !p.overwrites && !p.hypothesis;
      setSelected((prev) => ({ ...prev, ...sel }));
      setTurns((prev) => [
        ...prev,
        {
          id: turnId,
          role: "assistant",
          text: res.reply || "Pas de réponse exploitable.",
          questions: res.questions,
          proposals: res.proposals,
          rejected: res.rejectedProposals,
          studyRequired: res.studyRequired,
          coverage: res.coverage,
        },
      ]);
    } catch (e) {
      if (!gateRef.current.isCurrent(gen)) return;
      const base = e instanceof Error && e.message.length < 200 ? e.message : "Assistant indisponible.";
      const msg = message ? `${base} Votre texte est conservé : touchez à nouveau pour réessayer.` : `${base} Réessayez.`;
      setTurns((prev) => [...prev, { id: idRef.current++, role: "assistant", text: msg, error: true }]);
    } finally {
      if (gateRef.current.isCurrent(gen)) setBusy(null);
    }
  }

  function doApply(turnId: number, list: ReviewedCandidate[]) {
    if (!props.onApply || list.length === 0) return;
    if (!props.canApply) { toast.error("Saisie verrouillée : rien n'a été appliqué."); return; }
    const res = props.onApply(list.map((p) => ({
      field_key: p.field_key, section_key: p.section_key, label: p.label, proposed: p.proposed, expectedCurrent: p.current,
    })));
    if (res.accepted.length) {
      setApplied((prev) => {
        const n = { ...prev };
        for (const k of res.accepted) n[proposalCardId(turnId, k)] = true;
        return n;
      });
      toast.success(`${res.accepted.length} relevé${res.accepted.length > 1 ? "s" : ""} appliqué${res.accepted.length > 1 ? "s" : ""} — enregistrement automatique en cours.`);
    }
    if (res.rejected.length) {
      toast.error(`Non appliqué : ${res.rejected.map((r) => `${r.label} (${r.reason})`).join(", ")}.`);
    }
  }

  function applyFrom(turn: Turn) {
    if (!props.canApply || !props.onApply || !props.review) { toast.error("Saisie verrouillée : rien n'a été appliqué."); return; }
    const chosen = (turn.proposals ?? []).filter((p) => {
      const id = proposalCardId(turn.id, p.field_key);
      return selected[id] && !applied[id];
    });
    if (chosen.length === 0) { toast.error("Cochez au moins une proposition."); return; }
    // Relu sur l'état actuel de la visite, pas celui du moment de la demande.
    const { ok, rejected } = props.review(chosen.map((p) => ({ field_key: p.field_key, section_key: p.section_key, label: p.label, proposed: p.proposed })));
    if (rejected.length) toast.error(`Écarté : ${rejected.map((r) => `${r.label} (${r.reason})`).join(", ")}.`);
    if (ok.length === 0) return;
    if (ok.some((p) => p.overwrites)) setConfirmOverwrite({ turnId: turn.id, list: ok });
    else doApply(turn.id, ok);
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
            Vos demandes, dictées et les relevés de cette visite sont envoyés au service IA de PVIA pour répondre. PVIA ne conserve pas l'enregistrement audio ; la dictée peut utiliser le service de reconnaissance vocale de votre navigateur. Rien n'est enregistré dans la visite sans votre clic sur « Appliquer ».
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
                    {t.coverage && t.coverage.omitted > 0 ? (
                      <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
                        Analyse partielle : {t.coverage.included} champ(s) sur {t.coverage.total} transmis. Non pris en compte : {t.coverage.omittedSections.join(", ")}.
                      </p>
                    ) : null}
                    {t.studyRequired ? <Badge variant="outline">Étude technique requise</Badge> : null}
                    {t.proposals && t.proposals.length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-xs font-medium">Relevés proposés — cochez puis appliquez :</p>
                        {t.proposals.map((p) => { const cid = proposalCardId(t.id, p.field_key); return (
                          <label key={cid} className="flex min-h-11 cursor-pointer gap-3 rounded-md border p-3">
                            <Checkbox
                              className="mt-0.5 h-5 w-5"
                              checked={!!selected[cid]}
                              disabled={!!applied[cid]}
                              onCheckedChange={(v) => setSelected((s) => ({ ...s, [cid]: v === true }))}
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
                                {applied[cid] ? <Badge><Check className="mr-1 h-3 w-3" aria-hidden="true" />Appliqué</Badge> : null}
                              </span>
                            </span>
                          </label>
                        ); })}
                        <Button type="button" className="h-11 w-full" onClick={() => applyFrom(t)} disabled={!props.onApply || !props.canApply}>
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
            onChange={(e) => {
              if (listening) abortListening(); // la saisie clavier prime : le micro ne l'écrasera pas
              setText(e.target.value.slice(0, ASSISTANT_LIMITS.messageMax));
            }}
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
                onClick={() => (listening ? void stopListeningGracefully() : startListening())}
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
              <AlertDialogDescription>Valeurs relues à l'instant. Choisissez pour chaque remplacement.</AlertDialogDescription>
            </AlertDialogHeader>
            <ul className="space-y-2 text-sm">
              {(confirmOverwrite?.list ?? []).filter((p) => p.overwrites).map((p) => (
                <li key={p.field_key} className="rounded-md border p-2">
                  <span className="block font-medium break-words">{p.label}</span>
                  <span className="block break-words text-muted-foreground">Actuel : {p.currentText}</span>
                  <span className="block break-words">Proposé : <strong>{p.proposedText}</strong></span>
                </li>
              ))}
            </ul>
            <AlertDialogFooter>
              <AlertDialogCancel
                className="h-11"
                onClick={() => {
                  const c = confirmOverwrite;
                  setConfirmOverwrite(null);
                  const keep = (c?.list ?? []).filter((p) => !p.overwrites);
                  if (c && keep.length) doApply(c.turnId, keep);
                }}
              >
                Appliquer sans remplacer
              </AlertDialogCancel>
              <AlertDialogAction className="h-11" onClick={() => { const c = confirmOverwrite; setConfirmOverwrite(null); if (c) doApply(c.turnId, c.list); }}>
                Remplacer
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
