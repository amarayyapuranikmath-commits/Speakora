#!/usr/bin/env python3
"""
Adds the grammar lessons listed in grammar/new-lessons.json to backend/src/main/resources/curriculum/grammar-N.json, each right after the lesson it
names ("after"), and applies the title changes in "renames". Safe to run again: a lesson id that is already present is skipped.
The backend (Curriculum.java) validates every lesson again when it loads.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent.parent / 'backend' / 'src' / 'main' / 'resources' / 'curriculum'


def write(path, data):
    header = {k: v for k, v in data.items() if k != 'lessons'}
    head = json.dumps(header, ensure_ascii=False)[1:-1]
    body = ',\n'.join('    ' + json.dumps(l, ensure_ascii=False) for l in data['lessons'])
    path.write_text('{\n  ' + head.replace('", "', '",\n  "') + f',\n  "lessons": [\n{body}\n  ]\n}}\n', encoding='utf-8')


def main():
    spec = json.loads((HERE / 'grammar' / 'new-lessons.json').read_text(encoding='utf-8'))
    files = {lvl: json.loads((OUT / f'grammar-{lvl}.json').read_text(encoding='utf-8')) for lvl in range(1, 6)}
    added = 0
    for entry in spec['lessons']:
        data = files[entry['level']]
        lesson = entry['lesson']
        ids = [l['id'] for l in data['lessons']]
        if lesson['id'] in ids:
            continue
        if entry['after'] not in ids:
            sys.exit(f"ERROR: {lesson['id']}: there is no lesson {entry['after']} to insert it after")
        data['lessons'].insert(ids.index(entry['after']) + 1, lesson)
        added += 1
    for lid, title in spec['renames'].items():
        for data in files.values():
            for l in data['lessons']:
                if l['id'] == lid:
                    l['title'] = title
    for lvl, data in files.items():
        write(OUT / f'grammar-{lvl}.json', data)
    print(f'added {added} lessons; grammar now has {sum(len(d["lessons"]) for d in files.values())} lessons')


if __name__ == '__main__':
    main()
