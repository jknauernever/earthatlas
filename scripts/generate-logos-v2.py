#!/usr/bin/env python3
"""
EarthAtlas logo generator v2
- Generates clean SVG files (vector, perfect at any size)
- Generates PNGs by rendering at 16x resolution then LANCZOS downsampling
- Proper bezier curves for the leaf icon
"""

from PIL import Image, ImageDraw, ImageFont
import math, os

OUT = "/Users/jknauer/Projects/earthatlas/public/logos"
os.makedirs(OUT, exist_ok=True)

# ── Brand colors ──────────────────────────────────────────────
MOSS      = (61,  90,  62)
AMBER     = (184, 132,  42)
INK       = (26,  22,  16)
PARCHMENT = (245, 240, 232)
CREAM     = (250, 247, 242)

# ── Fonts ─────────────────────────────────────────────────────
FDIR   = "/System/Library/Fonts/Supplemental"
F_BOLD = f"{FDIR}/Georgia Bold.ttf"
F_ITAL = f"{FDIR}/Georgia Bold Italic.ttf"
F_REG  = f"{FDIR}/Georgia.ttf"
F_REGI = f"{FDIR}/Georgia Italic.ttf"

def fnt(path, size): return ImageFont.truetype(path, size)
def tw(d, t, f):
    bb = d.textbbox((0,0), t, font=f); return bb[2]-bb[0]
def th(d, t, f):
    bb = d.textbbox((0,0), t, font=f); return bb[3]-bb[1]

# ── Bezier helpers ─────────────────────────────────────────────
def cubic_bezier(p0, p1, p2, p3, steps=120):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        mt = 1 - t
        x = mt**3*p0[0] + 3*mt**2*t*p1[0] + 3*mt*t**2*p2[0] + t**3*p3[0]
        y = mt**3*p0[1] + 3*mt**2*t*p1[1] + 3*mt*t**2*p2[1] + t**3*p3[1]
        pts.append((x, y))
    return pts

def leaf_polygon(cx, cy, r):
    """
    Build a smooth leaf polygon using cubic bezier curves.
    The leaf is upright, pointed at top, rounded at bottom-center,
    with a subtle stem indent.
    """
    # Key points (relative to center, scaled by r)
    tip_top    = (cx,        cy - r*0.88)   # top tip
    tip_bot    = (cx,        cy + r*0.72)   # bottom (stem base)
    left_wide  = (cx - r*0.46, cy + r*0.05) # widest point left
    right_wide = (cx + r*0.46, cy + r*0.05) # widest point right

    # LEFT side: top tip → left bulge → bottom
    left_pts = cubic_bezier(
        tip_top,
        (cx - r*0.18, cy - r*0.52),   # upper-left control
        (cx - r*0.52, cy - r*0.18),   # mid-left control
        left_wide,
        steps=80
    ) + cubic_bezier(
        left_wide,
        (cx - r*0.48, cy + r*0.35),   # lower-left control
        (cx - r*0.14, cy + r*0.72),   # bottom approach left
        tip_bot,
        steps=80
    )

    # RIGHT side: bottom → right bulge → top tip
    right_pts = cubic_bezier(
        tip_bot,
        (cx + r*0.14, cy + r*0.72),   # bottom approach right
        (cx + r*0.48, cy + r*0.35),   # lower-right control
        right_wide,
        steps=80
    ) + cubic_bezier(
        right_wide,
        (cx + r*0.52, cy - r*0.18),   # mid-right control
        (cx + r*0.18, cy - r*0.52),   # upper-right control
        tip_top,
        steps=80
    )

    return left_pts + right_pts

def draw_icon_hq(draw, cx, cy, r, scale=1):
    """Draw icon at scale (call at high res then downsample)."""
    # Circle
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], fill=(*MOSS, 255))

    # Leaf — cream fill
    leaf = leaf_polygon(cx, cy, r * 0.62)
    draw.polygon(leaf, fill=(*PARCHMENT, 255))

    # Central vein
    vw = max(2, int(r * 0.045))
    vein_top = (cx, cy - r*0.62*0.86)
    vein_bot = (cx, cy + r*0.62*0.70)
    draw.line([vein_top, vein_bot], fill=(*MOSS, 255), width=vw)

    # Lateral veins (3 pairs)
    for frac, spread, rise in [(0.18, 0.30, 0.18), (0.42, 0.34, 0.14), (0.64, 0.26, 0.10)]:
        vy_base = vein_top[1] + (vein_bot[1] - vein_top[1]) * frac
        vx = cx
        vy = vy_base
        spread_px = r * 0.62 * spread
        rise_px   = r * 0.62 * rise
        lw = max(1, int(vw * 0.65))
        draw.line([(vx, vy), (vx - spread_px, vy - rise_px)], fill=(*MOSS, 220), width=lw)
        draw.line([(vx, vy), (vx + spread_px, vy - rise_px)], fill=(*MOSS, 220), width=lw)

