"""Do not invoke git push or create any unlock file, even in tests."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]

class PushLockTests(unittest.TestCase):
    def test_installer_creates_blocking_hook_without_overwriting(self):
        self.assertIsNotNone(importlib.util.find_spec('scripts.install_hooks'), 'safe hook installer is missing')
        from scripts.install_hooks import install
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(['git', 'init', '-q', str(root)], check=True)
            install(root)
            hook = root / '.git/hooks/pre-push'
            self.assertTrue(os.access(hook, os.X_OK))
            result = subprocess.run([str(hook)], cwd=root, capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertIn('push locked', result.stderr)
            before = hook.read_bytes()
            install(root)
            self.assertEqual(before, hook.read_bytes())
            self.assertFalse((root / '.push_unlocked').exists())

    def test_actual_repo_hook_denies_while_locked(self):
        if (ROOT / '.push_unlocked').exists():
            self.skipTest('Do not run locked-state tests after human unlock')
        result = subprocess.run([str(ROOT / '.git/hooks/pre-push')], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn('push locked', result.stderr)
