"""Arêtes dérivées de l'intersection des plans détectés.

Seules les arêtes suffisamment fiables sont produites ; les autres sont
marquées « à confirmer » plutôt que supprimées silencieusement.
"""

from __future__ import annotations

import math

import numpy as np

from .detect import PlaneResult


def _segment_overlap(a: PlaneResult, b: PlaneResult) -> float:
    ax = np.array([p[0] for p in a.contour])
    ay = np.array([p[1] for p in a.contour])
    bx = np.array([p[0] for p in b.contour])
    by = np.array([p[1] for p in b.contour])
    ox = min(ax.max(), bx.max()) - max(ax.min(), bx.min())
    oy = min(ay.max(), by.max()) - max(ay.min(), by.min())
    # Deux pans adjacents se touchent : le recouvrement est franc sur un axe et
    # nul sur l'autre. Un recouvrement négatif sur les deux axes = pans éloignés.
    if min(ox, oy) < -1.0:
        return 0.0
    return float(max(max(ox, oy), 0.0))


def derive_edges(planes: list[PlaneResult]) -> list[dict]:
    edges: list[dict] = []
    for i in range(len(planes)):
        for j in range(i + 1, len(planes)):
            a, b = planes[i], planes[j]
            na = np.array(a.normal)
            nb = np.array(b.normal)
            direction = np.cross(na, nb)
            norm = float(np.linalg.norm(direction))
            if norm < 1e-6:
                continue  # plans parallèles : pas d'arête d'intersection
            overlap = _segment_overlap(a, b)
            if overlap < 0.5:
                continue
            direction = direction / norm
            # Point de la droite d'intersection le plus proche des centroïdes.
            A = np.array([na, nb, direction])
            rhs = np.array([-a.d, -b.d, float(np.dot(direction, (np.array(a.centroid) + np.array(b.centroid)) / 2))])
            try:
                point = np.linalg.solve(A, rhs)
            except np.linalg.LinAlgError:
                continue

            half = overlap / 2 + 1.0
            p1 = point - direction * half
            p2 = point + direction * half
            mid_z = float((p1[2] + p2[2]) / 2)
            horizontal = abs(direction[2]) < 0.15
            higher = mid_z > max(a.centroid[2], b.centroid[2]) - 0.5
            angle = math.degrees(math.acos(max(-1.0, min(1.0, float(np.dot(na, nb))))))

            if horizontal and higher:
                kind = "faitage"
            elif horizontal:
                kind = "noue"
            elif higher:
                kind = "aretier"
            else:
                kind = "noue"

            confident = overlap >= 2.0 and angle > 8.0
            edges.append(
                {
                    "kind": kind,
                    "plane_indices": [a.index, b.index],
                    "start": [float(p1[0]), float(p1[1]), float(p1[2])],
                    "end": [float(p2[0]), float(p2[1]), float(p2[2])],
                    "length_m": float(np.linalg.norm(p2 - p1)),
                    "dihedral_deg": angle,
                    "status": "derived" if confident else "to_confirm",
                }
            )

    # Égouts : bord bas de chaque pan (toujours dérivable).
    for plane in planes:
        pts = np.array(plane.contour)
        if pts.shape[0] < 2:
            continue
        low = pts[np.argsort(pts[:, 2])][:2]
        edges.append(
            {
                "kind": "egout",
                "plane_indices": [plane.index],
                "start": [float(low[0][0]), float(low[0][1]), float(low[0][2])],
                "end": [float(low[1][0]), float(low[1][1]), float(low[1][2])],
                "length_m": float(np.linalg.norm(low[1] - low[0])),
                "dihedral_deg": None,
                "status": "to_confirm",
            }
        )
    return edges
