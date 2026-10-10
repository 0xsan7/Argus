from fastapi.testclient import TestClient
from backend.app.main import create_app
import pytest
from unittest.mock import patch
import os

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
    
    # In fixtures, window ID 0 exists
    response = client.post("/api/windows/0/note")
    assert response.status_code == 200
    
    data = response.json()
    assert data["window_id"] == 0
    assert data["source"] == "gemma"
    assert data["model"] == "gemma4:e2b-mlx"
    assert data["threat_summary"] == "Test threat"
    mock_save.assert_called_once()
    
    # Subsequent call should hit cache if we simulate cache returning
    mock_get.return_value = data
    cached_response = client.post("/api/windows/0/note")
    assert cached_response.status_code == 200
    assert cached_response.json()["source"] == "gemma"

@patch("backend.app.main.generate_note")
def test_note_endpoint_invalid_json_fallback(mock_generate, mock_cache_path):
    # Simulate generate_note failing to parse JSON and returning None
    mock_generate.return_value = None
    
    # In fixtures, window ID 1 exists
    response = client.post("/api/windows/1/note")
    assert response.status_code == 200
    
    data = response.json()
    assert data["window_id"] == 1
    assert data["source"] == "template"
    assert data["model"] is None
    assert "threat_summary" in data

@patch("backend.app.main.generate_note")
def test_note_endpoint_ollama_stopped_fallback(mock_generate, mock_cache_path):
    # Simulate connection error returning None
    mock_generate.return_value = None
    
    # In fixtures, window ID 2 exists
    response = client.post("/api/windows/2/note")
    assert response.status_code == 200
    
    data = response.json()
    assert data["window_id"] == 2
    assert data["source"] == "template"
    assert data["model"] is None

