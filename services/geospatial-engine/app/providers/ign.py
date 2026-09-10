"""Registre centralisé des sources IGN.

Les produits officiels évoluent : aucune URL ne doit apparaître ailleurs dans
le code métier. Chaque entrée porte sa licence et son attribution.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

ATTRIBUTION = "IGN — Géoplateforme"
LICENSE = "Licence Ouverte / Open Licence Etalab 2.0"


@dataclass(frozen=True)
class DatasetEndpoint:
    key: str
    label: str
    kind: str  # elevation | terrain_model | surface_model | height_model | lidar | imagery
    url: str
    protocol: str  # wcs | wms | wmts | rest | copc_index
    dataset: str
    version: str | None = None
    resolution_m: float | None = None
    crs: str = "EPSG:2154"
    attribution: str = ATTRIBUTION
    license: str = LICENSE
    notes: str = ""
    extra: dict[str, str] = field(default_factory=dict)


def _env(key: str, default: str) -> str:
    return os.environ.get(key, "") or default


# Points d'entrée. Surchargeables par variable d'environnement pour survivre
# aux migrations d'URL côté IGN sans redéploiement de code métier.
ENDPOINTS: dict[str, DatasetEndpoint] = {
    "elevation": DatasetEndpoint(
        key="elevation",
        label="Altimétrie ponctuelle (RGE ALTI)",
        kind="elevation",
        url=_env("IGN_ELEVATION_URL", "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json"),
        protocol="rest",
        dataset="RGE ALTI",
        resolution_m=1.0,
        crs="EPSG:4326",
    ),
    "terrain_model": DatasetEndpoint(
        key="terrain_model",
        label="Modèle numérique de terrain (RGE ALTI 1 m)",
        kind="terrain_model",
        url=_env("IGN_MNT_WCS_URL", "https://data.geopf.fr/wcs/ows"),
        protocol="wcs",
        dataset="RGEALTI-MNT_PYR-ZIP_FXX_LAMB93_WCS",
        version="2.0.1",
        resolution_m=1.0,
        extra={"coverage_id": _env("IGN_MNT_COVERAGE", "RGEALTI-MNT_PYR-ZIP_FXX_LAMB93_WCS___EL.RGEALTI")},
    ),
    "surface_model": DatasetEndpoint(
        key="surface_model",
        label="Modèle numérique de surface (LiDAR HD MNS)",
        kind="surface_model",
        url=_env("IGN_MNS_WCS_URL", "https://data.geopf.fr/wcs/ows"),
        protocol="wcs",
        dataset="IGNF_LIDAR-HD_MNS",
        version="2.0.1",
        resolution_m=0.5,
        extra={"coverage_id": _env("IGN_MNS_COVERAGE", "IGNF_LIDAR-HD_MNS")},
        notes="Couverture progressive : dépend de l'avancement du programme LiDAR HD.",
    ),
    "height_model": DatasetEndpoint(
        key="height_model",
        label="Modèle numérique de hauteur (LiDAR HD MNH)",
        kind="height_model",
        url=_env("IGN_MNH_WCS_URL", "https://data.geopf.fr/wcs/ows"),
        protocol="wcs",
        dataset="IGNF_LIDAR-HD_MNH",
        version="2.0.1",
        resolution_m=0.5,
        extra={"coverage_id": _env("IGN_MNH_COVERAGE", "IGNF_LIDAR-HD_MNH")},
    ),
    "lidar": DatasetEndpoint(
        key="lidar",
        label="Nuage LiDAR HD classé (COPC)",
        kind="lidar",
        # Index des dalles COPC. Doit être fourni explicitement : sans index
        # configuré, le moteur déclare la source indisponible plutôt que de
        # deviner une URL.
        url=_env("IGN_LIDAR_COPC_INDEX_URL", ""),
        protocol="copc_index",
        dataset="LiDAR HD — nuage classé",
        crs="EPSG:2154",
        notes="Lecture spatiale distante COPC : seuls les nœuds de la BBOX sont lus.",
    ),
    "imagery": DatasetEndpoint(
        key="imagery",
        label="Orthophotographie",
        kind="imagery",
        url=_env("IGN_WMTS_URL", "https://data.geopf.fr/wmts"),
        protocol="wmts",
        dataset="ORTHOIMAGERY.ORTHOPHOTOS",
        crs="EPSG:3857",
    ),
}


def endpoint(key: str) -> DatasetEndpoint | None:
    ep = ENDPOINTS.get(key)
    if ep is None or not ep.url:
        return None
    return ep


def configured_keys() -> list[str]:
    return [k for k, v in ENDPOINTS.items() if v.url]
