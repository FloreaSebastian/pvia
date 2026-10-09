/**
 * Assistant de visite — logique de session côté client (pure, testable).
 * Identité des cartes, restauration du texte, garde des requêtes tardives,
 * enregistrement préalable et re-validation au moment d'appliquer.
 */
import { formatAnswer, resolveSections } from "./engine";
import { findTemplateField, isValidFilled, validateFieldValue } from "./validation";
import {
  ANSWER_STATUS_TOKENS,
  isAnswerStatusToken,
  type AnswerMap,
  type AnswerValue,
  type VisitTemplate,
} from "./types";

/** Identifiant d'une carte : propre à la réponse (turn) ET au champ. */
export function proposalCardId(turnId: number, fieldKey: string): string {
  return `${turnId}:${fieldKey}`;
}

/**
 * Texte restant dans la zone de saisie après une réponse RÉUSSIE : on retire seulement ce qui
 * a été envoyé ; ce qui a été tapé pendant la requête est conservé. En cas d'échec, rien n'est retiré.
 */
export function textAfterSuccess(current: string, sent: string): string {
  const s = sent.trim();
  if (!s) return current;
  const cur = current.trim();
  if (cur === s) return "";
  if (cur.startsWith(s)) return cur.slice(s.length).trimStart();
  return current;
}

/** Garde de génération : seule la dernière requête de la session courante est prise en compte. */
export function createRequestGate() {
  let gen = 0;
  return {
    next: () => ++gen,
    isCurrent: (n: number) => n === gen,
    invalidate: () => {
      gen++;
    },
  };
}

/** Avant une demande IA : les saisies en attente doivent être confirmées par le serveur. */
export async function ensureSavedBeforeAsk(opts: {
  online: boolean;
  pending: () => number;
  flush: () => Promise<boolean>;
  hasFieldErrors?: () => boolean;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  if (opts.pending() === 0) return { ok: true };
  if (!opts.online) {
    return {
      ok: false,
      message:
        "Hors ligne : vos dernières réponses ne sont pas encore enregistrées. Réessayez au retour du réseau (votre texte est conservé).",
    };
  }
  let ok = await opts.flush();
  for (let i = 0; i < 2 && (!ok || opts.pending() > 0); i++) ok = await opts.flush();
  if (!ok || opts.pending() > 0) {
    return {
      ok: false,
      message:
        "Vos dernières réponses ne sont pas enregistrées : l'assistant ne peut pas les voir. Réessayez l'enregistrement puis relancez (votre texte est conservé).",
    };
  }
  return { ok: true };
}

function same(a: AnswerValue | undefined, b: AnswerValue | undefined | null) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
function hasValue(v: AnswerValue | undefined) {
  return v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
}
function display(template: VisitTemplate, key: string, v: AnswerValue | undefined) {
  if (!hasValue(v)) return "(vide)";
  if (isAnswerStatusToken(v)) return ANSWER_STATUS_TOKENS[v];
  const hit = findTemplateField(template, key);
  return hit ? formatAnswer(hit.field, v as AnswerValue) : String(v);
}

export interface ApplyCandidate {
  field_key: string;
  section_key: string;
  label: string;
  proposed: AnswerValue;
}
export interface ReviewedCandidate extends ApplyCandidate {
  /** Valeur courante relue maintenant : sert de valeur attendue à l'application. */
  current: AnswerValue | null;
  currentText: string;
  proposedText: string;
  overwrites: boolean;
}
export interface RejectedCandidate {
  field_key: string;
  label: string;
  reason: string;
}

function checkField(template: VisitTemplate, answers: AnswerMap, c: ApplyCandidate): string | null {
  const hit = findTemplateField(template, c.field_key);
  if (!hit || hit.section.key !== c.section_key) return "champ inconnu";
  const visible = resolveSections(template, answers).some((rs) =>
    rs.blocks.some((b) => b.fields.some((f) => f.answerKey === c.field_key)),
  );
  if (!visible) return "champ masqué par les réponses actuelles";
  if (!isValidFilled(hit.field, c.proposed) || validateFieldValue(hit.field, c.proposed) !== null)
    return "valeur non conforme au modèle";
  return null;
}

/** Relit l'état courant pour la confirmation : actuel/proposé à jour, champs devenus masqués ou invalides écartés. */
export function reviewCandidates(
  template: VisitTemplate,
  answers: AnswerMap,
  list: ApplyCandidate[],
) {
  const ok: ReviewedCandidate[] = [];
  const rejected: RejectedCandidate[] = [];
  for (const c of list) {
    const reason = checkField(template, answers, c);
    if (reason) {
      rejected.push({ field_key: c.field_key, label: c.label, reason });
      continue;
    }
    const cur = answers[c.field_key];
    if (same(cur, c.proposed)) {
      rejected.push({ field_key: c.field_key, label: c.label, reason: "déjà à cette valeur" });
      continue;
    }
    ok.push({
      ...c,
      current: hasValue(cur) ? (cur as AnswerValue) : null,
      currentText: display(template, c.field_key, cur),
      proposedText: display(template, c.field_key, c.proposed),
      overwrites: hasValue(cur),
    });
  }
  return { ok, rejected };
}

/**
 * Décision finale d'application : refuse tout si la saisie est verrouillée, et chaque champ
 * dont la valeur a changé depuis la confirmation (jamais d'écrasement non confirmé).
 */
export function planApply(
  template: VisitTemplate | null,
  answers: AnswerMap,
  entries: (ApplyCandidate & { expectedCurrent: AnswerValue | null })[],
  locked: boolean,
) {
  if (locked || !template) {
    return {
      accepted: [] as typeof entries,
      rejected: entries.map((e) => ({
        field_key: e.field_key,
        label: e.label,
        reason: "saisie verrouillée",
      })),
    };
  }
  const accepted: typeof entries = [];
  const rejected: RejectedCandidate[] = [];
  for (const e of entries) {
    const reason = checkField(template, answers, e);
    if (reason) rejected.push({ field_key: e.field_key, label: e.label, reason });
    else if (!same(answers[e.field_key], e.expectedCurrent))
      rejected.push({
        field_key: e.field_key,
        label: e.label,
        reason: "valeur modifiée entre-temps",
      });
    else accepted.push(e);
  }
  return { accepted, rejected };
}
