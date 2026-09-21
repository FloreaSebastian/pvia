/**
 * Smart PV Layout Engine — édition manuelle (P0-D).
 *
 * Module PUR et déterministe : aucune dépendance React, DOM ou serveur.
 * Toute action d'édition (déplacement, rotation, ajout, duplication,
 * suppression, alignement, distribution) passe par ce module, qui valide
 * avec EXACTEMENT les règles de P0-C via `validateModuleAgainst`.
 *
 * Invariant : une action n'est acceptée que si TOUS les modules concernés
 * restent valides. Sinon l'état précédent est conservé tel quel.
 */
import { moduleSize } from "./generate";
import { rectsOverlap, round3, type Rect } from "./geometry";
import { buildUsableArea, type UsableArea } from "./usable-area";
import { moduleRect, validateModuleAgainst } from "./validate";
import type {
  LayoutModule,
  LayoutModuleSpec,
  LayoutPlane,
  ModuleValidity,
  Orientation,
  RulesProfile,
  ValidityCause,
} from "./types";

/** Nombre minimal d'actions conservées dans l'historique local. */
export const MANUAL_HISTORY_LIMIT = 50;

/** Tolérance d'accrochage, en mètres. */
export const SNAP_TOLERANCE_M = 0.12;

/** Pas du clavier : flèche = 1 cm, Maj+flèche = 10 cm. */
export const NUDGE_FINE_M = 0.01;
export const NUDGE_COARSE_M = 0.1;

export const SHORT_CAUSE: Record<ValidityCause, string> = {
  hors_toiture: "Hors toiture",
  recul_insuffisant: "Marge de rive",
  collision_obstacle: "Obstacle",
  zone_interdite: "Zone interdite",
  passage_technique: "Passage technique",
  collision_module: "Collision panneau",
};

/** Cause courte affichée pendant le glisser : jamais un message technique. */
export function shortCause(v: ModuleValidity | null | undefined): string {
  if (!v || v.status === "valid" || !v.cause) return "Position valide";
  if (v.cause === "collision_obstacle" && v.blocker_label) return v.blocker_label;
  if (v.cause === "zone_interdite" && v.blocker_label) return v.blocker_label;
  return SHORT_CAUSE[v.cause];
}

/* ------------------------------- Contexte -------------------------------- */

export interface ManualContext {
  planes: LayoutPlane[];
  spec: LayoutModuleSpec;
  rules: RulesProfile;
  areaByPlane: Map<string, UsableArea>;
  planeByKey: Map<string, LayoutPlane>;
}

/**
 * Prépare une fois les zones utiles (offsets polygonaux coûteux) pour que le
 * glisser puisse revalider à chaque image sans recalculer la toiture.
 */
export function createManualContext(
  planes: LayoutPlane[],
  spec: LayoutModuleSpec,
  rules: RulesProfile,
): ManualContext {
  const areaByPlane = new Map<string, UsableArea>();
  const planeByKey = new Map<string, LayoutPlane>();
  for (const p of planes) {
    areaByPlane.set(p.key, buildUsableArea(p, rules));
    planeByKey.set(p.key, p);
  }
  return { planes, spec, rules, areaByPlane, planeByKey };
}

function outOfRoof(id: string): ModuleValidity {
  return {
    module_id: id,
    status: "invalid",
    cause: "hors_toiture",
    measured_m: null,
    required_m: null,
    blocker_label: null,
    message: SHORT_CAUSE.hors_toiture,
  };
}

/** Valide les modules demandés (tous par défaut) contre l'état complet. */
export function validateManual(
  ctx: ManualContext,
  modules: LayoutModule[],
  ids?: readonly string[],
): ModuleValidity[] {
  const wanted = ids ? new Set(ids) : null;
  const byPlane = new Map<string, LayoutModule[]>();
  for (const m of modules) {
    const list = byPlane.get(m.plane_key);
    if (list) list.push(m);
    else byPlane.set(m.plane_key, [m]);
  }
  const out: ModuleValidity[] = [];
  for (const m of modules) {
    if (wanted && !wanted.has(m.id)) continue;
    const plane = ctx.planeByKey.get(m.plane_key);
    const area = ctx.areaByPlane.get(m.plane_key);
    if (!plane || !area) {
      out.push(outOfRoof(m.id));
      continue;
    }
    out.push(
      validateModuleAgainst(plane, area, m, byPlane.get(m.plane_key) ?? [], ctx.spec, ctx.rules),
    );
  }
  return out;
}

/** Tous les modules du brouillon sont-ils valides et sans collision ? */
export function allValid(ctx: ManualContext, modules: LayoutModule[]): boolean {
  return validateManual(ctx, modules).every((v) => v.status === "valid");
}

/* -------------------------------- Actions -------------------------------- */

export type ManualFailureCause = ValidityCause | "aucune_place" | "selection_vide" | "inconnu";

export type ManualResult =
  | { ok: true; modules: LayoutModule[]; selection: string[] }
  | { ok: false; cause: ManualFailureCause; message: string; module_ids: string[] };

function failFromValidity(v: ModuleValidity[]): ManualResult | null {
  const bad = v.find((x) => x.status !== "valid");
  if (!bad) return null;
  return {
    ok: false,
    cause: bad.cause ?? "inconnu",
    message: shortCause(bad),
    module_ids: v.filter((x) => x.status !== "valid").map((x) => x.module_id),
  };
}

const EMPTY_SELECTION: ManualResult = {
  ok: false,
  cause: "selection_vide",
  message: "Aucun panneau sélectionné",
  module_ids: [],
};

/** Commit d'un état candidat : accepté seulement si les modules visés sont valides. */
function commit(ctx: ManualContext, next: LayoutModule[], touched: string[]): ManualResult {
  const fail = failFromValidity(validateManual(ctx, next, touched));
  if (fail) return fail;
  return { ok: true, modules: next, selection: touched };
}

/** Déplacement (souris ou clavier) d'un ou plusieurs panneaux. */
export function moveSelection(
  ctx: ManualContext,
  modules: LayoutModule[],
  ids: readonly string[],
  du: number,
  dv: number,
): ManualResult {
  if (ids.length === 0) return EMPTY_SELECTION;
  const set = new Set(ids);
  const next = modules.map((m) =>
    set.has(m.id) ? { ...m, u: round3(m.u + du), v: round3(m.v + dv) } : m,
  );
  return commit(ctx, next, [...ids].sort());
}

/** Rotation portrait ↔ paysage, centre conservé, modèle inchangé. */
export function rotateSelection(
  ctx: ManualContext,
  modules: LayoutModule[],
  ids: readonly string[],
): ManualResult {
  if (ids.length === 0) return EMPTY_SELECTION;
  const set = new Set(ids);
  const next = modules.map((m) =>
    set.has(m.id)
      ? { ...m, orientation: (m.orientation === "portrait" ? "paysage" : "portrait") as Orientation }
      : m,
  );
  return commit(ctx, next, [...ids].sort());
}

/** Suppression : toujours acceptée, l'historique permet de revenir. */
export function deleteSelection(
  modules: LayoutModule[],
  ids: readonly string[],
): ManualResult {
  if (ids.length === 0) return EMPTY_SELECTION;
  const set = new Set(ids);
  return { ok: true, modules: modules.filter((m) => !set.has(m.id)), selection: [] };
}

/** Identifiant local déterministe, distinct de tous les identifiants présents. */
export function nextManualId(modules: LayoutModule[], prefix = "manuel"): string {
  let n = 1;
  const used = new Set(modules.map((m) => m.id));
  while (used.has(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

/** Ajout d'un panneau du modèle courant à la position pointée. */
export function addModule(
  ctx: ManualContext,
  modules: LayoutModule[],
  at: { plane_key: string; u: number; v: number; orientation: Orientation },
): ManualResult {
  const id = nextManualId(modules);
  const created: LayoutModule = {
    id,
    plane_key: at.plane_key,
    u: round3(at.u),
    v: round3(at.v),
    orientation: at.orientation,
    row: 0,
    col: 0,
    matrix: 0,
  };
  return commit(ctx, [...modules, created], [id]);
}

/**
 * Duplication : essaie droite, gauche, haut, bas dans cet ordre déterministe,
 * en respectant les écartements du profil de règles.
 */
export function duplicateSelection(
  ctx: ManualContext,
  modules: LayoutModule[],
  ids: readonly string[],
): ManualResult {
  if (ids.length === 0) return EMPTY_SELECTION;
  const set = new Set(ids);
  const selected = modules.filter((m) => set.has(m.id));
  if (selected.length === 0) return EMPTY_SELECTION;

  const box = selectionBox(selected, ctx.spec);
  const stepU = box.width + Math.max(0, ctx.rules.col_gap_m);
  const stepV = box.length + Math.max(0, ctx.rules.row_gap_m);
  const offsets: { du: number; dv: number }[] = [
    { du: stepU, dv: 0 },
    { du: -stepU, dv: 0 },
    { du: 0, dv: stepV },
    { du: 0, dv: -stepV },
  ];

  for (const off of offsets) {
    const copies: LayoutModule[] = [];
    let pool = modules;
    for (const m of selected) {
      const id = nextManualId([...pool, ...copies], "copie");
      copies.push({
        ...m,
        id,
        u: round3(m.u + off.du),
        v: round3(m.v + off.dv),
      });
      pool = modules;
    }
    const next = [...modules, ...copies];
    const created = copies.map((c) => c.id);
    if (!failFromValidity(validateManual(ctx, next, created))) {
      return { ok: true, modules: next, selection: created };
    }
  }
  return {
    ok: false,
    cause: "aucune_place",
    message: "Aucune place libre à côté : placez la copie manuellement.",
    module_ids: [...ids],
  };
}

/* ---------------------------- Aligner / répartir --------------------------- */

export type AlignMode = "gauche" | "droite" | "haut" | "bas" | "centre_u" | "centre_v";

export function alignSelection(
  ctx: ManualContext,
  modules: LayoutModule[],
  ids: readonly string[],
  mode: AlignMode,
): ManualResult {
  if (ids.length < 2) {
    return { ok: false, cause: "selection_vide", message: "Sélectionnez au moins 2 panneaux", module_ids: [...ids] };
  }
  const set = new Set(ids);
  const selected = modules.filter((m) => set.has(m.id));
  const box = selectionBox(selected, ctx.spec);
  const meanU = selected.reduce((s, m) => s + m.u, 0) / selected.length;
  const meanV = selected.reduce((s, m) => s + m.v, 0) / selected.length;

  const next = modules.map((m) => {
    if (!set.has(m.id)) return m;
    const s = moduleSize(ctx.spec, m.orientation);
    switch (mode) {
      case "gauche":
        return { ...m, u: round3(box.minU + s.width / 2) };
      case "droite":
        return { ...m, u: round3(box.maxU - s.width / 2) };
      case "bas":
        return { ...m, v: round3(box.minV + s.length / 2) };
      case "haut":
        return { ...m, v: round3(box.maxV - s.length / 2) };
      case "centre_u":
        return { ...m, u: round3(meanU) };
      default:
        return { ...m, v: round3(meanV) };
    }
  });
  return commit(ctx, next, [...ids].sort());
}

export function distributeSelection(
  ctx: ManualContext,
  modules: LayoutModule[],
  ids: readonly string[],
  axis: "u" | "v",
): ManualResult {
  if (ids.length < 3) {
    return {
      ok: false,
      cause: "selection_vide",
      message: "Sélectionnez au moins 3 panneaux",
      module_ids: [...ids],
    };
  }
  const set = new Set(ids);
  const selected = modules
    .filter((m) => set.has(m.id))
    .sort((a, b) => (axis === "u" ? a.u - b.u || a.v - b.v : a.v - b.v || a.u - b.u));
  const first = selected[0]!;
  const last = selected[selected.length - 1]!;
  const from = axis === "u" ? first.u : first.v;
  const to = axis === "u" ? last.u : last.v;
  const step = (to - from) / (selected.length - 1);
  const target = new Map(selected.map((m, i) => [m.id, round3(from + step * i)]));

  const next = modules.map((m) => {
    const t = target.get(m.id);
    if (t === undefined) return m;
    return axis === "u" ? { ...m, u: t } : { ...m, v: t };
  });
  return commit(ctx, next, [...ids].sort());
}

/* --------------------------------- Snap ----------------------------------- */

export interface SnapGuide {
  axis: "u" | "v";
  value: number;
}

export interface SnapResult {
  du: number;
  dv: number;
  guides: SnapGuide[];
}

export interface SelectionBox {
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
  width: number;
  length: number;
  centerU: number;
  centerV: number;
}

export function selectionBox(selected: LayoutModule[], spec: LayoutModuleSpec): SelectionBox {
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const m of selected) {
    const s = moduleSize(spec, m.orientation);
    minU = Math.min(minU, m.u - s.width / 2);
    maxU = Math.max(maxU, m.u + s.width / 2);
    minV = Math.min(minV, m.v - s.length / 2);
    maxV = Math.max(maxV, m.v + s.length / 2);
  }
  return {
    minU,
    maxU,
    minV,
    maxV,
    width: maxU - minU,
    length: maxV - minV,
    centerU: (minU + maxU) / 2,
    centerV: (minV + maxV) / 2,
  };
}

/**
 * Accrochage visible : bords, centres et écartements du profil par rapport aux
 * panneaux voisins du même pan. Aucun déplacement automatique n'est appliqué
 * sans qu'une ligne-guide soit retournée.
 */
export function snapDelta(
  ctx: ManualContext,
  modules: LayoutModule[],
  ids: readonly string[],
  du: number,
  dv: number,
  opts: { enabled?: boolean; tolerance_m?: number } = {},
): SnapResult {
  if (opts.enabled === false || ids.length === 0) return { du, dv, guides: [] };
  const tol = opts.tolerance_m ?? SNAP_TOLERANCE_M;
  const set = new Set(ids);
  const selected = modules.filter((m) => set.has(m.id));
  if (selected.length === 0) return { du, dv, guides: [] };
  const planes = new Set(selected.map((m) => m.plane_key));
  const peers = modules.filter((m) => !set.has(m.id) && planes.has(m.plane_key));

  const box = selectionBox(selected, ctx.spec);
  const moved = {
    minU: box.minU + du,
    maxU: box.maxU + du,
    centerU: box.centerU + du,
    minV: box.minV + dv,
    maxV: box.maxV + dv,
    centerV: box.centerV + dv,
  };

  const best = (
    candidates: { from: number; to: number }[],
  ): { delta: number; value: number } | null => {
    let out: { delta: number; value: number } | null = null;
    for (const c of candidates) {
      const d = c.to - c.from;
      if (Math.abs(d) > tol) continue;
      if (!out || Math.abs(d) < Math.abs(out.delta)) out = { delta: d, value: c.to };
    }
    return out;
  };

  const candU: { from: number; to: number }[] = [];
  const candV: { from: number; to: number }[] = [];
  const gapU = Math.max(0, ctx.rules.col_gap_m);
  const gapV = Math.max(0, ctx.rules.row_gap_m);
  for (const p of peers) {
    const s = moduleSize(ctx.spec, p.orientation);
    const left = p.u - s.width / 2;
    const right = p.u + s.width / 2;
    const bottom = p.v - s.length / 2;
    const top = p.v + s.length / 2;
    // Alignement de bords et de centres.
    for (const t of [left, p.u, right]) {
      candU.push({ from: moved.minU, to: t }, { from: moved.maxU, to: t }, { from: moved.centerU, to: t });
    }
    for (const t of [bottom, p.v, top]) {
      candV.push({ from: moved.minV, to: t }, { from: moved.maxV, to: t }, { from: moved.centerV, to: t });
    }
    // Écartement du profil de règles, côté opposé uniquement.
    candU.push({ from: moved.minU, to: right + gapU }, { from: moved.maxU, to: left - gapU });
    candV.push({ from: moved.minV, to: top + gapV }, { from: moved.maxV, to: bottom - gapV });
  }

  const su = best(candU);
  const sv = best(candV);
  const guides: SnapGuide[] = [];
  if (su) guides.push({ axis: "u", value: round3(su.value) });
  if (sv) guides.push({ axis: "v", value: round3(sv.value) });

  return {
    du: round3(du + (su?.delta ?? 0)),
    dv: round3(dv + (sv?.delta ?? 0)),
    guides,
  };
}

/* ------------------------------- Sélection -------------------------------- */

/** Panneaux touchés par un rectangle de sélection (repère (u,v) du pan). */
export function modulesInRect(
  modules: LayoutModule[],
  spec: LayoutModuleSpec,
  rect: Rect,
  planeKey?: string,
): string[] {
  return modules
    .filter((m) => (planeKey ? m.plane_key === planeKey : true))
    .filter((m) => rectsOverlap(moduleRect(m, spec), rect))
    .map((m) => m.id)
    .sort();
}

/** Bascule d'un panneau dans la sélection (Maj+clic / Ctrl+clic). */
export function toggleSelection(selection: readonly string[], id: string): string[] {
  return selection.includes(id)
    ? selection.filter((s) => s !== id)
    : [...selection, id];
}

/* ------------------------------- Historique -------------------------------- */

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  limit: number;
}

export function createHistory<T>(present: T, limit = MANUAL_HISTORY_LIMIT): History<T> {
  return { past: [], present, future: [], limit };
}

export function pushHistory<T>(h: History<T>, next: T): History<T> {
  const past = [...h.past, h.present];
  // On conserve AU MOINS `limit` actions annulables.
  while (past.length > h.limit) past.shift();
  return { ...h, past, present: next, future: [] };
}

export function canUndo<T>(h: History<T>): boolean {
  return h.past.length > 0;
}

export function canRedo<T>(h: History<T>): boolean {
  return h.future.length > 0;
}

export function undoHistory<T>(h: History<T>): History<T> {
  if (!canUndo(h)) return h;
  const past = [...h.past];
  const present = past.pop()!;
  return { ...h, past, present, future: [h.present, ...h.future] };
}

export function redoHistory<T>(h: History<T>): History<T> {
  if (!canRedo(h)) return h;
  const [present, ...future] = h.future;
  return { ...h, past: [...h.past, h.present], present: present as T, future };
}

/* --------------------------------- Divers ---------------------------------- */

export function manualPowerKwc(modules: LayoutModule[], spec: LayoutModuleSpec): number {
  return Math.round(((modules.length * spec.power_wc) / 1000) * 100) / 100;
}

/** Deux brouillons décrivent-ils exactement la même implantation ? */
export function sameLayout(a: LayoutModule[], b: LayoutModule[]): boolean {
  if (a.length !== b.length) return false;
  const key = (m: LayoutModule) =>
    `${m.plane_key}|${m.u.toFixed(3)}|${m.v.toFixed(3)}|${m.orientation}`;
  const sa = a.map(key).sort().join("#");
  const sb = b.map(key).sort().join("#");
  return sa === sb;
}
