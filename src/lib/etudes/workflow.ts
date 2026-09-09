/**
 * Cahiers des charges — deux axes de statut strictement séparés.
 *
 *  1. STATUT DU CAHIER DES CHARGES : où en est la pré-étude technique
 *     (brouillon → en cours → à vérifier → finalisé → envoyé → archivé).
 *  2. STATUT COMMERCIAL : où en est le devis
 *     (à préparer → préparé → envoyé → relance → accepté / refusé / expiré).
 *
 * Un cahier des charges finalisé peut parfaitement avoir un devis « à préparer ».
 * Le cahier des charges n'est ni un devis, ni un bon de commande, ni un
 * engagement contractuel : le client ne « valide » donc rien ici.
 */
import type { StudyStatus } from "./types";

export type QuoteStatus =
  | "to_prepare"
  | "prepared"
  | "sent"
  | "follow_up"
  | "accepted"
  | "refused"
  | "expired";

export const QUOTE_STATUSES: QuoteStatus[] = [
  "to_prepare",
  "prepared",
  "sent",
  "follow_up",
  "accepted",
  "refused",
  "expired",
];

export const QUOTE_STATUS_META: Record<
  QuoteStatus,
  { label: string; tone: "neutral" | "info" | "warn" | "success" | "danger" | "muted" }
> = {
  to_prepare: { label: "Devis à préparer", tone: "neutral" },
  prepared: { label: "Devis préparé", tone: "info" },
  sent: { label: "Devis envoyé", tone: "info" },
  follow_up: { label: "Relance nécessaire", tone: "warn" },
  accepted: { label: "Devis accepté", tone: "success" },
  refused: { label: "Devis refusé", tone: "danger" },
  expired: { label: "Devis expiré", tone: "muted" },
};

export function isQuoteStatus(value: unknown): value is QuoteStatus {
  return typeof value === "string" && (QUOTE_STATUSES as string[]).includes(value);
}

/** Le projet est vendu : seule situation autorisant la création d'un chantier. */
export function isProjectWon(quoteStatus: string | null | undefined): boolean {
  return quoteStatus === "accepted";
}

export type StudySnapshotForAction = {
  status: string;
  quote_status: string | null;
  completion_percent: number | null;
  missingCount: number;
  pdf_path?: string | null;
  converted_chantier_id?: string | null;
  converted_visit_id?: string | null;
};

export type NextAction = {
  key: string;
  label: string;
  /** Détail court affiché sous le libellé. */
  help: string;
  tone: "info" | "warn" | "success" | "muted";
};

/**
 * Prochaine action déduite de l'état réel du dossier — jamais d'un statut seul.
 * L'ordre des tests reflète le parcours métier officiel PVIA.
 */
export function computeNextAction(s: StudySnapshotForAction): NextAction {
  if (s.status === "archived") {
    return { key: "archived", label: "Dossier archivé", help: "Aucune action en cours.", tone: "muted" };
  }

  if (isProjectWon(s.quote_status)) {
    if (!s.converted_visit_id && !s.converted_chantier_id) {
      return {
        key: "plan_visit",
        label: "Le devis est accepté : planifier la visite technique",
        help: "La visite technique crée ou rattache automatiquement le chantier.",
        tone: "success",
      };
    }
    if (!s.converted_visit_id) {
      return {
        key: "plan_visit_only",
        label: "Planifier la visite technique",
        help: "Le chantier est créé ; il reste à programmer la visite technique.",
        tone: "success",
      };
    }
    return { key: "follow_site", label: "Suivre le chantier", help: "Le projet est passé en production.", tone: "success" };
  }

  if (s.quote_status === "refused") {
    return { key: "lost", label: "Affaire perdue : archiver le dossier", help: "Le devis a été refusé.", tone: "muted" };
  }
  if (s.quote_status === "expired") {
    return { key: "requote", label: "Devis expiré : établir un nouveau devis", help: "Mettez à jour les montants et les dates.", tone: "warn" };
  }
  if (s.quote_status === "follow_up") {
    return { key: "follow_up", label: "Relancer le client", help: "Le devis attend une réponse.", tone: "warn" };
  }
  if (s.quote_status === "sent") {
    return { key: "await_answer", label: "Attendre la réponse au devis", help: "Passez en relance si le client ne répond pas.", tone: "info" };
  }

  if (s.status === "internal_review") {
    return { key: "review", label: "Valider le cahier des charges en interne", help: "En attente de la validation d'un responsable.", tone: "warn" };
  }
  if (s.status === "sent" || s.status === "completed") {
    if (s.quote_status === "prepared") {
      return { key: "send_quote", label: "Envoyer le devis au client", help: "Le devis est prêt : indiquez la date d'envoi.", tone: "info" };
    }
    return { key: "prepare_quote", label: "Préparer le devis", help: "La pré-étude est prête à être chiffrée.", tone: "info" };
  }
  if (s.missingCount > 0) {
    return {
      key: "complete_study",
      label: `Compléter le cahier des charges (${s.missingCount} élément(s) manquant(s))`,
      help: "Les informations obligatoires conditionnent le pré-dimensionnement.",
      tone: "warn",
    };
  }
  return { key: "finalize", label: "Finaliser l'étude", help: "Soumettez le cahier des charges à validation interne.", tone: "info" };
}

/** Statuts du cahier des charges exposés dans l'interface (axe technique uniquement). */
export const STUDY_STATUS_FILTERS: StudyStatus[] = [
  "draft",
  "in_progress",
  "internal_review",
  "completed",
  "sent",
  "archived",
];

/** Garde métier serveur : rien ne peut être créé avant la décision commerciale. */
export function assertConversionAllowed(quoteStatus: string | null | undefined): void {
  if (!isProjectWon(quoteStatus)) {
    throw new Error(
      "Le devis doit être marqué « accepté » dans le suivi commercial avant de créer une visite technique ou un chantier.",
    );
  }
}
