/**
 * Solar Studio — adaptation des données serveur vers la scène.
 *
 * Module SANS import WebGL : il peut être importé par la route (SSR possible)
 * alors que SolarScene.tsx, lui, reste chargé uniquement côté navigateur.
 */
import { footprintPolygon } from "@/lib/solar/roof";
import { type BuildingParams, type PlaneFrame, type PlacedModule } from "@/lib/solar/types";
import type { LocalPoint } from "@/lib/solar/geo";

export interface ScenePlane {
  id: string;
  key: string;
  name: string;
  azimuth_deg: number;
  tilt_deg: number;
  area_m2: number;
  polygon: LocalPoint[];
  frame: PlaneFrame;
}

export interface SceneObstacle {
  id: string;
  planeKey: string | null;
  u: number;
  v: number;
  baseZ: number;
  width: number;
  length: number;
  height: number;
  color: string;
}

export interface SolarSceneModel {
  planes: ScenePlane[];
  modules: PlacedModule[];
  obstacles: SceneObstacle[];
  specByPlaneKey: Record<
    string,
    { width_mm: number; height_mm: number; depth_mm: number | null } | undefined
  >;
  footprint: LocalPoint[];
  wallHeight: number;
  extent: number;
}

const OBSTACLE_COLORS: Record<string, string> = {
  cheminee: "#9a3412",
  velux: "#0ea5e9",
  chien_assis: "#b45309",
  antenne: "#64748b",
  climatisation: "#475569",
  ventilation: "#94a3b8",
  arbre: "#15803d",
  batiment_voisin: "#57534e",
  mur: "#78716c",
  poteau: "#525252",
  autre: "#7c3aed",
};

type PayloadLike = {
  params: BuildingParams;
  planes: ScenePlane[];
  modules: PlacedModule[];
  obstacles: {
    id: string;
    roof_plane_id: string | null;
    obstacle_type: string;
    position_x_m: number;
    position_y_m: number;
    base_z_m: number;
    width_m: number;
    length_m: number;
    height_m: number;
  }[];
  arrays: {
    roof_plane_id: string;
    module_catalog_id: string | null;
    module_snapshot?: unknown;
  }[];
  catalog: { id: string; width_mm: number; height_mm: number; thickness_mm?: number | null }[];
};

/** Dimensions réellement enregistrées avec l'implantation (jamais recalculées). */
function snapshotSpec(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as { width_mm?: unknown; height_mm?: unknown; depth_mm?: unknown };
  if (typeof s.width_mm !== "number" || typeof s.height_mm !== "number") return null;
  return {
    width_mm: s.width_mm,
    height_mm: s.height_mm,
    depth_mm: typeof s.depth_mm === "number" ? s.depth_mm : null,
  };
}

export function buildSceneModel(payload: PayloadLike): SolarSceneModel {
  const planeById = new Map(payload.planes.map((p) => [p.id, p]));

  const specByPlaneKey: SolarSceneModel["specByPlaneKey"] = {};
  for (const arr of payload.arrays) {
    const plane = planeById.get(arr.roof_plane_id);
    if (!plane) continue;
    const fromSnapshot = snapshotSpec(arr.module_snapshot);
    if (fromSnapshot) {
      specByPlaneKey[plane.key] = fromSnapshot;
      continue;
    }
    const legacy = payload.catalog.find((c) => c.id === arr.module_catalog_id);
    if (legacy) {
      specByPlaneKey[plane.key] = {
        width_mm: legacy.width_mm,
        height_mm: legacy.height_mm,
        depth_mm: legacy.thickness_mm ?? null,
      };
    }
  }

  const obstacles: SceneObstacle[] = payload.obstacles.map((o) => ({
    id: o.id,
    planeKey: o.roof_plane_id ? planeById.get(o.roof_plane_id)?.key ?? null : null,
    u: o.position_x_m,
    v: o.position_y_m,
    baseZ: o.base_z_m,
    width: o.width_m,
    length: o.length_m,
    height: o.height_m,
    color: OBSTACLE_COLORS[o.obstacle_type] ?? "#7c3aed",
  }));

  const footprint = footprintPolygon(payload.params);
  const extent = Math.max(payload.params.width_m, payload.params.depth_m) * 1.2;

  return {
    planes: payload.planes,
    modules: payload.modules,
    obstacles,
    specByPlaneKey,
    footprint,
    wallHeight: payload.params.wall_height_m,
    extent,
  };
}
