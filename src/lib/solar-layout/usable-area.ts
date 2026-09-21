/**
 * Smart PV Layout Engine — zone exploitable d'un pan.
 *
 * Zone exploitable = contour du pan
 *   − marge de chaque arête (P0-B : arête > pan > profil de règles)
 *   − obstacles dilatés de leur marge
 *   − zones interdites, passages techniques, réservations
 *
 * Règle de marge d'arête, dans cet ordre strict :
 *   1. marge dédiée saisie sur l'arête (`plane.edges[i].margin_m`) ;
 *   2. marge périphérique du pan (`plane.margin_m`) ;
 *   3. règle du profil correspondant au type d'arête ;
 *   4. arête « indefini » : marge PRUDENTE = la plus grande règle du profil,
 *      signalée dans l'explication. Le moteur ne devine jamais un type.
 *
 * Règle de marge d'obstacle : `max(clearance_m de l'obstacle, obstacle_m du
 * profil)`. Les deux ne s'additionnent JAMAIS : on retient la plus exigeante.
 *
 * Les zones prioritaires ne filtrent rien : elles sont conservées comme
 * préférence pour le scoring.
 */
import {
  bbox,
  offsetPolygon,
  polygonArea,
  rectIntersectsPolygon,
  rectInsidePolygon,
  rectsOverlap,
  toCCW,
  type Rect,
} from "./geometry";
import {
  LAYOUT_EDGE_LABEL,
  type LayoutEdgeKind,
  type LayoutObstacle,
  type LayoutPlane,
  type LayoutZone,
  type Pt,
  type RulesProfile,
} from "./types";

export type EdgeKind = "egout" | "faitage" | "rive";

/** Classe chaque arête du pan : bas de pente = égout, haut = faîtage, sinon rive. */
export function classifyEdges(poly: Pt[]): EdgeKind[] {
  const p = toCCW(poly);
  const box = bbox(p);
  const tol = Math.max(0.05, (box.maxY - box.minY) * 0.02);
  return p.map((a, i) => {
    const b = p[(i + 1) % p.length]!;
    const midY = (a.y + b.y) / 2;
    const horizontal = Math.abs(a.y - b.y) <= tol;
    if (horizontal && midY - box.minY <= tol) return "egout";
    if (horizontal && box.maxY - midY <= tol) return "faitage";
    return "rive";
  });
}

/** Marge du profil correspondant à un type d'arête. */
export function profileMarginFor(kind: LayoutEdgeKind, rules: RulesProfile): number {
  switch (kind) {
    case "egout":
      return rules.eave_m;
    case "faitage":
      return rules.ridge_m;
    case "rive":
      return rules.verge_m;
    case "noue":
      return rules.valley_m;
    case "aretier":
      return rules.hip_m;
    default:
      // Arête non classée : on ne devine pas, on prend la règle la plus stricte.
      return Math.max(rules.eave_m, rules.ridge_m, rules.verge_m, rules.valley_m, rules.hip_m);
  }
}

export type MarginSource = "arete" | "pan" | "profil" | "prudent";

export interface EdgeMarginResolution {
  index: number;
  kind: LayoutEdgeKind;
  /** Le type vient-il d'une saisie manuelle ou d'un classement automatique ? */
  kind_source: "manuel" | "auto";
  margin_m: number;
  source: MarginSource;
}

/**
 * Marge retenue pour chaque arête, dans l'ordre du contour fourni.
 * `plane.edges[i].index` référence l'arête partant du sommet i de `polygon`.
 */
export function resolveEdgeMargins(
  plane: LayoutPlane,
  rules: RulesProfile,
): EdgeMarginResolution[] {
  const auto = classifyEdges(plane.polygon);
  const manual = new Map((plane.edges ?? []).map((e) => [e.index, e]));
  return plane.polygon.map((_, i) => {
    const m = manual.get(i);
    const kind: LayoutEdgeKind = m?.kind ?? auto[i] ?? "indefini";
    const kindSource = m?.kind ? "manuel" : "auto";
    if (m && typeof m.margin_m === "number" && Number.isFinite(m.margin_m)) {
      return {
        index: i,
        kind,
        kind_source: kindSource,
        margin_m: Math.max(0, m.margin_m),
        source: "arete",
      };
    }
    if (typeof plane.margin_m === "number" && Number.isFinite(plane.margin_m)) {
      return {
        index: i,
        kind,
        kind_source: kindSource,
        margin_m: Math.max(0, plane.margin_m),
        source: "pan",
      };
    }
    return {
      index: i,
      kind,
      kind_source: kindSource,
      margin_m: Math.max(0, profileMarginFor(kind, rules)),
      source: kind === "indefini" ? "prudent" : "profil",
    };
  });
}

/** Marges seules, dans l'ordre du contour. */
export function edgeMargins(polyOrPlane: Pt[] | LayoutPlane, rules: RulesProfile): number[] {
  const plane: LayoutPlane = Array.isArray(polyOrPlane)
    ? {
        key: "",
        name: "",
        azimuth_deg: 0,
        tilt_deg: 0,
        polygon: polyOrPlane,
        obstacles: [],
        zones: [],
      }
    : polyOrPlane;
  return resolveEdgeMargins(plane, rules).map((e) => e.margin_m);
}

const BLOCKING_ZONES = new Set(["interdite", "passage", "technique", "reservee"]);

export interface ObstacleRect extends Rect {
  id: string;
  label: string;
  clearance_m: number;
}

export interface BlockedZone {
  id: string;
  type: LayoutZone["type"];
  label: string;
  polygon: Pt[];
}

export interface UsableArea {
  plane_key: string;
  /** Contour utile après reculs. Vide si l'offset est impossible. */
  boundary: Pt[];
  /** Emprises interdites (obstacles dilatés). */
  blockedRects: ObstacleRect[];
  /** Polygones interdits (zones dessinées). */
  blockedPolygons: Pt[][];
  blockedZones: BlockedZone[];
  /** Zones à privilégier. */
  priorityPolygons: Pt[][];
  /** Détail des marges réellement appliquées, arête par arête. */
  edges: EdgeMarginResolution[];
  /** Contraintes lisibles, utilisables telles quelles dans l'explication. */
  notes: string[];
  area_m2: number;
}

export function obstacleRect(o: LayoutObstacle, rules: RulesProfile): ObstacleRect {
  // Jamais clearance + obstacle_m : on retient la plus exigeante des deux.
  const clearance = Math.max(0, o.clearance_m ?? 0, rules.obstacle_m);
  const pad = clearance * 2;
  return {
    id: o.id,
    label: o.label?.trim() || "Obstacle",
    clearance_m: clearance,
    u: o.u,
    v: o.v,
    width: Math.max(0, o.width_m) + pad,
    length: Math.max(0, o.length_m) + pad,
  };
}

const ZONE_LABEL: Record<string, string> = {
  interdite: "Zone interdite",
  passage: "Passage de maintenance",
  technique: "Zone technique",
  reservee: "Zone réservée",
};

function formatM(v: number): string {
  return `${v.toFixed(2).replace(".", ",")} m`;
}

function marginNotes(edges: EdgeMarginResolution[]): string[] {
  const byKind = new Map<
    string,
    { kind: LayoutEdgeKind; margins: Set<number>; source: MarginSource }
  >();
  for (const e of edges) {
    const cur = byKind.get(e.kind) ?? {
      kind: e.kind,
      margins: new Set<number>(),
      source: e.source,
    };
    cur.margins.add(Math.round(e.margin_m * 100) / 100);
    byKind.set(e.kind, cur);
  }
  const out: string[] = [];
  for (const { kind, margins } of byKind.values()) {
    const list = [...margins]
      .sort((a, b) => a - b)
      .map(formatM)
      .join(" / ");
    if (kind === "indefini") {
      out.push(
        `Arête non classée : marge prudente ${list} appliquée (type d'arête non renseigné).`,
      );
    } else {
      out.push(`Marge ${LAYOUT_EDGE_LABEL[kind]} ${list}.`);
    }
  }
  return out;
}

export function buildUsableArea(plane: LayoutPlane, rules: RulesProfile): UsableArea {
  const edges = resolveEdgeMargins(plane, rules);
  const boundary = offsetPolygon(
    plane.polygon,
    edges.map((e) => e.margin_m),
  );
  const blockedRects = plane.obstacles.map((o) => obstacleRect(o, rules));
  const blockedZones: BlockedZone[] = plane.zones
    .filter((z) => BLOCKING_ZONES.has(z.type))
    .map((z) => ({
      id: z.id,
      type: z.type,
      label: z.label?.trim() || ZONE_LABEL[z.type] || "Zone",
      polygon: toCCW(z.polygon),
    }));
  const priorityPolygons = plane.zones
    .filter((z) => z.type === "prioritaire")
    .map((z) => toCCW(z.polygon));

  let area = boundary.length >= 3 ? polygonArea(boundary) : 0;
  for (const r of blockedRects) area -= r.width * r.length;
  for (const z of blockedZones) area -= polygonArea(z.polygon);

  const notes = marginNotes(edges);
  if (boundary.length < 3) {
    notes.push(
      "Zone utile inexploitable : les marges demandées ne laissent aucune surface continue sur ce pan.",
    );
  }
  for (const r of blockedRects) notes.push(`${r.label} : marge ${formatM(r.clearance_m)}.`);
  for (const z of blockedZones) notes.push(`${z.label} respectée.`);

  return {
    plane_key: plane.key,
    boundary,
    blockedRects,
    blockedPolygons: blockedZones.map((z) => z.polygon),
    blockedZones,
    priorityPolygons,
    edges,
    notes,
    area_m2: Math.max(0, area),
  };
}

export type PlacementBlock =
  | { kind: "marge"; id: null; label: string }
  | { kind: "obstacle" | "zone"; id: string; label: string };

/**
 * Pourquoi un emplacement de la grille est-il refusé ? `null` = posable.
 * Le test de contenance vérifie les 4 coins ET les 4 arêtes du module :
 * un contour concave ne peut pas « mordre » un module par une encoche.
 */
export function placementBlock(area: UsableArea, rect: Rect): PlacementBlock | null {
  if (area.boundary.length < 3 || !rectInsidePolygon(rect, area.boundary)) {
    return { kind: "marge", id: null, label: "Marge de bord" };
  }
  const o = area.blockedRects.find((b) => rectsOverlap(rect, b));
  if (o) return { kind: "obstacle", id: o.id, label: o.label };
  const z = area.blockedZones.find((b) => rectIntersectsPolygon(rect, b.polygon));
  if (z) return { kind: "zone", id: z.id, label: z.label };
  return null;
}

/** Un rectangle de module peut-il être posé ? */
export function canPlace(area: UsableArea, rect: Rect): boolean {
  return placementBlock(area, rect) === null;
}

export function inPriorityZone(area: UsableArea, rect: Rect): boolean {
  return area.priorityPolygons.some((p) => rectIntersectsPolygon(rect, p));
}
