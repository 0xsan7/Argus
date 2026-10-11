export const API = 'http://127.0.0.1:8000/api';
export async function request(path, options = {}, transport = fetch) {
  try {
    const response = await transport(API + path, {...options, signal: AbortSignal.timeout(options.method === 'POST' ? 75000 : 15000), cache:'no-store'});
    if (!response.ok) throw new Error(`Argus request failed (HTTP ${response.status}). Check the backend and retry.`);
    return await response.json();
  } catch (error) {
    if (error.message.startsWith('Argus request failed')) throw error;
    throw new Error('Cannot reach Argus. Start the local Argus backend on port 8000, then retry.');
  }
}
export function project(windows, model, threshold, defaultModel) {
  return windows.map(w => {
    const risk = w.risk_by_model?.[model] ?? (model === defaultModel ? w.risk : undefined);
    if (!Number.isFinite(risk)) throw new Error('Scores for this model are unavailable. Select another model.');
    return {...w, risk, flagged: risk >= threshold};
  });
}
export function validateNote(note, windowId) {
  if (!note || !['gemma','template'].includes(note.source) ||
      !['threat_summary','why_suspicious','caveat'].every(key=>typeof note[key]==='string' && note[key].trim()) ||
      !Array.isArray(note.suggested_checks) || !note.suggested_checks.length ||
      !note.suggested_checks.every(check=>typeof check==='string' && check.trim()) ||
      (note.window_id!==undefined && note.window_id!==windowId) ||
      (note.source==='gemma' && (typeof note.model!=='string' || !note.model.trim()))) {
    throw new Error('Argus returned an incomplete analyst note. Please retry; if it persists, check the local note service.');
  }
  return note;
}
