#!/usr/bin/env python3
"""
Lists every problem in a words/more-N.txt or phrasal/more-N.txt file at once (the generator stops at the first), so a batch can be fixed in one pass.
  python tools/curriculum/check_batch.py tools/curriculum/words/more-2.txt
"""
import re
import sys
from pathlib import Path


def main(path):
    p = Path(path)
    words = 'words' in p.parts
    seen = set()
    bad = 0
    for n, raw in enumerate(p.read_text(encoding='utf-8').splitlines(), 1):
        if not raw.strip() or raw.lstrip().startswith('#'):
            continue
        f = [x.strip() for x in raw.split('|')]
        want = 9 if words else 12
        if len(f) != want:
            print(f'{n}: expected {want} fields, found {len(f)}: {raw[:70]}')
            bad += 1
            continue
        key = f[0].lower()
        if key in seen:
            print(f'{n}: {f[0]} appears twice in this file')
            bad += 1
        seen.add(key)
        if words:
            word, example = f[0], f[4]
            if not re.search(r'\b' + re.escape(word) + r'\b', example, flags=re.I):
                print(f'{n}: example of "{word}" does not contain it exactly: {example}')
                bad += 1
        else:
            verb = f[0]
            for ex in (f[7], f[8]):
                if '[[' not in ex and not re.search(r'\b' + re.escape(verb) + r'\b', ex, flags=re.I):
                    print(f'{n}: example of "{verb}" needs the verb exactly or [[brackets]]: {ex}')
                    bad += 1
    print(f'{bad} problem(s) in {p.name}')


if __name__ == '__main__':
    main(sys.argv[1])
