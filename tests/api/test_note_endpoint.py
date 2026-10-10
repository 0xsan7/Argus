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


@patch("backend.app.services.gemma_client.urllib.request.urlopen")
def test_note_endpoint_wire_level_leakage(mock_urlopen, mock_cache_path):
    # We want to capture the request body passed to urlopen.
    # urlopen is called with a Request object.
    
    original_load = json.load
    def mocked_load(f, *args, **kwargs):
        data = original_load(f, *args, **kwargs)
        if isinstance(data, dict) and "windows" in data:
            data["windows"].append({
                "id": 888,
                "truth_now": 1,
                "truth_next": 1,
                "evaluation_stage": "Exploitation",
                "evaluation_attack_category": "DoS",
                "attack_cat": "DoS",
                "label": 1,
                "top_features": [{"name": "dur", "value": 1.0}]
            })
        return data

    with patch("json.load", side_effect=mocked_load):
        # Even if urlopen fails, we can inspect the mock call arguments.
        # But let's make it return a valid mock response to complete successfully.
        from unittest.mock import MagicMock
        mock_response = MagicMock()
        mock_response.read.return_value = b'{"response": "{\\"threat_summary\\": \\"ok\\"}"}'
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response
        
        response = client.post("/api/windows/888/note")
        assert response.status_code == 200
        
        # Now verify the request body sent to Ollama
        assert mock_urlopen.called
        request_obj = mock_urlopen.call_args[0][0]
        body = request_obj.data.decode("utf-8")
        
        forbidden_keys = [
            "truth_now", "truth_next", 
            "evaluation_attack_category", "evaluation_stage", 
            "attack_cat", "label"
        ]
        forbidden_values = ["Exploitation", "DoS"]
        
        for key in forbidden_keys:
            assert key not in body
        for val in forbidden_values:
            assert val not in body
