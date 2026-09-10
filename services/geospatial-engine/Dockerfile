# PVIA Geospatial Engine
# Native geospatial stack (PDAL / GDAL / PROJ) + FastAPI service.
#
# Build:  docker build -t pvia-geospatial-engine services/geospatial-engine
# Health: docker run --rm -p 8000:8000 pvia-geospatial-engine
#         curl localhost:8000/health
FROM debian:bookworm-slim AS base

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    PROJ_NETWORK=ON

# Native libraries. python3-pdal / python3-gdal expose the Python bindings that
# match the installed native libraries — pip wheels would not.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv \
      pdal libpdal-plugin-e57 python3-pdal \
      gdal-bin libgdal-dev python3-gdal \
      proj-bin proj-data \
      libgeos-dev \
      ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/engine

COPY pyproject.toml ./
COPY app ./app

RUN pip install --no-cache-dir \
      "fastapi>=0.115" "uvicorn[standard]>=0.30" "pydantic>=2.7" "httpx>=0.27" \
      "numpy>=1.26" "shapely>=2.0" "pyproj>=3.6" "rasterio>=1.3"

# Fail the build early if the native stack is not actually usable.
RUN python3 -c "import pdal, numpy, shapely, pyproj, rasterio; from osgeo import gdal; print('pdal', pdal.info.version); print('gdal', gdal.__version__); print('proj', pyproj.proj_version_str)"

EXPOSE 8000
ENV ENGINE_MODE=api

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/health || exit 1

# ENGINE_MODE=api    -> HTTP service (synchronous analysis endpoint)
# ENGINE_MODE=worker -> long-running job worker polling PVIA
CMD ["python3", "-m", "app.entrypoint"]
