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


def main():
    result = mod.bake()
    print(json.dumps(result["summary"], indent=2))
    token = os.environ.get("BLOB_READ_WRITE_TOKEN")
    if token:
        mod.upload_to_blob(result["outputs"], token)
        print("uploaded to Vercel Blob")
    else:
        out_dir = os.path.join(root, "public", "dev-data", "systems")
        os.makedirs(out_dir, exist_ok=True)
        for base, buf, meta in result["outputs"]:
            open(os.path.join(out_dir, f"{base}-grid.bin"), "wb").write(buf)
            open(os.path.join(out_dir, f"{base}-meta.json"), "w").write(json.dumps(meta))
        print("wrote public/dev-data/systems/")


if __name__ == "__main__":
    sys.exit(main())
