#!/usr/bin/env python3
"""
Bake JAXA GSMaP_NOW into a rolling half-hourly TAPE for the /inmotion
Precipitation layer, so rain plays the way desert dust does.

Why a tape (Josh, 2026-09-23: "How does the dust layer do it? That looks
SMOOTH"). The tiled rain replay fetched a screenful of tiles for every
half-hour and swapped them in: a slideshow with loading pauses however well
the swap was tuned. The scalar tape machinery (src/systems/tape.js,
tapeWarpGL.js) preloads one small global grid per frame, and the browser
computes the motion between consecutive frames and slides the field along it
on the GPU. Rain moves instead of dissolving.

ONE product for the whole loop. The tiled layer replayed NASA IMERG (6.4 h
behind) and showed GSMaP only at Now, so the loop was two products and a
six-hour hole. GSMaP_NOW alone runs right up to the present.

Frames: GSMaP_NOW files are issued every 30 minutes, each an average over the
hour that starts at its label (see bake-gsmap.py). valid_ms is the midpoint.

Grid: 0.2 deg, 1800 x 600, 59.9N..59.9S (GSMaP covers +-60). Each cell is the
MAX of the 2x2 block of 0.1 deg cells — the same rule as the tile pyramids,
so a lone 11 km downpour is not averaged into drizzle (it overstates rain
AREA; the layer copy says so). 0.2 deg is the size of the largest existing
global tape (CAMS methane) and finer than the globe canvas draws (~0.35 deg
per pixel at 1024 px).

Encoding: byte = round(sqrt(mm/h) * QSCALE), 1..255, byte 0 = no data
(nodata0). The square root gives drizzle and downpours both room on one byte:
QSCALE 30 spans 0.001 .. 72 mm/h. Kind: gsmap-rain-sqrt.

Motion: tape.js skips motion warping between frames whose run_ms differ,
unless the earlier frame is marked smoothed (that rule exists for forecast
runs, whose analysis jump would lurch). Observations have no runs, so every
frame carries smoothed: true — consecutive frames ARE ordinary evolution.
The in-between motion is computed in the browser from two measurements; the
layer copy says so.

Also written: gsmap-rain-meta.json + gsmap-rain-grid.bin, the newest frame as
a standard Int16 grid (value = sqrt(mm/h) * 100), which the scalar layer
loads first and uses for popups before the tape arrives.

Credit (JAXA FAQ Q14/Q16): "(c)JAXA, provided by JAXA, Courtesy of JAXA".
We process their binary into our own rasters; we never redistribute theirs.
"""

import io
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from ftplib import FTP, all_errors

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _rain_common import b64file, publish, read_tape  # noqa: E402

FTP_HOST = "hokusai.eorc.jaxa.jp"
NX, NY = 3600, 1200                 # 0.1 deg, row 0 = 59.95N (YREV), col 0 = 0.05E
KIND = "gsmap-rain"
DAYS = 2
STEP_MIN = 30
QSCALE = 30
GRID_SCALE = 100                    # Int16 live grid: sqrt(mm/h) * 100
MAX_NEW_PER_RUN = int(os.environ.get("GSMAP_TAPE_MAX_NEW", "120"))
CREDIT = "(c)JAXA, provided by JAXA, Courtesy of JAXA"
SOURCE = ("JAXA GSMaP_NOW (Global Satellite Mapping of Precipitation, real-time), hourly-average "
          "rain rate issued every 30 min, 0.1 deg max-pooled to 0.2 deg, stored as sqrt(mm/h)")
NAME_RE = re.compile(r"gsmap_now\.(\d{8})\.(\d{4})\.dat\.gz")


def frame_start(name):
    m = NAME_RE.fullmatch(name)
    return datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M").replace(tzinfo=timezone.utc)


def list_dir(ftp, path):
    try:
        return ftp.nlst(path)
    except all_errors:            # 450 / 550: JAXA answers "no such directory" either way
        return []


def find_frames(ftp, days):
    """
    {name: full path} for every GSMaP_NOW frame in the window, from
    /now/latest plus the dated half_hour archive.
    """
    found = {}
    for p in list_dir(ftp, "/now/latest"):
        n = p.rsplit("/", 1)[-1]
        if NAME_RE.fullmatch(n):
            found[n] = p if p.startswith("/") else f"/now/latest/{n}"
    now = datetime.now(timezone.utc)
    tried = []
    for back in range(days + 1):
        d = now - timedelta(days=back)
        # Confirmed 2026-09-23 against the live FTP: /now holds doc, netcdf,
        # sample, half_hour, latest, txt, half_hour_G; half_hour/YYYY/MM/DD
        # holds 48 frames a day. /now/latest holds only the last ~day.
        for tpl in ("/now/half_hour/{Y}/{m}/{d}",):
            path = tpl.format(Y=d.strftime("%Y"), m=d.strftime("%m"), d=d.strftime("%d"))
            names = list_dir(ftp, path)
            tried.append((path, len(names)))
            for p in names:
                n = p.rsplit("/", 1)[-1]
                if NAME_RE.fullmatch(n):
                    found.setdefault(n, p if p.startswith("/") else f"{path}/{n}")
    print("FTP layout probe:", ", ".join(f"{p}={k}" for p, k in tried if k) or "nothing beyond /now/latest")
    print(f"  /now/latest holds {sum(1 for p in found.values() if '/latest/' in p)} frames")
    return found


def read_grid(raw_gz):
    import gzip
    raw = gzip.decompress(raw_gz)
    if len(raw) != NX * NY * 4:
        raise ValueError(f"unexpected frame size {len(raw)}")
    a = np.frombuffer(raw, dtype="<f4").reshape(NY, NX)
    return np.where(a < 0, np.nan, a).astype(np.float32)     # negatives are flags


def pool(a):
    """0.1 -> 0.2 deg by MAX of each 2x2 block, ignoring missing cells."""
    b = a.reshape(NY // 2, 2, NX // 2, 2)
    with np.errstate(all="ignore"):
        m = np.nanmax(b, axis=(1, 3))
    return m                                                   # all-NaN block stays NaN


def encode_frame(rate):
    s = np.sqrt(np.maximum(rate, 0))
    b = np.where(np.isfinite(rate), np.clip(np.round(s * QSCALE), 1, 255), 0).astype("uint8")
    out = io.BytesIO()
    Image.fromarray(b, mode="L").save(out, format="PNG", optimize=True)
    return out.getvalue()


def live_grid(rate):
    s = np.sqrt(np.maximum(rate, 0)) * GRID_SCALE
    g = np.where(np.isfinite(rate), np.round(s), -32768).astype("<i2")
    return g.tobytes()


GRID = {"nLat": NY // 2, "nLon": NX // 2, "lat0": 59.9, "dLat": -0.2, "lon0": 0.1, "dLon": 0.2}


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    user, pw = os.environ.get("GSMAP_FTP_USER"), os.environ.get("GSMAP_FTP_PASS")
    if not (user and pw):
        raise SystemExit("set GSMAP_FTP_USER / GSMAP_FTP_PASS (JAXA GSMaP registration)")

    tape = read_tape(KIND, here)
    have = {int(f["valid_ms"]): f for f in tape.get("frames", [])}
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    cutoff = now_ms - DAYS * 86400000

    ftp = FTP(FTP_HOST, timeout=180)
    ftp.login(user, pw)
    ftp.set_pasv(True)
    try:
        found = find_frames(ftp, DAYS)
        todo = []
        for name, path in found.items():
            start = frame_start(name)
            valid = int((start.timestamp() + 1800) * 1000)
            if valid < cutoff or valid in have:
                continue
            todo.append((valid, name, path, start))
        todo.sort()
        todo = todo[-MAX_NEW_PER_RUN:]          # newest first if capped
        print(f"frames on FTP in window: {sum(1 for n in found if int((frame_start(n).timestamp() + 1800) * 1000) >= cutoff)}"
              f" · already in tape: {len(have)} · to bake: {len(todo)}")

        files, newest = [], None
        for valid, name, path, start in todo:
            buf = io.BytesIO()
            ftp.retrbinary(f"RETR {path}", buf.write)
            try:
                rate = pool(read_grid(buf.getvalue()))
            except ValueError as e:
                print(f"  skip {name}: {e}")
                continue
            stamp = datetime.fromtimestamp(valid / 1000, timezone.utc).strftime("%Y-%m-%d-%H%M")
            fpath = f"systems/{KIND}-tape/{stamp}.png"
            png = encode_frame(rate)
            files.append(b64file(fpath, "image/png", png))
            have[valid] = {
                "valid_ms": valid, "run_ms": valid, "lead_h": 0, "path": fpath,
                # See the module docstring: observations have no runs; this
                # is what lets tape.js warp between consecutive frames.
                "smoothed": True,
                "window_start_ms": int(start.timestamp() * 1000),
                "window_end_ms": int(start.timestamp() * 1000) + 3600000,
                "frame": name,
            }
            if newest is None or valid > newest[0]:
                newest = (valid, rate, name, start)
            print(f"  {name} -> {fpath} ({len(png) / 1024:.0f} KB, raining {100 * np.nanmean(rate > 0.1):.1f}%)")
            if len(files) >= 4:                      # the ingest's per-request cap
                publish(files, here)
                files = []
        if files:
            publish(files, here)
    finally:
        try: ftp.quit()
        except Exception: ftp.close()

    keep = sorted((f for v, f in have.items() if v >= cutoff), key=lambda f: f["valid_ms"])
    prune = [f["path"] for v, f in have.items() if v < cutoff]
    if not keep:
        raise SystemExit("no GSMaP_NOW frames in the window — check the FTP layout probe above")

    index = {
        "version": 1, "kind": f"{KIND}-sqrt-tape", "source": SOURCE, "credit": CREDIT,
        "fetched_ms": now_ms, **GRID,
        "qscale": QSCALE, "offset": 0, "nodata0": True,
        "step_ms": STEP_MIN * 60000, "days": DAYS, "frame_kind": "observation",
        "frames": keep,
    }
    out = [b64file(f"systems/{KIND}-tape.json", "application/json", json.dumps(index).encode())]
    if newest:
        valid, rate, name, start = newest
        meta = {
            "version": 1, "kind": f"{KIND}-sqrt", "run_ms": valid, "valid_ms": valid,
            "fetched_ms": now_ms, **GRID, "scale": GRID_SCALE, "missing": -32768,
            "window_start_ms": int(start.timestamp() * 1000),
            "window_end_ms": int(start.timestamp() * 1000) + 3600000,
            "frame": name, "credit": CREDIT, "source": SOURCE,
        }
        out += [b64file(f"systems/{KIND}-meta.json", "application/json", json.dumps(meta).encode()),
                b64file(f"systems/{KIND}-grid.bin", "application/octet-stream", live_grid(rate))]
    publish(out, here, prune=prune[:200] or None)
    print(f"tape: {len(keep)} frames, {len(prune)} pruned")
    return 0


if __name__ == "__main__":
    sys.exit(main())
