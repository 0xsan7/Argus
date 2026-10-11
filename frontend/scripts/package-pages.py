"""Package the built frontend for Cloudflare Pages dashboard Direct Upload."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[2]
dist = root / 'frontend' / 'dist'
for name in ('index.html', '_worker.js', '_routes.json', '_headers'):
    if not (dist / name).is_file():
        raise SystemExit(f'Missing dist/{name}. Run npm --prefix frontend run build first.')
output = root / 'runtime' / 'argus-cloudflare-pages.zip'
output.parent.mkdir(exist_ok=True)
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for source in sorted(dist.rglob('*')):
        if source.is_file():
            archive.write(source, source.relative_to(dist))
print(f'Pages upload package: {output}')
