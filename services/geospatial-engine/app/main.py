"""API du moteur géospatial PVIA.

Le navigateur ne contacte jamais ce service : seul PVIA (fonction serveur) ou
le worker s'y adresse. Aucun secret n'est exposé par l'API.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse

from .config import settings
from .geometry.validation import CoverageError, GeometryError, LimitError, TemporaryError
from .pipelines.analyze_building import analyze, check_coverage
from .schemas import AnalyzeRequest, AnalyzeResponse
from .versions import ENGINE_VERSION, PIPELINE_VERSION, PROTOCOL_VERSION, RESULT_SCHEMA_VERSION, native_versions

logging.basicConfig(level=logging.INFO, format='{"level":"%(levelname)s","msg":%(message)r}')
log = logging.getLogger("pvia.engine")

app = FastAPI(title="PVIA Geospatial Engine", version=ENGINE_VERSION)


def _auth(secret: str | None) -> None:
    expected = settings.pvia_worker_secret
    if not expected:
        raise HTTPException(status_code=503, detail="Moteur non configuré.")
    if not secret or secret != expected:
        raise HTTPException(status_code=401, detail="Non autorisé.")


@app.get("/health")
def health() -> dict:
    native = native_versions()
    return {
        "status": "ok" if native["pdal"] and native["gdal"] and native["proj"] else "degraded",
        "version": ENGINE_VERSION,
        "protocol_version": PROTOCOL_VERSION,
        "pipeline_version": PIPELINE_VERSION,
        "result_schema_version": RESULT_SCHEMA_VERSION,
        "pdal_version": native["pdal"],
        "gdal_version": native["gdal"],
        "proj_version": native["proj"],
        "worker_configured": settings.worker_configured,
    }


@app.get("/v1/coverage")
def coverage(x_engine_secret: str | None = Header(default=None)) -> dict:
    _auth(x_engine_secret)
    return {"datasets": check_coverage()}


@app.post("/v1/analyze", response_model=AnalyzeResponse)
def analyze_endpoint(payload: AnalyzeRequest, x_engine_secret: str | None = Header(default=None)) -> AnalyzeResponse:
    _auth(x_engine_secret)
    trace = uuid.uuid4().hex[:12]
    try:
        result = analyze(payload)
        log.info(
            '{"trace":"%s","stage":"done","planes":%d,"points_used":%s}'
            % (trace, len(result.planes), result.metrics.get("points_used"))
        )
        return AnalyzeResponse(ok=True, result=result)
    except (CoverageError, GeometryError, LimitError) as exc:
        log.warning('{"trace":"%s","error_code":"%s"}' % (trace, exc.code))
        return AnalyzeResponse(ok=False, error_code=exc.code, error_message=str(exc), retryable=False)
    except TemporaryError as exc:
        log.warning('{"trace":"%s","error_code":"temporary"}' % trace)
        return AnalyzeResponse(ok=False, error_code="temporary", error_message=str(exc), retryable=True)
    except Exception:  # pragma: no cover
        log.exception('{"trace":"%s","error_code":"internal"}' % trace)
        return JSONResponse(  # type: ignore[return-value]
            status_code=500,
            content={
                "ok": False,
                "error_code": "internal",
                "error_message": f"Erreur interne du moteur (référence {trace}).",
                "retryable": False,
            },
        )
