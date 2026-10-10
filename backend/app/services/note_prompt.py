import json

ALLOWED_FIELDS = {
    "id",
    "start_ts",
    "end_ts",
    "split",
    "risk",
    "flagged",
    "evaluation_attack_category",
    "top_features",
    "evaluation_stage"
}

FORBIDDEN_FIELDS = {
    "truth_now",
    "truth_next",
    "sequence_id",
    "counts",
    "risk_by_model",
    "explanation_available"
}

def build_prompt(window: dict) -> str:
    """
    Builds a strict prompt for the LLM, ensuring no ground truth or labels are leaked.
    """
    sanitized_window = {}
    for key, value in window.items():
        if key in ALLOWED_FIELDS:
            sanitized_window[key] = value

    prompt = f"""You are a security analyst evaluating a network traffic window.
Analyze the following window data and provide a concise alert note.

Window Data:
{json.dumps(sanitized_window, indent=2)}

Please return your response EXACTLY as a JSON object with the following keys:
- "source": must be exactly the string "llm"
- "threat_summary": A one-sentence summary of the threat.
- "why_suspicious": A brief explanation of why this window was flagged based on its features.
- "suggested_checks": A list of 2-3 actionable strings for investigating this further.
- "caveat": A brief warning that this is an automated LLM note and should be verified.

Do not include any markdown formatting, code blocks, or extra text outside the JSON object.
"""
    return prompt
