"""Pipeline complet : source 3D → bâtiment → pans → résultat versionné.

Étapes réelles (la progression envoyée à PVIA correspond aux étapes terminées) :
  10 %  contrôle de couverture
  30 %  lecture des données (COPC / MNT / MNS)
  50 %  extraction du bâtiment
  70 %  détection des pans
  85 %  arêtes, obstacles, terrain
 100 %  validation géométrique et résultat
"""

from __future__ import annotations

import time
from collections.abc import Callable

import numpy as np

from ..config import Limits, settings
from ..geometry import crs as crsmod
from ..geometry.validation import CoverageError, GeometryError, validate_bbox, validate_crs_units, validate_point_cloud
from ..lidar import copc
from ..providers import ign
from ..raster import dem
from ..roof.detect import detect_roof_planes
from ..roof.edges import derive_edges
from ..schemas import (
    AnalyzeRequest,
    DetectedObstacle,
    OriginRef,
    RoofEdge,
    RoofModelResult,
    RoofPlane,
    SourceMetadata,
    TerrainRef,
)

Progress = Callable[[str, int, str], None]

STAGES = [
    ("CHECK_3D_COVERAGE", 10, "Contrôle de couverture"),
    ("FETCH_LIDAR", 30, "Téléchargement des données"),
    ("DETECT_BUILDING", 50, "Extraction du bâtiment"),
    ("DETECT_ROOF_PLANES", 70, "Analyse de la toiture"),
    ("GENERATE_SITE_MODEL", 85, "Construction des pans"),
    ("COMPARE_GEOMETRY", 100, "Validation géométrique"),
]


def _noop(stage: str, percent: int, label: str) -> None:  # pragma: no cover
    return None


def _source_meta(ep: ign.DatasetEndpoint, resolution: float | None = None, date: str | None = None) -> SourceMetadata:
    return SourceMetadata(
        provider="IGN",
        dataset=ep.dataset,
        dataset_kind=ep.kind,
        dataset_version=ep.version,
        acquisition_date=date,
        crs=ep.crs,
        resolution_m=resolution if resolution is not None else ep.resolution_m,
        attribution=ep.attribution,
        license=ep.license,
    )


def check_coverage() -> list[dict]:
    """Ce que le moteur peut réellement fournir, d'après sa configuration."""
    out = []
    for key in ("lidar", "terrain_model", "surface_model", "height_model"):
        ep = ign.ENDPOINTS[key]
        configured = bool(ep.url)
        native_ok = copc.pdal_available() if key == "lidar" else dem.rasterio_available()
        out.append(
            {
                "dataset_kind": ep.kind,
                "label": ep.label,
                "configured": configured,
                "engine_ready": native_ok,
                "provider": "IGN" if configured else None,
                "dataset": ep.dataset if configured else None,
                "resolution_m": ep.resolution_m,
                "attribution": ep.attribution,
                "notes": ep.notes,
            }
        )
    return out


def analyze(request: AnalyzeRequest, progress: Progress = _noop, limits: Limits | None = None) -> RoofModelResult:
    lim = limits or settings.limits
    t0 = time.perf_counter()
    sources: list[SourceMetadata] = []

    progress(*STAGES[0])
    lidar_ep = ign.endpoint("lidar")
    mnt_ep = ign.endpoint("terrain_model")
    if lidar_ep is None:
        raise CoverageError("Source LiDAR non configurée pour ce moteur.")

    origin = crsmod.make_origin(request.latitude, request.longitude, request.altitude_m or 0.0)

    # Deux emprises : bâtiment (reconstruction) et environnement proche.
    if request.footprint:
        ring = np.asarray(request.footprint, dtype=float)
        half_building = float(max(np.ptp(ring[:, 0]), np.ptp(ring[:, 1])) / 2 + request.building_margin_m)
    else:
        half_building = 15.0 + request.building_margin_m
    half_building = min(half_building, lim.max_bbox_side_m / 2)
    half_env = min(max(request.environment_radius_m, half_building), lim.max_bbox_side_m / 2)

    bbox_env = crsmod.bbox_local_to_source(origin, half_env, lidar_ep.crs)
    validate_bbox(*bbox_env, lim)
    validate_crs_units(lidar_ep.crs)

    progress(*STAGES[1])
    points = copc.read_copc_bbox(lidar_ep.url, bbox_env, lim)
    validate_crs_units(points.source_crs)
    local = crsmod.world_to_local(origin, points.xyz, points.source_crs)
    validate_point_cloud(local, lim)
    sources.append(_source_meta(lidar_ep))

    masks = copc.split_classes(points)

    progress(*STAGES[2])
    # Contrainte spatiale : contour confirmé en phase 2A + marge.
    inside = _inside_building(local, request.footprint, request.building_margin_m, half_building)
    building_mask = masks["building"] & inside
    if building_mask.sum() < 50:
        # Repli documenté : sans classification exploitable, on garde les points
        # hauts de l'emprise bâtiment plutôt que d'abandonner.
        candidate = local[inside]
        if candidate.shape[0] < 50:
            raise CoverageError("Trop peu de points LiDAR sur le bâtiment.")
        ground = float(np.percentile(candidate[:, 2], 5))
        building_mask = inside & (local[:, 2] > ground + 1.5)
    roof_points = local[building_mask]
    if roof_points.shape[0] < 50:
        raise CoverageError("Trop peu de points LiDAR sur le bâtiment.")

    progress(*STAGES[3])
    planes, obstacle_candidates, metrics = detect_roof_planes(roof_points, request.parameters)
    if not planes:
        raise GeometryError("Aucun plan de toiture exploitable dans ce nuage.")

    progress(*STAGES[4])
    edges = derive_edges(planes)

    terrain = _terrain(origin, mnt_ep, local, masks, half_env, lim, sources)

    envelope = _envelope(planes)
    neighbours: list[dict] = []

    progress(*STAGES[5])
    result = RoofModelResult(
        origin=OriginRef(
            latitude=origin.latitude,
            longitude=origin.longitude,
            altitude_m=origin.altitude_m,
            working_crs=origin.working_crs,
            source_crs=points.source_crs,
        ),
        planes=[
            RoofPlane(
                index=p.index,
                normal=list(p.normal),
                plane_d=p.d,
                tilt_deg=p.tilt_deg,
                azimuth_deg=p.azimuth_deg,
                centroid=list(p.centroid),
                mean_height_m=p.mean_height_m,
                min_height_m=p.min_height_m,
                max_height_m=p.max_height_m,
                area_m2=p.area_m2,
                contour=[list(c) for c in p.contour],
                point_count=p.point_count,
                rejected_points=p.rejected_points,
                density_pts_m2=p.density_pts_m2,
                rmse_m=p.rmse_m,
                max_error_m=p.max_error_m,
                dispersion_m=p.dispersion_m,
                confidence=p.confidence,  # type: ignore[arg-type]
                confidence_reasons=p.confidence_reasons,
            )
            for p in planes
        ],
        edges=[RoofEdge(**e) for e in edges],
        obstacles=[
            DetectedObstacle(
                kind=o.kind,  # type: ignore[arg-type]
                position=list(o.position),
                height_m=o.height_m,
                width_m=o.width_m,
                length_m=o.length_m,
                point_count=o.point_count,
                confidence=o.confidence,
            )
            for o in obstacle_candidates
        ],
        neighbours=neighbours,  # type: ignore[arg-type]
        terrain=terrain,
        building_envelope=envelope,
        point_cloud_preview=_preview(roof_points, lim) if request.include_point_cloud else [],
        point_cloud_classification=(
            points.classification[building_mask][: lim.max_points_returned].tolist()
            if request.include_point_cloud
            else []
        ),
        classification_legend={str(k): v for k, v in copc.ASPRS_CLASSES.items()},
        quality={
            "verification_status": "unverified",
            "note": "Géométrie dérivée automatiquement. Non vérifiée sur le terrain.",
        },
        metrics={**metrics, "duration_s": round(time.perf_counter() - t0, 3), "points_read_source": points.points_read},
        sources=sources,
    )
    return result


def _inside_building(local: np.ndarray, footprint: list[list[float]], margin: float, half: float) -> np.ndarray:
    if not footprint or len(footprint) < 3:
        return (np.abs(local[:, 0]) <= half) & (np.abs(local[:, 1]) <= half)
    try:
        from shapely.geometry import Polygon, Point

        poly = Polygon([(p[0], p[1]) for p in footprint]).buffer(margin)
        return np.array([poly.contains(Point(x, y)) for x, y in local[:, :2]])
    except Exception:
        ring = np.asarray(footprint, dtype=float)
        return (
            (local[:, 0] >= ring[:, 0].min() - margin)
            & (local[:, 0] <= ring[:, 0].max() + margin)
            & (local[:, 1] >= ring[:, 1].min() - margin)
            & (local[:, 1] <= ring[:, 1].max() + margin)
        )


def _terrain(origin, mnt_ep, local, masks, half_env, lim, sources) -> TerrainRef:
    """Terrain issu du sol (MNT ou points classés sol) — jamais de la toiture."""
    ground = local[masks["ground"]]
    if ground.shape[0] >= 100:
        step = 2.0
        xs = np.arange(-half_env, half_env + step, step)
        cols = rows = xs.size
        heights = np.full((rows, cols), np.nan)
        gi = np.clip(((ground[:, 1] + half_env) / step).astype(int), 0, rows - 1)
        gj = np.clip(((ground[:, 0] + half_env) / step).astype(int), 0, cols - 1)
        for i, j, z in zip(gi, gj, ground[:, 2]):
            heights[i, j] = z if np.isnan(heights[i, j]) else (heights[i, j] + z) / 2
        median = float(np.nanmedian(heights))
        heights = np.where(np.isnan(heights), median, heights)
        return TerrainRef(
            available=True,
            origin_altitude_m=origin.altitude_m,
            min_m=float(np.min(heights)),
            max_m=float(np.max(heights)),
            grid_step_m=step,
            heights=[float(v) for v in heights.flatten()],
            cols=cols,
            rows=rows,
            source=SourceMetadata(
                provider="IGN",
                dataset="LiDAR HD — points classés sol",
                dataset_kind="terrain_model",
                crs=origin.working_crs,
                resolution_m=step,
                attribution=ign.ATTRIBUTION,
                license=ign.LICENSE,
            ),
        )
    if mnt_ep is not None:
        try:
            bbox = crsmod.bbox_local_to_source(origin, half_env, mnt_ep.crs)
            grid = dem.fetch_grid(mnt_ep, bbox, mnt_ep.crs, lim)
            sources.append(_source_meta(mnt_ep, grid.resolution_m))
            values = grid.values
            return TerrainRef(
                available=True,
                origin_altitude_m=origin.altitude_m,
                min_m=float(np.nanmin(values)),
                max_m=float(np.nanmax(values)),
                grid_step_m=grid.resolution_m,
                heights=[float(v) for v in np.nan_to_num(values, nan=float(np.nanmedian(values))).flatten()],
                cols=int(values.shape[1]),
                rows=int(values.shape[0]),
                source=_source_meta(mnt_ep, grid.resolution_m),
            )
        except Exception:
            pass
    return TerrainRef(available=False)


def _envelope(planes) -> list[list[float]]:
    pts = np.vstack([np.array(p.contour)[:, :2] for p in planes])
    from ..roof.detect import _convex_hull

    return [[float(x), float(y)] for x, y in _convex_hull(pts)]


def _preview(points: np.ndarray, lim: Limits) -> list[list[float]]:
    """Sous-échantillon décimé : le nuage complet ne part jamais au navigateur."""
    if points.shape[0] <= lim.max_points_returned:
        subset = points
    else:
        step = int(np.ceil(points.shape[0] / lim.max_points_returned))
        subset = points[::step]
    return [[round(float(x), 3), round(float(y), 3), round(float(z), 3)] for x, y, z in subset]
