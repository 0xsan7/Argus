import pytest
from backend.app.services.note_prompt import build_prompt

def test_build_prompt_leakage_guard():
    # A fake window containing both allowed and forbidden fields
    window = {
        "id": 123,
        "start_ts": "2026-01-01T12:00:00Z",
        "end_ts": "2026-01-01T12:00:01Z",
        "split": "test",
        "risk": 0.85,
        "flagged": True,
        "evaluation_attack_category": "DoS",
        "top_features": [{"name": "dur", "value": 0.5}],
        "evaluation_stage": "Exploitation",
        "truth_now": 1,
        "truth_next": 1,
        "sequence_id": "seq_1",
        "counts": {"packets": 100},
        "risk_by_model": {"rf": 0.85}
    }
    
    prompt = build_prompt(window)
    
    assert isinstance(prompt, str)
    
    # Check that allowed fields are in the prompt
    assert "123" in prompt
    assert "2026-01-01T12:00:00Z" in prompt
    assert "DoS" in prompt
    
    # Check that forbidden fields are completely excluded
    assert "truth_now" not in prompt
    assert "truth_next" not in prompt
    assert "sequence_id" not in prompt
    assert "seq_1" not in prompt
    assert "counts" not in prompt
    assert "packets" not in prompt
    assert "risk_by_model" not in prompt

def test_build_prompt_missing_fields():
    # Should work even if some allowed fields are missing
    window = {
        "id": 456,
        "risk": 0.9,
        "truth_now": 0 # This should be stripped
    }
    
    prompt = build_prompt(window)
    assert "456" in prompt
    assert "0.9" in prompt
    assert "truth_now" not in prompt
