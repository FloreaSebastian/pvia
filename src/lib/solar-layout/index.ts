/**
 * Smart PV Layout Engine — point d'entrée.
 *
 * Entrée : pans, module, profil de règles, objectif, stratégie.
 * Sortie : jusqu'à 4 implantations réellement différentes, expliquées :
 *   A Recommandée · B Maximum · C Esthétique · D Alternative.
 *
 * Aucune variante n'est inventée : si deux propositions sont identiques,
 * une seule est retournée.
 *
 * Déterministe : mêmes entrées + même version = même sortie.
 */
import { generateGrids, placementSignature, toModules, type GridPlacement, type GridResult } from "./generate";
import { modulesForPower, selectCount } from "./select";
import { computeCriteria, explain, powerKwc, scoreCandidate } from "./score";
import { moduleSize } from "./generate";
import { buildUsableArea, type UsableArea } from "./usable-area";
import {
  LAYOUT_ENGINE_VERSION,
  type LayoutCandidate,
  type LayoutModule,
  type LayoutModuleSpec,
  type LayoutPlane,
  type LayoutRequest,
  type Orientation,
  type Strategy,
  type VariantRole,
} from "./types";

export * from "./types";
export * from "./geometry";
export * from "./rules";
export * from "./usable-area";
export * from "./generate";
export * from "./select";
export * from "./score";
export * from "./validate";

const ROLE_LABEL: Record<VariantRole, string> = {
  recommandee: "Recommandée",
  maximum: "Maximum",
  esthetique: "Esthétique",
  alternative: "Alternative",
};

export interface LayoutResult {
  candidates: LayoutCandidate[];
  /** Nombre maximal de modules réellement posables, toutes contraintes respectées. */
  max_modules: number;
  max_power_kwc: number;
  /** Nombre de modules visé (0 en mode maximum). */
  target_modules: number;
  target_power_kwc: number | null;
  /** L'objectif demandé est-il atteignable ? */
  achievable: boolean;
  engine_version: string;
  /** Nombre de grilles réellement évaluées. */
  candidates_evaluated: number;
  usable_area_m2: number;
  /** Pans dont la zone utile est vide, avec la raison. */
  unusable_planes: { key: string; name: string; reason: string }[];
}

function orientationsFor(mode: LayoutRequest["orientation"]): Orientation[] {
  if (mode === "portrait") return ["portrait"];
  if (mode === "paysage") return ["paysage"];
  return ["portrait", "paysage"];
}

function orderPlanes(planes: LayoutPlane[], priority?: string[]): LayoutPlane[] {
  if (!priority?.length) return planes;
  const rank = new Map(priority.map((k, i) => [k, i]));
  return [...planes].sort((a, b) => (rank.get(a.key) ?? 999) - (rank.get(b.key) ?? 999));
}

interface PlaneWork {
  plane: LayoutPlane;
  area: UsableArea;
  grids: GridResult[];
  max: number;
}

interface AssembleOptions {
  /** Restreint les grilles à ces orientations (variante « autre orientation »). */
  orientations?: Orientation[];
  /** 0 = meilleure grille, 1 = deuxième meilleure (variante « autre grille »). */
  gridRank?: number;
}

interface Assembled {
  modules: LayoutModule[];
  priorityCount: number;
  planesUsed: LayoutPlane[];
  planesSkipped: LayoutPlane[];
  chosen: GridResult[];
}

export function generateLayouts(req: LayoutRequest): LayoutResult {
  const orientations = orientationsFor(req.orientation);
  const planes = orderPlanes(req.planes, req.plane_priority);
  const spec = req.module;

  const work: PlaneWork[] = planes.map((plane) => {
    const area = buildUsableArea(plane, req.rules);
    const grids = generateGrids(area, spec, req.rules, orientations);
    const max = grids.reduce((m, g) => Math.max(m, g.placements.length), 0);
    return { plane, area, grids, max };
  });

  const evaluated = work.reduce((n, w) => n + w.grids.length, 0);
  const maxModules = work.reduce((n, w) => n + w.max, 0);
  const usableArea = work.reduce((a, w) => a + w.area.area_m2, 0);
  const unusablePlanes = work
    .filter((w) => w.grids.length === 0)
    .map((w) => ({
      key: w.plane.key,
      name: w.plane.name,
      reason:
        w.area.boundary.length < 3
          ? "Marges trop importantes : aucune zone utile sur ce pan."
          : "Aucun panneau entier ne tient dans la zone utile de ce pan.",
    }));

  const targetModules =
    req.target.mode === "power"
      ? modulesForPower(req.target.power_kwc ?? 0, spec.power_wc, req.target.rounding)
      : req.target.mode === "count"
        ? Math.max(0, Math.floor(req.target.count ?? 0))
        : 0;

  const isTargeted = req.target.mode !== "max";
  const achievable = !isTargeted || targetModules <= maxModules;
  const targetPower = isTargeted ? powerKwc(targetModules, spec.power_wc) : null;

  const build = (role: VariantRole, strategy: Strategy, opts: AssembleOptions = {}) => {
    const wanted = strategy === "maximum" || !isTargeted ? Infinity : targetModules;
    const a = assemble(work, wanted, strategy, spec, opts);
    if (a.modules.length === 0) return null;
    return makeCandidate(role, strategy, a, spec, usableArea, targetPower, req);
  };

  const pool: LayoutCandidate[] = [];
  const bySignature = new Map<string, LayoutCandidate>();
  const push = (c: LayoutCandidate | null) => {
    if (!c) return false;
    if (bySignature.has(c.signature)) return false;
    bySignature.set(c.signature, c);
    pool.push(c);
    return true;
  };

  // Stratégies explicitement demandées : on respecte la demande sans rôle produit.
  if (req.strategies?.length) {
    for (const s of req.strategies) push(build(s === "maximum" ? "maximum" : s === "esthetique" ? "esthetique" : "recommandee", s));
  } else {
    push(build("recommandee", "equilibre"));
    push(build("maximum", "maximum"));
    push(build("esthetique", "esthetique"));

    // Alternative : une disposition réellement différente, jamais un doublon renommé.
    const attempts: AssembleOptions[] = [
      ...(orientations.length > 1 ? orientations.map((o) => ({ orientations: [o] })) : []),
      { gridRank: 1 },
      { gridRank: 2 },
    ];
    for (const opts of attempts) {
      if (push(build("alternative", "equilibre", opts))) break;
    }
  }

  const roleOrder: VariantRole[] = ["recommandee", "maximum", "esthetique", "alternative"];
  const candidates = [...pool]
    .sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role) || b.score - a.score)
    .slice(0, req.max_variants ?? 4)
    .map((c) => ({ ...c, label: ROLE_LABEL[c.role] }));

  return {
    candidates,
    max_modules: maxModules,
    max_power_kwc: powerKwc(maxModules, spec.power_wc),
    target_modules: targetModules,
    target_power_kwc: targetPower,
    achievable,
    engine_version: LAYOUT_ENGINE_VERSION,
    candidates_evaluated: evaluated,
    usable_area_m2: Math.round(usableArea * 100) / 100,
    unusable_planes: unusablePlanes,
  };
}

/**
 * Remplissage pan par pan, dans l'ordre de priorité demandé.
 * Un pan suivant n'est utilisé que si l'objectif n'est pas déjà atteint.
 */
function assemble(
  work: PlaneWork[],
  wanted: number,
  strategy: Strategy,
  spec: LayoutModuleSpec,
  opts: AssembleOptions,
): Assembled {
  let remaining = wanted;
  const modules: LayoutModule[] = [];
  const planesUsed: LayoutPlane[] = [];
  const planesSkipped: LayoutPlane[] = [];
  const chosen: GridResult[] = [];
  let priorityCount = 0;

  for (const w of work) {
    if (remaining <= 0) {
      planesSkipped.push(w.plane);
      continue;
    }
    const grids = opts.orientations
      ? w.grids.filter((g) => opts.orientations!.includes(g.orientation))
      : w.grids;

    const ranked: { grid: GridResult; kept: GridPlacement[]; score: number }[] = [];
    for (const grid of grids) {
      const take = Number.isFinite(remaining) ? Math.min(remaining, grid.placements.length) : grid.placements.length;
      const kept = selectCount(grid.placements, take);
      if (kept.length === 0) continue;
      const localModules = toModules(kept, strategy);
      const localCriteria = computeCriteria(
        localModules,
        spec,
        w.area.area_m2,
        null,
        kept.filter((p) => p.priority).length,
      );
      ranked.push({ grid, kept, score: scoreCandidate(localCriteria, strategy) });
    }
    if (ranked.length === 0) {
      planesSkipped.push(w.plane);
      continue;
    }
    // Tri déterministe : score, puis signature, jamais d'aléatoire.
    ranked.sort((a, b) => b.score - a.score || a.grid.signature.localeCompare(b.grid.signature));
    const pick = ranked[Math.min(opts.gridRank ?? 0, ranked.length - 1)]!;

    modules.push(...toModules(pick.kept, `${strategy}-${w.plane.key}`));
    priorityCount += pick.kept.filter((p) => p.priority).length;
    planesUsed.push(w.plane);
    chosen.push(pick.grid);
    if (Number.isFinite(remaining)) remaining -= pick.kept.length;
  }

  return { modules, priorityCount, planesUsed, planesSkipped, chosen };
}

function uniqueOrientation(modules: LayoutModule[]): Orientation | "mixte" {
  const set = new Set(modules.map((m) => m.orientation));
  if (set.size === 1) return [...set][0]!;
  return "mixte";
}

function orientationWord(o: Orientation | "mixte"): string {
  return o === "portrait" ? "portrait" : o === "paysage" ? "paysage" : "orientations mixtes";
}

function frenchList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} et ${items[items.length - 1]}`;
}

function rowStats(modules: LayoutModule[]): { rows_total: number; rows_full: number } {
  const rows = new Map<string, number>();
  for (const m of modules) {
    const k = `${m.plane_key}#${m.row}`;
    rows.set(k, (rows.get(k) ?? 0) + 1);
  }
  const counts = [...rows.values()];
  const max = counts.length ? Math.max(...counts) : 0;
  return { rows_total: counts.length, rows_full: counts.filter((c) => c === max).length };
}

function makeCandidate(
  role: VariantRole,
  strategy: Strategy,
  a: Assembled,
  spec: LayoutModuleSpec,
  usableArea: number,
  targetPower: number | null,
  req: LayoutRequest,
): LayoutCandidate {
  const criteria = computeCriteria(a.modules, spec, usableArea, targetPower, a.priorityCount);
  const signature = placementSignature(a.modules);
  const orientation = uniqueOrientation(a.modules);
  const moduleArea = a.modules.reduce((sum, m) => {
    const s = moduleSize(spec, m.orientation);
    return sum + s.width * s.length;
  }, 0);
  const rows = rowStats(a.modules);

  const usedNames = a.planesUsed.map((p) => p.name);
  const skippedNames = a.planesSkipped.map((p) => p.name);
  const targetMet = targetPower === null ? null : criteria.power_kwc + 1e-6 >= targetPower;
  const delta = targetPower === null ? null : Math.round((criteria.power_kwc - targetPower) * 100) / 100;

  // Contraintes réellement appliquées : issues des zones utiles et des
  // emplacements refusés, jamais d'une cause supposée.
  const constraints: string[] = [];
  for (const g of a.chosen) {
    for (const o of g.by_obstacle_list()) constraints.push(o);
  }
  const areaNotes = new Set<string>();
  for (const p of a.planesUsed) void p;
  for (const g of a.chosen) void g;

  const summary = buildSummary({
    role,
    count: criteria.module_count,
    power: criteria.power_kwc,
    orientation,
    usedNames,
    skippedNames,
    targetPower,
    targetMet,
    rows,
  });

  return {
    id: `${role}-${criteria.module_count}-${signature.length}`,
    label: ROLE_LABEL[role],
    role,
    strategy,
    orientation,
    modules: a.modules,
    power_kwc: criteria.power_kwc,
    module_area_m2: Math.round(moduleArea * 100) / 100,
    planes_used: a.planesUsed.map((p) => p.key),
    plane_names: usedNames,
    planes_unused: skippedNames,
    target_met: targetMet,
    target_delta_kwc: delta,
    rows_total: rows.rows_total,
    rows_full: rows.rows_full,
    criteria,
    score: scoreCandidate(criteria, strategy),
    summary,
    reasons: explain(criteria, targetPower, a.planesUsed.length),
    constraints: [...new Set([...constraints, ...areaNotes])],
    signature,
    engine_version: LAYOUT_ENGINE_VERSION,
  };
  void req;
}

function buildSummary(i: {
  role: VariantRole;
  count: number;
  power: number;
  orientation: Orientation | "mixte";
  usedNames: string[];
  skippedNames: string[];
  targetPower: number | null;
  targetMet: boolean | null;
  rows: { rows_total: number; rows_full: number };
}): string {
  const pan = i.usedNames.length ? ` sur ${frenchList(i.usedNames)}` : "";
  const head = `${i.count} panneau${i.count > 1 ? "x" : ""} en ${orientationWord(i.orientation)}${pan}`;

  if (i.targetPower !== null && i.targetMet) {
    const spare = i.skippedNames.length ? ` sans utiliser ${frenchList(i.skippedNames)}` : "";
    return `${head} : objectif ${format2(i.targetPower)} kWc atteint${spare}.`;
  }
  if (i.targetPower !== null) {
    return `${head} : ${format2(i.power)} kWc, soit ${format2(i.targetPower - i.power)} kWc sous l'objectif de ${format2(i.targetPower)} kWc.`;
  }
  if (i.role === "maximum") return `Maximum réel : ${head}, ${format2(i.power)} kWc.`;
  if (i.role === "esthetique") {
    return `${head} : ${i.rows.rows_full}/${i.rows.rows_total} rangée${i.rows.rows_total > 1 ? "s" : ""} complète${i.rows.rows_total > 1 ? "s" : ""}.`;
  }
  return `${head} : ${format2(i.power)} kWc.`;
}

function format2(v: number): string {
  return v.toFixed(2).replace(".", ",");
}
