/**
 * Solar Studio — unités et précision.
 *
 * Règle stricte : les CALCULS restent en unités SI, en pleine précision.
 * L'arrondi n'existe qu'à l'AFFICHAGE. Aucune fonction de ce module ne doit
 * être utilisée pour stocker une valeur.
 */

export type LengthUnit = "m" | "cm" | "mm";
export type AreaUnit = "m2";
export type AngleUnit = "deg";

export const LENGTH_UNIT_LABEL: Record<LengthUnit, string> = { m: "m", cm: "cm", mm: "mm" };

const LENGTH_FACTOR: Record<LengthUnit, number> = { m: 1, cm: 100, mm: 1000 };
const LENGTH_DECIMALS: Record<LengthUnit, number> = { m: 2, cm: 1, mm: 0 };

/** Conversion depuis les mètres (SI) vers l'unité d'affichage. */
export function fromMeters(value: number, unit: LengthUnit): number {
  return value * LENGTH_FACTOR[unit];
}

/** Conversion d'une saisie utilisateur vers les mètres (SI). */
export function toMeters(value: number, unit: LengthUnit): number {
  return value / LENGTH_FACTOR[unit];
}

export function formatLength(meters: number, unit: LengthUnit = "m", decimals?: number): string {
  const d = decimals ?? LENGTH_DECIMALS[unit];
  return `${fromMeters(meters, unit).toLocaleString("fr-FR", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })} ${LENGTH_UNIT_LABEL[unit]}`;
}

export function formatArea(squareMeters: number, decimals = 2): string {
  return `${squareMeters.toLocaleString("fr-FR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} m²`;
}

export function formatAngle(degrees: number, decimals = 1): string {
  return `${degrees.toLocaleString("fr-FR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}°`;
}

/** Pente en pourcentage à partir d'un angle. Calcul exact, arrondi à l'affichage. */
export function slopePercent(degrees: number): number {
  return Math.tan((degrees * Math.PI) / 180) * 100;
}

export function formatSlope(degrees: number): string {
  return `${formatAngle(degrees)} (${slopePercent(degrees).toFixed(1)} %)`;
}
