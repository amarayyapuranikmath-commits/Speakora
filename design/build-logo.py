"""Builds the Speakora logo system from one piece of geometry.

Run from the project folder:   python design/build-logo.py      (needs: pip install fonttools brotli)
Then:                          node design/build-icons.cjs      (PNGs for the website and the Android launcher / splash)

The mark is a speech bubble whose body holds a geometric S made of two stacked circular arcs: two voices, one conversation. The upper
bowl is white (navy on a white bubble) and the lower bowl is vivid blue. Everything is flat colour, and the wordmark is Inter Bold (SIL
Open Font License) converted to outlines, so the files do not depend on any installed font.
"""
import math
import os
import pathlib

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'design' / 'logo'
ANDROID_RES = ROOT / 'mobile' / 'android' / 'app' / 'src' / 'main' / 'res'
FONT = ROOT / 'frontend' / 'node_modules' / '@fontsource-variable' / 'inter' / 'files' / 'inter-latin-wght-normal.woff2'

NAVY = '#0B1F4B'
BLUE = '#2F6BFF'      # vivid blue of the mark
WHITE = '#FFFFFF'

# --- the mark, on a 64 x 64 grid -----------------------------------------------------------------------------------------------
BUBBLE = 'M18 4H46A14 14 0 0 1 60 18V38A14 14 0 0 1 46 52H28L13 61L18 52A14 14 0 0 1 4 38V18A14 14 0 0 1 18 4Z'
R = 8
C1, C2 = (32, 20), (32, 36)
STROKE = 8


def _pt(c, deg):
    return (c[0] + R * math.cos(math.radians(deg)), c[1] - R * math.sin(math.radians(deg)))


_s = _pt(C1, 35)           # upper terminal, up and to the right
_e = _pt(C2, -35)          # lower terminal, down and to the left... (mirrored below)
_e = (C2[0] - R * math.cos(math.radians(35)), C2[1] + R * math.sin(math.radians(35)))
S_TOP = f'M{_s[0]:.2f} {_s[1]:.2f}A{R} {R} 0 1 0 {C1[0]} {C1[1] + R}'
S_BOTTOM = f'M{C2[0]} {C2[1] - R}A{R} {R} 0 1 1 {_e[0]:.2f} {_e[1]:.2f}'
S_ALL = S_TOP + S_BOTTOM


def mark(variant, uid='m'):
    """The mark (64 x 64 grid) in one of: light, dark, mono-navy, mono-white."""
    s = f'stroke-width="{STROKE}" stroke-linecap="round" fill="none"'
    if variant == 'light':      # navy bubble, white upper bowl, blue lower bowl
        return f'<path d="{BUBBLE}" fill="{NAVY}"/><path d="{S_TOP}" stroke="{WHITE}" {s}/><path d="{S_BOTTOM}" stroke="{BLUE}" {s}/>'
    if variant == 'dark':       # white bubble, navy upper bowl, blue lower bowl: for navy or other dark backgrounds
        return f'<path d="{BUBBLE}" fill="{WHITE}"/><path d="{S_TOP}" stroke="{NAVY}" {s}/><path d="{S_BOTTOM}" stroke="{BLUE}" {s}/>'
    colour = NAVY if variant == 'mono-navy' else WHITE   # one colour, the S cut out so the background shows through
    return (f'<mask id="{uid}"><rect width="64" height="64" fill="#fff"/><path d="{S_ALL}" stroke="#000" {s}/></mask>'
            f'<path d="{BUBBLE}" fill="{colour}" mask="url(#{uid})"/>')


# --- the wordmark: Inter Bold converted to outlines ------------------------------------------------------------------------------
_font = instancer.instantiateVariableFont(TTFont(str(FONT)), {'wght': 700}, inplace=False)
_glyphs = _font.getGlyphSet()
_cmap = _font.getBestCmap()
_upem = _font['head'].unitsPerEm


def wordmark(text, size, x, baseline, tracking=-0.012):
    """Returns (path data, end x)."""
    scale = size / _upem
    d = []
    for ch in text:
        name = _cmap[ord(ch)]
        pen = SVGPathPen(_glyphs, ntos=lambda v: ('%.2f' % v).rstrip('0').rstrip('.'))
        _glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x, baseline)))
        d.append(pen.getCommands())
        x += _font['hmtx'][name][0] * scale + tracking * size
    return ''.join(d), x - tracking * size


WORD_SIZE, WORD_X, WORD_BASE = 38, 76, 41.5
WORD_D, WORD_END = wordmark('Speakora', WORD_SIZE, WORD_X, WORD_BASE)
WIDTH = math.ceil(WORD_END + 2)


def svg(w, h, body, title='Speakora'):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-label="{title}">'
            f'<title>{title}</title>{body}</svg>\n')


def horizontal(variant):
    ink = {'light': NAVY, 'dark': WHITE, 'mono-navy': NAVY, 'mono-white': WHITE}[variant]
    return svg(WIDTH, 64, mark(variant, 'h') + f'<path d="{WORD_D}" fill="{ink}"/>')


def app_icon(rounded=True):
    """Navy tile with the dark-variant mark: favicon, website icons, launcher."""
    rx = 14 if rounded else 0
    return svg(64, 64, f'<rect width="64" height="64" rx="{rx}" fill="{NAVY}"/>'
                       f'<g transform="translate(12.16 11.6) scale(0.62)">{mark("dark", "i")}</g>')


def placed_word(x, baseline, scale, fill):
    """The wordmark with its left end at x and its baseline at the given y, scaled."""
    return (f'<g transform="translate({x:.2f} {baseline:.2f}) scale({scale})">'
            f'<path d="{WORD_D}" fill="{fill}" transform="translate(-{WORD_X} -{WORD_BASE})"/></g>')


def splash():
    """Stacked logo for the launch screen: navy background, mark above the wordmark."""
    k = 1.1
    word_w = (WORD_END - WORD_X) * k
    return svg(320, 320, f'<rect width="320" height="320" fill="{NAVY}"/>'
                         f'<g transform="translate(112 70) scale(1.5)">{mark("dark", "s")}</g>'
                         + placed_word((320 - word_w) / 2, 244, k, WHITE))


def og():
    """Social-sharing card (1200 x 630). The tagline is live text, so it is rendered to a PNG rather than used as a logo file."""
    return svg(1200, 630, f'<rect width="1200" height="630" fill="{NAVY}"/>'
                          f'<g transform="translate(110 150) scale(3)">{mark("dark", "o")}</g>'
                          + placed_word(370, 318, 3.2, WHITE)
                          + f'<text x="372" y="400" fill="#C9D6F5" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="38">'
                            f'Practise speaking English with real people.</text>')


# --- Android vector drawables ---------------------------------------------------------------------------------------------------
def vector_foreground():
    """Adaptive-icon foreground: the dark-variant mark inside the 66dp safe zone of the 108dp canvas, on the navy background colour."""
    scale = 0.9
    off = (108 - 64 * scale) / 2
    return f'''<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by design/build-logo.py. Do not edit by hand. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <group android:translateX="{off:.2f}" android:translateY="{off:.2f}" android:scaleX="{scale}" android:scaleY="{scale}">
        <path android:fillColor="{WHITE}" android:pathData="{BUBBLE}" />
        <path android:strokeColor="{NAVY}" android:strokeWidth="{STROKE}" android:strokeLineCap="round" android:pathData="{S_TOP}" />
        <path android:strokeColor="{BLUE}" android:strokeWidth="{STROKE}" android:strokeLineCap="round" android:pathData="{S_BOTTOM}" />
    </group>
</vector>
'''


def write(path, text):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8', newline='\n')
    print('wrote', path.relative_to(ROOT))


if __name__ == '__main__':
    for v in ('light', 'dark', 'mono-navy', 'mono-white'):
        suffix = '' if v == 'light' else '-' + v
        write(OUT / f'speakora-symbol{suffix}.svg', svg(64, 64, mark(v)))
        write(OUT / f'speakora-logo{suffix}.svg', horizontal(v))
    write(OUT / 'speakora-app-icon.svg', app_icon())
    write(OUT / 'speakora-app-icon-square.svg', app_icon(False))
    write(OUT / 'speakora-splash.svg', splash())
    write(OUT / 'speakora-og.svg', og())
    write(ROOT / 'frontend' / 'public' / 'favicon.svg', app_icon())
    write(ANDROID_RES / 'drawable' / 'ic_launcher_foreground.xml', vector_foreground())
    write(ANDROID_RES / 'values' / 'ic_launcher_background.xml',
          f'<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">{NAVY}</color>\n</resources>\n')
    write(ANDROID_RES / 'mipmap-anydpi-v26' / 'ic_launcher.xml',
          '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
          '    <background android:drawable="@color/ic_launcher_background" />\n    <foreground android:drawable="@drawable/ic_launcher_foreground" />\n'
          '</adaptive-icon>\n')
    write(ANDROID_RES / 'mipmap-anydpi-v26' / 'ic_launcher_round.xml',
          '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
          '    <background android:drawable="@color/ic_launcher_background" />\n    <foreground android:drawable="@drawable/ic_launcher_foreground" />\n'
          '</adaptive-icon>\n')
