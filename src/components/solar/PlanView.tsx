/**
 * Solar Studio — plan 2D du pan sélectionné (SVG, sans WebGL).
 * Sert de vue de contrôle : contour du pan, obstacles, panneaux posés.
 */
import { useMemo } from "react";
import type { ScenePlane, SceneObstacle } from "./scene-model";
import type { PlacedModule } from "@/lib/solar/types";

export function PlanView({
  plane,
  modules,
  obstacles,
  spec,
  onToggleModule,
}: {
  plane: ScenePlane | null;
  modules: PlacedModule[];
  obstacles: SceneObstacle[];
  spec: { width_mm: number; height_mm: number } | undefined;
  onToggleModule: (id: string) => void;
}) {
  const view = useMemo(() => {
    if (!plane || plane.polygon.length < 3) return null;
    const xs = plane.polygon.map((p) => p.x);
    const ys = plane.polygon.map((p) => p.y);
    const pad = 0.8;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    const w = Math.max(...xs) - minX + pad;
    const h = Math.max(...ys) - minY + pad;
    return { minX, minY, w, h };
  }, [plane]);

  if (!plane || !view) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        Sélectionnez un pan de toiture pour afficher son plan.
      </p>
    );
  }

  const planeModules = modules.filter((m) => m.roof_plane_key === plane.key);

  return (
    <svg
      viewBox={`${view.minX} ${view.minY} ${view.w} ${view.h}`}
      className="h-full w-full"
      role="img"
      aria-label={`Plan du pan ${plane.name}`}
      style={{ transform: "scaleY(-1)" }}
    >
      <polygon
        points={plane.polygon.map((p) => `${p.x},${p.y}`).join(" ")}
        className="fill-muted stroke-foreground/60"
        strokeWidth={0.06}
      />
      {obstacles
        .filter((o) => o.planeKey === plane.key)
        .map((o) => (
          <rect
            key={o.id}
            x={o.u - o.width / 2}
            y={o.v - o.length / 2}
            width={o.width}
            height={o.length}
            fill={o.color}
            opacity={0.85}
          />
        ))}
      {spec &&
        planeModules.map((m) => {
          const w = (m.orientation === "portrait" ? spec.width_mm : spec.height_mm) / 1000;
          const h = (m.orientation === "portrait" ? spec.height_mm : spec.width_mm) / 1000;
          return (
            <rect
              key={m.id}
              x={m.local_u_m - w / 2}
              y={m.local_v_m - h / 2}
              width={w * 0.96}
              height={h * 0.96}
              fill={m.enabled ? "#12203a" : "#94a3b8"}
              stroke="#0ea5e9"
              strokeWidth={0.02}
              className="cursor-pointer"
              onClick={() => onToggleModule(m.id)}
            />
          );
        })}
    </svg>
  );
}
