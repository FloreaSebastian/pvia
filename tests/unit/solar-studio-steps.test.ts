import { describe, expect, it } from "vitest";
import {
  buildLayoutSummary,
  deriveStudioSteps,
  formatArea,
  formatKwc,
  isStudioStepId,
  saveStateLabel,
  STUDIO_STEP_ORDER,
  type StudioStepInput,
} from "@/lib/solar/studio-steps";

const base: StudioStepInput = {
  activeStep: "projet",
  hasAddress: true,
  hasGeolocation: true,
  planeCount: 2,
  roofAreaM2: 120,
  moduleSelected: true,
  moduleCount: 24,
  powerKwc: 9.6,
  targetKwc: 9,
};

const stateOf = (input: StudioStepInput, id: string) =>
  deriveStudioSteps(input).find((s) => s.id === id)!.state;

describe("deriveStudioSteps", () => {
  it("expose les six étapes dans l'ordre du parcours", () => {
    expect(deriveStudioSteps(base).map((s) => s.id)).toEqual(STUDIO_STEP_ORDER);
  });

  it("marque l'étape courante comme active même si elle est terminée par ailleurs", () => {
    expect(stateOf({ ...base, activeStep: "implantation" }, "implantation")).toBe("actif");
  });

  it("passe le projet en alerte quand l'adresse n'est pas localisée", () => {
    expect(stateOf({ ...base, activeStep: "toiture", hasGeolocation: false }, "projet")).toBe("alerte");
  });

  it("laisse le projet à faire sans adresse", () => {
    expect(stateOf({ ...base, activeStep: "toiture", hasAddress: false, hasGeolocation: false }, "projet")).toBe(
      "a_faire",
    );
  });

  it("bloque modules et implantation tant que la toiture n'a pas de pan", () => {
    const noRoof = { ...base, activeStep: "projet" as const, planeCount: 0, roofAreaM2: 0 };
    expect(stateOf(noRoof, "modules")).toBe("bloque");
    expect(stateOf(noRoof, "implantation")).toBe("bloque");
    expect(deriveStudioSteps(noRoof).find((s) => s.id === "modules")!.disabled).toBe(true);
  });

  it("met l'implantation en alerte quand l'objectif n'est pas atteint", () => {
    expect(stateOf({ ...base, activeStep: "projet", powerKwc: 6, targetKwc: 9 }, "implantation")).toBe("alerte");
  });

  it("considère l'implantation terminée quand l'objectif est atteint", () => {
    expect(stateOf({ ...base, activeStep: "projet" }, "implantation")).toBe("termine");
  });

  it("tolère un léger écart sous l'objectif", () => {
    expect(stateOf({ ...base, activeStep: "projet", powerKwc: 8.8, targetKwc: 9 }, "implantation")).toBe("termine");
  });

  it("garde l'étape électrique bloquée tant qu'elle n'est pas disponible", () => {
    const step = deriveStudioSteps(base).find((s) => s.id === "electrique")!;
    expect(step.state).toBe("bloque");
    expect(step.disabled).toBe(true);
    expect(step.hint).not.toMatch(/erreur|undefined/i);
  });

  it("ouvre l'étape électrique quand elle devient disponible avec une implantation", () => {
    const step = deriveStudioSteps({ ...base, electricalAvailable: true }).find((s) => s.id === "electrique")!;
    expect(step.state).toBe("a_faire");
    expect(step.disabled).toBe(false);
  });

  it("bloque les résultats sans implantation", () => {
    expect(stateOf({ ...base, activeStep: "projet", moduleCount: 0, powerKwc: 0 }, "resultats")).toBe("bloque");
  });

  it("donne une action principale unique et non vide par étape", () => {
    for (const step of deriveStudioSteps(base)) {
      expect(step.primaryAction.length).toBeGreaterThan(3);
      expect(step.hint.length).toBeGreaterThan(3);
    }
  });
});

describe("buildLayoutSummary", () => {
  it("affiche modules, puissance, surface, objectif et pans", () => {
    const summary = buildLayoutSummary({
      moduleCount: 24,
      powerKwc: 9.6,
      moduleAreaM2: 48.5,
      targetKwc: 9,
      planeNames: ["Pan sud", "Pan est"],
      alerts: [],
    });
    expect(summary.items.map((i) => i.label)).toEqual([
      "Modules",
      "Puissance",
      "Surface modules",
      "Objectif",
      "Pans utilisés",
    ]);
    expect(summary.items[1]!.value).toBe("9,6 kWc");
    expect(summary.items[4]!.value).toBe("Pan sud, Pan est");
    expect(summary.alerts).toHaveLength(0);
    expect(summary.progress).toBeGreaterThan(1 - 1e-9);
  });

  it("omet la surface quand elle n'est pas calculable et signale l'objectif libre", () => {
    const summary = buildLayoutSummary({
      moduleCount: 0,
      powerKwc: 0,
      moduleAreaM2: null,
      targetKwc: null,
      planeNames: [],
      alerts: [],
    });
    expect(summary.items.map((i) => i.label)).not.toContain("Surface modules");
    expect(summary.items.find((i) => i.label === "Objectif")!.value).toBe("Libre");
    expect(summary.items.find((i) => i.label === "Pans utilisés")!.value).toBe("Aucun");
    expect(summary.progress).toBeNull();
  });

  it("ajoute une alerte lisible quand l'objectif n'est pas atteint", () => {
    const summary = buildLayoutSummary({
      moduleCount: 16,
      powerKwc: 6.4,
      moduleAreaM2: 32,
      targetKwc: 9,
      planeNames: ["Pan sud"],
      alerts: ["Un pan a été ignoré."],
    });
    expect(summary.alerts).toHaveLength(2);
    expect(summary.alerts[1]).toContain("9 kWc");
    expect(summary.progress).toBeCloseTo(0.711, 2);
  });
});

describe("utilitaires du cadre", () => {
  it("valide les identifiants d'étape", () => {
    expect(isStudioStepId("toiture")).toBe(true);
    expect(isStudioStepId("inconnu")).toBe(false);
  });

  it("formate puissances et surfaces en français", () => {
    expect(formatKwc(9.605)).toBe("9,61 kWc");
    expect(formatArea(120.04)).toBe("120 m²");
  });

  it("donne des libellés de sauvegarde non anxiogènes", () => {
    expect(saveStateLabel("enregistre")).toBe("Enregistré");
    expect(saveStateLabel("modifie")).toBe("Modifications non enregistrées");
    expect(saveStateLabel("enregistrement")).toBe("Enregistrement…");
    expect(saveStateLabel("erreur")).toBe("Dernier enregistrement échoué");
  });
});
