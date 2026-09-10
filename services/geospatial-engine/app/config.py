"""Configuration du moteur. Aucun secret n'est jamais renvoyé par l'API."""

from __future__ import annotations

import os
from dataclasses import dataclass


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, "") or default)
    except ValueError:
        return default


@dataclass(frozen=True)
class Limits:
    """Garde-fous : personne ne demande le traitement de toute la France."""

    max_bbox_side_m: float = _float("MAX_BBOX_SIDE_M", 400.0)
    max_points: int = _int("MAX_POINTS", 4_000_000)
    max_points_returned: int = _int("MAX_POINTS_RETURNED", 120_000)
    max_download_mb: int = _int("MAX_DOWNLOAD_MB", 512)
    job_timeout_s: int = _int("JOB_TIMEOUT_S", 900)
    http_timeout_s: int = _int("HTTP_TIMEOUT_S", 60)
    max_building_span_m: float = _float("MAX_BUILDING_SPAN_M", 300.0)


@dataclass(frozen=True)
class Settings:
    mode: str = os.environ.get("ENGINE_MODE", "api")
    port: int = _int("PORT", 8000)
    worker_id: str = os.environ.get("WORKER_ID", os.environ.get("HOSTNAME", "worker-local"))
    # URL de l'application PVIA (endpoints /api/public/geospatial/*)
    pvia_base_url: str = os.environ.get("PVIA_BASE_URL", "")
    pvia_worker_secret: str = os.environ.get("PVIA_WORKER_SECRET", "")
    poll_interval_s: float = _float("POLL_INTERVAL_S", 5.0)
    limits: Limits = Limits()

    @property
    def worker_configured(self) -> bool:
        return bool(self.pvia_base_url and self.pvia_worker_secret)


settings = Settings()
