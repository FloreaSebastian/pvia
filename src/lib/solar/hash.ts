/**
 * Solar Studio — empreinte de l'état géométrique.
 *
 * Module PUR et déterministe : la même géométrie produit toujours la même
 * empreinte, quel que soit l'ordre des clés d'objet. Permet d'éviter de
 * relancer un traitement lourd quand rien n'a changé, et de lier une analyse
 * future à une version géométrique précise.
 */

/** Sérialisation stable : clés triées, nombres normalisés au micromètre. */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "null";
    return (Math.round(value * 1e6) / 1e6).toString();
  }
  if (typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return "null";
}

/** FNV-1a 64 bits (implémenté en BigInt), rendu en hexadécimal. */
export function fingerprint(value: unknown): string {
  const input = stableStringify(value);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash ^ BigInt(input.charCodeAt(i) & 0xff)) & mask;
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

export interface GeometryFingerprintInput {
  params: unknown;
  planes: unknown;
  obstacles: unknown;
  terrain?: unknown;
  origin?: unknown;
}

export function geometryFingerprint(input: GeometryFingerprintInput): string {
  return fingerprint({
    params: input.params,
    planes: input.planes,
    obstacles: input.obstacles,
    terrain: input.terrain ?? null,
    origin: input.origin ?? null,
  });
}
