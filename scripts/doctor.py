"""Offline preflight. Subprocesses contact no remote services."""
import importlib, importlib.metadata, platform, shutil, subprocess
from pathlib import Path
print('PASS Python', platform.python_version(), '(3.12-compatible source; installed runtime may differ)')
for name in ['fastapi','uvicorn','httpx','jsonschema','pandas','numpy','sklearn','yaml','pytest','shap']:
    try:
        mod = importlib.import_module(name)
        print('PASS', name, importlib.metadata.version({'sklearn':'scikit-learn', 'yaml':'pyyaml'}.get(name,name)))
    except Exception as exc:
        print('WARN', name, str(exc))
for command in [['node','--version'],['npm','--version'],['ollama','list']]:
    if not shutil.which(command[0]):
        print('WARN missing', command[0]); continue
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=15)
        print('PASS' if result.returncode == 0 else 'WARN', ' '.join(command), (result.stdout or result.stderr).strip())
    except Exception as exc:
        print('WARN', command[0], str(exc))
root = Path(__file__).resolve().parents[1]
print('PASS push locked' if not (root / '.push_unlocked').exists() else 'WARN human unlock file present')
for directory in [root / 'data/raw', Path('/Users/santiagojerald/Desktop/dataset')]:
    paths = list(directory.glob('*')) if directory.exists() else []
    print('PASS' if paths else 'WARN', 'dataset files in', directory)
    for p in paths:
        if p.is_file(): print(' ', p.name, p.stat().st_size, 'bytes')
