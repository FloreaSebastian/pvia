import { describe, expect, it } from "bun:test";
import { validateFieldValue, isValidFilled, validateAnswerEntries, findTemplateField } from "../../src/lib/visites/validation";
import { planRestore, readLocalDraft, writeLocalDraft, localDraftKey, type DraftStorage } from "../../src/lib/visites/local-draft";
import { localInputToIso, isoToLocalInputs } from "../../src/lib/visites/planning";
import { getVisitTemplate } from "../../src/lib/visites/templates";
import type { VisitField } from "../../src/lib/visites/types";

const num = { key: "pente", label: "Pente", type: "number", unit: "°", min: 0, max: 90 } as VisitField;
const intF = { key: "nb", label: "Nombre", type: "number", min: 1, max: 6, step: 1 } as VisitField;
const sel = { key: "t", label: "Type", type: "select", options: [{ value: "tuile", label: "Tuile" }] } as VisitField;
const multi = { key: "m", label: "M", type: "multiselect", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] } as VisitField;
const date = { key: "d", label: "Date", type: "date" } as VisitField;

describe("validation sémantique des réponses", () => {
  it("bornes numériques", () => {
    expect(validateFieldValue(num, 35)).toBeNull();
    expect(validateFieldValue(num, 91)).toContain("maximum 90 °");
    expect(validateFieldValue(num, -1)).toContain("minimum");
    expect(validateFieldValue(num, "35")).toContain("nombre attendu");
  });
  it("entier exigé si step >= 1", () => {
    expect(validateFieldValue(intF, 2.5)).toContain("entier");
    expect(validateFieldValue(intF, 2)).toBeNull();
  });
  it("options select / multiselect", () => {
    expect(validateFieldValue(sel, "ardoise")).toContain("non proposé");
    expect(validateFieldValue(multi, ["a", "a"])).toContain("double");
    expect(validateFieldValue(multi, ["a", "z"])).toContain("non proposé");
    expect(validateFieldValue(multi, ["a", "b"])).toBeNull();
  });
  it("date réelle", () => {
    expect(validateFieldValue(date, "2026-02-30")).toContain("invalide");
    expect(validateFieldValue(date, "2026-02-28")).toBeNull();
  });
  it("une valeur invalide ne compte pas comme renseignée", () => {
    expect(isValidFilled(num, 120)).toBe(false);
    expect(isValidFilled(num, 30)).toBe(true);
    expect(isValidFilled(num, null)).toBe(false);
  });
  it("clé inconnue ou mauvaise étape refusée sur le modèle réel", () => {
    const tpl = getVisitTemplate("photovoltaique" as never);
    const errs = validateAnswerEntries(tpl, [{ section_key: tpl.sections[0].key, field_key: "cle_inventee", value: "x" }]);
    expect(errs[0].message).toContain("inconnu");
    const f = tpl.sections[0].fields[0];
    const other = tpl.sections[1].key;
    const wrong = validateAnswerEntries(tpl, [{ section_key: other, field_key: f.key, value: null }]);
    expect(wrong[0].message).toContain("n'appartient pas");
  });
  it("index de répétition hors limite refusé", () => {
    const tpl = getVisitTemplate("photovoltaique" as never);
    const rep = tpl.sections.find((s) => s.repeat);
    if (!rep) return;
    expect(findTemplateField(tpl, `${rep.fields[0].key}__${rep.repeat!.max}`)).toBeNull();
    expect(findTemplateField(tpl, `${rep.fields[0].key}__0`)).not.toBeNull();
  });
});

function mem(): DraftStorage & { m: Map<string, string> } {
  const m = new Map<string, string>();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe("copie locale des réponses en attente", () => {
  it("clé cloisonnée utilisateur/entreprise/visite", () => {
    expect(localDraftKey("u1", "c1", "v1")).not.toBe(localDraftKey("u2", "c1", "v1"));
    expect(localDraftKey("u1", "c1", "v1")).not.toBe(localDraftKey("u1", "c2", "v1"));
  });
  it("type de visite différent : copie ignorée et effacée", () => {
    const s = mem();
    writeLocalDraft(s, "k", "photovoltaique", { a: { section_key: "s", value: 1, editedAt: 1 } });
    expect(readLocalDraft(s, "k", "pac_air_eau")).toBeNull();
    expect(s.m.size).toBe(0);
  });
  it("valeur serveur plus récente = conflit, jamais écrasée silencieusement", () => {
    const draft = { v: 1, visitType: "pv", entries: {
      a: { section_key: "s", value: 10, editedAt: Date.parse("2026-01-01T10:00:00Z") },
      b: { section_key: "s", value: 20, editedAt: Date.parse("2026-01-01T10:00:00Z") },
      c: { section_key: "s", value: 30, editedAt: 0 },
    } };
    const plan = planRestore(draft, { a: 1, b: 2, c: 30 }, { a: "2026-01-01T11:00:00Z", b: "2026-01-01T09:00:00Z" });
    expect(Object.keys(plan.conflicts)).toEqual(["a"]);
    expect(Object.keys(plan.restorable)).toEqual(["b"]);
    expect(plan.alreadySaved).toEqual(["c"]);
  });
});

describe("planification", () => {
  it("aller-retour date/heure locale", () => {
    const iso = localInputToIso("2026-10-12", "14:30")!;
    expect(isoToLocalInputs(iso)).toEqual({ date: "2026-10-12", time: "14:30" });
  });
  it("date impossible refusée", () => {
    expect(localInputToIso("2026-02-30", "10:00")).toBeNull();
    expect(localInputToIso("2026-02-10", "25:00")).toBeNull();
  });
});

import { sniffImage } from "../../src/lib/visites/validation";
describe("contrôle du contenu des photos", () => {
  it("signatures reconnues, faux .jpg refusé", () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffImage(new TextEncoder().encode("RIFF1234WEBP"))).toBe("image/webp");
    expect(sniffImage(new TextEncoder().encode("not an image"))).toBeNull();
  });
});
