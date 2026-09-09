/**
 * Solar Studio — provenance et confiance.
 *
 * Module PUR. Aucun booléen « verified » : toute donnée géométrique porte
 * son origine, son fournisseur, sa date, son niveau de confiance et son état
 * de vérification terrain.
 */

export type SourceType =
  | "AUTO"
  | "LIDAR"
  | "MNS"
  | "MNH"
  | "MNT"
  | "MAP"
  | "MANUAL"
  | "FIELD"
  | "DRONE"
  | "IMPORT";

export const SOURCE_TYPE_META: Record<SourceType, { label: string; color: string; help: string }> = {
  AUTO: { label: "Automatique", color: "#a78bfa", help: "Géométrie générée par PVIA à partir des paramètres saisis." },
  LIDAR: { label: "LiDAR", color: "#2563eb", help: "Dérivée d'un nuage de points altimétrique." },
  MNS: { label: "Modèle de surface", color: "#0ea5e9", help: "Altitude de la surface supérieure observée." },
  MNH: { label: "Modèle de hauteur", color: "#38bdf8", help: "Hauteur relative au terrain." },
  MNT: { label: "Modèle de terrain", color: "#14b8a6", help: "Altitude du sol." },
  MAP: { label: "Donnée cartographique", color: "#f59e0b", help: "Contour ou position issus d'une carte." },
  MANUAL: { label: "Saisie manuelle", color: "#94a3b8", help: "Valeur saisie dans Solar Studio." },
  FIELD: { label: "Relevé terrain", color: "#16a34a", help: "Mesure réalisée sur site." },
  DRONE: { label: "Relevé drone", color: "#7c3aed", help: "Photogrammétrie drone." },
  IMPORT: { label: "Import", color: "#78716c", help: "Fichier importé par l'utilisateur." },
};

/** Classification lisible par le professionnel. Pas de pseudo-précision chiffrée. */
export type ConfidenceLevel = "estimated" | "derived_3d" | "measured" | "field_verified";

export const CONFIDENCE_META: Record<ConfidenceLevel, { label: string; badge: string; rank: number; help: string }> = {
  estimated: {
    label: "Estimé",
    badge: "🟠",
    rank: 0,
    help: "Donnée cartographique ou estimation automatique.",
  },
  derived_3d: {
    label: "Données 3D",
    badge: "🔵",
    rank: 1,
    help: "Dérivée d'une source altimétrique ou LiDAR.",
  },
  measured: {
    label: "Mesuré",
    badge: "🟣",
    rank: 2,
    help: "Valeur saisie à partir d'une mesure réelle.",
  },
  field_verified: {
    label: "Vérifié terrain",
    badge: "🟢",
    rank: 3,
    help: "Confirmé pendant une visite technique.",
  },
};

export type VerificationStatus = "unverified" | "to_verify" | "verified" | "rejected";

export const VERIFICATION_META: Record<VerificationStatus, { label: string }> = {
  unverified: { label: "Non vérifié" },
  to_verify: { label: "À vérifier" },
  verified: { label: "Vérifié terrain" },
  rejected: { label: "Écart constaté" },
};

export type EntityKind = "model" | "building" | "roof_plane" | "roof_edge" | "obstacle" | "measurement" | "terrain";

export interface ProvenanceRecord {
  entity_kind: EntityKind;
  entity_id: string;
  attribute: string;
  source_type: SourceType;
  source_provider: string | null;
  source_dataset: string | null;
  source_date: string | null;
  confidence: ConfidenceLevel;
  verification_status: VerificationStatus;
  verification_method: string | null;
  verified_at: string | null;
  verified_by: string | null;
  field_measurement_id: string | null;
}

/** Confiance naturellement associée à une origine, avant toute vérification terrain. */
export function defaultConfidence(source: SourceType): ConfidenceLevel {
  switch (source) {
    case "FIELD":
      return "field_verified";
    case "LIDAR":
    case "MNS":
    case "MNH":
    case "MNT":
    case "DRONE":
      return "derived_3d";
    case "MANUAL":
    case "IMPORT":
      return "measured";
    default:
      return "estimated";
  }
}

/**
 * Niveau global du modèle : le MINIMUM des niveaux constatés, jamais une
 * moyenne flatteuse. Un modèle n'est « vérifié terrain » que si tout l'est.
 */
export function overallConfidence(records: Pick<ProvenanceRecord, "confidence">[]): ConfidenceLevel {
  if (!records.length) return "estimated";
  let best: ConfidenceLevel = "field_verified";
  for (const r of records) {
    if (CONFIDENCE_META[r.confidence].rank < CONFIDENCE_META[best].rank) best = r.confidence;
  }
  return best;
}

export interface QualityBreakdownRow {
  label: string;
  confidence: ConfidenceLevel;
  source: SourceType;
  detail: string;
  verification: VerificationStatus;
}

export interface QualityReport {
  overall: ConfidenceLevel;
  rows: QualityBreakdownRow[];
  verified_count: number;
  total_count: number;
}

/** Fiche « Qualité du modèle » : élément par élément, jamais réduite à un score. */
export function buildQualityReport(rows: QualityBreakdownRow[]): QualityReport {
  return {
    overall: overallConfidence(rows),
    rows,
    verified_count: rows.filter((r) => r.verification === "verified").length,
    total_count: rows.length,
  };
}
