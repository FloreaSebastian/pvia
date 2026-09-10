"""Point d'entrée conteneur : API HTTP ou worker de jobs."""

from __future__ import annotations

import logging

from .config import settings

logging.basicConfig(level=logging.INFO)


def main() -> None:  # pragma: no cover
    if settings.mode == "worker":
        from .jobs.worker import main as worker_main

        worker_main()
        return
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=settings.port, log_level="info")


if __name__ == "__main__":  # pragma: no cover
    main()
