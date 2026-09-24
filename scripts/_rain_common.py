#!/usr/bin/env python3
"""
Shared pieces of the two precipitation bakes (GSMaP global, GOES detail).

They live together deliberately. The whole point of the resolution ladder is
that the two tiers look like ONE measurement at different sharpness, so they
must share a colour ramp, a downsampling rule and a tile layout exactly. When
those were copied into each bake they drifted within a day.
"""

import base64
import io
import json
import os
import re
import urllib.request

import numpy as np
from PIL import Image
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

TILE = 256
COLORMAP = "https://gibs.earthdata.nasa.gov/colormaps/v1.3/GPM_Precipitation_Rate.xml"


def http(url, timeout=180, ua="earthatlas-rain-bake"):
    req = urllib.request.Request(url, headers={"User-Agent": ua})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def load_ramp():
    """
    GIBS's OWN published rain-rate ramp. Both tiers colour with this, so the
    swap between them is a change of sharpness and not a change of palette.
    """
    x = http(COLORMAP, timeout=60).decode()
    blk = re.search(r'<ColorMap title="Rain Rate".*?</ColorMap>', x, re.S).group(0)
    stops = []
    for e in re.findall(r"<ColorMapEntry\b([^>]*)/>", blk):
        if 'transparent="true"' in e:
            continue
        rgb = re.search(r'rgb="([^"]+)"', e)
        val = re.search(r'value="([^"]+)"', e)
        if not (rgb and val):
            continue
        m = re.match(r"[\[\(]([^,]+)", val.group(1))
        if not m or "INF" in m.group(1):
            continue
        stops.append((float(m.group(1)), tuple(int(c) for c in rgb.group(1).split(","))))
    stops.sort()
    if len(stops) < 10:
        raise SystemExit("rain-rate ramp looks wrong")
    return np.array([s[0] for s in stops]), np.array([s[1] for s in stops], dtype=np.uint8)


def xtile(lon, z):
    return (lon + 180.0) / 360.0 * (1 << z)


def ytile(lat, z):
    s = np.sin(np.radians(lat))
    return (0.5 - np.log((1 + s) / (1 - s)) / (4 * np.pi)) * (1 << z)


def tile_window(west, east, lat_limit, minz, maxz, north=None, south=None):
    """
    The MAXZ tile rectangle a bake covers, snapped OUTWARD to a multiple of
    2**(maxz-minz). The snap is what makes the pyramid poolable: every parent
    is then exactly four children, so each level is built by halving the one
    below rather than by re-sampling the source.
    """
    step = 1 << (maxz - minz)
    n = 1 << maxz
    x0 = max(0, int(np.floor(xtile(west, maxz) / step)) * step)
    x1 = min(n, int(np.ceil(xtile(east, maxz) / step)) * step)
    # north/south let a regional grid (MRMS is 20N-55N) ask for the band it
    # actually covers instead of a symmetric +-lat_limit box; the first cut
    # built 12,288 rows to fill 5,120 of them and threw the rest away as dry.
    top = lat_limit if north is None else north
    bot = -lat_limit if south is None else south
    y0 = max(0, int(np.floor(ytile(top, maxz) / step)) * step)
    y1 = min(n, int(np.ceil(ytile(bot, maxz) / step)) * step)
    return x0, x1, y0, y1


def pixel_lons(x0, x1, maxz):
    world = (1 << maxz) * TILE
    return (x0 * TILE + np.arange((x1 - x0) * TILE) + 0.5) / world * 360.0 - 180.0


def pixel_lats(y0, rows, maxz, offset=0):
    world = (1 << maxz) * TILE
    py = y0 * TILE + np.arange(offset, offset + rows) + 0.5
    return np.degrees(2 * np.arctan(np.exp((0.5 - py / world) * 2 * np.pi)) - np.pi / 2)


def max_pool(a):
    """
    Halve a value grid by taking the HEAVIEST rate in each 2x2 block.

    Not a mean, and the reason matters. At twenty kilometres per pixel a two
    kilometre convective cell cannot be drawn faithfully either way: a mean
    multiplies it by its area fraction until it renders as nothing, which is
    how the first build managed to show less rain the further you zoomed out.
    Max overstates the AREA of a cell and tells the truth about its presence
    and its intensity. Measured inflation of rain area at z3 is about 2x.
    """
    b, c = a[0::2, 0::2], a[0::2, 1::2]
    d, e = a[1::2, 0::2], a[1::2, 1::2]
    return np.fmax(np.fmax(b, c), np.fmax(d, e))   # fmax ignores NaN


def colourise(v, ramp_v, ramp_c):
    raining = np.isfinite(v) & (v >= ramp_v[0])
    idx = np.clip(np.searchsorted(ramp_v, np.where(raining, v, 0.0)) - 1, 0, len(ramp_v) - 1)
    out = np.zeros(v.shape + (4,), dtype=np.uint8)
    out[..., :3] = ramp_c[idx]
    out[..., 3] = np.where(raining, 255, 0)
    return out


def build_pyramid(grid, x0, y0, minz, maxz, ramp_v, ramp_c):
    """Value grid at MAXZ -> {tileid: webp bytes}. Dry tiles are never stored."""
    levels = {maxz: grid}
    for z in range(maxz - 1, minz - 1, -1):
        levels[z] = max_pool(levels[z + 1])
    tiles, empty = {}, 0
    for z in range(minz, maxz + 1):
        k = maxz - z
        gx0, gy0 = x0 >> k, y0 >> k
        g = levels[z]
        for ty in range(g.shape[0] // TILE):
            for tx in range(g.shape[1] // TILE):
                block = g[ty * TILE:(ty + 1) * TILE, tx * TILE:(tx + 1) * TILE]
                if not np.any(np.isfinite(block) & (block >= ramp_v[0])):
                    empty += 1          # never stored; the endpoint answers 204
                    continue
                buf = io.BytesIO()
                Image.fromarray(colourise(block, ramp_v, ramp_c)).save(
                    buf, format="WEBP", lossless=True)
                tiles[zxy_to_tileid(z, gx0 + tx, gy0 + ty)] = buf.getvalue()
    return tiles, empty


def write_pmtiles(tiles, name, west, east, lat_limit, minz, maxz):
    body = io.BytesIO()
    w = Writer(body)
    for tid in sorted(tiles):
        w.write_tile(tid, tiles[tid])
    w.finalize({
        "tile_type": TileType.WEBP,
        "tile_compression": Compression.NONE,
        "min_zoom": minz, "max_zoom": maxz,
        "min_lon_e7": int(west * 1e7), "min_lat_e7": int(-lat_limit * 1e7),
        "max_lon_e7": int(east * 1e7), "max_lat_e7": int(lat_limit * 1e7),
        "center_zoom": minz,
        "center_lon_e7": int((west + east) / 2 * 1e7), "center_lat_e7": 0,
    }, {"name": name, "format": "webp"})
    return body.getvalue()


def publish(files, script_dir, prune=None):
    """POST to the ingest endpoint, or write public/dev-data locally."""
    ingest, secret = os.environ.get("CLOUDS_INGEST_URL"), os.environ.get("CRON_SECRET")
    if ingest and secret:
        body = {"files": files}
        if prune:
            body["prune"] = list(prune)
        req = urllib.request.Request(
            ingest, data=json.dumps(body).encode(), method="POST",
            headers={"content-type": "application/json",
                     "authorization": f"Bearer {secret}"})
        with urllib.request.urlopen(req, timeout=300) as r:
            print("ingest:", r.read().decode()[:300])
    else:
        out = os.path.join(script_dir, "..", "public", "dev-data", "systems")
        for f in files:
            # Archive frames keep their subdirectory ("mrms-conus/<ms>.pmtiles")
            # so dev mirrors the Blob layout exactly.
            dest = os.path.join(out, *f["path"].split("/")[1:])
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, "wb") as fh:
                fh.write(base64.b64decode(f["b64"]))
        for path in (prune or []):
            dead = os.path.join(out, *path.split("/")[1:])
            try: os.remove(dead)
            except OSError: pass
        print(f"wrote {out}")


def read_tape(kind, script_dir):
    """Existing rolling-archive index, from Blob in CI or dev-data locally."""
    base = os.environ.get("BLOB_PUBLIC_BASE",
                          "https://fxj3imydg9misw9w.public.blob.vercel-storage.com")
    if os.environ.get("CLOUDS_INGEST_URL"):
        try:
            return json.loads(http(f"{base}/systems/{kind}-tape.json", timeout=45).decode())
        except Exception:
            return {"frames": []}
    local = os.path.join(script_dir, "..", "public", "dev-data", "systems", f"{kind}-tape.json")
    try:
        with open(local) as fh:
            return json.load(fh)
    except OSError:
        return {"frames": []}


def b64file(path, content_type, data):
    return {"path": path, "contentType": content_type,
            "b64": base64.b64encode(data).decode()}
