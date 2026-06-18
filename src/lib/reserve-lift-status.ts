/**
 * Lot C — Reserve-lift business statuses.
 *
 * The DB column `reserve_lift_reports.status` stays text-typed for back-compat.
 * Legacy values (`signe`, `signed_by_company`) are kept readable; new code derives
 * a `DisplayStatus` from the raw row using validation/timestamps so the UI never
 * shows raw technical values.
 */

export type DisplayStatus =
  | "brouillon"
  | "en_cours"
  | "signee_intervenant"
  | "envoyee_client"
  | "client_validated"
  | "client_rejected"
  | "archivee";

export type RawLiftRow = {
  status?: string | null;
  validation_mode?: string | null;
  signed_at?: string | null;
  client_signature?: string | null;
  client_validated_at?: string | null;
  client_rejected_at?: string | null;
};

export function deriveDisplayStatus(r: RawLiftRow): DisplayStatus {
  if (r.client_rejected_at) return "client_rejected";
  if (r.client_validated_at) return "client_validated";
  const s = (r.status ?? "").toLowerCase();
  if (s === "archivee") return "archivee";
  if (s === "brouillon") return "brouillon";
  if (s === "en_cours") return "en_cours";
  if (s === "client_validated") return "client_validated";
  if (s === "client_rejected") return "client_rejected";
  if (
    s === "signe" ||
    s === "signee_intervenant" ||
    s === "signed_by_company" ||
    s === "envoyee_client"
  ) {
    // On-site = client already signed in person → "Signée par intervenant".
    // Remote = waiting client validation → "Envoyée au client".
    if (r.validation_mode && r.validation_mode !== "on_site") return "envoyee_client";
    return "signee_intervenant";
  }
  return "en_cours";
}

export const STATUS_LABELS: Record<DisplayStatus, string> = {
  brouillon: "Brouillon",
  en_cours: "En cours",
  signee_intervenant: "Signée par intervenant",
  envoyee_client: "Envoyée au client",
  client_validated: "Validée client",
  client_rejected: "Rejetée client",
  archivee: "Archivée",
};

export type StatusTone = "neutral" | "warning" | "success" | "destructive" | "info";

export const STATUS_TONES: Record<DisplayStatus, StatusTone> = {
  brouillon: "neutral",
  en_cours: "info",
  signee_intervenant: "warning",
  envoyee_client: "warning",
  client_validated: "success",
  client_rejected: "destructive",
  archivee: "neutral",
};

/** UI hint — server still enforces the role/state rules. */
export function canReopenClientSide(r: RawLiftRow): boolean {
  if (r.client_validated_at || r.client_rejected_at || r.client_signature) return false;
  const ds = deriveDisplayStatus(r);
  return ds === "signee_intervenant" || ds === "envoyee_client";
}

export function isEditableDraft(r: RawLiftRow): boolean {
  const ds = deriveDisplayStatus(r);
  return ds === "brouillon" || ds === "en_cours";
}
