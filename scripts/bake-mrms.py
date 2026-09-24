#!/usr/bin/env python3
"""
Bake NOAA MRMS PrecipRate into the SHARPEST tier of the /inmotion
Precipitation ladder.

MRMS (Multi-Radar Multi-Sensor) is the national ground weather-radar network
fused with rain gauges, satellite and model fields. It is an order of
magnitude finer and fresher than anything above it:

    GSMaP_NOW   0.1 deg (~11 km)  every 30 min   ~30 min old   global
    MRMS        1 km              every  2 min   ~2 min old    CONUS

At 1 km you see individual convective cells and the hook of a squall line,
not a blob. That is the whole reason for the tier.

Grid, read from a real file rather than assumed (eccodes):
    7000 x 3500, 0.01 deg
    lat  54.995 -> 20.005   (row 0 is the NORTH edge)
    lon 230.005 -> 299.995  (degrees EAST, i.e. 130W -> 60W)
    missingValue 9999; negative values are no-coverage flags (e.g. -3)

GRIB2 needs eccodes, which now ships as a pip wheel, so CI needs no apt.

This is CONUS only. MRMS also publishes ALASKA, CARIB, GUAM and HAWAII at the
same cadence under the same bucket; they are separate grids and would each be
another tier entry. CONUS first because it is where the storms are watched.
"""

import gzip
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

import eccodes as ec
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _rain_common import (  # noqa: E402
    TILE, b64file, build_pyramid, http, load_ramp, pixel_lats, pixel_lons,
    publish, read_tape, tile_window, write_pmtiles,
)

BUCKET = "https://noaa-mrms-pds.s3.amazonaws.com"
PREFIX = "CONUS/PrecipRate_00.00"
NX, NY = 7000, 3500
DEG = 0.01
LAT0_NORTH = 54.995
LON0_EAST = 230.005

# The CONUS grid's own extent. MAXZ 7 is native (a z7 pixel is ~1.2 km against
# MRMS's 1 km); MINZ 5 is where the radar takes over from the 11 km global
# tier on /inmotion (layerDefs.js rain tier minzoom).
WEST, EAST = -130.0, -60.0
NORTH, SOUTH = 55.0, 20.0
MINZ, MAXZ = 5, 7

# Rolling archive. Without one, pressing play at a US zoom threw the map back
# to the global 11 km product magnified sixty-four times — enormous flat
# blocks that also overstate how uniform the rain is. MRMS publishes every 2
# minutes and keeps 365+ days, and a frame is only ~0.6 MB, so holding a few
# hours of 1 km radar costs almost nothing and is what a reader actually
# wants when they have zoomed in.
#
# 30-minute spacing over 48 hours: 97 frames, ~58 MB — the WHOLE replay
# window, matching the half-hourly global rain tape frame for frame. At 3
# hours (the first cut) a US zoom showed radar only at Now: the rest of the
# two-day loop fell back to 11 km (Josh, 2026-09-23). Backfilled from S3 on
# the first run so the loop is useful immediately.
ARCHIVE_SPACING_MIN = 30
ARCHIVE_HOURS = 48


def day_keys(day):
    xml = http(f"{BUCKET}/?list-type=2&prefix={PREFIX}/{day}/&max-keys=1000", timeout=90).decode()
    return sorted(re.findall(r"<Key>([^<]+)</Key>", xml))


def key_time(key):
    m = re.search(r"_(\d{8})-(\d{6})\.grib2", key)
    return datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)


def recent_keys():
    """Every PrecipRate key from the last ARCHIVE_HOURS, newest last."""
    now = datetime.now(timezone.utc)
    keys = []
    for back in range(ARCHIVE_HOURS // 24 + 1, -1, -1):
        try: keys += day_keys((now - timedelta(days=back)).strftime("%Y%m%d"))
        except Exception: pass
    cutoff = now - timedelta(hours=ARCHIVE_HOURS, minutes=ARCHIVE_SPACING_MIN)
    out = [k for k in keys if key_time(k) >= cutoff]
    if not out:
        raise SystemExit("no MRMS PrecipRate files in the last two days")
    return out


def wanted_slots():
    """The frame times the archive should hold, oldest first."""
    step = ARCHIVE_SPACING_MIN * 60
    now = int(datetime.now(timezone.utc).timestamp())
    newest = (now // step) * step
    n = int(ARCHIVE_HOURS * 60 / ARCHIVE_SPACING_MIN)
    return [(newest - i * step) * 1000 for i in range(n, -1, -1)]


def bake_one(key, ramp_v, ramp_c):
    raw_gz = http(f"{BUCKET}/{key}", timeout=180)
    src = read_grid(raw_gz)
    lat_limit = max(abs(NORTH), abs(SOUTH))
    x0, x1, y0, y1 = tile_window(WEST, EAST, lat_limit, MINZ, MAXZ, north=NORTH, south=SOUTH)
    grid = resample(src, x0, x1, y0, y1)
    del src
    tiles, _ = build_pyramid(grid, x0, y0, MINZ, MAXZ, ramp_v, ramp_c)
    del grid
    return write_pmtiles(tiles, "mrms-conus", WEST, EAST, lat_limit, MINZ, MAXZ), len(tiles)


def read_grid(raw_gz):
    """GRIB2 -> (3500, 7000) mm/h, NaN where there is no radar coverage."""
    # From the message bytes, not a file object: eccodes' *_from_file wants a
    # real fileno() and an in-memory buffer has none.
    h = ec.codes_new_from_message(gzip.decompress(raw_gz))
    if h is None:
        raise SystemExit("MRMS file held no GRIB message")
    try:
        ni, nj = ec.codes_get(h, "Ni"), ec.codes_get(h, "Nj")
        if (ni, nj) != (NX, NY):
            raise SystemExit(f"unexpected MRMS grid {ni}x{nj}")
        v = ec.codes_get_values(h).astype(np.float32)
    finally:
        ec.codes_release(h)
    # 9999 is the declared missing value; everything negative is a coverage
    # flag (-3 = outside radar range), never a rate. Both must become NaN, or
    # max-pooling would carry a flag up the pyramid as if it were rainfall.
    v = np.where((v < 0) | (v >= 9990), np.nan, v)
    return v.reshape(NY, NX)


def resample(src, x0, x1, y0, y1):
    W, H = (x1 - x0) * TILE, (y1 - y0) * TILE
    lons = pixel_lons(x0, x1, MAXZ)
    cols = np.rint((np.mod(lons, 360.0) - LON0_EAST) / DEG)
    col_ok = (cols >= 0) & (cols < NX)
    ci = np.clip(cols, 0, NX - 1).astype(np.int64)
    out = np.full((H, W), np.nan, dtype=np.float32)
    for top in range(0, H, TILE * 2):
        rows_n = min(TILE * 2, H - top)
        lats = pixel_lats(y0, rows_n, MAXZ, offset=top)
        rows = np.rint((LAT0_NORTH - lats) / DEG)
        row_ok = (rows >= 0) & (rows < NY)
        ri = np.clip(rows, 0, NY - 1).astype(np.int64)
        band = src[ri[:, None], ci[None, :]]
        out[top:top + rows_n] = np.where(row_ok[:, None] & col_ok[None, :], band, np.nan)
    return out


def main():
    ramp_v, ramp_c = load_ramp()
    here = os.path.dirname(os.path.abspath(__file__))
    keys = recent_keys()
    latest = keys[-1]
    print(f"newest: {latest}")

    tape = read_tape("mrms-conus", here)
    have = {int(f["valid_ms"]): f for f in tape.get("frames", [])}
    slots = wanted_slots()
    tol = ARCHIVE_SPACING_MIN * 60 * 1000 // 2

    # Pick the real scan nearest each slot, so the archive is evenly spaced in
    # TIME rather than every Nth file — MRMS occasionally skips a cycle.
    by_slot = {}
    for k in keys:
        ms = int(key_time(k).timestamp() * 1000)
        for slot in slots:
            if abs(ms - slot) <= tol:
                cur = by_slot.get(slot)
                if cur is None or abs(ms - slot) < abs(cur[0] - slot):
                    by_slot[slot] = (ms, k)

    files, frames, baked = [], [], 0
    for slot in slots:
        if slot in have:
            frames.append(have[slot])
            continue
        hit = by_slot.get(slot)
        if not hit:
            continue
        # One archive write per run in steady state; a first run backfills the
        # window, which takes a couple of minutes and only happens once.
        pmt, ntiles = bake_one(hit[1], ramp_v, ramp_c)
        files.append(b64file(f"systems/mrms-conus/{slot}.pmtiles",
                             "application/octet-stream", pmt))
        frames.append({"valid_ms": slot, "scan_ms": hit[0]})
        baked += 1
        print(f"  archived {datetime.fromtimestamp(slot / 1000, timezone.utc):%H:%M}Z "
              f"({ntiles} tiles, {len(pmt) / 1048576:.2f} MB)")
        # The ingest caps a request at four files, and each is ~0.6 MB against
        # a 4.5 MB body limit, so archive frames go up as they are made.
        if len(files) >= 3:
            publish(files, here); files = []

    frames.sort(key=lambda f: f["valid_ms"])
    live = bake_one(latest, ramp_v, ramp_c)[0]
    live_ms = int(key_time(latest).timestamp() * 1000)
    lat_limit = max(abs(NORTH), abs(SOUTH))
    meta = {
        "version": 1, "schema": 1, "kind": "mrms-conus",
        "valid_ms": live_ms,
        "fetched_ms": int(datetime.now(timezone.utc).timestamp() * 1000),
        "west": WEST, "east": EAST, "north": NORTH, "south": SOUTH,
        "lat_limit": lat_limit,
        "minzoom": MINZ, "maxzoom": MAXZ,
        "downsample": "max",
        "frame": latest,
        "source": "NOAA MRMS PrecipRate (Multi-Radar Multi-Sensor), 1 km, "
                  "coloured with the NASA GIBS GPM rain-rate ramp",
    }
    tape_out = {
        "version": 1, "kind": "mrms-conus",
        "step_ms": ARCHIVE_SPACING_MIN * 60 * 1000,
        "frames": frames,
    }
    keep = {f["valid_ms"] for f in frames}
    prune = [f"systems/mrms-conus/{ms}.pmtiles" for ms in have if ms not in keep]

    publish(files + [
        b64file("systems/mrms-conus.pmtiles", "application/octet-stream", live),
        b64file("systems/mrms-conus-meta.json", "application/json", json.dumps(meta).encode()),
    ], here)
    publish([b64file("systems/mrms-conus-tape.json", "application/json",
                     json.dumps(tape_out).encode())], here, prune=prune)
    print(f"archive: {len(frames)} frames ({baked} newly baked, {len(prune)} pruned)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
