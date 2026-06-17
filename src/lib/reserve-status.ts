// Statuts unifiés des réserves PVIA — source unique pour UI / PDF / emails.

export const RESERVE_STATUSES = [
  "ouverte",
  "en_cours",
  "levee",
  "en_attente_validation",
  "validee",
  "rejetee",
] as const;

export type ReserveStatusValue = (typeof RESERVE_STATUSES)[number];

export const RESERVE_STATUS_LABEL: Record<ReserveStatusValue, string> = {
  ouverte: "Ouverte",
  en_cours: "En cours",
  levee: "Levée",
  en_attente_validation: "En attente validation",
  validee: "Validée client",
  rejetee: "Rejetée",
};

export type StatusTone = "destructive" | "warning" | "success" | "neutral";

export const RESERVE_STATUS_TONE: Record<ReserveStatusValue, StatusTone> = {
  ouverte: "destructive",
  en_cours: "warning",
  levee: "warning",
  en_attente_validation: "warning",
  validee: "success",
  rejetee: "neutral",
};

export const RESERVE_SEVERITY_LABEL: Record<string, string> = {
  mineure: "Mineure",
  majeure: "Majeure",
};

export const RESERVE_PRIORITY_LABEL: Record<string, string> = {
  low: "Basse",
  normal: "Normale",
  high: "Haute",
};

export function reserveStatusLabel(s: string | null | undefined): string {
  if (!s) return "—";
  return RESERVE_STATUS_LABEL[s as ReserveStatusValue] ?? s;
}

export function reserveStatusTone(s: string | null | undefined): StatusTone {
  if (!s) return "neutral";
  return RESERVE_STATUS_TONE[s as ReserveStatusValue] ?? "neutral";
}

export function isReserveOverdue(due_date: string | null | undefined, status: string | null | undefined): boolean {
  if (!due_date) return false;
  if (status === "validee" || status === "levee" || status === "en_attente_validation") return false;
  return new Date(due_date) < new Date();
}
