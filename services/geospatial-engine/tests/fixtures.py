"""Nuages synthétiques à géométrie exactement connue.

Ils servent de vérité terrain numérique : le moteur doit retrouver pente,
azimut, faîtage et surface avec les tolérances documentées dans README.md.
"""

from __future__ import annotations

import math

import numpy as np

RNG = np.random.default_rng(1234)


def _grid(width: float, depth: float, density: float) -> tuple[np.ndarray, np.ndarray]:
    step = 1.0 / math.sqrt(density)
    xs = np.arange(-width / 2, width / 2 + step, step)
    ys = np.arange(-depth / 2, depth / 2 + step, step)
    gx, gy = np.meshgrid(xs, ys)
    return gx.flatten(), gy.flatten()


def gable_roof(
    width: float = 10.0,
    depth: float = 8.0,
    eave_h: float = 3.0,
    tilt_deg: float = 25.0,
    density: float = 20.0,
    noise_m: float = 0.02,
) -> np.ndarray:
    """Toit deux pans, faîtage orienté Est-Ouest (pans Nord et Sud)."""
    x, y = _grid(width, depth, density)
    slope = math.tan(math.radians(tilt_deg))
    z = eave_h + (depth / 2 - np.abs(y)) * slope
    z = z + RNG.normal(0, noise_m, z.shape)
    return np.column_stack([x, y, z])


def hip_roof(
    width: float = 12.0,
    depth: float = 8.0,
    eave_h: float = 3.0,
    tilt_deg: float = 30.0,
    density: float = 25.0,
    noise_m: float = 0.02,
) -> np.ndarray:
    """Toit quatre pans (croupe) : la pente est portée par la distance au bord."""
    x, y = _grid(width, depth, density)
    slope = math.tan(math.radians(tilt_deg))
    dx = width / 2 - np.abs(x)
    dy = depth / 2 - np.abs(y)
    z = eave_h + np.minimum(dx, dy) * slope
    z = z + RNG.normal(0, noise_m, z.shape)
    return np.column_stack([x, y, z])


def l_shaped_roof(density: float = 20.0) -> np.ndarray:
    """Bâtiment en L : corps principal deux pans + aile plus basse."""
    main = gable_roof(width=12, depth=8, eave_h=3.2, tilt_deg=22, density=density)
    wing = gable_roof(width=6, depth=6, eave_h=2.4, tilt_deg=18, density=density)
    wing[:, 0] += 9.0
    wing[:, 1] += 7.0
    return np.vstack([main, wing])


def add_chimney(points: np.ndarray, x: float = 2.0, y: float = 1.0, size: float = 0.8, height: float = 1.2) -> np.ndarray:
    """Petite structure : ne doit jamais devenir un pan majeur."""
    n = 400
    px = RNG.uniform(x - size / 2, x + size / 2, n)
    py = RNG.uniform(y - size / 2, y + size / 2, n)
    base = float(np.median(points[:, 2]))
    pz = RNG.uniform(base + 0.3, base + height, n)
    return np.vstack([points, np.column_stack([px, py, pz])])


def add_tree(points: np.ndarray, x: float = -12.0, y: float = -10.0, radius: float = 2.5, height: float = 6.0) -> np.ndarray:
    n = 900
    ang = RNG.uniform(0, 2 * math.pi, n)
    rad = RNG.uniform(0, radius, n)
    px = x + rad * np.cos(ang)
    py = y + rad * np.sin(ang)
    pz = RNG.uniform(1.5, height, n)
    return np.vstack([points, np.column_stack([px, py, pz])])


def add_outliers(points: np.ndarray, count: int = 60, spread: float = 8.0) -> np.ndarray:
    idx = RNG.choice(points.shape[0], size=count, replace=False)
    noisy = points[idx].copy()
    noisy[:, 2] += RNG.normal(0, spread, count)
    return np.vstack([points, noisy])
