#!/usr/bin/env python3
"""
Per-parcel NDVI statistics from NAIP 2023 (October scene) via Earth Engine.

Ported unchanged (same scene, breaks, scale, record shape) from Salish Sea Explorer's
scripts/ee-ndvi-parcel-stats.py, for the Vegetation tab of /shoreline's property popup. Only the
paths and the Earth Engine project differ: parcels come from the fresh county download
(fetch-county.mjs), and the project is EE_PROJECT (default: earthatlas). In GitHub Actions it signs in as the
shoreline-bake@earthatlas service account (GOOGLE_APPLICATION_CREDENTIALS); locally, with this Mac's EE login.

Writes data/shoreline/build/greenery.json: { "<FID>": { mean, stdDev, water, bare,
sparse, moderate, dense, veryDense } } — class values are % of parcel area.

Class breaks are calibrated to THIS scene (2026-09-14). Autumn light compresses
NDVI: sampled against NLCD 2021 land cover at 10 m, evergreen forest reads
p25 0.25 / p50 0.32 / p75 0.36, shrub p50 0.19 / p75 0.29, grass & pasture p50
0.13 / p75 0.20, developed-medium p50 0.09, developed-high p50 -0.01, water p90 -0.15. The textbook 0.5 / 0.7
tree breaks never occur here, which is why every forest parcel used to read as
"Shrubs / Garden".

  water     < -0.10
  bare      -0.10 – 0.08  rooftops, pavement, bare soil, rock
  sparse    0.08 – 0.20   grass, pasture, lawn
  moderate  0.20 – 0.29   shrubs, open woodland, edges
  dense     0.29 – 0.35   tree canopy
  veryDense > 0.35        dense conifer / mixed forest

Usage:  python3 scripts/shoreline/greenery-stats.py [--resume]
Needs:  earthengine-api (authenticated), shapely.  ~80 batches of 250 parcels.
"""
import json
import os
import sys
import time

import ee
from shapely import force_2d
from shapely.geometry import shape, mapping

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RAW = os.path.join(ROOT, 'data', 'shoreline', 'raw')
BUILD = os.path.join(ROOT, 'data', 'shoreline', 'build')
OUT = os.path.join(BUILD, 'greenery.json')
CKPT = os.path.join(BUILD, '.greenery.partial.json')

PROJECT = os.environ.get('EE_PROJECT', 'earthatlas')
BREAKS = [-0.10, 0.08, 0.20, 0.29, 0.35]  # water < -0.10: dark roofs and pavement read ~0 in this scene, open water p90 is -0.15
CLASSES = ['water', 'bare', 'sparse', 'moderate', 'dense', 'veryDense']
BATCH = 250
SCALE_M = 2  # NAIP is 0.6 m; 2 m keeps the class fractions stable at 1/11 the compute


def class_image(ndvi):
    bands = [ndvi.lt(BREAKS[0]).rename('water')]
    for i in range(len(BREAKS)):
        lo = BREAKS[i]
        hi = BREAKS[i + 1] if i + 1 < len(BREAKS) else None
        b = ndvi.gte(lo) if hi is None else ndvi.gte(lo).And(ndvi.lt(hi))
        bands.append(b.rename(CLASSES[i + 1]))
    return ee.Image.cat(bands)


def main():
    resume = '--resume' in sys.argv
    key = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')
    if key and os.path.exists(key):
        ee.Initialize(ee.ServiceAccountCredentials(json.load(open(key))['client_email'], key), project=PROJECT)
    else:
        ee.Initialize(project=PROJECT)
    sj = ee.Geometry.Rectangle([-123.35, 48.33, -122.65, 48.85])
    naip = ee.ImageCollection('USDA/NAIP/DOQQ').filterBounds(sj).filterDate('2023-01-01', '2024-01-01').mosaic()
    ndvi = naip.normalizedDifference(['N', 'R']).rename('ndvi')
    img = ee.Image.cat([ndvi, class_image(ndvi).multiply(100).toFloat()])
    reducer = ee.Reducer.mean().combine(ee.Reducer.stdDev(), sharedInputs=True)

    os.makedirs(BUILD, exist_ok=True)
    parcels = json.load(open(os.path.join(RAW, 'parcels.geojson')))['features']
    print(f'{len(parcels):,} parcels', flush=True)
    results = json.load(open(CKPT)) if resume and os.path.exists(CKPT) else {}
    todo = [f for f in parcels if str(f['properties'].get('FID')) not in results]
    print(f'{len(todo):,} to compute', flush=True)

    t0 = time.time()
    for b in range(0, len(todo), BATCH):
        chunk = todo[b:b + BATCH]
        feats = []
        for f in chunk:
            g = f.get('geometry')
            if not g:
                continue
            try:
                s = force_2d(shape(g)).simplify(0.000005, preserve_topology=True)  # parcels carry z=0; ~0.5 m
                if s.is_empty:
                    continue
                feats.append(ee.Feature(ee.Geometry(mapping(s), None, False), {'FID': str(f['properties'].get('FID'))}))
            except Exception as e:
                print(f'  skip FID {f["properties"].get("FID")}: {str(e)[:80]}', flush=True)
                continue
        if not feats:
            continue
        fc = ee.FeatureCollection(feats)
        for attempt in range(4):
            try:
                out = img.reduceRegions(collection=fc, reducer=reducer, scale=SCALE_M, tileScale=4).getInfo()
                break
            except Exception as e:  # EE hiccups: back off and retry
                print(f'  batch {b // BATCH} attempt {attempt + 1} failed: {str(e)[:120]}', flush=True)
                time.sleep(10 * (attempt + 1))
        else:
            raise SystemExit('giving up')
        for feat in out['features']:
            p = feat['properties']
            fid = p['FID']
            if p.get('ndvi_mean') is None:
                continue
            rec = {'mean': round(p['ndvi_mean'], 4), 'stdDev': round(p.get('ndvi_stdDev') or 0, 4)}
            for c in CLASSES:
                rec[c] = round(p.get(f'{c}_mean') or 0, 1)
            results[fid] = rec
        with open(CKPT, 'w') as fh:
            json.dump(results, fh)
        done = b + len(chunk)
        el = time.time() - t0
        print(f'  {done:,}/{len(todo):,} ({el:.0f}s, ~{el / done * (len(todo) - done):.0f}s left)', flush=True)

    # keep the file in FID order
    ordered = {k: results[k] for k in sorted(results, key=lambda x: int(x) if x.isdigit() else x)}
    with open(OUT, 'w') as fh:
        json.dump(ordered, fh, separators=(',', ':'))
    os.remove(CKPT)
    print(f'wrote {OUT}: {len(ordered):,} parcels, {os.path.getsize(OUT) / 1024:.0f} KB')


if __name__ == '__main__':
    main()
