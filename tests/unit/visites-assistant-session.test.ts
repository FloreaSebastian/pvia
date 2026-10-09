import { describe, expect, test } from "bun:test";
import { resolveVisitTemplate } from "@/lib/visites/templates";
import { findTemplateField } from "@/lib/visites/validation";
import {
  createRequestGate,
  ensureSavedBeforeAsk,
  planApply,
  mergeApplyResult,
  proposalCardId,
  reviewCandidates,
  textAfterSuccess,
} from "@/lib/visites/assistant-session";

const tpl = resolveVisitTemplate({ visit_type: "btp", lots: ["toiture"] })!;
const sec = (k: string) => findTemplateField(tpl, k)!.section.key;
const dist = (v: number) => ({
  field_key: "btp_distance_stationnement",
  section_key: sec("btp_distance_stationnement"),
  label: "Distance",
  proposed: v,
});

describe("assistant — même champ proposé sur deux réponses", () => {
  test("identifiants distincts par réponse", () => {
    expect(proposalCardId(1, "btp_distance_stationnement")).not.toBe(
      proposalCardId(2, "btp_distance_stationnement"),
    );
  });
  test("une correction ultérieure du même champ reste applicable", () => {
    const answers = { btp_distance_stationnement: 35 }; // 1re proposition déjà appliquée
    const r = reviewCandidates(tpl, answers, [dist(40)]);
    expect(r.ok).toHaveLength(1);
    expect(r.ok[0].overwrites).toBe(true);
    expect(r.ok[0].current).toBe(35);
  });
});

describe("assistant — texte conservé", () => {
  test("échec : rien n'est retiré (le texte n'est vidé qu'au succès)", () => {
    expect(textAfterSuccess("Garage 3 m", "Garage 3 m")).toBe("");
  });
  test("succès : la saisie tapée pendant la requête est gardée", () => {
    expect(textAfterSuccess("Garage 3 m puis cave", "Garage 3 m")).toBe("puis cave");
    expect(textAfterSuccess("autre chose", "Garage 3 m")).toBe("autre chose");
  });
});

describe("assistant — changement de visite pendant la requête", () => {
  test("une réponse tardive est ignorée après invalidation", () => {
    const g = createRequestGate();
    const n = g.next();
    g.invalidate(); // changement de visite / fermeture
    expect(g.isCurrent(n)).toBe(false);
    const m = g.next();
    expect(g.isCurrent(m)).toBe(true);
  });
});

describe("assistant — saisies en attente avant demande", () => {
  test("enregistre d'abord puis autorise", async () => {
    let pending = 2;
    let calls = 0;
    const r = await ensureSavedBeforeAsk({
      hasFieldErrors: () => false,
      online: true,
      pending: () => pending,
      flush: async () => {
        calls++;
        pending = 0;
        return true;
      },
    });
    expect(r.ok).toBe(true);
    expect(calls).toBe(1);
  });
  test("échec d'enregistrement : demande bloquée", async () => {
    const r = await ensureSavedBeforeAsk({
      hasFieldErrors: () => false,
      online: true,
      pending: () => 1,
      flush: async () => false,
    });
    expect(r.ok).toBe(false);
  });
  test("hors ligne avec saisies en attente : demande bloquée sans envoi", async () => {
    let calls = 0;
    const r = await ensureSavedBeforeAsk({
      hasFieldErrors: () => false,
      online: false,
      pending: () => 1,
      flush: async () => {
        calls++;
        return true;
      },
    });
    expect(r.ok).toBe(false);
    expect(calls).toBe(0);
  });
  test("aucune saisie en attente mais valeur locale refusée (ex. -1 m) : demande bloquée", async () => {
    let calls = 0;
    const r = await ensureSavedBeforeAsk({
      hasFieldErrors: () => true,
      online: true,
      pending: () => 0,
      flush: async () => {
        calls++;
        return true;
      },
    });
    expect(r.ok).toBe(false);
    expect(calls).toBe(0);
  });
  test("erreur de champ révélée par l'enregistrement : demande bloquée après envoi", async () => {
    let errors = false;
    let pending = 1;
    const r = await ensureSavedBeforeAsk({
      hasFieldErrors: () => errors,
      online: true,
      pending: () => pending,
      flush: async () => {
        pending = 0;
        errors = true;
        return true;
      },
    });
    expect(r.ok).toBe(false);
  });
});

describe("assistant — conflit / verrou à l'application", () => {
  const entry = { ...dist(40), expectedCurrent: 35 };
  test("saisie verrouillée : tout refusé", () => {
    const r = planApply(tpl, { btp_distance_stationnement: 35 }, [entry], true);
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected[0].reason).toBe("saisie verrouillée");
  });
  test("valeur modifiée depuis la confirmation : refusée", () => {
    const r = planApply(tpl, { btp_distance_stationnement: 50 }, [entry], false);
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected[0].reason).toBe("valeur modifiée entre-temps");
  });
  test("valeur inchangée : acceptée", () => {
    expect(
      planApply(tpl, { btp_distance_stationnement: 35 }, [entry], false).accepted,
    ).toHaveLength(1);
  });
  test("champ devenu masqué : refusé", () => {
    const k = "btp_documents_autres";
    const e = {
      field_key: k,
      section_key: sec(k),
      label: "Autres",
      proposed: "PLU",
      expectedCurrent: null,
    };
    expect(planApply(tpl, { btp_documents: ["autre"] }, [e], false).accepted).toHaveLength(1);
    expect(planApply(tpl, { btp_documents: [] }, [e], false).rejected[0].reason).toBe(
      "champ masqué par les réponses actuelles",
    );
  });
});

describe("mergeApplyResult — saisie pendant une application IA", () => {
  test("champ retapé pendant l'envoi : la nouvelle saisie reste, pas d'effacement d'erreur", () => {
    const rev = new Map([["a", 3]]);
    const r = mergeApplyResult({ a: 55 } as Record<string, unknown>, { applied: ["a"], conflicts: [] }, new Map([["a", 40]]), new Map([["a", 2]]), (k) => rev.get(k) ?? 0);
    expect(r.answers.a).toBe(55);
    expect(r.settled).toEqual([]);
  });
  test("champ inchangé : valeur appliquée intégrée et réglée", () => {
    const r = mergeApplyResult({ a: 35 } as Record<string, unknown>, { applied: ["a"], conflicts: [] }, new Map([["a", 40]]), new Map([["a", 2]]), () => 2);
    expect(r.answers.a).toBe(40);
    expect(r.settled).toEqual(["a"]);
  });
  test("conflit sur champ retapé : saisie locale conservée", () => {
    const r = mergeApplyResult({ a: 60 } as Record<string, unknown>, { applied: [], conflicts: [{ field_key: "a", current: 50 }] }, new Map([["a", 40]]), new Map([["a", 1]]), () => 2);
    expect(r.answers.a).toBe(60);
  });
});

test("mergeApplyResult — saisie (même invalide) pendant le preflight : révision 0 au début, 1 ensuite, retour CAS ignoré", () => {
  const revAtStart = new Map([["a", 0]]);
  const rev = new Map([["a", 0]]);
  rev.set("a", 1); // retape pendant flush/preflight
  const r = mergeApplyResult({ a: -1 } as Record<string, unknown>, { applied: ["a"], conflicts: [] }, new Map([["a", 40]]), revAtStart, (k) => rev.get(k) ?? 0);
  expect(r.answers.a).toBe(-1);
  expect(r.settled).toEqual([]);
});
