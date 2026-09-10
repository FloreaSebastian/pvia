"""Contrôles amont/aval : un résultat absurde est refusé, jamais publié."""

from __future__ import annotations

import numpy as np

from ..config import Limits


class GeometryError(Exception):
    """Erreur non rejouable : la donnée ou la géométrie est invalide."""

    code = "invalid_geometry"


class CoverageError(Exception):
    """Aucune donnée disponible sur cette emprise. Non rejouable."""

    code = "no_coverage"


class TemporaryError(Exception):
    """Erreur temporaire (réseau, service). Rejouable."""

    code = "temporary"


class LimitError(Exception):
    """Demande hors limites de sécurité. Non rejouable."""

    code = "limit_exceeded"


KNOWN_METRIC_UNITS = {"metre", "meter", "m", "metres", "meters"}


def validate_bbox(minx: float, miny: float, maxx: float, maxy: float, limits: Limits) -> None:
    if not all(np.isfinite([minx, miny, maxx, maxy])):
        raise GeometryError("Emprise non numérique.")
    width = maxx - minx
    height = maxy - miny
    if width <= 0 or height <= 0:
        raise GeometryError("Emprise vide.")
    if width > limits.max_bbox_side_m or height > limits.max_bbox_side_m:
        raise LimitError(
            f"Emprise trop grande ({width:.0f} × {height:.0f} m, maximum {limits.max_bbox_side_m:.0f} m)."
        )


def validate_crs_units(crs_name: str) -> None:
    """Refuse un CRS non métrique : le pipeline raisonne en mètres."""
    try:
        from pyproj import CRS

        crs = CRS.from_user_input(crs_name)
    except Exception as exc:  # pragma: no cover
        raise GeometryError(f"CRS source illisible : {crs_name}") from exc
    if crs.is_geographic:
        raise GeometryError(f"CRS source géographique ({crs_name}) : projection métrique requise avant traitement.")
    unit = (crs.axis_info[0].unit_name or "").lower() if crs.axis_info else ""
    if unit not in KNOWN_METRIC_UNITS:
        raise GeometryError(f"Unité de CRS non métrique : {unit or 'inconnue'}.")


def validate_point_cloud(points: np.ndarray, limits: Limits) -> None:
    if points.size == 0:
        raise CoverageError("Aucun point dans l'emprise demandée.")
    if points.shape[0] > limits.max_points:
        raise LimitError(f"Nuage trop volumineux ({points.shape[0]} points).")
    span_x = float(np.ptp(points[:, 0]))
    span_y = float(np.ptp(points[:, 1]))
    span_z = float(np.ptp(points[:, 2]))
    if max(span_x, span_y) > limits.max_building_span_m:
        raise GeometryError(
            f"Étendue incohérente ({span_x:.0f} × {span_y:.0f} m) : transformation de coordonnées suspecte."
        )
    if span_z > 500:
        raise GeometryError(f"Amplitude verticale incohérente ({span_z:.0f} m).")


def validate_building_dimensions(width_m: float, depth_m: float, limits: Limits) -> None:
    if not np.isfinite([width_m, depth_m]).all() or width_m <= 0 or depth_m <= 0:
        raise GeometryError("Dimensions de bâtiment invalides.")
    if width_m > limits.max_building_span_m or depth_m > limits.max_building_span_m:
        raise GeometryError(f"Bâtiment de {width_m:.0f} × {depth_m:.0f} m : résultat rejeté.")
