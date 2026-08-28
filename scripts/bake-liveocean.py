#!/usr/bin/env python3
"""
Local runner for the LiveOcean ocean-acidity bake (the logic lives in
scripts/liveocean_bake.py, which the GitHub Actions cron also runs).

  python3 scripts/bake-liveocean.py            # writes public/dev-data/systems/
  BLOB_READ_WRITE_TOKEN=... python3 ...        # uploads to Vercel Blob instead

Deps: pip install -r scripts/liveocean-requirements.txt
"""
import importlib.util
import json
import os
import sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location(
    "liveocean_bake", os.path.join(root, "scripts", "liveocean_bake.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def write_dev(files):
    out_dir = os.path.join(root, "public", "dev-data", "systems")
    for f in files:
        rel = f["path"].removeprefix("systems/")
        dest = os.path.join(out_dir, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        open(dest, "wb").write(f["bytes"])


def main():
    result = mod.bake()
    print(json.dumps(result["summary"], indent=2))
    files = mod.grid_pair_files(result["outputs"])
    tape_files, tape_summary = mod.bake_tape()
    print("tidal tape:", json.dumps(tape_summary))
    files += tape_files
    ingest = os.environ.get("LIVEOCEAN_INGEST_URL")
    secret = os.environ.get("CRON_SECRET")
    if ingest and secret:
        resp = mod.upload_files_via_ingest(files, ingest, secret)
        print(f"uploaded via ingest: {len(resp['written'])} files")
    else:
        write_dev(files)
        print("wrote public/dev-data/systems/")


if __name__ == "__main__":
    sys.exit(main())
