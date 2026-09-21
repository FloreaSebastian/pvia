/**
 * Solar Studio — règles pures d'interaction du canevas d'édition manuelle (P0-D.2).
 *
 * Ce module ne contient AUCUNE règle géométrique : il réutilise le moteur pur
 * (`validateManual`, `snapDelta`) pour le fantôme d'ajout et expose les règles
 * d'événements pointeur afin qu'elles soient testables sans DOM.
 */
import {
  shortCause,
  snapDelta,
  validateManual,
  type ManualContext,
  type SnapGuide,
} from "./manual";
import type { LayoutModule, Orientation } from "./types";

/** Identifiant réservé au module fantôme (jamais persisté). */
export const GHOST_ID = "__ghost__";

type ClosestLike = { closest?: (selector: string) => unknown } | null | undefined;

/** Vrai si l'événement pointeur provient d'un panneau (`data-module-id`). */
export function isModuleEventTarget(target: ClosestLike): boolean {
  if (!target || typeof target.closest !== "function") return false;
  return Boolean(target.closest("[data-module-id]"));
}

/**
 * Règle de désélection sur pointerup : seul un vrai clic dans le fond,
 * sans rectangle en cours et sans glisser, vide la sélection.
 */
export function shouldDeselectOnBackgroundUp(opts: {
  fromModule: boolean;
  hasMarquee: boolean;
  dragging: boolean;
}): boolean {
  return !opts.fromModule && !opts.hasMarquee && !opts.dragging;
}

export interface AddGhost {
  at: { u: number; v: number };
  valid: boolean;
  cause: string;
  guides: SnapGuide[];
  snapped: boolean;
}

/**
 * Fantôme d'ajout : accrochage réel (bords, centres, espacement) puis
 * validation du point ACCROCHÉ par le même moteur que le serveur.
 * `snap:false` (Alt) garde le point brut mais conserve la validation.
 */
export function computeAddGhost(
  ctx: ManualContext,
  modules: LayoutModule[],
  planeKey: string,
  at: { u: number; v: number },
  orientation: Orientation,
  opts: { snap?: boolean } = {},
): AddGhost {
  const snapEnabled = opts.snap !== false;
  const probe: LayoutModule = {
    id: GHOST_ID,
    plane_key: planeKey,
    u: at.u,
    v: at.v,
    orientation,
    row: 0,
    col: 0,
    matrix: 0,
  };
  const withGhost = [...modules, probe];
  const snap = snapDelta(ctx, withGhost, [GHOST_ID], 0, 0, { enabled: snapEnabled });
  const point = { u: at.u + snap.du, v: at.v + snap.dv };
  const final = withGhost.map((m) => (m.id === GHOST_ID ? { ...m, u: point.u, v: point.v } : m));
  const checks = validateManual(ctx, final, [GHOST_ID]);
  const bad = checks.find((c) => c.status !== "valid");
  return {
    at: point,
    valid: !bad,
    cause: bad ? shortCause(bad) : "",
    guides: snapEnabled ? snap.guides : [],
    snapped: snapEnabled && (Math.abs(snap.du) > 1e-9 || Math.abs(snap.dv) > 1e-9),
  };
}
