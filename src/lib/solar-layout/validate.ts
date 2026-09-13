/**
 * Smart PV Layout Engine — validation live d'un module posé.
 *
 * Un module invalide n'est jamais supprimé : il est marqué, expliqué, et une
 * position valide voisine peut être proposée.
 */
import {
  distanceToBoundary,
  offsetPolygon,
  rectIntersectsPolygon,
  rectsOverlap,
  rectInsidePolygon,
  round3,
  toCCW,
  type Rect,
} from "./geometry";
import { moduleSize } from "./generate";
import { buildUsableArea, canPlace, edgeMargins, type UsableArea } from "./usable-area";
import type {
  LayoutModule,
  LayoutModuleSpec,
  LayoutPlane,
  ModuleValidity,
  RulesProfile,
  ValidityCause,
} from "./types";

const CAUSE_LABEL: Record<ValidityCause, string> = {
  hors_toiture: "Panneau hors toiture",
  recul_insuffisant: "Distance de recul insuffisante",
  collision_obstacle: "Collision avec un obstacle",
  zone_interdite: "Panneau dans une zone interdite",
  passage_technique: "Panneau sur un passage technique",
  collision_module: "Chevauchement avec un autre panneau",
};

export function moduleRect(m: LayoutModule, spec: LayoutModuleSpec): Rect {
  const s = moduleSize(spec, m.orientation);
  return { u: m.u, v: m.v, width: s.width, length: s.length };
}

export function validateLayout(
  planes: LayoutPlane[],
  modules: LayoutModule[],
  spec: LayoutModuleSpec,
  rules: RulesProfile,
): ModuleValidity[] {
  const areaByPlane = new Map<string, UsableArea>();
  const planeByKey = new Map<string, LayoutPlane>();
  for (const p of planes) {
    areaByPlane.set(p.key, buildUsableArea(p, rules));
    planeByKey.set(p.key, p);
  }

  return modules.map((m) => {
    const plane = planeByKey.get(m.plane_key);
    const area = areaByPlane.get(m.plane_key);
    const rect = moduleRect(m, spec);
    const base = { module_id: m.id, measured_m: null as number | null, required_m: null as number | null };

    if (!plane || !area) {
      return { ...base, status: "invalid", cause: "hors_toiture", message: CAUSE_LABEL.hors_toiture };
    }

    const outline = toCCW(plane.polygon);
    if (!rectInsidePolygon(rect, outline)) {
      return { ...base, status: "invalid", cause: "hors_toiture", message: CAUSE_LABEL.hors_toiture };
    }

    const overlapping = modules.find((o) => o !== m && o.plane_key === m.plane_key && rectsOverlap(rect, moduleRect(o, spec)));
    if (overlapping) {
      return {
        ...base,
        status: "invalid",
        cause: "collision_module",
        message: `${CAUSE_LABEL.collision_module} (${overlapping.id})`,
      };
    }

    const hitObstacle = area.blockedRects.find((b) => rectsOverlap(rect, b));
    if (hitObstacle) {
      return {
        ...base,
        status: "invalid",
        cause: "collision_obstacle",
        required_m: round3(rules.obstacle_m),
        message: `${CAUSE_LABEL.collision_obstacle} — marge requise ${rules.obstacle_m.toFixed(2)} m`,
      };
    }

    for (const zone of plane.zones) {
      if (zone.type !== "interdite" && zone.type !== "passage") continue;
      if (!rectIntersectsPolygon(rect, toCCW(zone.polygon))) continue;
      const cause: ValidityCause = zone.type === "interdite" ? "zone_interdite" : "passage_technique";
      return { ...base, status: "invalid", cause, message: CAUSE_LABEL[cause] };
    }

    if (!rectInsidePolygon(rect, area.boundary)) {
      const margins = edgeMargins(plane.polygon, rules);
      const required = Math.max(...margins, 0);
      const measured = round3(Math.min(...cornerDistances(rect, outline)));
      return {
        ...base,
        status: "invalid",
        cause: "recul_insuffisant",
        measured_m: measured,
        required_m: round3(required),
        message: `${CAUSE_LABEL.recul_insuffisant} — ${measured.toFixed(2)} m mesurés, ${required.toFixed(2)} m exigés`,
      };
    }

    return { ...base, status: "valid", cause: null, message: "Position conforme au profil de règles" };
  });
}

function cornerDistances(rect: Rect, poly: ReturnType<typeof toCCW>): number[] {
  const hw = rect.width / 2;
  const hl = rect.length / 2;
  return [
    { x: rect.u - hw, y: rect.v - hl },
    { x: rect.u + hw, y: rect.v - hl },
    { x: rect.u + hw, y: rect.v + hl },
    { x: rect.u - hw, y: rect.v + hl },
  ].map((c) => distanceToBoundary(c, poly));
}

/**
 * Cherche la position valide la plus proche, par anneaux concentriques.
 * Retourne null si aucune position n'est trouvée dans le rayon exploré.
 */
export function suggestFix(
  plane: LayoutPlane,
  others: LayoutModule[],
  module: LayoutModule,
  spec: LayoutModuleSpec,
  rules: RulesProfile,
  options: { step_m?: number; radius_m?: number } = {},
): { u: number; v: number } | null {
  const area = buildUsableArea(plane, rules);
  const step = options.step_m ?? 0.1;
  const radius = options.radius_m ?? 4;
  const size = moduleSize(spec, module.orientation);
  const peers = others.filter((o) => o.id !== module.id && o.plane_key === module.plane_key);
  const rings = Math.ceil(radius / step);

  for (let r = 1; r <= rings; r += 1) {
    const candidates: { u: number; v: number }[] = [];
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        candidates.push({ u: round3(module.u + dx * step), v: round3(module.v + dy * step) });
      }
    }
    candidates.sort((a, b) => (a.v - b.v) || (a.u - b.u));
    for (const c of candidates) {
      const rect: Rect = { u: c.u, v: c.v, width: size.width, length: size.length };
      if (!canPlace(area, rect)) continue;
      if (peers.some((p) => rectsOverlap(rect, moduleRect(p, spec)))) continue;
      return c;
    }
  }
  return null;
}

/** Contour utile exposé à l'interface (guides, aperçu de la zone exploitable). */
export function usableBoundary(plane: LayoutPlane, rules: RulesProfile) {
  return offsetPolygon(plane.polygon, edgeMargins(plane.polygon, rules));
}
