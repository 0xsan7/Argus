import pytest
import re
from backend.app.services.note_prompt import build_prompt

def test_build_prompt_leakage_guard():
    # Window containing forbidden fields
    window = {
        "id": 123,
        "start_ts": "2026-01-01T12:00:00Z",
        "end_ts": "2026-01-01T12:00:01Z",
        "split": "test",
        "risk": 0.85,
        "flagged": True,
        "evaluation_attack_category": "Fuzzers",
        "evaluation_stage": "Reconnaissance",
        "label": 1,
        "attack_cat": "Fuzzers",
        "truth_now": 0,
        "truth_next": 1,
        "sequence_id": "seq_1",
        "counts": {"flows": 50, "packets": 100},
        "risk_by_model": {"rf": 0.85},
        "top_features": [
            {"name": "dur", "value": 0.5, "shap": 0.12},
            {"name": "sbytes", "value": 1024, "shap": 0.34}
        ]
    }
    
    prompt = build_prompt(window)
    assert isinstance(prompt, str)
    
    # Assert (a): window containing forbidden fields produces a prompt with none of them
    forbidden_terms = [
        "truth_now",
        "truth_next",
        "evaluation_attack_category",
        "evaluation_stage",
        "label",
        "attack_cat",
        "Fuzzers",
        "Reconnaissance",
        "sequence_id",
        "seq_1",
        "risk_by_model",
        "shap"
    ]
    for term in forbidden_terms:
        assert term not in prompt, f"Forbidden term '{term}' leaked into prompt!"
        
    # Allowed fields are present
    assert "0.85" in prompt
    assert "2026-01-01T12:00:00Z" in prompt
    assert "2026-01-01T12:00:01Z" in prompt
    assert "flows" in prompt
    assert "dur" in prompt
    assert "sbytes" in prompt

def test_build_prompt_requests_only_four_keys():
    # Assert (b): the prompt requests only the four keys
    window = {
        "risk": 0.9,
        "top_features": [{"name": "dur", "value": 1.2}],
        "counts": {"flows": 10},
        "start_ts": 100.0,
        "end_ts": 101.0
    }
    prompt = build_prompt(window)
    
    required_keys = ["threat_summary", "why_suspicious", "suggested_checks", "caveat"]
    for key in required_keys:
        assert f'"{key}"' in prompt
        
    # Check that it asks ONLY for these keys
    assert "exactly these four keys" in prompt
