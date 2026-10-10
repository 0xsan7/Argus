import os
import json
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from pathlib import Path
from backend.app.services.note_prompt import build_prompt
from backend.app.services.gemma_client import generate_note, build_template_note
from backend.app.services.notes_cache import get_cached_note, save_cached_note

LIGHT_FIELDS = {
    "id", "sequence_id", "start_ts", "end_ts", "risk", "flagged",
    "truth_next", "evaluation_stage", "explanation_available",
}

def create_app(use_fixtures: bool | None = None, artifact_dir: Path | None = None):
    if use_fixtures is None:
        use_fixtures = os.environ.get("USE_FIXTURES", "1") == "1"

    app = FastAPI(title="Argus API")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    app.state.use_fixtures = use_fixtures
    
    def get_data_dir():
        if app.state.use_fixtures:
            return Path("fixtures")
        if artifact_dir is not None:
            return artifact_dir
        return Path("artifacts")

    def get_file(name: str):
        path = get_data_dir() / f"{name}.json"
        if not path.exists():
            return None
        try:
            with open(path) as f:
                return json.load(f)
        except Exception:
            return None

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException):
        if exc.status_code == 404:
            return JSONResponse(status_code=404, content={"error": "Not found"})
        if exc.status_code == 405:
            return JSONResponse(status_code=405, content={"error": "Method not allowed"})
        return JSONResponse(status_code=exc.status_code, content={"error": str(exc.detail)})

    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        return JSONResponse(status_code=500, content={"error": str(exc)})
        
    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        return JSONResponse(status_code=422, content={"error": "Validation error"})

    def is_artifacts_valid():
        timeline = get_file("timeline")
        metrics = get_file("metrics")
        manifest = get_file("run_manifest")
        
        if not timeline or not metrics or not manifest:
            return False
            
        try:
            r1 = timeline.get("meta", {}).get("run_id")
            r2 = metrics.get("run_id")
            r3 = manifest.get("run_id")
            if not r1 or not r2 or not r3 or r1 != r2 or r1 != r3:
                return False
                
            path = get_data_dir() / "stage_map.json"
            if path.exists():
                try:
                    with open(path) as f:
                        sm = json.load(f)
                    if not sm:
                        return False
                except:
                    return False
        except:
            return False
            
        return True

    @app.get("/api/health")
    def health():
        mode = "fixtures" if app.state.use_fixtures else "artifacts"
        artifacts_ok = is_artifacts_valid()
        if app.state.use_fixtures:
            artifacts_ok = True
            
        return {
            "ok": True,
            "artifacts": artifacts_ok,
            "ollama": False,
            "mode": mode
        }

    def require_artifacts():
        if not is_artifacts_valid():
            return JSONResponse(
                status_code=503, 
                content={"error": "Artifact bundle unavailable or invalid. Check the selected data directory and restart the API."}
            )

    @app.get("/api/meta")
    def get_meta():
        err = require_artifacts()
        if err: return err
        timeline = get_file("timeline")
        return timeline.get("meta", {})

    @app.get("/api/timeline")
    def get_timeline(request: Request, split: str | None = None):
        if split is not None and split not in ["test", "val", "train"]:
            return JSONResponse(status_code=422, content={"error": "Invalid split"})
            
        err = require_artifacts()
        if err: return err
            
        from_ts_str = request.query_params.get("from")
        to_ts_str = request.query_params.get("to")
        
        from_ts = None
        to_ts = None
        
        if from_ts_str:
            try:
                from_ts = float(from_ts_str)
                if str(from_ts) in ['inf', '-inf', 'nan']:
                    raise ValueError()
            except ValueError:
                return JSONResponse(status_code=422, content={"error": "Invalid from"})
                
        if to_ts_str:
            try:
                to_ts = float(to_ts_str)
                if str(to_ts) in ['inf', '-inf', 'nan']:
                    raise ValueError()
            except ValueError:
                return JSONResponse(status_code=422, content={"error": "Invalid to"})
                
        if from_ts is not None and to_ts is not None and from_ts > to_ts:
            return JSONResponse(status_code=422, content={"error": "from > to"})
            
        timeline = get_file("timeline")
        windows = timeline.get("windows", [])
        
        filtered = []
        for w in windows:
            if split is not None and w.get("split") != split:
                continue
            if from_ts is not None and w.get("start_ts", 0) < from_ts:
                continue
            if to_ts is not None and w.get("start_ts", 0) >= to_ts:
                continue
            
            # return lightweight representation
            filtered.append({k: w[k] for k in LIGHT_FIELDS if k in w})
            
        return filtered

    @app.get("/api/windows/{window_id}")
    def get_window(window_id: str):
        err = require_artifacts()
        if err: return err
        
        try:
            window_id_int = int(window_id)
        except ValueError:
            return JSONResponse(status_code=422, content={"error": "Invalid id"})
            
        timeline = get_file("timeline")
        for w in timeline.get("windows", []):
            if w["id"] == window_id_int:
                return w
        return JSONResponse(status_code=404, content={"error": "Not found"})


    @app.post("/api/windows/{window_id}/note")
    def create_window_note(window_id: str):
        err = require_artifacts()
        if err: return err
        
        try:
            window_id_int = int(window_id)
        except ValueError:
            return JSONResponse(status_code=422, content={"error": "Invalid id"})
            
        timeline = get_file("timeline")
        window = None
        for w in timeline.get("windows", []):
            if w["id"] == window_id_int:
                window = w
                break
                
        if window is None:
            return JSONResponse(status_code=404, content={"error": "Not found"})
            
        model_name = os.environ.get("OLLAMA_MODEL", "gemma4:e2b-mlx")
        
        # Check cache
        cached = get_cached_note(window_id_int, model_name)
        if cached:
            resp = dict(cached)
            resp["window_id"] = window_id_int
            if "source" not in resp:
                resp["source"] = "gemma"
            if "model" not in resp:
                resp["model"] = model_name
            return resp
            
        prompt = build_prompt(window)
        note = generate_note(prompt)
        
        if note and isinstance(note, dict) and "threat_summary" in note:
            note["source"] = "gemma"
            note["model"] = model_name
            save_cached_note(window_id_int, model_name, note)
            
            resp = dict(note)
            resp["window_id"] = window_id_int
            return resp
            
        # Fallback
        top_features = window.get("top_features", [])
        template_note = build_template_note(top_features)
        
        template_note["model"] = None
        
        resp = dict(template_note)
        resp["window_id"] = window_id_int
        return resp

    @app.get("/api/metrics")
    def get_metrics():
        err = require_artifacts()
        if err: return err
        metrics = get_file("metrics")
        return metrics

    return app

USE_FIXTURES = os.environ.get("USE_FIXTURES", "1") == "1"
app = create_app(use_fixtures=USE_FIXTURES)
