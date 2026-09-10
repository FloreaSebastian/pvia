"""Versions de protocole du moteur géospatial PVIA.

Toute évolution incompatible incrémente RESULT_SCHEMA_VERSION ; les anciens
résultats restent lisibles car la version est stockée avec le résultat.
"""

from __future__ import annotations

ENGINE_VERSION = "1.0.0"
PIPELINE_VERSION = "roof-reconstruction-1.0.0"
RESULT_SCHEMA_VERSION = "roof-model-v1"
PROTOCOL_VERSION = "geospatial-engine-v1"

# Convention d'azimut PVIA, identique côté TypeScript (src/lib/solar/geo.ts) :
# Nord = 0°, Est = 90°, Sud = 180°, Ouest = 270°.
AZIMUTH_CONVENTION = "north_zero_clockwise"


def native_versions() -> dict[str, str | None]:
    """Versions réellement installées. Jamais inventées : None si absent."""
    out: dict[str, str | None] = {"pdal": None, "gdal": None, "proj": None}
    try:
        import pdal  # type: ignore

        out["pdal"] = str(pdal.info.version)
    except Exception:  # pragma: no cover - dépend de l'image
        pass
    try:
        from osgeo import gdal  # type: ignore

        out["gdal"] = str(gdal.__version__)
    except Exception:  # pragma: no cover
        try:
            import rasterio  # type: ignore

            out["gdal"] = str(rasterio.__gdal_version__)
        except Exception:
            pass
    try:
        import pyproj  # type: ignore

        out["proj"] = str(pyproj.proj_version_str)
    except Exception:  # pragma: no cover
        pass
    return out
