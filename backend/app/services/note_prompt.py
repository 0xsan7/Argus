import json
from typing import Any, Dict, List

ALLOWED_FIELDS = {
    "risk",
    "top_features",
    "counts",
    "start_ts",
    "end_ts",
}

FORBIDDEN_FIELDS = {
    "truth_now",
    "truth_next",
    "evaluation_attack_category",
    "evaluation_stage",
    "label",
    "attack_cat",
    "id",
    "sequence_id",
    "split",
    "flagged",
    "risk_by_model",
    "explanation_available"
}

def sanitize_features(top_features: Any) -> List[Dict[str, Any]]:
    if not isinstance(top_features, list):
        return []
    sanitized = []
    for item in top_features:
        if isinstance(item, dict):
            feat = {}
            if "name" in item:
                feat["name"] = str(item["name"])
            if "value" in item:
                feat["value"] = item["value"]
            if feat:
                sanitized.append(feat)
    return sanitized

def build_prompt(window: dict) -> str:
    """
    Builds a strict prompt for the LLM without leaking labels or unauthorized fields.
    Accepts only an explicit allowlist: risk, top_features (name and value), counts, start_ts, end_ts.
    Never includes truth_now, truth_next, evaluation_attack_category, evaluation_stage, or any label/attack_cat.
    """
    payload: Dict[str, Any] = {}
    
    if "risk" in window:
        payload["risk"] = window["risk"]
    if "top_features" in window:
        payload["top_features"] = sanitize_features(window["top_features"])
    if "counts" in window and isinstance(window["counts"], dict):
        payload["counts"] = window["counts"]
    if "start_ts" in window:
        payload["start_ts"] = window["start_ts"]
    if "end_ts" in window:
        payload["end_ts"] = window["end_ts"]

    prompt = f"""You are a cybersecurity analyst assistant.
Analyze the following observed network traffic telemetry for an anomalous window and provide an analyst note.

Telemetry:
{json.dumps(payload, indent=2)}

Respond ONLY with a valid JSON object containing exactly these four keys:
- "threat_summary": A concise 1-sentence summary of the detected pattern.
- "why_suspicious": An explanation of why the observed features and traffic counts are anomalous.
- "suggested_checks": A list of 2-3 specific investigation steps for a SOC analyst.
- "caveat": A brief note stating that this is an automated heuristic and should be verified.

Do not include any other keys, markdown code fences, or text outside the JSON object.
"""
    return prompt
