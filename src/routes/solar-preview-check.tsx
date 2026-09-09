/** Route temporaire de vérification visuelle de la scène 3D. Supprimée après contrôle. */
import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { buildRoofPlanes } from "@/lib/solar/roof";
import { DEFAULT_BUILDING_PARAMS } from "@/lib/solar/types";
import type { SolarSceneModel } from "@/components/solar/scene-model";
import { buildSceneModel } from "@/components/solar/scene-model";
import { gridLayout } from "@/lib/solar/layout";

const SolarScene = lazy(() => import("@/components/solar/SolarScene"));

export const Route = createFileRoute("/solar-preview-check")({ ssr: false, component: Page });

function Page() {
  const params = { ...DEFAULT_BUILDING_PARAMS };
  const geo = buildRoofPlanes(params);
  const spec = { id: "m1", width_mm: 1134, height_mm: 1762 };
  const planes = geo.map((g, i) => ({ id: `plane-${i}`, ...g }));
  const modules = planes.flatMap((p) =>
    gridLayout(p, spec, [], {
      setback_m: 0.4,
      row_gap_m: 0.02,
      col_gap_m: 0.02,
      orientation: "portrait" as const,
      forbidden: [],
    }).map((m, i) => ({ id: `${p.id}-${i}`, ...m })),
  );
  const model: SolarSceneModel = buildSceneModel({
    params,
    planes,
    modules,
    obstacles: [
      {
        id: "o1",
        roof_plane_id: planes[0]!.id,
        obstacle_type: "cheminee",
        position_x_m: 5,
        position_y_m: 2,
        base_z_m: 0,
        width_m: 0.8,
        length_m: 0.8,
        height_m: 1.2,
      },
    ],
    arrays: planes.map((p) => ({ roof_plane_id: p.id, module_catalog_id: "m1" })),
    catalog: [spec],
  });
  return (
    <div className="fixed inset-0">
      <Suspense fallback={null}>
        <SolarScene model={model} selectedPlaneKey="p1" onSelectPlane={() => {}} onToggleModule={() => {}} />
      </Suspense>
    </div>
  );
}
