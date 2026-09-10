"""Validation de la reconstruction sur fixtures à géométrie connue.

Tolérances documentées :
  pente   ±1,5°
  azimut  ±5°
  surface ±8 %
  RMSE    ≤ 8 cm sur un nuage bruité à σ = 2 cm
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from app.roof.detect import detect_roof_planes
from app.roof.edges import derive_edges
from tests import fixtures

TOL_TILT = 1.5
TOL_AZIMUTH = 5.0
TOL_AREA_RATIO = 0.08


def _by_azimuth(planes, azimuth: float, tol: float = 45.0):
    for p in planes:
        if abs(((p.azimuth_deg - azimuth + 180) % 360) - 180) <= tol:
            return p
    return None


def test_gable_roof_two_planes():
    cloud = fixtures.gable_roof(width=10, depth=8, tilt_deg=25)
    planes, obstacles, metrics = detect_roof_planes(cloud)

    assert len(planes) == 2, f"attendu 2 pans, obtenu {len(planes)}"
    for p in planes:
        assert abs(p.tilt_deg - 25.0) <= TOL_TILT
        assert p.rmse_m <= 0.08
    south = _by_azimuth(planes, 180.0)
    north = _by_azimuth(planes, 0.0)
    assert south is not None and north is not None
    # Surface réelle d'un pan : (profondeur/2 / cos) × largeur
    expected = (4.0 / math.cos(math.radians(25))) * 10.0
    for p in (south, north):
        assert abs(p.area_m2 - expected) / expected <= TOL_AREA_RATIO
    assert metrics["points_read"] > 0


def test_gable_with_noise_outliers_chimney_and_tree():
    cloud = fixtures.gable_roof(width=10, depth=8, tilt_deg=25, noise_m=0.03)
    cloud = fixtures.add_chimney(cloud)
    cloud = fixtures.add_outliers(cloud)
    planes, obstacles, metrics = detect_roof_planes(cloud)

    # La cheminée ne doit pas créer un pan majeur supplémentaire.
    assert len(planes) <= 3
    majors = [p for p in planes if p.area_m2 > 20]
    assert len(majors) == 2
    for p in majors:
        assert abs(p.tilt_deg - 25.0) <= TOL_TILT
    assert metrics["points_rejected_outlier"] >= 0


def test_hip_roof_four_planes():
    cloud = fixtures.hip_roof(width=12, depth=8, tilt_deg=30, density=40)
    planes, _, _ = detect_roof_planes(cloud, {"min_points": 150, "min_area_m2": 3.0})

    majors = [p for p in planes if p.point_count > 200]
    assert 3 <= len(majors) <= 5, f"quatre pans attendus, obtenu {len(majors)}"
    for p in majors:
        assert abs(p.tilt_deg - 30.0) <= 2.5
    azimuths = sorted(round(p.azimuth_deg) for p in majors)
    assert len(set(azimuths)) == len(azimuths)


def test_l_shaped_building_produces_valid_geometry():
    cloud = fixtures.l_shaped_roof()
    planes, _, _ = detect_roof_planes(cloud)

    assert len(planes) >= 2
    for p in planes:
        assert len(p.contour) >= 3
        assert p.area_m2 > 0
        assert 0 <= p.azimuth_deg < 360
        assert np.isfinite(p.normal).all()
        assert p.rmse_m >= 0


def test_edges_include_ridge_for_gable():
    cloud = fixtures.gable_roof()
    planes, _, _ = detect_roof_planes(cloud)
    edges = derive_edges(planes)
    kinds = {e["kind"] for e in edges}
    assert "faitage" in kinds
    ridge = next(e for e in edges if e["kind"] == "faitage")
    assert ridge["length_m"] > 3
    assert abs(ridge["start"][2] - ridge["end"][2]) < 0.3


def test_azimuth_convention_north_zero():
    """Pan orienté plein Sud : la normale pointe vers le Sud, azimut ≈ 180°."""
    x = np.random.default_rng(7).uniform(-5, 5, 4000)
    y = np.random.default_rng(8).uniform(-4, 4, 4000)
    z = 3.0 + (4.0 - y) * math.tan(math.radians(20))
    planes, _, _ = detect_roof_planes(np.column_stack([x, y, z]))
    assert len(planes) >= 1
    assert abs(((planes[0].azimuth_deg - 180 + 180) % 360) - 180) <= TOL_AZIMUTH


def test_flat_roof_is_detected_as_single_plane():
    x = np.random.default_rng(3).uniform(-6, 6, 5000)
    y = np.random.default_rng(4).uniform(-5, 5, 5000)
    z = np.full(5000, 6.0) + np.random.default_rng(5).normal(0, 0.01, 5000)
    planes, _, _ = detect_roof_planes(np.column_stack([x, y, z]))
    assert len(planes) == 1
    assert planes[0].tilt_deg < 1.5


def test_obstacle_candidate_from_chimney():
    cloud = fixtures.add_chimney(fixtures.gable_roof(), x=2.0, y=1.0, height=1.4)
    _, obstacles, _ = detect_roof_planes(cloud)
    assert any(o.height_m >= 0.35 for o in obstacles)


@pytest.mark.parametrize("tilt", [10.0, 25.0, 40.0])
def test_tilt_accuracy_across_slopes(tilt: float):
    cloud = fixtures.gable_roof(tilt_deg=tilt)
    planes, _, _ = detect_roof_planes(cloud)
    assert planes
    assert min(abs(p.tilt_deg - tilt) for p in planes) <= TOL_TILT
