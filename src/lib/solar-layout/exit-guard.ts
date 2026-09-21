/**
 * Solar Studio — garde de sortie du brouillon d'édition manuelle (P0-D.1).
 *
 * Module PUR : décide si un changement d'étape (ou une sortie de l'atelier)
 * peut avoir lieu immédiatement, ou doit d'abord ouvrir un dialogue.
 * Un seul dialogue pertinent à la fois : la toiture d'abord (étape active),
 * sinon l'édition manuelle.
 */

export interface StudioGuardState {
  /** Étape active de l'atelier. */
  step: string;
  /** Contours de toiture non enregistrés. */
  roofDirty: boolean;
  /** Mode d'édition manuelle ouvert. */
  manualEditing: boolean;
  /** Brouillon manuel non enregistré. */
  manualDirty: boolean;
}

export type GuardDecision =
  | { action: "proceed" }
  | { action: "confirm-roof" }
  | { action: "confirm-manual" };

/** Décision pour un changement d'étape demandé par le rail. */
export function decideStepChange(state: StudioGuardState, next: string): GuardDecision {
  if (next === state.step) return { action: "proceed" };
  if (state.roofDirty && next !== "toiture") return { action: "confirm-roof" };
  if (state.manualEditing && state.manualDirty) return { action: "confirm-manual" };
  return { action: "proceed" };
}

/** Décision pour une sortie complète (Quitter Solar Studio, lien retour). */
export function decideLeaveStudio(state: StudioGuardState): GuardDecision {
  if (state.roofDirty) return { action: "confirm-roof" };
  if (state.manualEditing && state.manualDirty) return { action: "confirm-manual" };
  return { action: "proceed" };
}

/** Faut-il armer l'avertissement natif de fermeture d'onglet ? */
export function shouldWarnBeforeUnload(state: StudioGuardState): boolean {
  return state.roofDirty || (state.manualEditing && state.manualDirty);
}

/* ------------------------ Résolution du dialogue -------------------------- */

export type ManualLeaveChoice = "save" | "discard" | "stay";

export interface ManualLeaveOutcome {
  /** Poursuivre vers l'étape demandée ? */
  proceed: boolean;
  /** Rester en mode édition manuelle ? */
  stayInManual: boolean;
  /** Restaurer exactement le brouillon de référence ? */
  restoreBaseline: boolean;
}

/**
 * Résultat du dialogue. Un enregistrement échoué NE quitte PAS l'édition et ne
 * change PAS d'étape : les corrections restent à l'écran.
 */
export function resolveManualLeave(
  choice: ManualLeaveChoice,
  saveSucceeded?: boolean,
): ManualLeaveOutcome {
  if (choice === "stay") return { proceed: false, stayInManual: true, restoreBaseline: false };
  if (choice === "discard") return { proceed: true, stayInManual: false, restoreBaseline: true };
  if (saveSucceeded) return { proceed: true, stayInManual: false, restoreBaseline: false };
  return { proceed: false, stayInManual: true, restoreBaseline: false };
}

/* ------------------------- État de sauvegarde exact ------------------------ */

export type ManualSaveState = "idle" | "dirty" | "saving" | "saved" | "error";

/**
 * L'état affiché découle de l'empreinte réelle du brouillon : après un undo
 * revenu exactement à l'état enregistré, l'atelier n'affiche plus « Modifié ».
 */
export function resolveManualSaveState(raw: ManualSaveState, dirty: boolean): ManualSaveState {
  if (raw === "saving" || raw === "error") return raw;
  if (dirty) return "dirty";
  return raw === "saved" ? "saved" : "idle";
}
