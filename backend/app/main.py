"""Read-only, offline Vigil artifact API. Start with backend.app.main:app."""
import math
import os
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from tests.schemas.validate import load_bundle, validate_bundle

ROOT = Path(__file__).resolve().parents[2]
LIGHT_FIELDS = (
    "id", "sequence_id", "start_ts", "end_ts", "risk", "flagged",
    "truth_next", "evaluation_stage", "explanation_available",
)


def create_app(*, artifact_dir: Path | None = None, use_fixtures: bool | None = None) -> FastAPI:
    fixtures = os.getenv("USE_FIXTURES", "1") != "0" if use_fixtures is None else use_fixtures
    directory = Path(artifact_dir) if artifact_dir is not None else ROOT / ("fixtures" if fixtures else "artifacts")
    try:
        bundle = load_bundle(directory)
        validate_bundle(bundle)
    except (OSError, ValueError, TypeError, KeyError):
        bundle = None
    app = FastAPI(title="Vigil", docs_url=None, redoc_url=None)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_request, exc):
        return JSONResponse(status_code=exc.status_code, content={"error": str(exc.detail)})

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request, _exc):
        return JSONResponse(status_code=422, content={"error": "Invalid request parameters."})

    def require_bundle():
        if bundle is None:
            raise HTTPException(503, "Artifact bundle unavailable or invalid. Check the selected data directory and restart the API.")
        return bundle

    data_routes = APIRouter(dependencies=[Depends(require_bundle)])

    @app.get("/api/health")
    def health():
        return {"ok": True, "artifacts": bundle is not None, "ollama": False, "mode": "fixtures" if fixtures else "artifacts"}

    @data_routes.get("/api/meta")
    def meta(data: dict = Depends(require_bundle)):
        return data["timeline"]["meta"]

    @data_routes.get("/api/timeline")
    def timeline(
        split: Literal["train", "val", "test"] = "test",
        from_ts: str | None = Query(None, alias="from"),
        to_ts: str | None = Query(None, alias="to"),
        data: dict = Depends(require_bundle),
    ):
        # Filtering is [from, to) on the INPUT observation start_ts, not target time.
        def bound(value):
            if value is None or value == "":
                return None
            try:
                number = float(value)
            except ValueError:
                raise HTTPException(422, "Time bounds must be finite seconds.") from None
            if not math.isfinite(number):
                raise HTTPException(422, "Time bounds must be finite seconds.")
            return number

        lower, upper = bound(from_ts), bound(to_ts)
        if lower is not None and upper is not None and lower > upper:
            raise HTTPException(422, "The from bound must not exceed the to bound.")
        return [
            {key: w[key] for key in LIGHT_FIELDS}
            for w in data["timeline"]["windows"]
            if w["split"] == split
            and (lower is None or w["start_ts"] >= lower)
            and (upper is None or w["start_ts"] < upper)
        ]

    @data_routes.get("/api/windows/{window_id}")
    def window(window_id: int, data: dict = Depends(require_bundle)):
        for item in data["timeline"]["windows"]:
            if item["id"] == window_id:
                return item
        raise HTTPException(404, "Window not found.")

    @data_routes.get("/api/metrics")
    def metrics(data: dict = Depends(require_bundle)):
        return data["metrics"]

    app.include_router(data_routes)
    return app


app = create_app()
