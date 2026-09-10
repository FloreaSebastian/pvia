"""Schéma des résultats renvoyés à PVIA — `roof-model-v1`.

Documenté dans README.md, section « Format des résultats ». Toute évolution
incompatible incrémente RESULT_SCHEMA_VERSION.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from .versions import AZIMUTH_CONVENTION, ENGINE_VERSION, PIPELINE_VERSION, RESULT_SCHEMA_VERSION


class SourceMetadata(BaseModel):
    provider: str
    dataset: str
    dataset_kind: str
    dataset_version: str | None = None
    acquisition_date: str | None = None
    crs: str
    resolution_m: float | None = None
    attribution: str
    license: str


class OriginRef(BaseModel):
    latitude: float
    longitude: float
    altitude_m: float
    working_crs: str
    source_crs: str


class RoofPlane(BaseModel):
    index: int
    normal: list[float]
    plane_d: float
    tilt_deg: float
    azimuth_deg: float
    centroid: list[float]
    mean_height_m: float
    min_height_m: float
    max_height_m: float
    area_m2: float
    contour: list[list[float]]
    point_count: int
    rejected_points: int
    density_pts_m2: float
    rmse_m: float
    max_error_m: float
    dispersion_m: float
    confidence: Literal["high", "medium", "low"]
    confidence_reasons: list[str]


class RoofEdge(BaseModel):
    kind: str
    plane_indices: list[int]
    start: list[float]
    end: list[float]
    length_m: float
    dihedral_deg: float | None = None
    status: Literal["derived", "to_confirm"]


class DetectedObstacle(BaseModel):
    kind: Literal["obstacle", "vegetation"]
    position: list[float]
    height_m: float
    width_m: float
    length_m: float
    point_count: int
    confidence: str
    status: Literal["to_confirm"] = "to_confirm"


class NeighbourBuilding(BaseModel):
    ring: list[list[float]]
    height_m: float
    source: str


class TerrainRef(BaseModel):
    available: bool
    origin_altitude_m: float | None = None
    min_m: float | None = None
    max_m: float | None = None
    grid_step_m: float | None = None
    heights: list[float] = Field(default_factory=list)
    cols: int | None = None
    rows: int | None = None
    source: SourceMetadata | None = None


class RoofModelResult(BaseModel):
    result_schema_version: str = RESULT_SCHEMA_VERSION
    engine_version: str = ENGINE_VERSION
    pipeline_version: str = PIPELINE_VERSION
    azimuth_convention: str = AZIMUTH_CONVENTION
    origin: OriginRef
    planes: list[RoofPlane] = Field(default_factory=list)
    edges: list[RoofEdge] = Field(default_factory=list)
    obstacles: list[DetectedObstacle] = Field(default_factory=list)
    neighbours: list[NeighbourBuilding] = Field(default_factory=list)
    terrain: TerrainRef
    building_envelope: list[list[float]] = Field(default_factory=list)
    point_cloud_preview: list[list[float]] = Field(default_factory=list)
    point_cloud_classification: list[int] = Field(default_factory=list)
    classification_legend: dict[str, str] = Field(default_factory=dict)
    quality: dict[str, Any] = Field(default_factory=dict)
    metrics: dict[str, Any] = Field(default_factory=dict)
    sources: list[SourceMetadata] = Field(default_factory=list)


class AnalyzeRequest(BaseModel):
    latitude: float
    longitude: float
    altitude_m: float | None = None
    footprint: list[list[float]] = Field(default_factory=list, description="Contour local (x,y) déjà confirmé")
    building_margin_m: float = 3.0
    environment_radius_m: float = 40.0
    include_point_cloud: bool = False
    parameters: dict[str, Any] = Field(default_factory=dict)


class AnalyzeResponse(BaseModel):
    ok: bool
    result: RoofModelResult | None = None
    error_code: str | None = None
    error_message: str | None = None
    retryable: bool = False
