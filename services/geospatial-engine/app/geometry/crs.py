"""Transformations de coordonnées. Toute conversion du moteur passe par ici.

Chaîne : CRS source réel → CRS projeté métrique → repère local Solar Studio
(x = Est, y = Nord, z = altitude relative à l'origine), géoréférence conservée.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

try:  # pyproj est requis en production, optionnel pour les tests purs
    from pyproj import CRS, Transformer

    HAS_PYPROJ = True
except Exception:  # pragma: no cover
    HAS_PYPROJ = False


@dataclass(frozen=True)
class LocalOrigin:
    latitude: float
    longitude: float
    altitude_m: float
    working_crs: str
    easting: float
    northing: float


def pick_working_crs(latitude: float, longitude: float) -> str:
    """France métropolitaine → Lambert-93 ; ailleurs → UTM adapté."""
    if 41.0 <= latitude <= 51.6 and -5.5 <= longitude <= 9.8:
        return "EPSG:2154"
    zone = int((longitude + 180) // 6) + 1
    return f"EPSG:{32600 + zone if latitude >= 0 else 32700 + zone}"


def _transformer(src: str, dst: str) -> "Transformer":
    if not HAS_PYPROJ:  # pragma: no cover
        raise RuntimeError("pyproj indisponible : transformation impossible.")
    return Transformer.from_crs(CRS.from_user_input(src), CRS.from_user_input(dst), always_xy=True)


def make_origin(latitude: float, longitude: float, altitude_m: float = 0.0, working_crs: str | None = None) -> LocalOrigin:
    crs = working_crs or pick_working_crs(latitude, longitude)
    east, north = _transformer("EPSG:4326", crs).transform(longitude, latitude)
    return LocalOrigin(latitude, longitude, altitude_m, crs, float(east), float(north))


def world_to_local(origin: LocalOrigin, xyz: np.ndarray, source_crs: str) -> np.ndarray:
    """xyz (N,3) dans `source_crs` → repère local métrique de Solar Studio."""
    pts = np.asarray(xyz, dtype=float).reshape(-1, 3)
    if source_crs.upper() != origin.working_crs.upper():
        tr = _transformer(source_crs, origin.working_crs)
        x, y = tr.transform(pts[:, 0], pts[:, 1])
        pts = np.column_stack([np.asarray(x), np.asarray(y), pts[:, 2]])
    out = np.empty_like(pts)
    out[:, 0] = pts[:, 0] - origin.easting
    out[:, 1] = pts[:, 1] - origin.northing
    out[:, 2] = pts[:, 2] - origin.altitude_m
    return out


def local_to_world(origin: LocalOrigin, xyz: np.ndarray) -> np.ndarray:
    """Repère local → (lon, lat, altitude) WGS84, pour conserver la géoréférence."""
    pts = np.asarray(xyz, dtype=float).reshape(-1, 3)
    east = pts[:, 0] + origin.easting
    north = pts[:, 1] + origin.northing
    tr = _transformer(origin.working_crs, "EPSG:4326")
    lon, lat = tr.transform(east, north)
    return np.column_stack([np.asarray(lon), np.asarray(lat), pts[:, 2] + origin.altitude_m])


def bbox_local_to_source(origin: LocalOrigin, half_side_m: float, source_crs: str) -> tuple[float, float, float, float]:
    """BBOX carrée autour de l'origine, exprimée dans le CRS de la source."""
    corners = np.array(
        [
            [-half_side_m, -half_side_m, 0.0],
            [half_side_m, -half_side_m, 0.0],
            [half_side_m, half_side_m, 0.0],
            [-half_side_m, half_side_m, 0.0],
        ]
    )
    east = corners[:, 0] + origin.easting
    north = corners[:, 1] + origin.northing
    if source_crs.upper() != origin.working_crs.upper():
        tr = _transformer(origin.working_crs, source_crs)
        east, north = tr.transform(east, north)
        east, north = np.asarray(east), np.asarray(north)
    return float(np.min(east)), float(np.min(north)), float(np.max(east)), float(np.max(north))
