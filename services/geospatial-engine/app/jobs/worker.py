"""Worker : réclame un job PVIA, exécute le pipeline, publie le résultat.

Le worker ne fait jamais confiance à un `company_id` transmis par un
navigateur : il ne connaît que le job réservé par PVIA côté serveur.
"""

from __future__ import annotations

import logging
import time

import httpx

from ..config import settings
from ..geometry.validation import CoverageError, GeometryError, LimitError, TemporaryError
from ..pipelines.analyze_building import analyze
from ..schemas import AnalyzeRequest
from ..versions import ENGINE_VERSION, PIPELINE_VERSION, RESULT_SCHEMA_VERSION

log = logging.getLogger("pvia.worker")


class PviaClient:
    def __init__(self, base_url: str, secret: str, worker_id: str) -> None:
        self.base = base_url.rstrip("/")
        self.headers = {"x-worker-secret": secret, "content-type": "application/json"}
        self.worker_id = worker_id
        self.http = httpx.Client(timeout=30)

    def claim(self) -> dict | None:
        res = self.http.post(
            f"{self.base}/api/public/geospatial/claim",
            headers=self.headers,
            json={"worker_id": self.worker_id, "job_types": ["ANALYZE_BUILDING_3D"]},
        )
        res.raise_for_status()
        body = res.json()
        return body.get("job")

    def progress(self, job_id: str, stage: str, percent: int, label: str) -> bool:
        res = self.http.post(
            f"{self.base}/api/public/geospatial/progress",
            headers=self.headers,
            json={
                "worker_id": self.worker_id,
                "job_id": job_id,
                "stage": stage,
                "progress_percent": percent,
                "label": label,
            },
        )
        res.raise_for_status()
        return bool(res.json().get("cancel_requested"))

    def finish(self, job_id: str, payload: dict) -> None:
        res = self.http.post(
            f"{self.base}/api/public/geospatial/finish",
            headers=self.headers,
            json={"worker_id": self.worker_id, "job_id": job_id, **payload},
        )
        res.raise_for_status()


class Cancelled(Exception):
    pass


def run_job(client: PviaClient, job: dict) -> None:
    job_id = job["id"]
    params = job.get("params") or {}
    started = time.perf_counter()

    def progress(stage: str, percent: int, label: str) -> None:
        if client.progress(job_id, stage, percent, label):
            raise Cancelled()

    try:
        request = AnalyzeRequest(
            latitude=params["latitude"],
            longitude=params["longitude"],
            altitude_m=params.get("altitude_m"),
            footprint=params.get("footprint") or [],
            environment_radius_m=float(params.get("environment_radius_m", 40.0)),
            include_point_cloud=bool(params.get("include_point_cloud", False)),
            parameters=params.get("parameters") or {},
        )
        result = analyze(request, progress)
        client.finish(
            job_id,
            {
                "status": "COMPLETED",
                "result": result.model_dump(),
                "metrics": {**result.metrics, "worker_duration_s": round(time.perf_counter() - started, 3)},
                "result_version": RESULT_SCHEMA_VERSION,
                "pipeline_version": PIPELINE_VERSION,
                "engine_version": ENGINE_VERSION,
            },
        )
    except Cancelled:
        client.finish(job_id, {"status": "CANCELLED", "error_code": "cancelled", "error_message": "Annulé."})
    except (CoverageError, GeometryError, LimitError) as exc:
        client.finish(
            job_id,
            {"status": "FAILED", "error_code": exc.code, "error_message": str(exc), "retryable": False},
        )
    except TemporaryError as exc:
        client.finish(
            job_id,
            {"status": "FAILED", "error_code": "temporary", "error_message": str(exc), "retryable": True},
        )
    except Exception as exc:  # pragma: no cover
        log.exception("job %s failed", job_id)
        client.finish(
            job_id,
            {
                "status": "FAILED",
                "error_code": "internal",
                "error_message": f"Erreur interne : {type(exc).__name__}",
                "retryable": False,
            },
        )


def main() -> None:  # pragma: no cover - boucle de service
    if not settings.worker_configured:
        raise SystemExit("PVIA_BASE_URL et PVIA_WORKER_SECRET sont requis en mode worker.")
    client = PviaClient(settings.pvia_base_url, settings.pvia_worker_secret, settings.worker_id)
    log.info("worker %s démarré", settings.worker_id)
    while True:
        try:
            job = client.claim()
        except Exception as exc:
            log.warning("claim impossible : %s", type(exc).__name__)
            time.sleep(settings.poll_interval_s * 2)
            continue
        if not job:
            time.sleep(settings.poll_interval_s)
            continue
        log.info("job %s (%s) réservé", job.get("id"), job.get("job_type"))
        run_job(client, job)
