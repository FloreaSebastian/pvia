import { describe, expect, test } from "bun:test";
import { createDictation, createSpeaker, type SpeechRecLike } from "@/lib/visites/assistant-voice";

class FakeRec implements SpeechRecLike {
  static all: FakeRec[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: SpeechRecLike["onresult"] = null;
  onerror: SpeechRecLike["onerror"] = null;
  onend: SpeechRecLike["onend"] = null;
  stopped = false;
  aborted = false;
  constructor() {
    FakeRec.all.push(this);
  }
  start() {}
  stop() {
    this.stopped = true;
  }
  abort() {
    this.aborted = true;
  }
  emit(parts: [string, boolean][]) {
    this.onresult?.({ results: parts.map(([t, f]) => ({ isFinal: f, 0: { transcript: t } })) });
  }
}

function setup() {
  FakeRec.all = [];
  const st = { text: "", listening: false, errors: [] as (string | undefined)[] };
  const d = createDictation({
    Ctor: FakeRec,
    maxMs: 60_000,
    stopGraceMs: 50,
    onText: (t) => (st.text = t),
    onListening: (b) => (st.listening = b),
    onError: (c) => st.errors.push(c),
  });
  return { d, st };
}

describe("dictée — arrêt gracieux", () => {
  test("résultat final émis après stop() est conservé, puis onend termine", async () => {
    const { d, st } = setup();
    d.start("");
    const rec = FakeRec.all[0];
    rec.emit([["garage trois", false]]);
    const done = d.stop();
    expect(rec.stopped).toBe(true);
    expect(st.listening).toBe(true); // attend encore les derniers mots
    rec.emit([["garage trois mètres vingt", true]]);
    rec.onend?.();
    await done;
    expect(st.text).toBe("garage trois mètres vingt");
    expect(st.listening).toBe(false);
  });

  test("abort : les callbacks tardifs de l'ancien micro sont ignorés", () => {
    const { d, st } = setup();
    d.start("");
    const old = FakeRec.all[0];
    d.abort();
    expect(old.aborted).toBe(true);
    st.text = "saisie clavier";
    old.emit([["vieux mot", true]]);
    old.onerror?.({ error: "network" });
    expect(st.text).toBe("saisie clavier");
    expect(st.errors).toHaveLength(0);
  });

  test("nouvelle dictée : l'ancien micro ne peut ni écrire ni couper la nouvelle", () => {
    const { d, st } = setup();
    d.start("");
    const a = FakeRec.all[0];
    d.start("base");
    const b = FakeRec.all[1];
    a.emit([["ancien", true]]);
    a.onend?.();
    expect(st.listening).toBe(true);
    b.emit([["nouveau", true]]);
    expect(st.text).toBe("base nouveau");
  });

  test("onend jamais reçu : délai de grâce puis détachement", async () => {
    const { d, st } = setup();
    d.start("");
    await d.stop();
    expect(st.listening).toBe(false);
    expect(d.isActive()).toBe(false);
  });

  test("micro refusé : erreur remontée et arrêt", () => {
    const { d, st } = setup();
    d.start("");
    FakeRec.all[0].onerror?.({ error: "not-allowed" });
    expect(st.errors).toEqual(["not-allowed"]);
    expect(st.listening).toBe(false);
  });
});

describe("lecture vocale", () => {
  function sp() {
    const us: {
      lang: string;
      onend: (() => void) | null;
      onerror: (() => void) | null;
      text: string;
    }[] = [];
    let speaking: number | null = null;
    let cancels = 0;
    const s = createSpeaker({
      synth: {
        speak: () => {},
        cancel: () => {
          cancels++;
        },
      },
      makeUtterance: (text) => {
        const u = { lang: "", onend: null, onerror: null, text };
        us.push(u);
        return u;
      },
      onSpeaking: (id) => (speaking = id),
    });
    return {
      s,
      us,
      get speaking() {
        return speaking;
      },
      get cancels() {
        return cancels;
      },
    };
  }
  test("A puis B : la fin tardive de A ne retire pas le Stop de B", () => {
    const t = sp();
    t.s.speak(1, "A");
    t.s.speak(2, "B");
    t.us[0].onend?.();
    t.us[0].onerror?.();
    expect(t.speaking).toBe(2);
    t.us[1].onend?.();
    expect(t.speaking).toBe(null);
  });
  test("fermeture : stop annule et ignore les callbacks", () => {
    const t = sp();
    t.s.speak(1, "A");
    t.s.stop();
    expect(t.speaking).toBe(null);
    expect(t.cancels).toBeGreaterThan(0);
    t.s.speak(3, "C");
    t.us[0].onend?.();
    expect(t.speaking).toBe(3);
  });
});
