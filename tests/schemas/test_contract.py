"""Shared artifact contract; fixtures are illustrative, never model evidence."""
import copy
import importlib
import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

class ContractTests(unittest.TestCase):
    def test_validator_exists_and_accepts_fixtures(self):
        self.assertIsNotNone(importlib.util.find_spec('tests.schemas.validate'), 'artifact validator is missing')
        validator = importlib.import_module('tests.schemas.validate')
        bundle = validator.load_bundle(ROOT / 'fixtures')
        validator.validate_bundle(bundle)

    def test_malformed_bundles_rejected(self):
        self.assertIsNotNone(importlib.util.find_spec('tests.schemas.validate'), 'artifact validator is missing')
        v = importlib.import_module('tests.schemas.validate')
        base = v.load_bundle(ROOT / 'fixtures')
        changes = {
            'missing baseline': lambda b: b['metrics']['models'].pop(),
            'wrong default risk': lambda b: b['timeline']['windows'][0].update(risk=0.999),
            'wrong flag': lambda b: b['timeline']['windows'][0].update(flagged=True),
            'missing contract field': lambda b: b['timeline']['meta'].pop('dataset_citation'),
            'future label in features': lambda b: b['run_manifest']['feature_names'].append('truth_next_lag0'),
            'unavailable explanation has features': lambda b: b['timeline']['windows'][0].update(top_features=[{'name':'flows_lag0','value':1,'shap':0.1}]),
            'confusion total drift': lambda b: b['metrics']['models'][0]['confusion'].update(tp=9999),
            'run id mismatch': lambda b: b['metrics'].update(run_id='different'),
            'threshold mismatch': lambda b: b['timeline']['meta'].update(default_threshold=0.3),
            'nonfinite score': lambda b: b['timeline']['windows'][0].update(risk=float('nan')),
        }
        for name, change in changes.items():
            with self.subTest(name=name):
                altered = copy.deepcopy(base)
                change(altered)
                with self.assertRaises((ValueError, AssertionError)):
                    v.validate_bundle(altered)

if __name__ == '__main__':
    unittest.main()
