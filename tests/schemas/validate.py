"""Shared JSON Schema plus cross-artifact semantic checks. No network access."""
import json
import math
import sys
from pathlib import Path
import jsonschema

MODELS = {'oracle_persistence', 'lr_current', 'lr_lag', 'rf'}
SCHEMA_DIR = Path(__file__).resolve().parent

def load_bundle(directory):
    directory = Path(directory)
    result = {}
    for name in ['timeline', 'metrics', 'run_manifest', 'stage_map']:
        path = directory / (name + '.json')
        if name == 'stage_map' and not path.exists():
            continue
        result[name] = json.loads(path.read_text())
    return result

def _require(condition, message):
    if not condition:
        raise ValueError(message)

def _finite(value):
    if isinstance(value, float):
        _require(math.isfinite(value), 'nonfinite numeric value')
    elif isinstance(value, dict):
        for item in value.values():
            _finite(item)
    elif isinstance(value, list):
        for item in value:
            _finite(item)

def validate_bundle(bundle):
    for name in ['timeline', 'metrics', 'run_manifest']:
        _require(name in bundle, 'missing artifact: ' + name)
    for name, content in bundle.items():
        _finite(content)
        schema = json.loads((SCHEMA_DIR / (name + '.schema.json')).read_text())
        try:
            jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker()).validate(content)
        except jsonschema.ValidationError as exc:
            raise ValueError(name + ': ' + exc.message) from exc
    timeline, metrics, manifest = (bundle[k] for k in ['timeline', 'metrics', 'run_manifest'])
    meta = timeline['meta']
    _require(meta['run_id'] == metrics['run_id'] == manifest['run_id'], 'run_id mismatch')
    _require(meta['dataset'] == manifest['dataset'], 'dataset mismatch')
    _require(len(metrics['models']) == 4 and {m['name'] for m in metrics['models']} == MODELS, 'four distinct models required')
    by_model = {m['name']: m for m in metrics['models']}
    _require(meta['default_threshold'] == by_model[meta['default_model']]['threshold'], 'default threshold mismatch')
    _require(by_model['oracle_persistence']['threshold'] is None, 'oracle has no learned threshold')
    for name in MODELS - {'oracle_persistence'}:
        _require(by_model[name]['threshold'] is not None, 'missing predictive threshold')
    for feature in manifest['feature_names']:
        _require(not any(x in feature.lower() for x in ['label', 'attack_cat', 'truth_now', 'truth_next', 'evaluation_stage']), 'label-derived model feature')
    windows = timeline['windows']
    _require(len({w['id'] for w in windows}) == len(windows), 'duplicate window id')
    for w in windows:
        _require(w['end_ts'] > w['start_ts'], 'invalid window interval')
        _require(math.isclose(w['end_ts'] - w['start_ts'], meta['window_seconds']), 'window length mismatch')
        _require(w['risk'] == w['risk_by_model'][meta['default_model']], 'default risk mismatch')
        _require(w['flagged'] == (w['risk'] >= meta['default_threshold']), 'flag mismatch')
        _require(w['risk_by_model']['oracle_persistence'] == w['truth_now'], 'oracle truth mismatch')
        _require(w['explanation_available'] == bool(w['top_features']), 'explanation availability mismatch')
        magnitude = [abs(f['shap']) for f in w['top_features']]
        _require(magnitude == sorted(magnitude, reverse=True), 'SHAP not sorted')
    test = [w for w in windows if w['split'] == 'test']
    _require(len(test) == metrics['test_windows'], 'test count mismatch')
    onset = [w for w in test if w['truth_now'] == 0 and w['truth_next'] == 1]
    _require(len(onset) == metrics['attack_onset_windows'], 'onset count mismatch')
    _require(sum(w['truth_now'] == 1 and w['truth_next'] == 1 for w in test) == metrics['continuation_windows'], 'continuation count mismatch')
    if test:
        _require(math.isclose(sum(w['truth_next'] for w in test) / len(test), metrics['positive_rate'], abs_tol=1e-8), 'positive rate mismatch')
    for m in metrics['models']:
        threshold = .5 if m['name'] == 'oracle_persistence' else m['threshold']
        confusion = dict.fromkeys(['tp', 'fp', 'tn', 'fn'], 0)
        for w in test:
            prediction = w['risk_by_model'][m['name']] >= threshold
            key = ('tp' if w['truth_next'] else 'fp') if prediction else ('fn' if w['truth_next'] else 'tn')
            confusion[key] += 1
        _require(confusion == m['confusion'], 'confusion mismatch: ' + m['name'])
        tp, fp, tn, fn = (confusion[k] for k in ['tp','fp','tn','fn'])
        ratio = lambda a,b: a/b if b else 0.
        p, r = ratio(tp,tp+fp), ratio(tp,tp+fn)
        expected = {'precision':p,'recall':r,'f1':ratio(2*p*r,p+r),'fpr':ratio(fp,fp+tn),'onset_recall':ratio(sum(w['risk_by_model'][m['name']] >= threshold for w in onset),len(onset))}
        for key,value in expected.items():
            _require(math.isclose(m[key],value,abs_tol=1e-8), key+' inconsistent with timeline: '+m['name'])
    return True

if __name__ == '__main__':
    directory = Path(sys.argv[1] if len(sys.argv) > 1 else 'fixtures')
    validate_bundle(load_bundle(directory))
    print('PASS: schema and cross-artifact consistency:', directory)
