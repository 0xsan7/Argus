import os
import json
import urllib.request
import urllib.error

def is_complete_note(note) -> bool:
    return (
        isinstance(note, dict)
        and all(isinstance(note.get(key), str) and note[key].strip() for key in ('threat_summary', 'why_suspicious', 'caveat'))
        and isinstance(note.get('suggested_checks'), list)
        and bool(note['suggested_checks'])
        and all(isinstance(check, str) and check.strip() for check in note['suggested_checks'])
    )

def generate_note(prompt: str) -> dict | None:
    """Calls Ollama to generate a note."""
    model = os.environ.get("OLLAMA_MODEL", "gemma4:e2b-mlx")
    url = "http://localhost:11434/api/generate"
    
    payload = {
        "model": model,
        "prompt": prompt,
        "format": "json",
        "stream": False,
        "options": {
            "temperature": 0
        }
    }
    
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    
    timeout_s = float(os.environ.get("GEMMA_TIMEOUT_S", "60"))
    
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as response:
            result = json.loads(response.read().decode("utf-8"))
            return json.loads(result.get("response", "{}"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None

def build_template_note(top_features: list, stage: str | None = None) -> dict:
    """Fallback template builder when Ollama is unavailable."""
    feature_names = [f.get("name", "unknown") for f in top_features] if top_features else []
    
    summary = "Automated alert triggered by threshold violation."
    if feature_names:
        summary = f"Flagged primarily due to features: {', '.join(feature_names[:3])}."
        
    suspicious = "Traffic patterns deviated from the expected baseline."

    return {
        "source": "template",
        "threat_summary": summary,
        "why_suspicious": suspicious,
        "suggested_checks": [
            "Verify source IP reputation.",
            "Check for corresponding alerts in other security systems.",
            "Review full PCAP if available for this window."
        ],
        "caveat": "Automated note. Verify before acting."
    }
