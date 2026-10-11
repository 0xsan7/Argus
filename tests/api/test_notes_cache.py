import json
import pytest
from pathlib import Path
from backend.app.services.notes_cache import NotesCache

def test_default_note_cache_is_runtime_not_immutable_artifacts():
    from backend.app.services.notes_cache import DEFAULT_CACHE_PATH
    assert DEFAULT_CACHE_PATH == Path('runtime/notes_cache.json')

def test_cache_missing_file_starts_empty(tmp_path: Path):
    cache_path = tmp_path / "notes_cache.json"
    cache = NotesCache(cache_path)
    
    assert cache.load() == {}
    assert cache.get(1, "gemma4:e2b-mlx") is None

def test_cache_corrupt_file_starts_empty(tmp_path: Path):
    cache_path = tmp_path / "notes_cache.json"
    cache_path.write_text("NOT A VALID JSON {{{")
    
    cache = NotesCache(cache_path)
    assert cache.load() == {}
    assert cache.get(1, "gemma4:e2b-mlx") is None

def test_cache_write_and_read(tmp_path: Path):
    cache_path = tmp_path / "notes_cache.json"
    cache = NotesCache(cache_path)
    
    sample_note = {
        "threat_summary": "High packet volume",
        "why_suspicious": "Sudden burst",
        "suggested_checks": ["Check IP"],
        "caveat": "Automated"
    }
    
    # Save note
    cache.set(42, "gemma4:e2b-mlx", sample_note)
    
    # File was created and contains valid JSON
    assert cache_path.exists()
    content = json.loads(cache_path.read_text())
    assert isinstance(content, dict)
    
    # Read back with int window_id
    cached = cache.get(42, "gemma4:e2b-mlx")
    assert cached == sample_note
    
    # Read back with str window_id
    cached_str = cache.get("42", "gemma4:e2b-mlx")
    assert cached_str == sample_note
    
    # Non-existent model returns None
    assert cache.get(42, "other_model") is None
    # Non-existent window returns None
    assert cache.get(999, "gemma4:e2b-mlx") is None
