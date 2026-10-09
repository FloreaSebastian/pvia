/**
 * Contrôleurs voix de l'assistant (dictée Web Speech et lecture speechSynthesis),
 * indépendants de React pour être testables avec des doubles.
 *
 * Dictée : `stop()` est un arrêt GRACIEUX — la reconnaissance reste attachée jusqu'à `onend`
 * pour recevoir les derniers résultats finaux. `abort()` détache immédiatement (fermeture,
 * navigation, saisie clavier) : les callbacks tardifs de l'ancien micro sont ignorés.
 */

export interface SpeechRecLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult:
    | ((e: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void)
    | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

export interface DictationOptions {
  Ctor: new () => SpeechRecLike;
  onText: (text: string) => void;
  onListening: (on: boolean) => void;
  onError: (code: string | undefined) => void;
  onTimeout?: () => void;
  maxMs: number;
  /** Délai max d'attente de `onend` après un arrêt gracieux. */
  stopGraceMs?: number;
  maxLength?: number;
}

export function createDictation(o: DictationOptions) {
  let active: SpeechRecLike | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let stopWaiters: (() => void)[] = [];

  const clearTimers = () => {
    if (maxTimer) clearTimeout(maxTimer);
    if (graceTimer) clearTimeout(graceTimer);
    maxTimer = graceTimer = null;
  };
  const finish = (rec: SpeechRecLike) => {
    if (active !== rec) return;
    active = null;
    clearTimers();
    o.onListening(false);
    const w = stopWaiters;
    stopWaiters = [];
    w.forEach((f) => f());
  };

  function abort() {
    const rec = active;
    if (!rec) return;
    active = null; // détaché d'abord : plus aucun callback de ce micro n'est pris en compte
    clearTimers();
    try {
      rec.abort();
    } catch {
      /* déjà arrêté */
    }
    o.onListening(false);
    const w = stopWaiters;
    stopWaiters = [];
    w.forEach((f) => f());
  }

  /** Arrêt gracieux : se résout quand les derniers résultats ont été reçus (onend) ou après le délai de grâce. */
  function stop(): Promise<void> {
    const rec = active;
    if (!rec) return Promise.resolve();
    if (maxTimer) clearTimeout(maxTimer);
    maxTimer = null;
    const done = new Promise<void>((r) => stopWaiters.push(r));
    if (!graceTimer) graceTimer = setTimeout(() => abort(), o.stopGraceMs ?? 3000);
    try {
      rec.stop();
    } catch {
      abort();
    }
    return done;
  }

  function start(baseText: string): boolean {
    abort();
    const rec = new o.Ctor();
    rec.lang = "fr-FR";
    rec.continuous = true;
    rec.interimResults = true;
    const base = baseText ? `${baseText.trimEnd()} ` : "";
    rec.onresult = (e) => {
      if (active !== rec) return;
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      const out = base + t;
      o.onText(o.maxLength ? out.slice(0, o.maxLength) : out);
    };
    rec.onerror = (e) => {
      if (active !== rec) return;
      o.onError(e?.error);
      abort();
    };
    rec.onend = () => finish(rec);
    try {
      rec.start();
    } catch {
      o.onError("start-failed");
      return false;
    }
    active = rec;
    o.onListening(true);
    maxTimer = setTimeout(() => {
      if (active !== rec) return;
      o.onTimeout?.();
      void stop();
    }, o.maxMs);
    return true;
  }

  return { start, stop, abort, isActive: () => active !== null };
}

export interface UtteranceLike {
  lang: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onend: ((...args: any[]) => unknown) | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onerror: ((...args: any[]) => unknown) | null;
}
export interface SpeakerOptions<U extends UtteranceLike> {
  synth: { speak(u: U): void; cancel(): void };
  makeUtterance: (text: string) => U;
  onSpeaking: (id: number | null) => void;
}

/** Lecture vocale : seuls les callbacks de l'énoncé courant modifient l'état. */
export function createSpeaker<U extends UtteranceLike>(o: SpeakerOptions<U>) {
  let current: { u: U; id: number } | null = null;
  function stop() {
    current = null;
    o.synth.cancel();
    o.onSpeaking(null);
  }
  function speak(id: number, text: string) {
    if (current?.id === id) {
      stop();
      return;
    }
    current = null;
    o.synth.cancel();
    const u = o.makeUtterance(text);
    u.lang = "fr-FR";
    const mine = { u, id };
    const end = () => {
      if (current !== mine) return;
      current = null;
      o.onSpeaking(null);
    };
    u.onend = end;
    u.onerror = end;
    current = mine;
    o.onSpeaking(id);
    o.synth.speak(u);
  }
  return { speak, stop, speakingId: () => current?.id ?? null };
}
