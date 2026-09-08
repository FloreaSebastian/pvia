/**
 * Conformité documentaire des sous-traitants (module interne à l'entreprise).
 *
 * Fichier CLIENT-SAFE : aucune dépendance serveur. Il est utilisé à la fois
 * par les server functions (source de vérité) et par l'UI (rendu).
 *
 * ⚠️ Vocabulaire produit : PVIA ne certifie AUCUNE conformité juridique.
 * Les libellés parlent toujours des « règles documentaires de votre
 * entreprise ».
 */

export const SUBCONTRACTOR_DOC_TYPES = [
  "decennale",
  "rc_pro",
  "kbis",
  "urssaf_vigilance",
  "attestation_fiscale",
  "rge",
  "qualipv",
  "qualipac",
  "qualifelec",
  "habilitation_electrique",
  "carte_btp",
  "autorisation_specifique",
  "autre",
] as const;

export type SubcontractorDocType = (typeof SUBCONTRACTOR_DOC_TYPES)[number];

/** Catalogue extensible : ajouter un type = 1 entrée ici + 1 valeur d'enum SQL. */
export const DOC_TYPE_META: Record<
  SubcontractorDocType,
  { label: string; group: string; hint?: string; expiresUsually: boolean }
> = {
  decennale: { label: "Attestation d'assurance décennale", group: "Assurances", expiresUsually: true },
  rc_pro: { label: "Responsabilité civile professionnelle", group: "Assurances", expiresUsually: true },
  kbis: { label: "Kbis / extrait RNE", group: "Administratif", expiresUsually: true },
  urssaf_vigilance: { label: "Attestation de vigilance URSSAF", group: "Administratif", expiresUsually: true },
  attestation_fiscale: { label: "Attestation fiscale", group: "Administratif", expiresUsually: true },
  rge: { label: "Qualification RGE", group: "Qualifications", expiresUsually: true },
  qualipv: { label: "QualiPV", group: "Qualifications", expiresUsually: true },
  qualipac: { label: "QualiPAC", group: "Qualifications", expiresUsually: true },
  qualifelec: { label: "Qualifelec", group: "Qualifications", expiresUsually: true },
  habilitation_electrique: { label: "Habilitation électrique", group: "Habilitations", expiresUsually: true },
  carte_btp: { label: "Carte BTP", group: "Habilitations", expiresUsually: true },
  autorisation_specifique: { label: "Autorisation / habilitation spécifique", group: "Habilitations", expiresUsually: true },
  autre: { label: "Autre pièce", group: "Divers", expiresUsually: false },
};

export function isDocType(value: unknown): value is SubcontractorDocType {
  return typeof value === "string" && (SUBCONTRACTOR_DOC_TYPES as readonly string[]).includes(value);
}

export function docTypeLabel(type: string, customLabel?: string | null): string {
  if (customLabel && customLabel.trim()) return customLabel.trim();
  return isDocType(type) ? DOC_TYPE_META[type].label : type;
}

/** Règles par défaut proposées (modifiables par l'entreprise, jamais imposées). */
export const DEFAULT_DOC_RULES: Partial<Record<SubcontractorDocType, { required: boolean; blocking: boolean }>> = {
  decennale: { required: true, blocking: true },
  rc_pro: { required: true, blocking: true },
  kbis: { required: true, blocking: false },
  urssaf_vigilance: { required: true, blocking: false },
};

/** Seuils d'alerte, centralisés (jamais redéfinis dans l'UI). */
export const EXPIRY_ALERT_DAYS = [60, 30, 7, 0] as const;
/** Un document est « expire bientôt » sous ce nombre de jours. */
export const EXPIRY_SOON_DAYS = 30;
/** Relance après expiration : au plus une tous les N jours. */
export const EXPIRED_REMINDER_DAYS = 7;

/**
 * Jalon d'alerte applicable aujourd'hui pour une pièce, ou null si aucune
 * alerte n'est due. Centralisé ici pour rester testable sans le cron.
 */
export function milestoneFor(days: number): string | null {
  if (days < 0) {
    const overdue = -days;
    if (overdue % EXPIRED_REMINDER_DAYS !== 0) return null;
    return `expired+${overdue}`;
  }
  return (EXPIRY_ALERT_DAYS as readonly number[]).includes(days) ? `j-${days}` : null;
}

export type DocumentStatus =
  | "valid"
  | "expiring_soon"
  | "expired"
  | "missing"
  | "no_expiry"
  | "pending_review"
  | "rejected";

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  valid: "Valide",
  no_expiry: "Sans échéance",
  expiring_soon: "Expire bientôt",
  expired: "Expiré",
  missing: "Manquante",
  pending_review: "À vérifier",
  rejected: "Refusée",
};

/**
 * État de revue d'une pièce.
 *
 * COMPATIBILITÉ HISTORIQUE : toutes les pièces déposées avant l'ouverture du
 * portail sous-traitant sont `approved` (défaut SQL). Les dépôts admin restent
 * `approved` (l'entreprise se valide elle-même en déposant). Seuls les dépôts
 * faits PAR le sous-traitant passent par `pending_review`. Aucun partenaire
 * aujourd'hui conforme ne devient non conforme.
 */
export type ReviewStatus = "pending_review" | "approved" | "rejected";

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  pending_review: "À vérifier",
  approved: "Validée",
  rejected: "Refusée",
};

/**
 * Libellé exact d'un motif de blocage à l'affectation. « pending_review » et
 * « rejected » ne doivent JAMAIS être affichés comme « manquante » : la
 * dérogation écrite doit rester compréhensible et auditable.
 */
export const BLOCKING_REASON_LABELS: Record<
  "missing" | "expired" | "pending_review" | "rejected",
  string
> = {
  missing: "manquante",
  expired: "expirée",
  pending_review: "à vérifier",
  rejected: "refusée",
};

export type ComplianceStatus =
  | "compliant"
  | "incomplete"
  | "expiring_soon"
  | "blocking"
  | "pending_review";

export const COMPLIANCE_STATUS_LABELS: Record<ComplianceStatus, string> = {
  compliant: "Conforme selon vos règles",
  incomplete: "À compléter",
  expiring_soon: "Expire bientôt",
  blocking: "Pièce bloquante non conforme",
  pending_review: "Pièce à vérifier",
};

export type ComplianceDocInput = {
  id: string;
  doc_type: string;
  label?: string | null;
  expiry_date?: string | null;
  issue_date?: string | null;
  is_required?: boolean | null;
  is_blocking?: boolean | null;
  archived_at?: string | null;
  review_status?: string | null;
  rejection_reason?: string | null;
};

export type ComplianceRuleInput = {
  doc_type: string;
  is_required: boolean;
  is_blocking: boolean;
};

export type ComplianceLine = {
  docType: string;
  label: string;
  documentId: string | null;
  expiryDate: string | null;
  issueDate: string | null;
  required: boolean;
  blocking: boolean;
  status: DocumentStatus;
  reviewStatus: ReviewStatus | null;
  rejectionReason: string | null;
  daysToExpiry: number | null;
};

export type ComplianceSummary = {
  status: ComplianceStatus;
  lines: ComplianceLine[];
  counts: {
    valid: number;
    expiringSoon: number;
    expired: number;
    missing: number;
    pendingReview: number;
    rejected: number;
  };
  nextExpiry: { docType: string; label: string; date: string; daysToExpiry: number } | null;
  blockingIssues: Array<{
    docType: string;
    label: string;
    reason: "missing" | "expired" | "pending_review" | "rejected";
  }>;
};

export function normalizeReviewStatus(value: unknown): ReviewStatus {
  return value === "pending_review" || value === "rejected" ? value : "approved";
}


/** Jours calendaires entre aujourd'hui (UTC minuit) et une date ISO `YYYY-MM-DD`. */
export function daysUntil(dateIso: string, now: Date = new Date()): number {
  const target = Date.parse(`${dateIso.slice(0, 10)}T00:00:00Z`);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / 86400000);
}

export function documentStatus(expiry: string | null | undefined, now: Date = new Date()): DocumentStatus {
  if (!expiry) return "no_expiry";
  const d = daysUntil(expiry, now);
  if (d < 0) return "expired";
  if (d <= EXPIRY_SOON_DAYS) return "expiring_soon";
  return "valid";
}

/**
 * Calcule l'état de conformité d'un partenaire.
 * Source de vérité SERVEUR : l'UI ne fait que rendre ce résultat.
 */
export function computeCompliance(
  docs: ComplianceDocInput[],
  rules: ComplianceRuleInput[],
  now: Date = new Date(),
): ComplianceSummary {
  const active = docs.filter((d) => !d.archived_at);

  /**
   * Version de référence par type : une pièce VALIDÉE prime toujours sur une
   * pièce en cours de vérification, qui prime sur une pièce refusée. À état de
   * revue égal, l'échéance la plus lointaine gagne. Un dépôt en attente ne peut
   * donc jamais dégrader une pièce déjà validée et encore valable.
   */
  const rank = (d: ComplianceDocInput) =>
    ({ approved: 0, pending_review: 1, rejected: 2 })[normalizeReviewStatus(d.review_status)];

  const byType = new Map<string, ComplianceDocInput>();
  for (const d of active) {
    const current = byType.get(d.doc_type);
    if (!current) {
      byType.set(d.doc_type, d);
      continue;
    }
    if (rank(d) < rank(current)) {
      byType.set(d.doc_type, d);
      continue;
    }
    if (rank(d) === rank(current) && (d.expiry_date ?? "") > (current.expiry_date ?? "")) {
      byType.set(d.doc_type, d);
    }
  }

  const types = new Set<string>([...rules.map((r) => r.doc_type), ...byType.keys()]);
  const lines: ComplianceLine[] = [];

  for (const type of types) {
    const rule = rules.find((r) => r.doc_type === type);
    const doc = byType.get(type);
    const required = rule?.is_required ?? doc?.is_required ?? false;
    const blocking = rule?.is_blocking ?? doc?.is_blocking ?? false;
    const review = doc ? normalizeReviewStatus(doc.review_status) : null;
    const status: DocumentStatus = !doc
      ? "missing"
      : review === "pending_review"
        ? "pending_review"
        : review === "rejected"
          ? "rejected"
          : documentStatus(doc.expiry_date, now);
    lines.push({
      docType: type,
      label: docTypeLabel(type, doc?.label),
      documentId: doc?.id ?? null,
      expiryDate: doc?.expiry_date ?? null,
      issueDate: doc?.issue_date ?? null,
      required,
      blocking,
      status,
      reviewStatus: review,
      rejectionReason: review === "rejected" ? (doc?.rejection_reason ?? null) : null,
      daysToExpiry: doc?.expiry_date ? daysUntil(doc.expiry_date, now) : null,
    });
  }

  lines.sort((a, b) => {
    const order = (l: ComplianceLine) =>
      (l.blocking ? 0 : l.required ? 1 : 2) * 10 +
      ({
        expired: 0,
        rejected: 1,
        missing: 2,
        pending_review: 3,
        expiring_soon: 4,
        valid: 5,
        no_expiry: 6,
      } as const)[l.status];
    return order(a) - order(b) || a.label.localeCompare(b.label, "fr");
  });

  const counts = {
    valid: lines.filter((l) => l.status === "valid" || l.status === "no_expiry").length,
    expiringSoon: lines.filter((l) => l.status === "expiring_soon").length,
    expired: lines.filter((l) => l.status === "expired").length,
    missing: lines.filter((l) => l.status === "missing" && l.required).length,
    // Compteurs de revue : toutes les versions actives concernées, pas
    // seulement la version de référence (une pièce peut être en attente alors
    // qu'une version validée reste en vigueur).
    pendingReview: active.filter((d) => normalizeReviewStatus(d.review_status) === "pending_review").length,
    rejected: active.filter((d) => normalizeReviewStatus(d.review_status) === "rejected").length,
  };

  const blockingIssues = lines
    .filter(
      (l) =>
        l.blocking &&
        l.required &&
        (l.status === "expired" ||
          l.status === "missing" ||
          l.status === "pending_review" ||
          l.status === "rejected"),
    )
    .map((l) => ({
      docType: l.docType,
      label: l.label,
      reason: l.status as "missing" | "expired" | "pending_review" | "rejected",
    }));

  const upcoming = lines
    .filter((l) => l.expiryDate && l.daysToExpiry !== null && l.daysToExpiry >= 0)
    .sort((a, b) => (a.daysToExpiry! - b.daysToExpiry!));
  const next = upcoming[0];

  let status: ComplianceStatus = "compliant";
  if (blockingIssues.length > 0) status = "blocking";
  else if (counts.missing > 0 || lines.some((l) => l.required && l.status === "expired")) status = "incomplete";
  else if (counts.pendingReview > 0 || lines.some((l) => l.required && l.status === "rejected"))
    status = "pending_review";
  else if (counts.expiringSoon > 0) status = "expiring_soon";


  return {
    status,
    lines,
    counts,
    nextExpiry: next
      ? { docType: next.docType, label: next.label, date: next.expiryDate!, daysToExpiry: next.daysToExpiry! }
      : null,
    blockingIssues,
  };
}

/** Date lisible FR (jamais un statut par la seule couleur). */
export function formatFrDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}

/** Libellé humain pour le journal d'audit. */
export function complianceAuditLabel(
  actor: string,
  companyName: string,
  action: string,
  docLabel: string,
  partnerName: string,
  expiry?: string | null,
): string {
  const suffix = expiry ? `, valable jusqu'au ${formatFrDate(expiry)}` : "";
  return `${actor} — ${companyName} a ${action} ${docLabel} de ${partnerName}${suffix}.`;
}
