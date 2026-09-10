"""Tests COPC / PDAL.

Ils ne s'exécutent que si PDAL est réellement disponible (image Docker du
moteur). Hors conteneur, ils sont marqués « skipped », jamais « passed ».
"""

from __future__ import annotations

import json
import os

import numpy as np
import pytest

from app.config import Limits
from app.geometry.validation import CoverageError, TemporaryError
from app.lidar import copc

pdal_only = pytest.mark.skipif(not copc.pdal_available(), reason="PDAL absent de cet environnement")
LIMITS = Limits()


def test_missing_source_is_reported_not_faked():
    with pytest.raises(CoverageError):
        copc.read_copc_bbox("", (0, 0, 10, 10), LIMITS)


def test_no_pdal_reports_unavailable(monkeypatch):
    monkeypatch.setattr(copc, "pdal_available", lambda: False)
    with pytest.raises(TemporaryError):
        copc.read_copc_bbox("http://example.invalid/a.copc.laz", (0, 0, 10, 10), LIMITS)


def test_class_split_preserves_original_classification():
    ps = copc.PointSet(
        xyz=np.zeros((5, 3)),
        classification=np.array([2, 6, 5, 9, 1]),
        intensity=None,
        source_crs="EPSG:2154",
        points_read=5,
        duration_s=0.0,
    )
    masks = copc.split_classes(ps)
    assert masks["ground"].sum() == 1
    assert masks["building"].sum() == 1
    assert masks["vegetation"].sum() == 1
    assert masks["water"].sum() == 1
    assert masks["other"].sum() == 1
    # La classification d'origine n'est jamais réécrite.
    assert list(ps.classification) == [2, 6, 5, 9, 1]


@pdal_only
def test_local_copc_fixture_roundtrip(tmp_path):
    """Écrit un petit COPC local avec PDAL, puis le relit par BBOX."""
    import pdal

    n = 5000
    rng = np.random.default_rng(11)
    # Coordonnées Lambert-93 plausibles (Lyon).
    xs = rng.uniform(842_000, 842_040, n)
    ys = rng.uniform(6_519_000, 6_519_040, n)
    zs = rng.uniform(170, 178, n)
    cls = rng.choice([2, 6], size=n)
    arr = np.zeros(
        n,
        dtype=[("X", "f8"), ("Y", "f8"), ("Z", "f8"), ("Classification", "u1")],
    )
    arr["X"], arr["Y"], arr["Z"], arr["Classification"] = xs, ys, zs, cls

    path = tmp_path / "fixture.copc.laz"
    writer = pdal.Pipeline(
        json.dumps({"pipeline": [{"type": "writers.copc", "filename": str(path), "a_srs": "EPSG:2154"}]}),
        arrays=[arr],
    )
    writer.execute()
    assert os.path.exists(path)

    bbox = (842_010.0, 6_519_010.0, 842_020.0, 6_519_020.0)
    ps = copc.read_copc_bbox(str(path), bbox, LIMITS)
    assert ps.points_read > 0
    assert ps.source_crs == "EPSG:2154"
    assert ps.xyz[:, 0].min() >= bbox[0] - 0.001
    assert ps.xyz[:, 0].max() <= bbox[2] + 0.001
    assert set(np.unique(ps.classification)).issubset({2, 6})
