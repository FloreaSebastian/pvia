"""CRS, garde-fous et refus des résultats absurdes."""

from __future__ import annotations

import numpy as np
import pytest

from app.config import Limits
from app.geometry import crs as crsmod
from app.geometry.validation import (
    GeometryError,
    LimitError,
    validate_bbox,
    validate_building_dimensions,
    validate_point_cloud,
)

pyproj_only = pytest.mark.skipif(not crsmod.HAS_PYPROJ, reason="pyproj absent de l'environnement")
LIMITS = Limits()


def test_working_crs_selection():
    assert crsmod.pick_working_crs(48.85, 2.35) == "EPSG:2154"   # Paris
    assert crsmod.pick_working_crs(-33.9, 18.4).startswith("EPSG:327")  # Le Cap


@pyproj_only
def test_local_round_trip_precision():
    origin = crsmod.make_origin(48.8566, 2.3522, 35.0)
    local = np.array([[10.0, -5.0, 4.0], [0.0, 0.0, 0.0], [-25.0, 30.0, -2.0]])
    world = crsmod.local_to_world(origin, local)
    back = crsmod.world_to_local(origin, world[:, [0, 1, 2]], "EPSG:4326")
    # world_to_local attend (x=lon, y=lat) exprimés en EPSG:4326.
    assert np.allclose(back[:, 2], local[:, 2], atol=1e-6)
    assert np.allclose(back[:, :2], local[:, :2], atol=0.01)


@pyproj_only
def test_bbox_from_origin_is_square_in_metres():
    origin = crsmod.make_origin(45.75, 4.85, 200.0)
    minx, miny, maxx, maxy = crsmod.bbox_local_to_source(origin, 50.0, "EPSG:2154")
    assert abs((maxx - minx) - 100.0) < 1.0
    assert abs((maxy - miny) - 100.0) < 1.0


def test_bbox_limit_rejects_huge_area():
    with pytest.raises(LimitError):
        validate_bbox(0, 0, 100_000, 100_000, LIMITS)


def test_point_cloud_span_guard():
    absurd = np.array([[0, 0, 0], [850_000, 0, 0], [0, 10, 2]], dtype=float)
    with pytest.raises(GeometryError):
        validate_point_cloud(absurd, LIMITS)


def test_building_dimension_guard():
    validate_building_dimensions(12.0, 8.0, LIMITS)
    with pytest.raises(GeometryError):
        validate_building_dimensions(850_000.0, 8.0, LIMITS)
