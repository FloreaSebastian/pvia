/**
 * Smart PV Layout Engine — génération des implantations.
 *
 * Déterministe : aucune valeur aléatoire. Le moteur balaie un jeu fixe
 * d'origines, d'alignements et de déphasages, en portrait et en paysage,
 * puis conserve les résultats réellement différents.
 */
import { bbox, round3, type Rect } from "./geometry";
import { inPriorityZone, placementBlock, type UsableArea } from "./usable-area";
import type { LayoutModule, LayoutModuleSpec, Orientation, RulesProfile } from "./types";

export function moduleSize(
  spec: LayoutModuleSpec,
  orientation: Orientation,
): { width: number; length: number } {
  const w = spec.width_mm / 1000;
  const h = spec.height_mm / 1000;
  return orientation === "portrait" ? { width: w, length: h } : { width: h, length: w };
}

export type Align = "start" | "center" | "end";
const ALIGNS: Align[] = ["start", "center", "end"];
const PHASES = [0, 0.5];

export interface GridPlacement {
  plane_key: string;
  u: number;
  v: number;
  orientation: Orientation;
  row: number;
  col: number;
  priority: boolean;
}

/** Emplacements de grille refusés, par cause réellement constatée. */
export interface GridBlocks {
  /** Emplacements refusés par une marge de bord. */
  by_margin: number;
  /** Emplacements refusés par un obstacle, par identifiant d'obstacle. */
  by_obstacle: { id: string; label: string; count: number }[];
  /** Emplacements refusés par une zone dessinée. */
  by_zone: { id: string; label: string; count: number }[];
  /** Emplacements balayés, tous statuts confondus. */
  slots: number;
}

export interface GridResult {
  plane_key: string;
  orientation: Orientation;
  alignU: Align;
  alignV: Align;
  phaseU: number;
  phaseV: number;
  placements: GridPlacement[];
  blocks: GridBlocks;
  signature: string;
}

function shiftFor(align: Align, span: number, step: number, size: number): number {
  const count = Math.max(0, Math.floor((span - size) / step) + 1);
  if (count <= 0) return 0;
  const used = (count - 1) * step + size;
  const leftover = Math.max(0, span - used);
  if (align === "start") return 0;
  if (align === "center") return leftover / 2;
  return leftover;
}

function buildGrid(
  area: UsableArea,
  spec: LayoutModuleSpec,
  rules: RulesProfile,
  orientation: Orientation,
  alignU: Align,
  alignV: Align,
  phaseU: number,
  phaseV: number,
): GridResult | null {
  if (area.boundary.length < 3) return null;
  const { width, length } = moduleSize(spec, orientation);
  if (!(width > 0) || !(length > 0)) return null;

  const box = bbox(area.boundary);
  const spanU = box.maxX - box.minX;
  const spanV = box.maxY - box.minY;
  if (spanU < width || spanV < length) return null;

  const stepU = width + Math.max(0, rules.col_gap_m);
  const stepV = length + Math.max(0, rules.row_gap_m);

  const startU = box.minX + shiftFor(alignU, spanU, stepU, width) + phaseU * stepU + width / 2;
  const startV = box.minY + shiftFor(alignV, spanV, stepV, length) + phaseV * stepV + length / 2;

  const placements: GridPlacement[] = [];
  const obstacleHits = new Map<string, { label: string; count: number }>();
  const zoneHits = new Map<string, { label: string; count: number }>();
  let byMargin = 0;
  let slots = 0;
  let row = 0;
  for (let v = startV; v <= box.maxY - length / 2 + 1e-9; v += stepV, row += 1) {
    let col = 0;
    for (let u = startU; u <= box.maxX - width / 2 + 1e-9; u += stepU, col += 1) {
      const rect: Rect = { u, v, width, length };
      slots += 1;
      const blocked = placementBlock(area, rect);
      if (blocked) {
        if (blocked.kind === "marge") byMargin += 1;
        else {
          const map = blocked.kind === "obstacle" ? obstacleHits : zoneHits;
          const cur = map.get(blocked.id) ?? { label: blocked.label, count: 0 };
          cur.count += 1;
          map.set(blocked.id, cur);
        }
        continue;
      }
      placements.push({
        plane_key: area.plane_key,
        u: round3(u),
        v: round3(v),
        orientation,
        row,
        col,
        priority: inPriorityZone(area, rect),
      });
    }
  }
  if (placements.length === 0) return null;

  return {
    plane_key: area.plane_key,
    orientation,
    alignU,
    alignV,
    phaseU,
    phaseV,
    placements,
    blocks: {
      by_margin: byMargin,
      by_obstacle: [...obstacleHits.entries()].map(([id, v2]) => ({
        id,
        label: v2.label,
        count: v2.count,
      })),
      by_zone: [...zoneHits.entries()].map(([id, v2]) => ({
        id,
        label: v2.label,
        count: v2.count,
      })),
      slots,
    },
    signature: placementSignature(placements),
  };
}

export function placementSignature(
  placements: { u: number; v: number; orientation: Orientation }[],
): string {
  return placements
    .map((p) => `${p.u.toFixed(2)},${p.v.toFixed(2)},${p.orientation[0]}`)
    .sort()
    .join("|");
}

/** Toutes les grilles distinctes possibles sur un pan, pour les orientations demandées. */
export function generateGrids(
  area: UsableArea,
  spec: LayoutModuleSpec,
  rules: RulesProfile,
  orientations: Orientation[],
): GridResult[] {
  const seen = new Set<string>();
  const out: GridResult[] = [];
  for (const orientation of orientations) {
    for (const alignV of ALIGNS) {
      for (const alignU of ALIGNS) {
        for (const phaseV of PHASES) {
          for (const phaseU of PHASES) {
            const grid = buildGrid(area, spec, rules, orientation, alignU, alignV, phaseU, phaseV);
            if (!grid) continue;
            if (seen.has(grid.signature)) continue;
            seen.add(grid.signature);
            out.push(grid);
          }
        }
      }
    }
  }
  return out;
}

/**
 * Regroupe les modules en matrices (blocs contigus).
 * Deux modules sont voisins s'ils se touchent en rangée ou en colonne.
 */
export function assignMatrices(placements: GridPlacement[]): number[] {
  const n = placements.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const a = placements[i]!;
      const b = placements[j]!;
      const dr = Math.abs(a.row - b.row);
      const dc = Math.abs(a.col - b.col);
      if (dr + dc === 1) union(i, j);
    }
  }
  const labels = new Map<number, number>();
  return placements.map((_, i) => {
    const root = find(i);
    if (!labels.has(root)) labels.set(root, labels.size);
    return labels.get(root)!;
  });
}

export function toModules(placements: GridPlacement[], prefix: string): LayoutModule[] {
  const matrices = assignMatrices(placements);
  return placements.map((p, i) => ({
    id: `${prefix}-${p.plane_key}-${i}`,
    plane_key: p.plane_key,
    u: p.u,
    v: p.v,
    orientation: p.orientation,
    row: p.row,
    col: p.col,
    matrix: matrices[i]!,
  }));
}
