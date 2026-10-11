import json
import os
from pathlib import Path
from typing import Any, Dict, Optional

DEFAULT_CACHE_PATH = Path("runtime/notes_cache.json")

class NotesCache:
    def __init__(self, cache_path: Path | str | None = None):
        if cache_path is not None:
            self.cache_path = Path(cache_path)
        else:
            self.cache_path = Path(os.environ.get("NOTES_CACHE_PATH", DEFAULT_CACHE_PATH))

    def _cache_key(self, window_id: Any, model_name: str) -> str:
        return f"{window_id}:{model_name}"

    def load(self) -> Dict[str, Any]:
        """Loads cache dict. Missing or corrupt file starts empty."""
        if not self.cache_path.exists():
            return {}
        try:
            with open(self.cache_path, "r", encoding="utf-8") as f:
                content = f.read().strip()
                if not content:
                    return {}
                data = json.loads(content)
                if isinstance(data, dict):
                    return data
                return {}
        except Exception:
            return {}

    def get(self, window_id: Any, model_name: str) -> Optional[Dict[str, Any]]:
        """
        Read before calling Gemma.
        Checks for cached note keyed by window id and model name.
        Supports both composite key 'window_id:model_name' and nested 'data[window_id][model_name]'.
        """
        data = self.load()
        w_str = str(window_id)
        
        # Check composite key
        key = self._cache_key(window_id, model_name)
        if key in data and isinstance(data[key], dict):
            return data[key]
            
        # Check nested key
        if w_str in data and isinstance(data[w_str], dict) and model_name in data[w_str]:
            return data[w_str][model_name]
            
        return None

    def set(self, window_id: Any, model_name: str, note: Dict[str, Any]) -> None:
        """
        Write after a successful note.
        """
        data = self.load()
        key = self._cache_key(window_id, model_name)
        data[key] = note
        
        # Also maintain nested format for maximum compatibility
        w_str = str(window_id)
        if w_str not in data or not isinstance(data[w_str], dict):
            data[w_str] = {}
        data[w_str][model_name] = note

        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with open(self.cache_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        except Exception:
            pass

default_cache = NotesCache()

def get_cached_note(window_id: Any, model_name: str, cache_path: Path | str | None = None) -> Optional[Dict[str, Any]]:
    cache = NotesCache(cache_path) if cache_path else default_cache
    return cache.get(window_id, model_name)

def save_cached_note(window_id: Any, model_name: str, note: Dict[str, Any], cache_path: Path | str | None = None) -> None:
    cache = NotesCache(cache_path) if cache_path else default_cache
    cache.set(window_id, model_name, note)
