"""Generate the social-share card for /forestmonitor.

Outputs a 1200×630 PNG to public/forestmonitor-social.png. Runs at build
time (referenced via prebuild script or run manually before commits).

Design: dark forest-green gradient background, large "Forest Monitor"
wordmark in cream, EarthAtlas brand mark above, brief subhead describing
what the tool does, and a footer URL. Subtle decorative element: a soft
yellow→red gradient bar along the bottom alluding to the recency color
ramp the tool actually uses.
"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1200, 630
OUT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    '..', 'public', 'forestmonitor-social.png',
)

# Colors (deep forest → near-black with warm accent)
BG_TOP    = (12, 27, 22)
BG_BOTTOM = (4, 10, 8)
CREAM     = (244, 240, 226)
SOFT_WHITE = (220, 220, 215)
ACCENT_AMBER = (251, 191, 36)   # matches site's #fbbf24
ACCENT_GOLD  = (212, 175, 55)
MUTED_GREEN  = (78, 122, 86)

# Recency gradient stops (matches the tool's legend)
RAMP = [
    (0x45, 0x0a, 0x0a),
    (0x7f, 0x1d, 0x1d),
    (0xb9, 0x1c, 0x1c),
    (0xdc, 0x26, 0x26),
    (0xef, 0x44, 0x44),
    (0xfb, 0x92, 0x3c),
    (0xfb, 0xbf, 0x24),
]


def _lerp(a, b, t):
    return int(round(a + (b - a) * t))


def _color_at(t, stops):
    """t in [0,1] → color interpolated along `stops`."""
    if t <= 0:
        return stops[0]
    if t >= 1:
        return stops[-1]
    seg = t * (len(stops) - 1)
    i = int(seg)
    f = seg - i
    a, b = stops[i], stops[i + 1]
    return (_lerp(a[0], b[0], f), _lerp(a[1], b[1], f), _lerp(a[2], b[2], f))


def _vertical_gradient(top, bottom):
    img = Image.new('RGB', (W, H), bottom)
    px = img.load()
    for y in range(H):
        t = y / (H - 1)
        c = (_lerp(top[0], bottom[0], t),
             _lerp(top[1], bottom[1], t),
             _lerp(top[2], bottom[2], t))
        for x in range(W):
            px[x, y] = c
    return img


def _add_noise_texture(img, strength=4):
    """Subtle film-grain so the bg doesn't read as flat."""
    import random
    px = img.load()
    rng = random.Random(2026)
    for y in range(H):
        for x in range(W):
            if rng.random() > 0.4:
                continue
            r, g, b = px[x, y]
            d = rng.randint(-strength, strength)
            px[x, y] = (
                max(0, min(255, r + d)),
                max(0, min(255, g + d)),
                max(0, min(255, b + d)),
            )
    return img


def _draw_recency_ramp(img, y0, y1):
    """Draw the recency-color gradient bar at the bottom (decorative)."""
    px = img.load()
    height = y1 - y0
    for x in range(W):
        t = x / (W - 1)
        c = _color_at(t, RAMP)
        for y in range(y0, y1):
            # Fade in vertically at top of ramp for soft join
            edge_t = (y - y0) / height
            opacity = min(1.0, edge_t * 3)
            bg = px[x, y]
            px[x, y] = (
                _lerp(bg[0], c[0], opacity),
                _lerp(bg[1], c[1], opacity),
                _lerp(bg[2], c[2], opacity),
            )
    return img


def _glow_dot(img, cx, cy, radius, color, opacity=0.5):
    """Soft glow disk — adds visual interest near the wordmark."""
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse(
        [cx - radius, cy - radius, cx + radius, cy + radius],
        fill=(*color, int(255 * opacity)),
    )
    layer = layer.filter(ImageFilter.GaussianBlur(radius // 2))
    img.paste(layer, (0, 0), layer)
    return img


def _font(path, size):
    return ImageFont.truetype(path, size)


def main():
    # 1. Base gradient
    img = _vertical_gradient(BG_TOP, BG_BOTTOM).convert('RGB')

    # 2. Soft amber glow behind the wordmark
    img = _glow_dot(img, 260, 220, 320, ACCENT_AMBER, opacity=0.10)

    # 3. Subtle radial darkening at the edges (vignette effect)
    vignette = Image.new('L', (W, H), 0)
    vd = ImageDraw.Draw(vignette)
    cx, cy = W // 2, H // 2
    max_r = int(math.hypot(cx, cy))
    for r in range(max_r, 0, -2):
        alpha = int(70 * (r / max_r) ** 2)
        vd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=alpha)
    vignette = vignette.filter(ImageFilter.GaussianBlur(60))
    img.paste(Image.new('RGB', (W, H), (0, 0, 0)), (0, 0), vignette)

    # 4. Recency-ramp bar along the bottom (visual reference to the legend)
    img = _draw_recency_ramp(img, H - 70, H - 30)

    # 5. Film grain
    img = _add_noise_texture(img, strength=3)

    # Now text via ImageDraw
    d = ImageDraw.Draw(img)

    avenir = '/System/Library/Fonts/Avenir Next.ttc'
    georgia = '/System/Library/Fonts/Supplemental/Georgia.ttf'
    georgia_italic = '/System/Library/Fonts/Supplemental/Georgia Italic.ttf'

    # ── Brand mark (top): "EARTHATLAS" small caps + divider + "FOREST MONITOR" amber
    d.text((80, 78), 'EARTHATLAS', font=_font(avenir, 22), fill=SOFT_WHITE)
    # Divider bar
    d.rectangle([240, 87, 242, 102], fill=(255, 255, 255, 60))
    d.text((260, 78), 'FOREST MONITOR', font=_font(avenir, 22), fill=ACCENT_AMBER)

    # ── Main headline
    d.text(
        (80, 170),
        'Near-real-time',
        font=_font(georgia, 92),
        fill=CREAM,
    )
    d.text(
        (80, 270),
        'forest disturbance,',
        font=_font(georgia, 92),
        fill=CREAM,
    )
    d.text(
        (80, 370),
        'mapped globally.',
        font=_font(georgia_italic, 92),
        fill=ACCENT_AMBER,
    )

    # ── Subheading row of facts (small, muted)
    d.text(
        (80, 490),
        '30 m resolution  ·  updated every 12 hours  ·  every continent',
        font=_font(avenir, 24),
        fill=SOFT_WHITE,
    )

    # ── Footer URL above the ramp
    d.text(
        (80, 540),
        'earthatlas.org/forestmonitor',
        font=_font(avenir, 22),
        fill=(200, 200, 195),
    )

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    img.save(OUT, 'PNG', optimize=True)
    print(f'wrote {OUT}  ({os.path.getsize(OUT) / 1024:.1f} KB)')


if __name__ == '__main__':
    main()
