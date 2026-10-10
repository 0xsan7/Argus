from fastapi.testclient import TestClient
from backend.app.main import create_app
import pytest
from unittest.mock import patch, mock_open
import os
import json

app = create_app(use_fixtures=True)
client = TestClient(app)

@pytest.fixture
def mock_cache_path(tmp_path):
    with patch("backend.app.main.get_cached_note") as mock_get, \
         patch("backend.app.main.save_cached_note") as mock_save:
        mock_get.return_value = None
        yield mock_get, mock_save

def test_note_endpoint_unknown_window():
    response = client.post("/api/windows/9999/note")
    assert response.status_code == 404
    assert response.json() == {"error": "Not found"}

@patch("backend.app.main.generate_note")
def test_note_endpoint_ollama_mocked_gemma(mock_generate, mock_cache_path):
    mock_get, mock_save = mock_cache_path
    mock_generate.return_value = {
        "threat_summary": "Test threat",
        "why_suspicious": "Test why",
        "suggested_checks": ["Test check"],
        "caveat": "Test caveat"
    }
    response = client.post("/api/windows/0/note")
    assert response.status_code == 200
    data = response.json()
    assert data["source"] == "gemma"

@patch("backend.app.main.generate_note")
def test_note_endpoint_invalid_json_fallback(mock_generate, mock_cache_path):
    mock_generate.return_value = None
    response = client.post("/api/windows/1/note")
    assert response.status_code == 200
    data = response.json()
    assert data["source"] == "template"

@patch("backend.app.main.generate_note")
def test_note_endpoint_ollama_stopped_fallback(mock_generate, mock_cache_path):
    mock_generate.return_value = None
    response = client.post("/api/windows/2/note")
    assert response.status_code == 200
    data = response.json()
    assert data["source"] == "template"

@patch("backend.app.main.generate_note")
def test_note_endpoint_no_ground_truth_in_fallback(mock_generate, mock_cache_path):
    mock_generate.return_value = None
    # We will patch the json.load to inject our malicious window
    original_load = json.load
    def mocked_load(f, *args, **kwargs):
        data = original_load(f, *args, **kwargs)
        if isinstance(data, dict) and "windows" in data:
            data["windows"].append({
                "id": 999,
                "evaluation_stage": "Exploitation",
                "evaluation_attack_category": "DoS",
                "top_features": [{"name": "dur", "value": 1.0}]
            })
        return data
        
    with patch("json.load", side_effect=mocked_load):
        response = client.post("/api/windows/999/note")
        assert response.status_code == 200
        data = response.json()
        assert data["source"] == "template"
        note_str = str(data)
        assert "Exploitation" not in note_str
        assert "DoS" not in note_str

