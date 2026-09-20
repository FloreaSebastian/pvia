/**
 * Cadre UX Solar Studio V2 (LOT P0-A).
 *
 * Ce module ne contient QUE de la logique pure : définition des étapes du
 * parcours, dérivation de leur état visuel et construction de la barre de
 * synthèse d'implantation. Aucune dépendance React / réseau, afin de pouvoir
 * être testé isolément (cf. tests/unit/solar-studio-steps.test.ts).
 */

export type StudioStepId =
  | "projet"
  | "toiture"
  | "modules"
  | "implantation"
  | "electrique"
  | "resultats";

/** actif = étape en cours, terminé = suffisamment renseigné, alerte = utilisable mais incomplet, bloqué = prérequis manquant. */
export type StudioStepState = "actif" | "termine" | "alerte" | "bloque" | "a_faire";

export type StudioMode = "rapide" | "expert";

export type StudioStep = {
  id: StudioStepId;
  label: string;
  /** Action principale unique de l'étape (règle UX : une seule par étape). */
  primaryAction: string;
  state: StudioStepState;
  /** Explication courte, sans jargon technique, affichée en infobulle / sous le rail. */
  hint: string;
  /** Une étape bloquée reste consultable mais son action principale est désactivée. */
  disabled: boolean;
};

export const STUDIO_STEP_ORDER: StudioStepId[] = [
  "projet",
  "toiture",
  "modules",
  "implantation",
  "electrique",
  "resultats",
];

export const STUDIO_STEP_LABELS: Record<StudioStepId, string> = {
  projet: "Projet",
  toiture: "Toiture",
  modules: "Modules",
  implantation: "Implantation",
  electrique: "Électrique",
  resultats: "Résultats",
};

export type StudioStepInput = {
  activeStep: StudioStepId;
  hasAddress: boolean;
  hasGeolocation: boolean;
  planeCount: number;
  roofAreaM2: number;
  moduleSelected: boolean;
  moduleCount: number;
  powerKwc: number;
  /** Objectif de puissance en kWc, null si aucun objectif n'est fixé. */
  targetKwc: number | null;
  /** Étape électrique : branchée sur un lot ultérieur, jamais simulée. */
  electricalAvailable?: boolean;
};

export function isStudioStepId(value: string): value is StudioStepId {
  return (STUDIO_STEP_ORDER as string[]).includes(value);
}

/** Tolérance d'atteinte de l'objectif : en dessous, l'étape passe en alerte. */
export const TARGET_TOLERANCE = 0.95;

export function deriveStudioSteps(input: StudioStepInput): StudioStep[] {
  const roofReady = input.planeCount > 0 && input.roofAreaM2 > 0;
  const layoutReady = input.moduleCount > 0 && input.powerKwc > 0;
  const targetMissed =
    layoutReady && input.targetKwc != null && input.targetKwc > 0
      ? input.powerKwc < input.targetKwc * TARGET_TOLERANCE
      : false;

  const raw: Array<Omit<StudioStep, "state"> & { state: StudioStepState }> = [
    {
      id: "projet",
      label: STUDIO_STEP_LABELS.projet,
      primaryAction: "Confirmer l'adresse du site",
      state: input.hasAddress ? (input.hasGeolocation ? "termine" : "alerte") : "a_faire",
      hint: input.hasAddress
        ? input.hasGeolocation
          ? "Adresse localisée sur la carte."
          : "Adresse saisie mais non localisée : la carte ne peut pas se centrer."
        : "Renseignez l'adresse du site pour afficher la carte.",
      disabled: false,
    },
    {
      id: "toiture",
      label: STUDIO_STEP_LABELS.toiture,
      primaryAction: "Dessiner et régler la toiture",
      state: roofReady ? "termine" : "a_faire",
      hint: roofReady
        ? `${input.planeCount} pan${input.planeCount > 1 ? "s" : ""} · ${formatArea(input.roofAreaM2)}`
        : "Définissez au moins un pan de toiture.",
      disabled: false,
    },
    {
      id: "modules",
      label: STUDIO_STEP_LABELS.modules,
      primaryAction: "Choisir le panneau à poser",
      state: !roofReady ? "bloque" : input.moduleSelected ? "termine" : "a_faire",
      hint: !roofReady
        ? "Définissez d'abord la toiture."
        : input.moduleSelected
          ? "Référence de panneau sélectionnée."
          : "Choisissez une référence réelle dans le catalogue.",
      disabled: !roofReady,
    },
    {
      id: "implantation",
      label: STUDIO_STEP_LABELS.implantation,
      primaryAction: "Calculer l'implantation",
      state: !roofReady ? "bloque" : targetMissed ? "alerte" : layoutReady ? "termine" : "a_faire",
      hint: !roofReady
        ? "Définissez d'abord la toiture."
        : targetMissed
          ? `Objectif ${formatKwc(input.targetKwc ?? 0)} non atteint : ${formatKwc(input.powerKwc)} posés.`
          : layoutReady
            ? `${input.moduleCount} panneaux · ${formatKwc(input.powerKwc)}`
            : "Lancez un calcul d'implantation.",
      disabled: !roofReady,
    },
    {
      id: "electrique",
      label: STUDIO_STEP_LABELS.electrique,
      primaryAction: "Préparer l'étude électrique",
      state: input.electricalAvailable ? (layoutReady ? "a_faire" : "bloque") : "bloque",
      hint: input.electricalAvailable
        ? layoutReady
          ? "Onduleurs et chaînes à définir."
          : "Calculez d'abord une implantation."
        : "Étape prévue : elle sera activée quand l'étude électrique sera disponible.",
      disabled: !input.electricalAvailable || !layoutReady,
    },
    {
      id: "resultats",
      label: STUDIO_STEP_LABELS.resultats,
      primaryAction: "Consulter la synthèse",
      state: layoutReady ? "termine" : "bloque",
      hint: layoutReady ? "Synthèse disponible." : "Calculez d'abord une implantation.",
      disabled: !layoutReady,
    },
  ];

  // Une étape bloquée reste consultable, mais ne perd JAMAIS son état « bloqué » :
  // l'indisponibilité doit rester lisible même quand l'étape est ouverte.
  return raw.map((step) =>
    step.id === input.activeStep && step.state !== "bloque"
      ? { ...step, state: "actif" as const }
      : step,
  );
}

/** Libellé d'état affiché dans le rail (accessibilité + mention « Indisponible »). */
export function studioStepStatusLabel(state: StudioStepState): string {
  switch (state) {
    case "termine":
      return "Terminé";
    case "alerte":
      return "À vérifier";
    case "bloque":
      return "Indisponible";
    case "actif":
      return "En cours";
    default:
      return "À faire";
  }
}

export type LayoutSummaryInput = {
  moduleCount: number;
  powerKwc: number;
  /** Surface cumulée des modules posés, null si non calculable. */
  moduleAreaM2: number | null;
  targetKwc: number | null;
  planeNames: string[];
  alerts: string[];
};

export type LayoutSummaryItem = { label: string; value: string };

export type LayoutSummary = {
  items: LayoutSummaryItem[];
  alerts: string[];
  /** Progression vers l'objectif, entre 0 et 1 ; null si aucun objectif. */
  progress: number | null;
};

export function buildLayoutSummary(input: LayoutSummaryInput): LayoutSummary {
  const items: LayoutSummaryItem[] = [
    { label: "Modules", value: String(input.moduleCount) },
    { label: "Puissance", value: formatKwc(input.powerKwc) },
  ];
  if (input.moduleAreaM2 != null)
    items.push({ label: "Surface modules", value: formatArea(input.moduleAreaM2) });
  items.push({
    label: "Objectif",
    value: input.targetKwc == null ? "Libre" : formatKwc(input.targetKwc),
  });
  items.push({
    label: "Pans utilisés",
    value: input.planeNames.length ? input.planeNames.join(", ") : "Aucun",
  });

  const alerts = [...input.alerts];
  if (
    input.targetKwc != null &&
    input.targetKwc > 0 &&
    input.powerKwc > 0 &&
    input.powerKwc < input.targetKwc * TARGET_TOLERANCE
  ) {
    alerts.push(
      `Objectif ${formatKwc(input.targetKwc)} non atteint : ${formatKwc(input.powerKwc)} posés.`,
    );
  }

  return {
    items,
    alerts,
    progress:
      input.targetKwc == null || input.targetKwc <= 0
        ? null
        : Math.max(0, Math.min(1, input.powerKwc / input.targetKwc)),
  };
}

export type SaveState = "enregistre" | "modifie" | "enregistrement" | "erreur";

/** Libellé rassurant de l'état de sauvegarde (règle UX : visible et non anxiogène). */
export function saveStateLabel(state: SaveState): string {
  switch (state) {
    case "enregistrement":
      return "Enregistrement…";
    case "modifie":
      return "Modifications non enregistrées";
    case "erreur":
      return "Dernier enregistrement échoué";
    default:
      return "Enregistré";
  }
}

export function formatKwc(value: number): string {
  return `${round(value, 2).toLocaleString("fr-FR")} kWc`;
}

export function formatArea(value: number): string {
  return `${round(value, 1).toLocaleString("fr-FR")} m²`;
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
