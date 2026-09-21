/**
 * Solar Studio — canevas 2D d'édition manuelle (P0-D).
 *
 * Interactions directes sur le plan : sélection, rectangle de sélection,
 * glisser-déposer avec aperçu fantôme, accrochage visible, ajout fantôme.
 * Toute la validation passe par le moteur pur (`@/lib/solar-layout/manual`) :
 * ce composant n'implémente AUCUNE règle géométrique de son côté.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { bbox } from "@/lib/solar-layout/geometry";
import { moduleSize } from "@/lib/solar-layout/generate";
import {
  modulesInRect,
  moveSelection,
  shortCause,
  snapDelta,
  toggleSelection,
  validateManual,
  type ManualContext,
  type ManualResult,
  type SnapGuide,
} from "@/lib/solar-layout/manual";
import type { LayoutModule, ModuleValidity, Orientation } from "@/lib/solar-layout/types";

type Pointer = { u: number; v: number };

export interface ManualPlanCanvasProps {
  ctx: ManualContext;
  planeKey: string;
  modules: LayoutModule[];
  selection: string[];
  onSelectionChange: (ids: string[]) => void;
  /** Résultat d'une action de déplacement : accepté ou refusé. */
  onCommit: (result: ManualResult) => void;
  /** Clic de pose en mode Ajouter, en coordonnées (u,v) du pan. */
  onAddAt: (point: { u: number; v: number }) => void;
  tool: "select" | "add";
  addOrientation: Orientation;
  /** Édition désactivée (mobile, lecture seule) : sélection toujours possible. */
  editDisabled?: boolean;
}

export function ManualPlanCanvas({
  ctx,
  planeKey,
  modules,
  selection,
  onSelectionChange,
  onCommit,
  onAddAt,
  tool,
  addOrientation,
  editDisabled = false,
}: ManualPlanCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const plane = ctx.planeByKey.get(planeKey) ?? null;
  const area = ctx.areaByPlane.get(planeKey) ?? null;

  const [drag, setDrag] = useState<{
    from: Pointer;
    du: number;
    dv: number;
    valid: boolean;
    cause: string;
    guides: SnapGuide[];
    snap: boolean;
  } | null>(null);
  const [marquee, setMarquee] = useState<{ from: Pointer; to: Pointer } | null>(null);
  const [ghost, setGhost] = useState<Pointer | null>(null);

  const view = useMemo(() => {
    if (!plane || plane.polygon.length < 3) return null;
    const box = bbox(plane.polygon);
    const pad = 0.8;
    return {
      minX: box.minX - pad,
      maxY: box.maxY + pad,
      w: box.maxX - box.minX + pad * 2,
      h: box.maxY - box.minY + pad * 2,
    };
  }, [plane]);

  const validity = useMemo(() => {
    const map = new Map<string, ModuleValidity>();
    for (const v of validateManual(ctx, modules)) map.set(v.module_id, v);
    return map;
  }, [ctx, modules]);

  const toModel = useCallback(
    (e: { clientX: number; clientY: number }): Pointer | null => {
      const svg = svgRef.current;
      if (!svg || !view) return null;
      const r = svg.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      return {
        u: view.minX + ((e.clientX - r.left) / r.width) * view.w,
        v: view.maxY - ((e.clientY - r.top) / r.height) * view.h,
      };
    },
    [view],
  );

  if (!plane || !view || !area) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        Sélectionnez un pan de toiture pour modifier son implantation.
      </p>
    );
  }

  const planeModules = modules.filter((m) => m.plane_key === planeKey);
  const selected = new Set(selection);

  /* ------------------------------ Interactions ---------------------------- */

  const startDrag = (e: React.PointerEvent, id: string) => {
    if (e.button !== undefined && e.button > 0) return;
    const point = toModel(e);
    if (!point) return;
    let next = selection;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      next = toggleSelection(selection, id);
      onSelectionChange(next);
      return;
    }
    if (!selected.has(id)) {
      next = [id];
      onSelectionChange(next);
    }
    if (editDisabled) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ from: point, du: 0, dv: 0, valid: true, cause: "", guides: [], snap: !e.altKey });
    e.stopPropagation();
  };

  const moveDrag = (e: React.PointerEvent) => {
    if (!drag) return;
    const point = toModel(e);
    if (!point) return;
    const ids = selection;
    const snapped = snapDelta(ctx, modules, ids, point.u - drag.from.u, point.v - drag.from.v, {
      enabled: drag.snap && !e.altKey,
    });
    const set = new Set(ids);
    const candidate = modules.map((m) =>
      set.has(m.id) ? { ...m, u: m.u + snapped.du, v: m.v + snapped.dv } : m,
    );
    const checks = validateManual(ctx, candidate, ids);
    const bad = checks.find((c) => c.status !== "valid");
    setDrag({
      ...drag,
      du: snapped.du,
      dv: snapped.dv,
      guides: snapped.guides,
      valid: !bad,
      cause: bad ? shortCause(bad) : "",
    });
  };

  const endDrag = () => {
    if (!drag) return;
    const { du, dv, valid } = drag;
    setDrag(null);
    if (!valid) {
      onCommit({
        ok: false,
        cause: "inconnu",
        message: "Position interdite : le panneau revient à sa place.",
        module_ids: selection,
      });
      return;
    }
    if (Math.abs(du) < 1e-6 && Math.abs(dv) < 1e-6) return;
    onCommit(moveSelection(ctx, modules, selection, du, dv));
  };

  const onBackgroundDown = (e: React.PointerEvent) => {
    const point = toModel(e);
    if (!point) return;
    if (tool === "add") return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setMarquee({ from: point, to: point });
  };

  const onBackgroundMove = (e: React.PointerEvent) => {
    if (tool === "add" && !editDisabled) {
      setGhost(toModel(e));
      return;
    }
    if (!marquee) return;
    const point = toModel(e);
    if (point) setMarquee({ ...marquee, to: point });
  };

  const onBackgroundUp = (e: React.PointerEvent) => {
    if (tool === "add" && !editDisabled) {
      const point = toModel(e);
      if (point) onAddAt(point);
      return;
    }
    if (!marquee) {
      onSelectionChange([]);
      return;
    }
    const rect = {
      u: (marquee.from.u + marquee.to.u) / 2,
      v: (marquee.from.v + marquee.to.v) / 2,
      width: Math.abs(marquee.to.u - marquee.from.u),
      length: Math.abs(marquee.to.v - marquee.from.v),
    };
    setMarquee(null);
    if (rect.width < 0.05 && rect.length < 0.05) {
      onSelectionChange([]);
      return;
    }
    onSelectionChange(modulesInRect(modules, ctx.spec, rect, planeKey));
  };

  /* -------------------------------- Rendu --------------------------------- */

  const ghostSize = moduleSize(ctx.spec, addOrientation);

  return (
    <svg
      ref={svgRef}
      viewBox={`${view.minX} ${-view.maxY} ${view.w} ${view.h}`}
      className="h-full w-full touch-none select-none"
      role="application"
      aria-label={`Édition du plan ${plane.name}`}
      onPointerDown={onBackgroundDown}
      onPointerMove={(e) => (drag ? moveDrag(e) : onBackgroundMove(e))}
      onPointerUp={(e) => (drag ? endDrag() : onBackgroundUp(e))}
      onPointerCancel={() => {
        setDrag(null);
        setMarquee(null);
      }}
    >
      <g transform="scale(1,-1)">
        <polygon
          points={plane.polygon.map((p) => `${p.x},${p.y}`).join(" ")}
          className="fill-muted stroke-foreground/60"
          strokeWidth={0.06}
        />
        {area.boundary.length >= 3 && (
          <polygon
            points={area.boundary.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="#0ea5e9"
            strokeWidth={0.03}
            strokeDasharray="0.2 0.15"
            pointerEvents="none"
          />
        )}
        {area.blockedRects.map((b) => (
          <rect
            key={b.id}
            x={b.u - b.width / 2}
            y={b.v - b.length / 2}
            width={b.width}
            height={b.length}
            fill="#dc2626"
            opacity={0.18}
            pointerEvents="none"
          />
        ))}
        {area.blockedZones.map((z) => (
          <polygon
            key={z.id}
            points={z.polygon.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="#f59e0b"
            opacity={0.2}
            pointerEvents="none"
          />
        ))}

        {planeModules.map((m) => {
          const s = moduleSize(ctx.spec, m.orientation);
          const isSel = selected.has(m.id);
          const v = validity.get(m.id);
          const invalid = v && v.status !== "valid";
          return (
            <g key={m.id}>
              <rect
                x={m.u - s.width / 2}
                y={m.v - s.length / 2}
                width={s.width * 0.97}
                height={s.length * 0.97}
                fill={invalid ? "#fecaca" : isSel ? "#1d4ed8" : "#12203a"}
                stroke={invalid ? "#dc2626" : isSel ? "#f8fafc" : "#0ea5e9"}
                strokeWidth={isSel ? 0.07 : 0.02}
                className="cursor-move"
                onPointerDown={(e) => startDrag(e, m.id)}
              />
              {isSel && (
                <rect
                  x={m.u - s.width / 2 - 0.05}
                  y={m.v - s.length / 2 - 0.05}
                  width={s.width + 0.1}
                  height={s.length + 0.1}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth={0.05}
                  pointerEvents="none"
                />
              )}
            </g>
          );
        })}

        {/* Aperçu fantôme du déplacement */}
        {drag &&
          planeModules
            .filter((m) => selected.has(m.id))
            .map((m) => {
              const s = moduleSize(ctx.spec, m.orientation);
              return (
                <rect
                  key={`ghost-${m.id}`}
                  x={m.u + drag.du - s.width / 2}
                  y={m.v + drag.dv - s.length / 2}
                  width={s.width}
                  height={s.length}
                  fill={drag.valid ? "#22c55e" : "#ef4444"}
                  opacity={0.35}
                  stroke={drag.valid ? "#16a34a" : "#dc2626"}
                  strokeWidth={0.06}
                  pointerEvents="none"
                />
              );
            })}

        {/* Lignes-guides d'accrochage */}
        {drag?.guides.map((g) => (
          <line
            key={`${g.axis}-${g.value}`}
            x1={g.axis === "u" ? g.value : view.minX}
            x2={g.axis === "u" ? g.value : view.minX + view.w}
            y1={g.axis === "u" ? view.maxY - view.h : g.value}
            y2={g.axis === "u" ? view.maxY : g.value}
            stroke="#f59e0b"
            strokeWidth={0.03}
            strokeDasharray="0.15 0.1"
            pointerEvents="none"
          />
        ))}

        {marquee && (
          <rect
            x={Math.min(marquee.from.u, marquee.to.u)}
            y={Math.min(marquee.from.v, marquee.to.v)}
            width={Math.abs(marquee.to.u - marquee.from.u)}
            height={Math.abs(marquee.to.v - marquee.from.v)}
            fill="#0ea5e9"
            opacity={0.15}
            stroke="#0ea5e9"
            strokeWidth={0.03}
            pointerEvents="none"
          />
        )}

        {tool === "add" && ghost && !editDisabled && (
          <rect
            x={ghost.u - ghostSize.width / 2}
            y={ghost.v - ghostSize.length / 2}
            width={ghostSize.width}
            height={ghostSize.length}
            fill="#22c55e"
            opacity={0.3}
            stroke="#16a34a"
            strokeWidth={0.06}
            pointerEvents="none"
          />
        )}
      </g>

      {drag && (
        <text
          x={view.minX + 0.2}
          y={-view.maxY + 0.7}
          fontSize={0.45}
          fill={drag.valid ? "#16a34a" : "#dc2626"}
        >
          {drag.valid ? "✓ Position valide" : `✕ ${drag.cause}`}
        </text>
      )}
    </svg>
  );
}
