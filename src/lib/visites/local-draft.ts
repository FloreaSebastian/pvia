/**
 * Visites techniques — copie locale des SEULES réponses non encore confirmées par le serveur.
 *
 * Ce n'est pas un mode hors connexion : il s'agit d'un filet de sécurité qui permet,
 * après un rechargement ou un retour sur la page, de proposer la restauration des
 * saisies restées en attente. Rien n'est restauré sans l'accord de l'utilisateur et
 * une réponse modifiée plus récemment sur le serveur n'est jamais écrasée en silence.
 */
import type { AnswerMap, AnswerValue } from "./types";

export const LOCAL_DRAFT_VERSION = 1;

export interface PendingEntry {
  section_key: string;
  value: AnswerValue;
  /** Horodatage local (ms) de la saisie. */
  editedAt: number;
}

export interface LocalDraft {
  v: number;
  visitType: string;
  entries: Record<string, PendingEntry>;
}

export interface DraftStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/** Clé cloisonnée par utilisateur, entreprise, visite et version du format. */
export function localDraftKey(userId: string, companyId: string, visitId: string): string {
  return `pvia:vt-pending:v${LOCAL_DRAFT_VERSION}:${userId}:${companyId}:${visitId}`;
}

export function readLocalDraft(storage: DraftStorage | null, key: string, visitType: string): LocalDraft | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalDraft;
    if (!parsed || parsed.v !== LOCAL_DRAFT_VERSION || parsed.visitType !== visitType || typeof parsed.entries !== "object") {
      storage.removeItem(key);
      return null;
    }
    return Object.keys(parsed.entries).length ? parsed : null;
  } catch {
    return null;
  }
}

/** Écrit (ou efface si vide) la copie locale. Renvoie false si le stockage est indisponible/plein. */
export function writeLocalDraft(
  storage: DraftStorage | null,
  key: string,
  visitType: string,
  entries: Record<string, PendingEntry>,
): boolean {
  if (!storage) return false;
  try {
    if (Object.keys(entries).length === 0) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify({ v: LOCAL_DRAFT_VERSION, visitType, entries } satisfies LocalDraft));
    return true;
  } catch {
    return false;
  }
}

function same(a: AnswerValue | undefined, b: AnswerValue | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export interface RestorePlan {
  /** Saisies locales restaurables sans conflit. */
  restorable: Record<string, PendingEntry>;
  /** Saisies locales dont la réponse serveur a été modifiée APRÈS la saisie locale. */
  conflicts: Record<string, PendingEntry & { serverValue: AnswerValue | undefined }>;
  /** Saisies déjà identiques au serveur (rien à faire). */
  alreadySaved: string[];
}

/** Compare la copie locale à l'état serveur (valeurs + dates de mise à jour). */
export function planRestore(
  draft: LocalDraft,
  serverAnswers: AnswerMap,
  serverUpdatedAt: Record<string, string | null | undefined>,
): RestorePlan {
  const plan: RestorePlan = { restorable: {}, conflicts: {}, alreadySaved: [] };
  for (const [key, entry] of Object.entries(draft.entries)) {
    const server = serverAnswers[key];
    if (same(server, entry.value)) {
      plan.alreadySaved.push(key);
      continue;
    }
    const ts = serverUpdatedAt[key] ? Date.parse(serverUpdatedAt[key]!) : NaN;
    if (Number.isFinite(ts) && ts > entry.editedAt) plan.conflicts[key] = { ...entry, serverValue: server };
    else plan.restorable[key] = entry;
  }
  return plan;
}

export function safeLocalStorage(): DraftStorage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const probe = "pvia:probe";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}
