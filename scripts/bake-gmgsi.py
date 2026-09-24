#!/usr/bin/env python3
"""
Bake NOAA's Global Mosaic of Geostationary Satellite Imagery (GMGSI) into one
global cloud image for the /inmotion Clouds layer.

Why this and not the obvious alternatives — all of which were tried first:

  * Stitching GOES + Meteosat + Himawari ourselves produced a visibly broken
    picture. GIBS has no Meteosat at all, so the gap has to be filled from
    EUMETSAT, and the two providers render the same infrared completely
    differently (measured over identical ocean: GIBS clear sky at luminance
    125, EUMETSAT at 22). Full discs also overlap, and a geostationary limb
    washes out white, so the joins blew out. See docs/CLOUDS_API.md.
  * MODIS/VIIRS true colour is seamless and beautiful but builds its global
    mosaic swath by swath through the day — measured at z3, today's Americas
    tile was an empty 1.6 KB while Asia already had 22 KB. Only YESTERDAY is
    complete, so it cannot show a storm that exists now.
  * Raw GOES ABI off S3 is minutes fresh but is 351 MB per scan for the
    multi-band file, in geostationary projection, and carries no GeoColor —
    that is a CIRA composite, not a band in the file. Rendering it would mean
    building a satellite imaging pipeline.

GMGSI is NOAA doing all of that already: every geostationary satellite merged
into ONE global field, hourly, 7 MB a frame. Nothing to stitch, because there
is only one source.

Output: a single WEB MERCATOR grey+alpha WebP where cloud is white and
clear sky is transparent, uploaded to Blob and drawn as one raster layer.

Run locally with no env set and it writes public/dev-data/systems/ instead.
"""

import base64
import io
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

import h5py
import numpy as np
from PIL import Image

BUCKET = "https://noaa-gmgsi-pds.s3.amazonaws.com"
PRODUCT = "GMGSI_LW"          # longwave infrared: works day AND night, globally
# WEB MERCATOR, not equirectangular — see resample(). Height is chosen so the
# vertical sampling near the equator (~0.086 deg) stays close to GMGSI's own
# 0.072 deg, since Mercator spends most of its rows on the high latitudes.
OUT_W, OUT_H = 4096, 2730
LAT_LIMIT = 72.7              # the mosaic's own extent; geostationary sees no further

# Brightness -> opacity. In this product HIGH means COLD means high cloud:
# measured in one frame, Hurricane Polo's core read 204, the night-time Sahara
# 124 and the warm tropical Atlantic 72. So clouds are the top of the range.
#
# The honest limit of any single-band infrared: it measures TEMPERATURE, not
# cloud. Cold ground — winter continents, high terrain, ice sheets, a desert
# that has radiated its heat away overnight — reads like cloud and there is no
# way to tell them apart from this band alone. The threshold below is set high
# enough to reject most of it, and the layer says so in plain words.
# Chosen from the distribution of a real frame, not by eye. Clear surfaces
# measured 37 (daylit Sahara) to 112; unambiguous cloud measured 180 (North
# Atlantic front) to 210 (Hurricane Polo's core); the median pixel is 122.
# 130 sits just above the clear-surface range and 210 at the deep-cloud end.
#
# What no threshold can fix: LOW cloud over warm ocean is almost the same
# temperature as the sea beneath it, so longwave infrared cannot separate the
# two. This layer therefore shows mid and high cloud well and misses shallow
# marine cloud. GMGSI_VIS would fill that in on the daylit half if it is ever
# wanted; the trade is that visible imagery goes black at night.
ALPHA_LO = 130.0
ALPHA_HI = 200.0


def http(url, timeout=120):
    req = urllib.request.Request(url, headers={"User-Agent": "earthatlas-gmgsi-bake"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def latest_key():
    """Newest GMGSI frame. Anonymous S3 REST — no boto3, no credentials."""
    now = datetime.now(timezone.utc)
    for back in range(0, 8):
        t = now - timedelta(hours=back)
        prefix = f"{PRODUCT}/{t:%Y/%m/%d/%H}/"
        xml = http(f"{BUCKET}/?list-type=2&prefix={prefix}&max-keys=10", timeout=60).decode()
        keys = re.findall(r"<Key>([^<]+)</Key>", xml)
        if keys:
            return sorted(keys)[-1]
    raise SystemExit("no GMGSI frame found in the last 8 hours")


def mercator_y(lat_deg):
    """Web Mercator y, in radians-equivalent units. Only the ratio matters."""
    r = np.radians(np.clip(lat_deg, -89.0, 89.0))
    return np.log(np.tan(np.pi / 4.0 + r / 2.0))


def resample(data, src_lat, src_lon):
    """
    GMGSI's grid is regular in longitude (0.072 deg) but NOT in latitude — the
    spacing runs 0.021 to 0.072, i.e. it is projected. Because latitude varies
    only down rows and longitude only across columns, the resample separates
    into two 1-D lookups and needs no scattered interpolation.

    The OUTPUT must be WEB MERCATOR, not equirectangular. A Mapbox `image`
    source texture-maps its image onto a quad in Mercator space, so image rows
    are interpolated linearly in Mercator y — NOT in latitude. The first
    version of this bake wrote equirectangular rows, which Mapbox then
    stretched as though they were Mercator: cloud was displaced in latitude,
    negligibly at the equator and worse further north or south. It looked
    plausible on a whole-globe view and was visibly wrong zoomed in, with
    storms sitting beside their own cloud shields instead of under them.
    """
    y_top, y_bot = mercator_y(LAT_LIMIT), mercator_y(-LAT_LIMIT)
    tgt_y = np.linspace(y_top, y_bot, OUT_H)
    tgt_lat = np.degrees(2.0 * np.arctan(np.exp(tgt_y)) - np.pi / 2.0)
    tgt_lon = np.linspace(-180.0, 180.0, OUT_W, endpoint=False)

    # src_lat descends; np.interp needs ascending, so walk it backwards.
    rows = np.interp(tgt_lat, src_lat[::-1], np.arange(len(src_lat))[::-1])
    lon_unwrapped = np.where(src_lon < src_lon[0], src_lon + 360.0, src_lon)
    cols = np.interp(np.where(tgt_lon < src_lon[0], tgt_lon + 360.0, tgt_lon),
                     lon_unwrapped, np.arange(len(src_lon)))
    r = np.clip(np.rint(rows).astype(np.int32), 0, data.shape[0] - 1)
    c = np.clip(np.rint(cols).astype(np.int32), 0, data.shape[1] - 1)
    return data[r[:, None], c[None, :]]


def to_image(grid):
    """
    Grey-plus-alpha, written as LOSSLESS WebP.

    Measured on a real frame at 4096x2048: RGBA PNG 9.5 MB, grey+alpha PNG
    6.4 MB, lossless WebP 1.19 MB — and lossy WebP was BIGGER than lossless
    (1.45 MB at q75), because most of the image is uniform transparency.
    So full resolution survives and still fits the 4.5 MB function-body limit
    once base64 has added its third.
    """
    b = np.clip(grid, 0, 255).astype(np.float32)
    a = np.clip((b - ALPHA_LO) / (ALPHA_HI - ALPHA_LO), 0.0, 1.0)
    a = a * a * (3.0 - 2.0 * a)                        # smoothstep: no hard edge

    # Grey must span the WHOLE cloud range, not saturate partway.
    #
    # The first version used 160 + (b - 130) * 1.6, which hits pure white at
    # b = 189 — while brightness runs to 255 and storm tops live at 190-255.
    # Every eyewall, spiral band and overshooting top was therefore flattened
    # into one identical flat white: on screen a hurricane was a featureless
    # blob sitting beside a precisely drawn wind field, which is what Josh
    # spotted as a mismatch between the two layers. Mapping 130..255 across
    # 120..255 keeps the structure that actually distinguishes a storm.
    grey = np.clip(120 + (b - ALPHA_LO) * (135.0 / (255.0 - ALPHA_LO)), 0, 255)
    out = np.zeros((OUT_H, OUT_W, 2), dtype=np.uint8)
    out[..., 0] = grey.astype(np.uint8)
    out[..., 1] = (a * 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(out).save(buf, format="WEBP", lossless=True)
    return buf.getvalue()


def main():
    key = latest_key()
    print(f"frame: {key}")
    raw = http(f"{BUCKET}/{key}")
    print(f"downloaded {len(raw) / 1048576:.1f} MB")

    with h5py.File(io.BytesIO(raw), "r") as f:
        data = np.asarray(f["data"][0], dtype=np.float32)
        src_lat = np.asarray(f["lat"][:, 0], dtype=np.float64)
        src_lon = np.asarray(f["lon"][0, :], dtype=np.float64)
        start = f.attrs.get("time_coverage_start", b"")
        start = start.decode() if isinstance(start, bytes) else str(start)

    grid = resample(data, src_lat, src_lon)
    img = to_image(grid)
    valid_ms = int(datetime.strptime(start, "%Y-%m-%dT%H:%M:%SZ")
                   .replace(tzinfo=timezone.utc).timestamp() * 1000) if start else None

    meta = {
        "version": 1,
        "kind": "gmgsi-clouds",
        "valid_ms": valid_ms,
        "fetched_ms": int(datetime.now(timezone.utc).timestamp() * 1000),
        "width": OUT_W, "height": OUT_H, "lat_limit": LAT_LIMIT,
        "source": "NOAA Global Mosaic of Geostationary Satellite Imagery (GMGSI), longwave infrared",
        "frame": key,
    }
    print(f"webp {len(img) / 1048576:.2f} MB  valid {start}")

    files = [
        {"path": "systems/gmgsi-clouds.webp", "contentType": "image/webp",
         "b64": base64.b64encode(img).decode()},
        {"path": "systems/gmgsi-clouds-meta.json", "contentType": "application/json",
         "b64": base64.b64encode(json.dumps(meta).encode()).decode()},
    ]

    ingest, secret = os.environ.get("CLOUDS_INGEST_URL"), os.environ.get("CRON_SECRET")
    if ingest and secret:
        body = json.dumps({"files": files}).encode()
        req = urllib.request.Request(ingest, data=body, method="POST", headers={
            "content-type": "application/json", "authorization": f"Bearer {secret}"})
        with urllib.request.urlopen(req, timeout=180) as r:
            print("ingest:", r.read().decode()[:300])
    else:
        out = os.path.join(os.path.dirname(__file__), "..", "public", "dev-data", "systems")
        os.makedirs(out, exist_ok=True)
        for f in files:
            with open(os.path.join(out, os.path.basename(f["path"])), "wb") as fh:
                fh.write(base64.b64decode(f["b64"]))
        print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
