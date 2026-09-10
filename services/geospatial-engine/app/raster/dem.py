"""Accès MNT / MNS / MNH par WCS (GDAL/rasterio).

Une absence de couverture est signalée telle quelle : aucune valeur n'est
extrapolée, aucun raster n'est fabriqué.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np

from ..config import Limits
from ..geometry.validation import CoverageError, TemporaryError
from ..providers.ign import DatasetEndpoint


@dataclass
class RasterGrid:
    values: np.ndarray          # (rows, cols) altitudes en mètres
    transform: tuple[float, float, float, float, float, float]
    crs: str
    resolution_m: float
    nodata_ratio: float
    duration_s: float
    dataset: str
    provider: str


def rasterio_available() -> bool:
    try:
        import rasterio  # noqa: F401

        return True
    except Exception:
        return False


def _wcs_url(ep: DatasetEndpoint, bbox: tuple[float, float, float, float], crs: str) -> str:
    minx, miny, maxx, maxy = bbox
    coverage = ep.extra.get("coverage_id", ep.dataset)
    axis_x, axis_y = ("E", "N") if crs.endswith("2154") else ("X", "Y")
    return (
        f"{ep.url}?SERVICE=WCS&VERSION={ep.version or '2.0.1'}&REQUEST=GetCoverage"
        f"&COVERAGEID={coverage}&FORMAT=image/geotiff"
        f"&SUBSET={axis_x}({minx},{maxx})&SUBSET={axis_y}({miny},{maxy})"
        f"&SUBSETTINGCRS={crs}&OUTPUTCRS={crs}"
    )


def fetch_grid(
    ep: DatasetEndpoint,
    bbox: tuple[float, float, float, float],
    crs: str,
    limits: Limits,
) -> RasterGrid:
    if not rasterio_available():
        raise TemporaryError("GDAL/rasterio indisponible : lecture raster impossible.")

    import rasterio
    from rasterio.errors import RasterioIOError

    url = _wcs_url(ep, bbox, crs)
    started = time.perf_counter()
    try:
        with rasterio.Env(GDAL_HTTP_TIMEOUT=str(limits.http_timeout_s), GDAL_HTTP_MAX_RETRY="2"):
            with rasterio.open(f"/vsicurl/{url}") as src:
                data = src.read(1, masked=True)
                transform = tuple(src.transform)[:6]
                res = float(abs(src.transform.a))
                src_crs = src.crs.to_string() if src.crs else crs
    except RasterioIOError as exc:
        raise TemporaryError(f"Service raster indisponible ({ep.dataset}).") from exc
    except Exception as exc:  # pragma: no cover
        raise TemporaryError(f"Lecture raster impossible ({ep.dataset}).") from exc

    if data.size == 0:
        raise CoverageError(f"{ep.label} : aucune donnée sur cette emprise.")
    filled = np.ma.filled(data.astype(float), np.nan)
    nodata_ratio = float(np.isnan(filled).mean())
    if nodata_ratio > 0.9:
        raise CoverageError(f"{ep.label} : emprise hors couverture.")

    return RasterGrid(
        values=filled,
        transform=transform,  # type: ignore[arg-type]
        crs=src_crs,
        resolution_m=res,
        nodata_ratio=nodata_ratio,
        duration_s=time.perf_counter() - started,
        dataset=ep.dataset,
        provider="IGN",
    )


def grid_to_points(grid: RasterGrid, step: int = 1) -> np.ndarray:
    """Convertit la grille en points (x, y, z) dans le CRS du raster."""
    a, b, c, d, e, f = grid.transform
    rows, cols = grid.values.shape
    ii, jj = np.mgrid[0:rows:step, 0:cols:step]
    x = c + a * (jj + 0.5) + b * (ii + 0.5)
    y = f + d * (jj + 0.5) + e * (ii + 0.5)
    z = grid.values[::step, ::step]
    mask = ~np.isnan(z)
    return np.column_stack([x[mask], y[mask], z[mask]])


def height_above_ground(surface: RasterGrid, terrain: RasterGrid) -> np.ndarray:
    """MNH dérivé = MNS − MNT, uniquement si les grilles sont comparables."""
    if surface.values.shape != terrain.values.shape:
        raise CoverageError("MNS et MNT non superposables : hauteur relative non calculée.")
    return surface.values - terrain.values
