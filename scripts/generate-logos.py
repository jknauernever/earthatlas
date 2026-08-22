#!/usr/bin/env python3
"""
EarthAtlas logo generator — produces PNG variants with transparency.
Uses Pillow + system Georgia fonts. Output → public/logos/
"""

from PIL import Image, ImageDraw, ImageFont
import math, os

OUT = "/Users/jknauer/Projects/earthatlas/public/logos"
os.makedirs(OUT, exist_ok=True)

# ── Brand colors ──────────────────────────────────────────────
MOSS        = (61,  90,  62)       # #3d5a3e
MOSS_LT     = (90, 125,  91)       # lighter moss for leaf detail
AMBER       = (184, 132,  42)      # #b8842a
INK         = (26,  22,  16)       # #1a1610
PARCHMENT   = (245, 240, 232)      # #f5f0e8
CREAM       = (250, 247, 242)      # #faf7f2
WHITE       = (255, 255, 255)
TRANSPARENT = (0, 0, 0, 0)

# ── Font paths ────────────────────────────────────────────────
FONT_DIR = "/System/Library/Fonts/Supplemental"
F_BOLD        = f"{FONT_DIR}/Georgia Bold.ttf"
F_BOLD_ITALIC = f"{FONT_DIR}/Georgia Bold Italic.ttf"
F_REGULAR     = f"{FONT_DIR}/Georgia.ttf"
F_ITALIC      = f"{FONT_DIR}/Georgia Italic.ttf"
F_MONO        = "/System/Library/Fonts/SFNSMono.ttf"

def font(path, size):
    return ImageFont.truetype(path, size)

# ── Draw the EarthAtlas icon (moss circle + leaf) ─────────────
def draw_icon(draw, cx, cy, r, bg_alpha=255):
    """Draw the circular icon centered at (cx, cy) with radius r."""
    # Outer circle — moss green
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], fill=(*MOSS, bg_alpha))

    # Leaf shape — drawn as a simple bezier-approximated polygon
    # Leaf points relative to center, scaled to radius
    s = r * 0.52
    leaf_pts = []
    # Stem bottom
    stem_y = cy + s * 0.75
    # Build leaf outline: left arc then right arc
    steps = 24
    for i in range(steps + 1):
        t = i / steps
        # Left side of leaf (tip to base)
        angle = math.pi * t
        lx = cx - math.sin(angle) * s * 0.48
        ly = cy - math.cos(angle) * s * 0.92
        leaf_pts.append((lx, ly))
    for i in range(steps + 1):
        t = i / steps
        angle = math.pi * t
        lx = cx + math.sin(angle) * s * 0.48
        ly = cy + math.cos(angle) * s * 0.92
        leaf_pts.append((lx, ly))

    draw.polygon(leaf_pts, fill=(*PARCHMENT, bg_alpha))

    # Central vein line
    vein_w = max(1, int(r * 0.04))
    draw.line([(cx, cy - s * 0.88), (cx, cy + s * 0.88)],
              fill=(*MOSS_LT, bg_alpha), width=vein_w)

    # 3 lateral veins each side
    for frac in [0.2, 0.45, 0.65]:
        vx = cx
        vy = cy - s * 0.88 + s * 1.76 * frac
        spread = s * 0.38 * (1 - frac * 0.5)
        angle_off = s * 0.22
        draw.line([(vx, vy), (vx - spread, vy - angle_off)],
                  fill=(*MOSS_LT, bg_alpha), width=max(1, vein_w - 1))
        draw.line([(vx, vy), (vx + spread, vy - angle_off)],
                  fill=(*MOSS_LT, bg_alpha), width=max(1, vein_w - 1))

def text_width(draw, text, fnt):
    bb = draw.textbbox((0, 0), text, font=fnt)
    return bb[2] - bb[0]

def text_height(draw, text, fnt):
    bb = draw.textbbox((0, 0), text, font=fnt)
    return bb[3] - bb[1]

def draw_wordmark(draw, x, y, size, ink_color, accent_color, italic_atlas=True):
    """Draw 'Earth' + 'Atlas' starting at (x, y baseline). Returns total width."""
    f_earth = font(F_BOLD, size)
    f_atlas = font(F_BOLD_ITALIC if italic_atlas else F_BOLD, size)
    w_earth = text_width(draw, "Earth", f_earth)
    draw.text((x, y), "Earth", font=f_earth, fill=ink_color)
    draw.text((x + w_earth, y), "Atlas", font=f_atlas, fill=accent_color)
    return w_earth + text_width(draw, "Atlas", f_atlas)

def draw_domain_suffix(draw, x, y, size, color):
    f = font(F_BOLD_ITALIC, size)
    draw.text((x, y), ".org", font=f, fill=color)
    return text_width(draw, ".org", f)

def draw_tagline(draw, x, y, size, color):
    f = font(F_REGULAR, size)
    draw.text((x, y), "Every species · Every place", font=f, fill=color)

# ═══════════════════════════════════════════════════════════════
# 1. HORIZONTAL LOGO — dark text, transparent bg
#    icon | Earth Atlas
# ═══════════════════════════════════════════════════════════════
def make_horizontal(suffix="dark", ink=INK, accent=AMBER, bg=None):
    SCALE = 2          # 2× for retina
    text_size = 52 * SCALE
    icon_r = 34 * SCALE
    pad = 20 * SCALE
    gap = 18 * SCALE

    # Measure text
    tmp = Image.new("RGBA", (1, 1))
    td = ImageDraw.Draw(tmp)
    f_e = font(F_BOLD, text_size)
    f_a = font(F_BOLD_ITALIC, text_size)
    w_earth = text_width(td, "Earth", f_e)
    w_atlas = text_width(td, "Atlas", f_a)
    t_h = text_height(td, "EarthAtlas", f_e)

    icon_diam = icon_r * 2
    total_w = pad + icon_diam + gap + w_earth + w_atlas + pad
    total_h = max(icon_diam, t_h) + pad * 2

    img = Image.new("RGBA", (total_w, total_h), (0, 0, 0, 0))
    if bg:
        img.paste(bg + (255,), (0, 0, total_w, total_h))
    d = ImageDraw.Draw(img)

    # Icon
    icon_cx = pad + icon_r
    icon_cy = total_h // 2
    draw_icon(d, icon_cx, icon_cy, icon_r)

    # Text — vertically centered
    tx = pad + icon_diam + gap
    ty = (total_h - t_h) // 2 - int(text_size * 0.08)
    d.text((tx, ty), "Earth", font=font(F_BOLD, text_size), fill=(*ink, 255))
    d.text((tx + w_earth, ty), "Atlas", font=font(F_BOLD_ITALIC, text_size), fill=(*accent, 255))

    img.save(f"{OUT}/logo-horizontal-{suffix}.png")
    print(f"  ✓ logo-horizontal-{suffix}.png  {total_w}×{total_h}px")

# ═══════════════════════════════════════════════════════════════
# 2. HORIZONTAL WITH .ORG
# ═══════════════════════════════════════════════════════════════
def make_horizontal_domain(suffix="dark", ink=INK, accent=AMBER, bg=None):
    SCALE = 2
    text_size = 52 * SCALE
    org_size  = 36 * SCALE
    icon_r = 34 * SCALE
    pad = 20 * SCALE
    gap = 18 * SCALE

    tmp = Image.new("RGBA", (1, 1))
    td = ImageDraw.Draw(tmp)
    f_e  = font(F_BOLD, text_size)
    f_a  = font(F_BOLD_ITALIC, text_size)
    f_o  = font(F_BOLD_ITALIC, org_size)
    w_e  = text_width(td, "Earth", f_e)
    w_a  = text_width(td, "Atlas", f_a)
    w_o  = text_width(td, ".org", f_o)
    t_h  = text_height(td, "EarthAtlas", f_e)

    icon_diam = icon_r * 2
    total_w = pad + icon_diam + gap + w_e + w_a + w_o + pad
    total_h = max(icon_diam, t_h) + pad * 2

    img = Image.new("RGBA", (total_w, total_h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    icon_cx = pad + icon_r
    draw_icon(d, icon_cx, total_h // 2, icon_r)

    tx = pad + icon_diam + gap
    ty = (total_h - t_h) // 2 - int(text_size * 0.08)
    d.text((tx, ty), "Earth", font=f_e, fill=(*ink, 255))
    d.text((tx + w_e, ty), "Atlas", font=f_a, fill=(*accent, 255))
    # .org sits baseline-aligned but slightly smaller
    org_ty = ty + t_h - text_height(td, ".org", f_o) + int(org_size * 0.08)
    d.text((tx + w_e + w_a, org_ty), ".org", font=f_o, fill=(*accent, 200))

    img.save(f"{OUT}/logo-horizontal-domain-{suffix}.png")
    print(f"  ✓ logo-horizontal-domain-{suffix}.png  {total_w}×{total_h}px")

# ═══════════════════════════════════════════════════════════════
# 3. STACKED LOGO — icon above wordmark
# ═══════════════════════════════════════════════════════════════
def make_stacked(suffix="dark", ink=INK, accent=AMBER):
    SCALE = 2
    text_size = 56 * SCALE
    icon_r = 52 * SCALE
    pad = 24 * SCALE
    gap = 20 * SCALE

    tmp = Image.new("RGBA", (1, 1))
    td = ImageDraw.Draw(tmp)
    f_e = font(F_BOLD, text_size)
    f_a = font(F_BOLD_ITALIC, text_size)
    w_e = text_width(td, "Earth", f_e)
    w_a = text_width(td, "Atlas", f_a)
    t_h = text_height(td, "EarthAtlas", f_e)
    total_text_w = w_e + w_a

    icon_diam = icon_r * 2
    total_w = max(icon_diam, total_text_w) + pad * 2
    total_h = pad + icon_diam + gap + t_h + pad

    img = Image.new("RGBA", (total_w, total_h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Icon centered
    icon_cx = total_w // 2
    icon_cy = pad + icon_r
    draw_icon(d, icon_cx, icon_cy, icon_r)

    # Wordmark centered
    tx = (total_w - total_text_w) // 2
    ty = pad + icon_diam + gap
    d.text((tx, ty), "Earth", font=f_e, fill=(*ink, 255))
    d.text((tx + w_e, ty), "Atlas", font=f_a, fill=(*accent, 255))

    img.save(f"{OUT}/logo-stacked-{suffix}.png")
    print(f"  ✓ logo-stacked-{suffix}.png  {total_w}×{total_h}px")

# ═══════════════════════════════════════════════════════════════
# 4. STACKED WITH TAGLINE
# ═══════════════════════════════════════════════════════════════
def make_stacked_tagline(suffix="dark", ink=INK, accent=AMBER, muted=None):
    if muted is None:
        muted = (122, 112, 96)
    SCALE = 2
    text_size = 56 * SCALE
    tag_size  = 20 * SCALE
    icon_r = 52 * SCALE
    pad = 24 * SCALE
    gap = 20 * SCALE
    tag_gap = 14 * SCALE

    tmp = Image.new("RGBA", (1, 1))
    td = ImageDraw.Draw(tmp)
    f_e = font(F_BOLD, text_size)
    f_a = font(F_BOLD_ITALIC, text_size)
    f_t = font(F_ITALIC, tag_size)
    w_e = text_width(td, "Earth", f_e)
    w_a = text_width(td, "Atlas", f_a)
    t_h = text_height(td, "EarthAtlas", f_e)
    tag_txt = "Every species · Every place"
    w_tag = text_width(td, tag_txt, f_t)
    tag_h = text_height(td, tag_txt, f_t)

    icon_diam = icon_r * 2
    total_w = max(icon_diam, w_e + w_a, w_tag) + pad * 2
    total_h = pad + icon_diam + gap + t_h + tag_gap + tag_h + pad

    img = Image.new("RGBA", (total_w, total_h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    icon_cx = total_w // 2
    draw_icon(d, icon_cx, pad + icon_r, icon_r)

    tx = (total_w - (w_e + w_a)) // 2
    ty = pad + icon_diam + gap
    d.text((tx, ty), "Earth", font=f_e, fill=(*ink, 255))
    d.text((tx + w_e, ty), "Atlas", font=f_a, fill=(*accent, 255))

    # Rule line
    rule_y = ty + t_h + tag_gap // 2
    rule_x1 = (total_w - w_tag) // 2
    rule_x2 = rule_x1 + w_tag
    d.line([(rule_x1, rule_y), (rule_x2, rule_y)], fill=(*accent, 80), width=2)

    # Tagline
    ttx = (total_w - w_tag) // 2
    tty = ty + t_h + tag_gap
    d.text((ttx, tty), tag_txt, font=f_t, fill=(*muted, 255))

    img.save(f"{OUT}/logo-stacked-tagline-{suffix}.png")
    print(f"  ✓ logo-stacked-tagline-{suffix}.png  {total_w}×{total_h}px")

# ═══════════════════════════════════════════════════════════════
# 5. ICON ONLY — multiple sizes
# ═══════════════════════════════════════════════════════════════
def make_icon(size_px):
    img = Image.new("RGBA", (size_px, size_px), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = size_px // 2 - 2
    draw_icon(d, size_px // 2, size_px // 2, r)
    img.save(f"{OUT}/logo-icon-{size_px}.png")
    print(f"  ✓ logo-icon-{size_px}.png  {size_px}×{size_px}px")

# ═══════════════════════════════════════════════════════════════
# 6. WORDMARK ONLY (no icon)
# ═══════════════════════════════════════════════════════════════
def make_wordmark_only(suffix="dark", ink=INK, accent=AMBER):
    SCALE = 2
    text_size = 72 * SCALE
    pad = 20 * SCALE

    tmp = Image.new("RGBA", (1, 1))
    td = ImageDraw.Draw(tmp)
    f_e = font(F_BOLD, text_size)
    f_a = font(F_BOLD_ITALIC, text_size)
    w_e = text_width(td, "Earth", f_e)
    w_a = text_width(td, "Atlas", f_a)
    t_h = text_height(td, "EarthAtlas", f_e)

    total_w = w_e + w_a + pad * 2
    total_h = t_h + pad * 2

    img = Image.new("RGBA", (total_w, total_h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.text((pad, pad), "Earth", font=f_e, fill=(*ink, 255))
    d.text((pad + w_e, pad), "Atlas", font=f_a, fill=(*accent, 255))

    img.save(f"{OUT}/logo-wordmark-{suffix}.png")
    print(f"  ✓ logo-wordmark-{suffix}.png  {total_w}×{total_h}px")

# ═══════════════════════════════════════════════════════════════
# 7. FAVICON — 32×32 and 64×64 (for use as favicon.png)
# ═══════════════════════════════════════════════════════════════
def make_favicon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = size // 2 - 1
    draw_icon(d, size // 2, size // 2, r)
    img.save(f"{OUT}/favicon-{size}.png")
    print(f"  ✓ favicon-{size}.png  {size}×{size}px")

# ═══════════════════════════════════════════════════════════════
# RUN ALL
# ═══════════════════════════════════════════════════════════════
print("\n🌿 Generating EarthAtlas logos...\n")

# Dark variants (dark ink on transparent — for light backgrounds)
make_horizontal("dark", ink=INK, accent=AMBER)
make_horizontal_domain("dark", ink=INK, accent=AMBER)
make_stacked("dark", ink=INK, accent=AMBER)
make_stacked_tagline("dark", ink=INK, accent=AMBER, muted=(122, 112, 96))
make_wordmark_only("dark", ink=INK, accent=AMBER)

# Light variants (light text on transparent — for dark backgrounds)
make_horizontal("light", ink=PARCHMENT, accent=AMBER)
make_horizontal_domain("light", ink=PARCHMENT, accent=AMBER)
make_stacked("light", ink=PARCHMENT, accent=AMBER)
make_stacked_tagline("light", ink=PARCHMENT, accent=AMBER, muted=(180, 170, 155))
make_wordmark_only("light", ink=PARCHMENT, accent=AMBER)

# Moss variants (all moss — single color, for watermarks etc)
make_horizontal("moss", ink=MOSS, accent=MOSS_LT)
make_stacked("moss", ink=MOSS, accent=MOSS_LT)
make_wordmark_only("moss", ink=MOSS, accent=MOSS_LT)

# Icons
for sz in [32, 64, 128, 256, 512]:
    make_icon(sz)
make_favicon(32)
make_favicon(64)

print(f"\n✅ Done — all logos saved to {OUT}/\n")
