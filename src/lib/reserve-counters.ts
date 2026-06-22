// Compteurs réserves PVIA — source unique de vérité.
// Tous les écrans (Dashboard, Statistiques, Dossier chantier, Fiche PV,
// Page Réserves, Historique) doivent passer par ce helper afin d'avoir
// strictement les mêmes chiffres pour un même jeu de données.

import { RESERVE_STATUSES, type ReserveStatusValue } from "./reserve-status";

export type CountableReserve = {
  status?: string | null;
  severity?: string | null;
  due_date?: string | null;
};

export type ReserveCounters = {
  total: number;
  ouvertes: number;
  enCours: number;
  levees: number;
  enAttenteValidation: number;
  validees: number;
  rejetees: number;
  /** Toutes les réserves non encore validées (= total - validees - rejetees). */
  ouvertesEffectives: number;
  /** Réserves majeures non encore validées. */
  bloquantes: number;
  /** Réserves dont la due_date est dépassée (et non levées/validées). */
  enRetard: number;
};

function emptyCounters(): ReserveCounters {
  return {
    total: 0,
    ouvertes: 0,
    enCours: 0,
    levees: 0,
    enAttenteValidation: 0,
    validees: 0,
    rejetees: 0,
    ouvertesEffectives: 0,
    bloquantes: 0,
    enRetard: 0,
  };
}

function isOverdue(due_date: string | null | undefined, status: string | null | undefined): boolean {
  if (!due_date) return false;
  if (status === "validee" || status === "rejetee" || status === "levee" || status === "en_attente_validation") {
    return false;
  }
  return new Date(due_date).getTime() < Date.now();
}

/**
 * Calcule les compteurs canoniques pour un ensemble de réserves.
 * Tolère les statuts inconnus (ignorés) et les valeurs null.
 */
export function getReserveCounters(reserves: readonly CountableReserve[] | null | undefined): ReserveCounters {
  const out = emptyCounters();
  if (!reserves || reserves.length === 0) return out;

  for (const r of reserves) {
    out.total++;
    const status = (r.status ?? "ouverte") as ReserveStatusValue;
    switch (status) {
      case "ouverte":
        out.ouvertes++;
        break;
      case "en_cours":
        out.enCours++;
        break;
      case "levee":
        out.levees++;
        break;
      case "en_attente_validation":
        out.enAttenteValidation++;
        break;
      case "validee":
        out.validees++;
        break;
      case "rejetee":
        out.rejetees++;
        break;
      default:
        // Statut inconnu : on le considère comme "ouverte" pour rester strict.
        out.ouvertes++;
        break;
    }
    if (status !== "validee" && status !== "rejetee" && r.severity === "majeure") {
      out.bloquantes++;
    }
    if (isOverdue(r.due_date ?? null, status)) {
      out.enRetard++;
    }
  }

  out.ouvertesEffectives = out.total - out.validees - out.rejetees;
  return out;
}

/**
 * Variante optimisée pour un agrégat par-statut déjà calculé côté SQL
 * (par exemple `count(*) FILTER (WHERE status = ...)`).
 * Utile dans les routes server pour éviter de recharger toutes les lignes.
 */
export function buildReserveCountersFromAggregate(by: Partial<Record<ReserveStatusValue, number>>): ReserveCounters {
  const out = emptyCounters();
  for (const s of RESERVE_STATUSES) {
    const n = by[s] ?? 0;
    switch (s) {
      case "ouverte":
        out.ouvertes = n;
        break;
      case "en_cours":
        out.enCours = n;
        break;
      case "levee":
        out.levees = n;
        break;
      case "en_attente_validation":
        out.enAttenteValidation = n;
        break;
      case "validee":
        out.validees = n;
        break;
      case "rejetee":
        out.rejetees = n;
        break;
    }
    out.total += n;
  }
  out.ouvertesEffectives = out.total - out.validees - out.rejetees;
  return out;
}
