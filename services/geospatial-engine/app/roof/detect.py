"""Reconstruction des pans de toiture à partir d'un nuage de points.

Algorithme : PVIA Roof Extraction v1.0
  1. filtrage statistique des outliers (k plus proches voisins par grille) ;
  2. segmentation itérative par RANSAC déterministe (graine fixe) ;
  3. rejet des surfaces trop petites / trop peu denses (cheminées, VMC) ;
  4. contour concave (alpha-shape) simplifié et validé ;
  5. métriques réelles : RMSE, densité, points utilisés/rejetés, dispersion.

Aucune valeur n'est inventée : les métriques proviennent des points reçus.
Le nombre de pans provient des données, jamais d'un a priori architectural.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

RNG_SEED = 20260910

# Valeurs par défaut documentées (voir README, section « Paramètres »).
DEFAULTS = {
    "distance_threshold_m": 0.12,   # tolérance d'appartenance au plan
    "min_points": 120,              # taille minimale d'un pan candidat
    "min_area_m2": 4.0,             # au-dessous : petite structure, pas un pan
    "max_planes": 12,
    "iterations": 400,
    "outlier_k": 8,
    "outlier_sigma": 2.5,
    "max_tilt_deg": 75.0,           # au-delà : mur, pas une toiture
    "obstacle_min_points": 12,
    "obstacle_min_height_m": 0.35,
}


@dataclass
class PlaneResult:
    index: int
    normal: tuple[float, float, float]
    d: float
    tilt_deg: float
    azimuth_deg: float
    centroid: tuple[float, float, float]
    mean_height_m: float
    min_height_m: float
    max_height_m: float
    point_count: int
    rejected_points: int
    density_pts_m2: float
    rmse_m: float
    max_error_m: float
    dispersion_m: float
    area_m2: float
    contour: list[tuple[float, float, float]]
    confidence: str
    confidence_reasons: list[str] = field(default_factory=list)


@dataclass
class ObstacleCandidate:
    position: tuple[float, float, float]
    height_m: float
    width_m: float
    length_m: float
    point_count: int
    kind: str  # "obstacle" | "vegetation"
    confidence: str


def _grid_outlier_filter(points: np.ndarray, k: int, sigma: float) -> tuple[np.ndarray, int]:
    """Filtre statistique local sur une grille 1 m : rejette les z aberrants."""
    if points.shape[0] < k * 2:
        return points, 0
    keys = np.floor(points[:, :2]).astype(np.int64)
    order = np.lexsort((keys[:, 1], keys[:, 0]))
    sorted_pts = points[order]
    sorted_keys = keys[order]
    keep = np.ones(sorted_pts.shape[0], dtype=bool)
    start = 0
    for i in range(1, sorted_pts.shape[0] + 1):
        if i == sorted_pts.shape[0] or not np.array_equal(sorted_keys[i], sorted_keys[start]):
            cell = sorted_pts[start:i, 2]
            if cell.size >= k:
                med = float(np.median(cell))
                mad = float(np.median(np.abs(cell - med))) or 1e-6
                keep[start:i] = np.abs(cell - med) <= sigma * 1.4826 * mad
            start = i
    filtered = sorted_pts[keep]
    return filtered, int(sorted_pts.shape[0] - filtered.shape[0])


def _fit_plane(points: np.ndarray) -> tuple[np.ndarray, float]:
    """Plan des moindres carrés (PCA) : normale unitaire + offset."""
    centroid = points.mean(axis=0)
    centred = points - centroid
    _, _, vh = np.linalg.svd(centred, full_matrices=False)
    normal = vh[2]
    if normal[2] < 0:
        normal = -normal
    d = -float(np.dot(normal, centroid))
    return normal, d


def _ransac_plane(points: np.ndarray, threshold: float, iterations: int, rng: np.random.Generator):
    n = points.shape[0]
    best_inliers: np.ndarray | None = None
    best_count = 0
    for _ in range(iterations):
        idx = rng.choice(n, size=3, replace=False)
        p0, p1, p2 = points[idx]
        normal = np.cross(p1 - p0, p2 - p0)
        norm = np.linalg.norm(normal)
        if norm < 1e-9:
            continue
        normal = normal / norm
        if normal[2] < 0:
            normal = -normal
        d = -float(np.dot(normal, p0))
        dist = np.abs(points @ normal + d)
        inliers = dist <= threshold
        count = int(inliers.sum())
        if count > best_count:
            best_count = count
            best_inliers = inliers
    if best_inliers is None:
        return None
    # Raffinement sur l'ensemble des inliers.
    normal, d = _fit_plane(points[best_inliers])
    dist = np.abs(points @ normal + d)
    inliers = dist <= threshold
    return normal, d, inliers


def _tilt_azimuth(normal: np.ndarray) -> tuple[float, float]:
    """Convention PVIA : Nord = 0°, Est = 90°, Sud = 180°, Ouest = 270°."""
    nx, ny, nz = float(normal[0]), float(normal[1]), float(normal[2])
    tilt = math.degrees(math.acos(max(-1.0, min(1.0, abs(nz)))))
    if math.hypot(nx, ny) < 1e-9:
        return tilt, 0.0
    # La pente descend dans la direction opposée à la composante horizontale
    # de la normale ascendante.
    azimuth = (math.degrees(math.atan2(-nx, -ny))) % 360.0
    return tilt, azimuth


def _alpha_shape(xy: np.ndarray, alpha_m: float) -> list[tuple[float, float]]:
    """Contour concave. Repli sur l'enveloppe convexe si shapely est absent."""
    try:
        from shapely.geometry import MultiPoint
        from shapely.ops import unary_union

        pts = MultiPoint([tuple(p) for p in xy])
        # Buffer/erosion : approximation d'alpha-shape robuste et déterministe.
        shape = unary_union(pts.buffer(alpha_m, quad_segs=4)).buffer(-alpha_m * 0.85, quad_segs=4)
        if shape.is_empty:
            shape = pts.convex_hull
        if shape.geom_type == "MultiPolygon":
            shape = max(shape.geoms, key=lambda g: g.area)
        shape = shape.simplify(0.15, preserve_topology=True)
        if shape.geom_type != "Polygon" or not shape.is_valid or shape.area <= 0:
            shape = pts.convex_hull
        if shape.geom_type != "Polygon":
            return _convex_hull(xy)
        return [(float(x), float(y)) for x, y in list(shape.exterior.coords)[:-1]]
    except Exception:
        return _convex_hull(xy)


def _convex_hull(xy: np.ndarray) -> list[tuple[float, float]]:
    pts = sorted({(float(x), float(y)) for x, y in xy})
    if len(pts) < 3:
        return [(float(x), float(y)) for x, y in pts]

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower: list[tuple[float, float]] = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper: list[tuple[float, float]] = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def _polygon_area(ring: list[tuple[float, float]]) -> float:
    if len(ring) < 3:
        return 0.0
    s = 0.0
    for i, (x1, y1) in enumerate(ring):
        x2, y2 = ring[(i + 1) % len(ring)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def _confidence(point_count: int, density: float, rmse: float, area: float) -> tuple[str, list[str]]:
    reasons = [
        f"{point_count} points utilisés",
        f"densité {density:.1f} pts/m²",
        f"erreur de plan (RMSE) {rmse * 100:.1f} cm",
        f"surface {area:.2f} m²",
    ]
    if point_count >= 800 and density >= 6 and rmse <= 0.06:
        return "high", reasons
    if point_count >= 200 and density >= 2 and rmse <= 0.15:
        return "medium", reasons
    return "low", reasons


def detect_roof_planes(points: np.ndarray, params: dict | None = None) -> tuple[list[PlaneResult], list[ObstacleCandidate], dict]:
    """Retourne (pans, obstacles candidats, métriques du traitement)."""
    cfg = {**DEFAULTS, **(params or {})}
    pts = np.asarray(points, dtype=float).reshape(-1, 3)
    read = int(pts.shape[0])

    filtered, removed = _grid_outlier_filter(pts, int(cfg["outlier_k"]), float(cfg["outlier_sigma"]))
    rng = np.random.default_rng(RNG_SEED)

    remaining = filtered
    planes: list[PlaneResult] = []
    small_clusters: list[np.ndarray] = []
    index = 0

    while remaining.shape[0] >= int(cfg["min_points"]) and len(planes) < int(cfg["max_planes"]):
        fit = _ransac_plane(remaining, float(cfg["distance_threshold_m"]), int(cfg["iterations"]), rng)
        if fit is None:
            break
        normal, d, mask = fit
        inliers = remaining[mask]
        if inliers.shape[0] < int(cfg["min_points"]):
            break

        tilt, azimuth = _tilt_azimuth(normal)
        xy = inliers[:, :2]
        contour_xy = _alpha_shape(xy, alpha_m=1.0)
        area_2d = _polygon_area(contour_xy)
        cos_t = max(math.cos(math.radians(tilt)), 1e-3)
        area = area_2d / cos_t
        dist = np.abs(inliers @ normal + d)
        rmse = float(np.sqrt(np.mean(dist**2)))
        density = inliers.shape[0] / area if area > 0 else 0.0

        keep_as_plane = (
            area >= float(cfg["min_area_m2"])
            and tilt <= float(cfg["max_tilt_deg"])
            and inliers.shape[0] >= int(cfg["min_points"])
        )

        if keep_as_plane:
            centroid = inliers.mean(axis=0)
            # Contour projeté sur le plan (z issu de l'équation du plan).
            contour = []
            for x, y in contour_xy:
                z = -(normal[0] * x + normal[1] * y + d) / (normal[2] if abs(normal[2]) > 1e-6 else 1e-6)
                contour.append((float(x), float(y), float(z)))
            conf, reasons = _confidence(int(inliers.shape[0]), density, rmse, area)
            planes.append(
                PlaneResult(
                    index=index,
                    normal=(float(normal[0]), float(normal[1]), float(normal[2])),
                    d=float(d),
                    tilt_deg=tilt,
                    azimuth_deg=azimuth,
                    centroid=(float(centroid[0]), float(centroid[1]), float(centroid[2])),
                    mean_height_m=float(np.mean(inliers[:, 2])),
                    min_height_m=float(np.min(inliers[:, 2])),
                    max_height_m=float(np.max(inliers[:, 2])),
                    point_count=int(inliers.shape[0]),
                    rejected_points=int(mask.size - mask.sum()),
                    density_pts_m2=float(density),
                    rmse_m=rmse,
                    max_error_m=float(np.max(dist)),
                    dispersion_m=float(np.std(dist)),
                    area_m2=float(area),
                    contour=contour,
                    confidence=conf,
                    confidence_reasons=reasons,
                )
            )
            index += 1
        else:
            small_clusters.append(inliers)

        remaining = remaining[~mask]

    # Points restants + petites surfaces → obstacles / végétation candidats.
    leftovers = [remaining] if remaining.shape[0] else []
    obstacles = _candidates(planes, small_clusters + leftovers, cfg)

    metrics = {
        "points_read": read,
        "points_used": int(filtered.shape[0]),
        "points_rejected_outlier": removed,
        "points_unassigned": int(remaining.shape[0]),
        "planes_detected": len(planes),
        "obstacle_candidates": len(obstacles),
        "algorithm": "PVIA Roof Extraction v1.0",
        "parameters": cfg,
    }
    return planes, obstacles, metrics


def _candidates(planes: list[PlaneResult], clusters: list[np.ndarray], cfg: dict) -> list[ObstacleCandidate]:
    out: list[ObstacleCandidate] = []
    if not clusters:
        return out
    for cluster in clusters:
        if cluster.shape[0] < int(cfg["obstacle_min_points"]):
            continue
        for group in _cluster_xy(cluster, cell_m=1.0):
            if group.shape[0] < int(cfg["obstacle_min_points"]):
                continue
            base = _reference_height(planes, group)
            top = float(np.percentile(group[:, 2], 95))
            height = top - base
            if height < float(cfg["obstacle_min_height_m"]):
                continue
            width = float(np.ptp(group[:, 0]))
            length = float(np.ptp(group[:, 1]))
            spread_z = float(np.std(group[:, 2]))
            # Végétation : volume diffus et haut ; obstacle : compact sur le toit.
            kind = "vegetation" if spread_z > 1.2 and max(width, length) > 2.0 else "obstacle"
            out.append(
                ObstacleCandidate(
                    position=(float(np.mean(group[:, 0])), float(np.mean(group[:, 1])), base),
                    height_m=height,
                    width_m=max(width, 0.2),
                    length_m=max(length, 0.2),
                    point_count=int(group.shape[0]),
                    kind=kind,
                    confidence="medium" if group.shape[0] >= 60 else "low",
                )
            )
    return out[:40]


def _cluster_xy(points: np.ndarray, cell_m: float) -> list[np.ndarray]:
    """Regroupement par cellules connexes (grille) — déterministe et léger."""
    keys = np.floor(points[:, :2] / cell_m).astype(np.int64)
    buckets: dict[tuple[int, int], list[int]] = {}
    for i, key in enumerate(map(tuple, keys)):
        buckets.setdefault(key, []).append(i)
    seen: set[tuple[int, int]] = set()
    groups: list[np.ndarray] = []
    for key in buckets:
        if key in seen:
            continue
        stack = [key]
        members: list[int] = []
        seen.add(key)
        while stack:
            cur = stack.pop()
            members.extend(buckets[cur])
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    nb = (cur[0] + dx, cur[1] + dy)
                    if nb in buckets and nb not in seen:
                        seen.add(nb)
                        stack.append(nb)
        groups.append(points[members])
    return groups


def _reference_height(planes: list[PlaneResult], group: np.ndarray) -> float:
    """Altitude du toit sous l'objet, sinon point bas du groupe."""
    if not planes:
        return float(np.percentile(group[:, 2], 5))
    cx, cy = float(np.mean(group[:, 0])), float(np.mean(group[:, 1]))
    best = None
    for plane in planes:
        nx, ny, nz = plane.normal
        if abs(nz) < 1e-6:
            continue
        z = -(nx * cx + ny * cy + plane.d) / nz
        if best is None or abs(z - np.percentile(group[:, 2], 5)) < abs(best - np.percentile(group[:, 2], 5)):
            best = z
    return float(best if best is not None else np.percentile(group[:, 2], 5))
