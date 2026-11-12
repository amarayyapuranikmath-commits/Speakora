#!/usr/bin/env python3
"""Lists every file of the website's production build (frontend/dist) with its raw and gzipped size, largest first.
Run `npm run build` in frontend first:   python tools/perf/dist-size.py [frontend/dist] [how many rows]"""
import glob
import gzip
import os
import sys

root = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', '..', 'frontend', 'dist')
rows_to_show = int(sys.argv[2]) if len(sys.argv) > 2 else 22
rows = []
for f in glob.glob(os.path.join(root, '**', '*'), recursive=True):
    if os.path.isfile(f):
        b = open(f, 'rb').read()
        compressible = f.endswith(('.js', '.css', '.svg', '.html', '.json', '.webmanifest'))
        rows.append((len(b), len(gzip.compress(b, 6)) if compressible else len(b), os.path.relpath(f, root).replace(os.sep, '/')))
rows.sort(reverse=True)
total, total_gz = sum(r[0] for r in rows), sum(r[1] for r in rows)
js = [r for r in rows if r[2].endswith('.js')]
print(f'TOTAL {total / 1024:.0f} KB raw, {total_gz / 1024:.0f} KB gzip, {len(rows)} files; JavaScript {sum(r[0] for r in js) / 1024:.0f} KB raw, {sum(r[1] for r in js) / 1024:.0f} KB gzip in {len(js)} files')
for raw, gz, name in rows[:rows_to_show]:
    print(f'{raw / 1024:9.1f} KB {gz / 1024:9.1f} KB gz  {name}')
