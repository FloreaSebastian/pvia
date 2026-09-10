"""Lecture spatiale distante d'un nuage LiDAR HD au format COPC.LAZ.

Le format COPC est un octree indexé : on lit uniquement les nœuds qui
intersectent la BBOX du projet. Aucune dalle complète n'est téléchargée.

Si PDAL n'est pas disponible, ou si aucune source n'est configurée, la fonction
lève une erreur explicite. Aucun nuage n'est jamais simulé.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np

from ..config import Limits
from ..geometry.validation import CoverageError, GeometryError, LimitError, TemporaryError

# Classification ASPRS conservée telle quelle (classification d'origine).
ASPRS_CLASSES = {
    1: "non classé",
    2: "sol",
    3: "végétation basse",
    4: "végétation moyenne",
    5: "végétation haute",
    6: "bâtiment",
    9: "eau",
    17: "pont",
    64: "sursol pérenne",
    66: "point virtuel",
}


@dataclass
class PointSet:
    xyz: np.ndarray               # (N,3) dans le CRS source
    classification: np.ndarray    # (N,) classification d'origine
    intensity: np.ndarray | None
    source_crs: str
    points_read: int
    duration_s: float


def pdal_available() -> bool:
    try:
        import pdal  # noqa: F401

        return True
    except Exception:
        return False


def read_copc_bbox(
    copc_url: str,
    bbox: tuple[float, float, float, float],
    limits: Limits,
    *,
    resolution_m: float | None = None,
    classes: list[int] | None = None,
) -> PointSet:
    """Lit un COPC (local ou HTTP) restreint à la BBOX du projet."""
    if not copc_url:
        raise CoverageError("Aucune source LiDAR configurée pour cette zone.")
    if not pdal_available():
        raise TemporaryError("PDAL indisponible dans ce conteneur : lecture LiDAR impossible.")

    import json

    import pdal

    minx, miny, maxx, maxy = bbox
    if (maxx - minx) > limits.max_bbox_side_m or (maxy - miny) > limits.max_bbox_side_m:
        raise LimitError("Emprise LiDAR trop grande.")

    stages: list[dict] = [
        {
            "type": "readers.copc",
            "filename": copc_url,
            "bounds": f"([{minx},{maxx}],[{miny},{maxy}])",
            **({"resolution": resolution_m} if resolution_m else {}),
        }
    ]
    if classes:
        expr = " || ".join(f"Classification == {c}" for c in classes)
        stages.append({"type": "filters.expression", "expression": expr})

    started = time.perf_counter()
    try:
        pipeline = pdal.Pipeline(json.dumps({"pipeline": stages}))
        count = pipeline.execute()
    except RuntimeError as exc:
        message = str(exc)
        if "404" in message or "not found" in message.lower():
            raise CoverageError("Dalle LiDAR absente pour cette emprise.") from exc
        if "timed out" in message.lower() or "curl" in message.lower():
            raise TemporaryError("Lecture LiDAR distante interrompue.") from exc
        raise GeometryError(f"Lecture COPC impossible : {message[:200]}") from exc

    duration = time.perf_counter() - started
    if not count:
        raise CoverageError("Aucun point LiDAR dans l'emprise du bâtiment.")
    if count > limits.max_points:
        raise LimitError(f"Nuage trop volumineux ({count} points).")

    array = pipeline.arrays[0]
    xyz = np.column_stack([array["X"], array["Y"], array["Z"]]).astype(float)
    classification = (
        array["Classification"].astype(int)
        if "Classification" in array.dtype.names
        else np.zeros(xyz.shape[0], dtype=int)
    )
    intensity = array["Intensity"].astype(float) if "Intensity" in array.dtype.names else None

    srs = ""
    try:
        meta = pipeline.metadata
        meta = meta if isinstance(meta, dict) else json.loads(meta)
        srs = (
            meta.get("metadata", {})
            .get("readers.copc", {})
            .get("srs", {})
            .get("horizontal", "")
        )
    except Exception:
        srs = ""

    return PointSet(
        xyz=xyz,
        classification=classification,
        intensity=intensity,
        source_crs=_crs_name(srs),
        points_read=int(count),
        duration_s=duration,
    )


def _crs_name(srs_wkt: str) -> str:
    """Le CRS réel de la source. Jamais supposé WGS84."""
    if not srs_wkt:
        raise GeometryError("CRS du nuage LiDAR inconnu : traitement refusé.")
    try:
        from pyproj import CRS

        crs = CRS.from_user_input(srs_wkt)
        code = crs.to_epsg()
        return f"EPSG:{code}" if code else crs.to_wkt()
    except Exception as exc:
        raise GeometryError("CRS du nuage LiDAR illisible.") from exc


def split_classes(points: PointSet) -> dict[str, np.ndarray]:
    """Masques par classification d'origine, sans reclassification silencieuse."""
    cls = points.classification
    return {
        "ground": np.isin(cls, [2]),
        "building": np.isin(cls, [6]),
        "vegetation": np.isin(cls, [3, 4, 5]),
        "water": np.isin(cls, [9]),
        "other": ~np.isin(cls, [2, 3, 4, 5, 6, 9]),
    }
