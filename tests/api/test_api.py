"""Contract tests exercise real shared fixtures and ASGI, without network access."""
import importlib
import json
import shutil
from pathlib import Path

import pytest

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "fixtures"
LIGHT_FIELDS = {
    "id", "sequence_id", "start_ts", "end_ts", "risk", "flagged",
    "truth_next", "evaluation_stage", "explanation_available",
}


def client_for(**kwargs):
    assert (ROOT / "backend/app/main.py").exists(), "L0 API implementation is missing"
    module = importlib.import_module("backend.app.main")
    return TestClient(module.create_app(**kwargs))


def test_fixture_core_routes_match_shared_contract(monkeypatch):
    monkeypatch.delenv("USE_FIXTURES", raising=False)
    with client_for() as client:
        assert client.get("/api/health").json() == {
            "ok": True, "artifacts": True, "ollama": False, "mode": "fixtures"
        }
        source = json.loads((FIXTURES / "timeline.json").read_text())
        assert client.get("/api/meta").json() == source["meta"]
        expected = [{key: w[key] for key in LIGHT_FIELDS} for w in source["windows"] if w["split"] == "test"]
        assert client.get("/api/timeline").json() == expected
        assert "ts" not in expected[0]
        assert client.get("/api/windows/0").json() == source["windows"][0]
        assert client.get("/api/metrics").json() == json.loads((FIXTURES / "metrics.json").read_text())


@pytest.mark.parametrize("damage", ["missing", "malformed", "invalid", "manifest", "stage_map", "empty_file"])
def test_damaged_bundle_degrades_without_hiding_health(tmp_path, damage):
    directory = tmp_path / "bundle"
    shutil.copytree(FIXTURES, directory)
    if damage == "missing":
        (directory / "timeline.json").unlink()
    elif damage == "malformed":
        (directory / "timeline.json").write_text('{bad-json')
    elif damage == "invalid":
        (directory / "metrics.json").write_text('{}')
    elif damage == "manifest":
        manifest = json.loads((directory / "run_manifest.json").read_text())
        manifest["run_id"] = "wrong-run"
        (directory / "run_manifest.json").write_text(json.dumps(manifest))
    elif damage == "stage_map":
        (directory / "stage_map.json").write_text('{}')
    else:
        (directory / "timeline.json").write_text('')
    with client_for(artifact_dir=directory, use_fixtures=False) as client:
        assert client.get("/api/health").json() == {
            "ok": True, "artifacts": False, "ollama": False, "mode": "artifacts"
        }
        for path in ["/api/meta", "/api/timeline", "/api/windows/0", "/api/metrics"]:
            response = client.get(path)
            assert response.status_code == 503
            assert response.json() == {"error": "Artifact bundle unavailable or invalid. Check the selected data directory and restart the API."}
            assert str(directory) not in response.text
            assert "Traceback" not in response.text


def test_timeline_filters_use_half_open_observation_start_interval():
    with client_for() as client:
        result = client.get("/api/timeline?split=test&from=20&to=50").json()
        assert [w["start_ts"] for w in result] == [20, 30, 40]
        assert client.get("/api/timeline?split=train&from=&to=").json() == []
        assert client.get("/api/timeline?from=9999").json() == []
        assert client.get("/api/timeline?from=20&to=20").json() == []


@pytest.mark.parametrize("path", [
    "/api/timeline?split=unknown", "/api/timeline?from=oops", "/api/timeline?to=NaN",
    "/api/timeline?from=inf", "/api/timeline?from=50&to=20", "/api/windows/oops",
])
def test_bad_parameters_have_safe_json_errors(path):
    with client_for() as client:
        response = client.get(path)
        assert response.status_code == 422
        assert set(response.json()) == {"error"}
        assert isinstance(response.json()["error"], str)


def test_unknown_window_and_route_and_disallowed_method_are_json():
    with client_for() as client:
        for path, method, status in [("/api/windows/999999", "get", 404), ("/api/unknown", "get", 404), ("/api/metrics", "post", 405)]:
            response = getattr(client, method)(path)
            assert response.status_code == status
            assert set(response.json()) == {"error"}


def test_valid_empty_bundle_and_optional_stage_map(tmp_path):
    from tests.schemas.validate import load_bundle, validate_bundle
    bundle = load_bundle(FIXTURES)
    bundle.pop("stage_map", None)
    bundle["timeline"]["windows"] = []
    metrics = bundle["metrics"]
    for key in ["test_windows", "positive_rate", "attack_onset_windows", "continuation_windows"]:
        metrics[key] = 0
    for model in metrics["models"]:
        for key in ["precision", "recall", "f1", "fpr", "onset_recall"]:
            model[key] = 0
        model["confusion"] = dict.fromkeys(["tp", "fp", "tn", "fn"], 0)
    assert validate_bundle(bundle)
    for key, value in bundle.items():
        (tmp_path / f"{key}.json").write_text(json.dumps(value))
    with client_for(artifact_dir=tmp_path, use_fixtures=False) as client:
        assert client.get("/api/health").json()["artifacts"] is True
        assert client.get("/api/timeline").json() == []
        assert client.get("/api/metrics").json()["test_windows"] == 0
        assert client.get("/api/windows/0").status_code == 404


def test_mode_switch_does_not_fall_back_to_fixtures(monkeypatch):
    monkeypatch.setenv("USE_FIXTURES", "0")
    with client_for() as client:
        assert client.get("/api/health").json()["mode"] == "artifacts"
