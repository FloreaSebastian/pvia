/**
 * Planification des alertes d'échéance des pièces sous-traitants.
 *
 * Fichier PUR (aucune dépendance serveur) pour rester testable sans base :
 *  - calcul des jours restants en **date locale Europe/Paris** (jamais UTC nu,
 *    sinon une alerte peut partir avec un jour de décalage selon l'heure
 *    d'exécution et les bascules heure d'été / heure d'hiver) ;
 *  - jalons J-60 / J-30 / J-7 / J0 puis relance hebdomadaire J+7, J+14… ;
 *  - éligibilité d'une pièce (archivée, remplacée, règle d'entreprise,
 *    partenaire suspendu ou archivé).
 */
import { EXPIRED_REMINDER_DAYS, EXPIRY_ALERT_DAYS } from "./subcontractor-compliance";

const PARIS = "Europe/Paris";

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: PARIS,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const hourFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: PARIS,
  hour: "2-digit",
  hour12: false,
});

/** Date locale Paris au format `YYYY-MM-DD` pour un instant donné. */
export function parisDateString(now: Date = new Date()): string {
  return partsFmt.format(now);
}

/** Heure locale Paris (0-23) — sert au garde-fou « une fois le matin ». */
export function parisHour(now: Date = new Date()): number {
  return Number(hourFmt.format(now));
}

/** Nombre de jours calendaires entre aujourd'hui (Paris) et une échéance. */
export function daysUntilParis(expiryIso: string, now: Date = new Date()): number {
  const today = Date.parse(`${parisDateString(now)}T00:00:00Z`);
  const target = Date.parse(`${expiryIso.slice(0, 10)}T00:00:00Z`);
  return Math.round((target - today) / 86400000);
}

/**
 * Jalon dû aujourd'hui, ou null.
 *  - avant échéance : uniquement J-60, J-30, J-7 et J0 ;
 *  - après échéance : relance hebdomadaire seulement (J+7, J+14, …),
 *    donc rien à J+1..J+6.
 */
export function milestoneForDays(days: number): string | null {
  if (days < 0) {
    const overdue = -days;
    if (overdue % EXPIRED_REMINDER_DAYS !== 0) return null;
    return `expired+${overdue}`;
  }
  return (EXPIRY_ALERT_DAYS as readonly number[]).includes(days) ? `j-${days}` : null;
}

export type AlertState = "expiring_soon" | "expiring_today" | "expired";

export function alertState(days: number): AlertState {
  if (days < 0) return "expired";
  if (days === 0) return "expiring_today";
  return "expiring_soon";
}

export type ScheduleDoc = {
  id: string;
  company_id: string;
  subcontractor_company_id: string;
  doc_type: string;
  label: string | null;
  expiry_date: string | null;
  is_required: boolean | null;
  is_blocking: boolean | null;
  archived_at: string | null;
  replaced_by_id: string | null;
};

export type ScheduleRule = {
  /** Tenant propriétaire de la règle (contrôlé quand il est fourni). */
  company_id?: string;
  subcontractor_company_id: string;
  doc_type: string;
  is_required: boolean;
  is_blocking: boolean;
};

export type SchedulePartner = {
  id: string;
  /** Tenant propriétaire du partenaire (contrôlé quand il est fourni). */
  company_id?: string;
  name: string;
  status: string;
  archived_at: string | null;
};

export type PlannedAlert = {
  document: ScheduleDoc;
  partner: SchedulePartner;
  milestone: string;
  days: number;
  state: AlertState;
  blocking: boolean;
};

export type SkipReason =
  | "archived_document"
  | "replaced_document"
  | "superseded_by_newer"
  | "no_expiry"
  | "not_required"
  | "partner_inactive"
  | "partner_unknown"
  | "no_milestone";

export type PlanResult = {
  planned: PlannedAlert[];
  skipped: Array<{ documentId: string; reason: SkipReason }>;
};

/**
 * Décide, pour l'exécution du jour, quelles pièces méritent une alerte.
 * La règle d'entreprise (subcontractor_document_rules) prime toujours sur
 * les drapeaux portés par la pièce elle-même.
 */
export function planAlerts(
  docs: ScheduleDoc[],
  rules: ScheduleRule[],
  partners: SchedulePartner[],
  now: Date = new Date(),
): PlanResult {
  const planned: PlannedAlert[] = [];
  const skipped: PlanResult["skipped"] = [];
  const partnerById = new Map(partners.map((p) => [p.id, p]));

  // Pièce active la plus « fraîche » par (partenaire, type) : une ancienne
  // version encore active mais dépassée par une pièce plus récente ne doit
  // plus déclencher d'alerte obsolète.
  const freshest = new Map<string, ScheduleDoc>();
  for (const d of docs) {
    if (d.archived_at || d.replaced_by_id) continue;
    const key = `${d.subcontractor_company_id}:${d.doc_type}`;
    const cur = freshest.get(key);
    if (!cur || (d.expiry_date ?? "") > (cur.expiry_date ?? "")) freshest.set(key, d);
  }

  for (const d of docs) {
    const skip = (reason: SkipReason) => skipped.push({ documentId: d.id, reason });
    if (d.archived_at) { skip("archived_document"); continue; }
    if (d.replaced_by_id) { skip("replaced_document"); continue; }
    const key = `${d.subcontractor_company_id}:${d.doc_type}`;
    if (freshest.get(key)?.id !== d.id) { skip("superseded_by_newer"); continue; }
    if (!d.expiry_date) { skip("no_expiry"); continue; }

    const partner = partnerById.get(d.subcontractor_company_id);
    if (!partner) { skip("partner_unknown"); continue; }
    // Partenaire suspendu ou archivé : plus aucune alerte (il ne peut plus
    // être affecté ; on n'inonde pas les équipes d'échéances sans objet).
    if (partner.archived_at || partner.status === "suspended" || partner.status === "archived") {
      skip("partner_inactive");
      continue;
    }

    const rule = rules.find(
      (r) => r.subcontractor_company_id === d.subcontractor_company_id && r.doc_type === d.doc_type,
    );
    const required = rule ? rule.is_required : (d.is_required ?? false);
    const blocking = rule ? rule.is_required && rule.is_blocking : (d.is_blocking ?? false);
    if (!required) { skip("not_required"); continue; }

    const days = daysUntilParis(d.expiry_date, now);
    const milestone = milestoneForDays(days);
    if (!milestone) { skip("no_milestone"); continue; }

    planned.push({ document: d, partner, milestone, days, state: alertState(days), blocking });
  }

  return { planned, skipped };
}
