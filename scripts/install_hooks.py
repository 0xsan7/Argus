"""Install a push lock in a fresh repository; never modify an existing hook."""
import os
from pathlib import Path
import subprocess

HOOK = '''#!/bin/sh
# Human-controlled hackathon push lock. Never bypass this hook.
root=$(git rev-parse --show-toplevel) || exit 1
if [ ! -f "$root/.push_unlocked" ]; then
  printf '%s\\n' 'push locked: only the human may unlock after the official hackathon start.' >&2
  exit 1
fi
exit 0
'''

def install(root):
    root = Path(root).resolve()
    actual = subprocess.check_output(['git','rev-parse','--show-toplevel'],cwd=root,text=True).strip()
    if Path(actual).resolve() != root:
        raise RuntimeError('Refusing to install outside this repository root')
    override = subprocess.run(['git','config','--get','core.hooksPath'],cwd=root,capture_output=True,text=True)
    if override.returncode == 0:
        raise RuntimeError('core.hooksPath is configured; refusing to alter or bypass it')
    hook = root / '.git/hooks/pre-push'
    if hook.exists():
        if hook.read_text() != HOOK or not os.access(hook,os.X_OK):
            raise RuntimeError('Existing hook differs or is not executable; explicit human permission required to edit it')
        print('PASS existing push lock retained unchanged')
        return
    hook.parent.mkdir(parents=True,exist_ok=True)
    with hook.open('x') as stream:
        stream.write(HOOK)
    hook.chmod(0o755)
    print('PASS push lock installed; no unlock file created')

if __name__ == '__main__':
    install(Path(__file__).resolve().parents[1])
