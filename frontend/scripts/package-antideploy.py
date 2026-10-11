"""Package the complete deployable app, excluding local tools, secrets and training data."""
from pathlib import Path
from tarfile import open as tar_open

root = Path(__file__).resolve().parents[2]
paths = [root / name for name in (
    'Dockerfile', '.dockerignore', '.antideploy.json',
    'backend', 'frontend/src', 'frontend/package.json', 'frontend/package-lock.json',
    'frontend/index.html', 'frontend/tsconfig.json', 'frontend/vite.config.ts',
    'artifacts/timeline.json', 'artifacts/metrics.json', 'artifacts/run_manifest.json',
)]
files = []
for source in paths:
    if not source.exists():
        raise SystemExit(f'Missing required deployment input: {source.relative_to(root)}')
    if source.is_dir():
        files.extend(p for p in source.rglob('*') if p.is_file() and '__pycache__' not in p.parts)
    else:
        files.append(source)
if sum(p.stat().st_size for p in files) > 28 * 1024 * 1024:
    raise SystemExit('Deployment inputs exceed the Antideploy archive limit.')
output = root / 'runtime' / 'argus-antideploy.tar.gz'
output.parent.mkdir(exist_ok=True)
with tar_open(output, 'w:gz') as archive:
    for source in sorted(files):
        archive.add(source, arcname=str(source.relative_to(root)), recursive=False)
print(f'Packaged {len(files)} files, {sum(p.stat().st_size for p in files):,} source bytes: {output}')
