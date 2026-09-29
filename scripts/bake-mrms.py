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

import base64
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
# 10-minute spacing over 48 hours: 289 frames, ~250 MB — the WHOLE replay
# window. At 3 hours (the first cut) a US zoom showed radar only at Now: the
# rest of the two-day loop fell back to 11 km (Josh, 2026-09-23). At 30 min
# (to 2026-09-29) stepping back from Now jumped half an hour while the live
# radar was minutes old; Josh chose 10-min steps. The :00/:30 frames still
# line up with the half-hourly GSMaP tape, and playback uses only those.
ARCHIVE_SPACING_MIN = 10
ARCHIVE_HOURS = 48
# Backfill is capped per run, newest slots first: a run bakes ~20 s per
# frame, so filling ~190 missing frames at once would outlast the job's
# timeout. At 6 per run and a run every 10 min the archive fills in ~5 h,
# and the recent past (what a reader steps back into) fills first.
MAX_NEW_PER_RUN = 6


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


def bake_one(key, ramp_v, ramp_c, good=None):
    raw_gz = http(f"{BUCKET}/{key}", timeout=180)
    src = read_grid(raw_gz)
    if good is not None:
        clip_to_coverage(src, good)
    lat_limit = max(abs(NORTH), abs(SOUTH))
    x0, x1, y0, y1 = tile_window(WEST, EAST, lat_limit, MINZ, MAXZ, north=NORTH, south=SOUTH)
    grid = resample(src, x0, x1, y0, y1)
    del src
    tiles, _ = build_pyramid(grid, x0, y0, MINZ, MAXZ, ramp_v, ramp_c)
    del grid
    return write_pmtiles(tiles, "mrms-conus", WEST, EAST, lat_limit, MINZ, MAXZ), len(tiles)


# Where the radars can actually SEE, as a coarse bitmap. The grid is a
# 20-55N / 130-60W RECTANGLE; /inmotion hands the view to radar when its
# centre is over the grid, so judging by the box alone blanked Hurricane
# Polo's rain over Sonora (2026-09-28) — GSMaP switched off, radar with
# nothing to show. PrecipRate cannot answer this: far from the radars it
# reports 0 ("dry"), not -3, because the beam overshoots the rain. MRMS's
# RadarQualityIndex (same 7000x3500 grid, 0..1, -3 = out of range) is the
# product that says how well the radar sees each cell. Sampled 2026-09-29:
# 1.0 over Santa Fe/Albuquerque/LA/Miami, 0.0 over Sonora, Hermosillo and
# the Pacific 400 km off SF, 0.1 in the Gulf 200 km off Texas, 0.3-0.4 in
# the Nevada and Rockies gaps. RQI >= 0.1 ("the radar has some view") keeps
# every interior-US gap on radar, so panning inside the country never flips
# products, and gives Mexico and the open ocean back to the satellite.
# 0.25 deg cells, covered when at least half their pixels pass: ~5 KB, and
# it follows radar outages as they happen.
#
# The same mask also CLIPS the radar tiles: /inmotion stitches the two rain
# products along it (radar inside, GSMaP outside, Josh 2026-09-28), and an
# unclipped radar would paint its weak overshooting returns on top of the
# satellite field just outside the seam.
RQI_PREFIX = "CONUS/RadarQualityIndex_00.00"
RQI_MIN = 0.1
COVER_DEG = 0.25


def fill_interior_gaps(good):
    """Radar gaps INSIDE the network (Four Corners, the Great Basin) stay radar.

    Stitching them to the satellite left blocky GSMaP patches, an hour out of
    step with the radar around them, all over the interior West (Josh,
    2026-09-28). Only uncovered ground connected to the grid's edge — Mexico,
    the oceans, Canada — is handed to the satellite.
    """
    ny, nx = good.shape
    outside = np.zeros_like(good)
    stack = [(r, c) for r in range(ny) for c in (0, nx - 1)] + [(r, c) for c in range(nx) for r in (0, ny - 1)]
    while stack:
        r, c = stack.pop()
        if outside[r, c] or good[r, c]:
            continue
        outside[r, c] = True
        if r > 0: stack.append((r - 1, c))
        if r < ny - 1: stack.append((r + 1, c))
        if c > 0: stack.append((r, c - 1))
        if c < nx - 1: stack.append((r, c + 1))
    return ~outside


def clip_to_coverage(src, good):
    """NaN every 1 km pixel in a 0.25 deg cell the radar cannot see (in place)."""
    k = int(round(COVER_DEG / DEG))
    ny, nx = good.shape
    view = src[: ny * k, : nx * k].reshape(ny, k, nx, k)
    view[~good[:, None, :, None].repeat(k, 1).repeat(k, 3)] = np.nan


def rqi_key_near(ms):
    """The RadarQualityIndex scan closest to a PrecipRate scan (same 2-min cadence)."""
    day = datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y%m%d")
    xml = http(f"{BUCKET}/?list-type=2&prefix={RQI_PREFIX}/{day}/&max-keys=1000", timeout=90).decode()
    keys = re.findall(r"<Key>([^<]+)</Key>", xml)
    if not keys:
        raise RuntimeError(f"no RadarQualityIndex files for {day}")
    best = min(keys, key=lambda k: abs(key_time(k).timestamp() * 1000 - ms))
    if abs(key_time(best).timestamp() * 1000 - ms) > 30 * 60 * 1000:
        raise RuntimeError(f"nearest RadarQualityIndex scan {best} is >30 min from the rain scan")
    return best


def coverage_mask(rain_ms):
    key = rqi_key_near(rain_ms)
    h = ec.codes_new_from_message(gzip.decompress(http(f"{BUCKET}/{key}", timeout=180)))
    if h is None:
        raise RuntimeError("RadarQualityIndex file held no GRIB message")
    try:
        if (ec.codes_get(h, "Ni"), ec.codes_get(h, "Nj")) != (NX, NY):
            raise RuntimeError("unexpected RadarQualityIndex grid")
        q = ec.codes_get_values(h).astype(np.float32).reshape(NY, NX)
    finally:
        ec.codes_release(h)
    k = int(round(COVER_DEG / DEG))
    ny, nx = NY // k, NX // k
    sees = (q[: ny * k, : nx * k] >= RQI_MIN) & (q[: ny * k, : nx * k] <= 1.0)
    good = fill_interior_gaps(sees.reshape(ny, k, nx, k).mean(axis=(1, 3)) >= 0.5)
    return good, {
        "deg": COVER_DEG, "north": NORTH, "west": WEST, "nx": nx, "ny": ny,
        "bits": base64.b64encode(np.packbits(good.astype(np.uint8), axis=None).tobytes()).decode(),
        "covered_frac": round(float(good.mean()), 4),
        "rqi_min": RQI_MIN,
        "source": key,
    }


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
    # Coverage first: every frame this run bakes is clipped to it. Best
    # effort — without a mask the client falls back to the grid's box (the
    # old behaviour) and frames go up unclipped; the bake never fails on it.
    good, coverage = None, None
    try:
        good, coverage = coverage_mask(int(key_time(latest).timestamp() * 1000))
        print(f"coverage: {coverage['covered_frac']:.1%} of the box, from {coverage['source']}")
    except Exception as err:
        print(f"coverage mask skipped: {err}")
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
    for slot in sorted(slots, reverse=True):  # newest first: the cap spends itself on the recent past
        if slot in have:
            frames.append(have[slot])
            continue
        hit = by_slot.get(slot)
        if not hit or baked >= MAX_NEW_PER_RUN:
            continue
        pmt, ntiles = bake_one(hit[1], ramp_v, ramp_c, good)
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
    live = bake_one(latest, ramp_v, ramp_c, good)[0]
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
        "coverage": coverage,
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
