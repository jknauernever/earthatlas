#!/usr/bin/env python3
"""Add a fresh test stretch of shoreline to the dock-detection pilot: tiles every 72 m
along the coast inside a bbox, same imagery and size as prepare_pilot.py's pilot set,
appended to manifest.json as set <name> (ids <name>_00000…). Never relabels or
re-plans the existing tiles.

    python3 scripts/sanjuan-docks/ml/prepare_test_area.py westcott -123.19 48.585 -123.12 48.625          # plan only
    python3 scripts/sanjuan-docks/ml/prepare_test_area.py westcott -123.19 48.585 -123.12 48.625 --fetch  # download
    … county -123.25 48.40 -122.70 48.81 --skip-sets pilot,westcott,wasp --fetch   # rest of the county

--skip-sets leaves out shoreline inside those sets' areas (their tiles already exist).
Downloads skip tiles already on disk, so an interrupted run resumes where it stopped.
"""
import json, os, sys, time
from shapely.geometry import box, LineString

sys.argv, _args = sys.argv[:1], sys.argv[1:]  # prepare_pilot reads sys.argv at import
import importlib.util
spec = importlib.util.spec_from_file_location('pp', os.path.join(os.path.dirname(__file__), 'prepare_pilot.py'))
pp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pp)  # defs only: its main block is guarded by __name__

name, x0, y0, x1, y1 = _args[0], *map(float, _args[1:5])
manifest = json.load(open(f'{pp.ROOT}/manifest.json'))
existing = [t for t in manifest['tiles'] if t['set'] == name]
if existing:
    tiles = existing
else:
    area = box(x0, y0, x1, y1)
    coast = pp.coastline().intersection(area)
    skip = next((a.split('=', 1)[1] if '=' in a else _args[_args.index(a) + 1] for a in _args if a.startswith('--skip-sets')), '')
    for s_ in filter(None, skip.split(',')):
        coast = coast.difference(box(*(manifest['pilot_bbox'] if s_ == 'pilot' else manifest['test_areas'][s_])))
    flat = lambda g: [x for sub in getattr(g, 'geoms', [g]) for x in (flat(sub) if hasattr(sub, 'geoms') else [sub])]
    tiles = []
    for part in (g for g in flat(coast) if isinstance(g, LineString)):
        lat = part.centroid.y
        part_m = pp.ll2m(part)
        n = max(1, int(part_m.length / (pp.COAST_STEP_M * pp.merc_scale(lat))))
        for k in range(n + 1):
            c = part_m.interpolate(k / n, normalized=True)
            tiles.append({'set': name, 'bbox': pp.tile_bbox(c.x, c.y, lat)})
    for i, t in enumerate(tiles):
        t['id'] = f'{name}_{i:05d}'
print(f'{name}: {len(tiles)} tiles along the shore in {x0},{y0},{x1},{y1}')
if '--fetch' in _args:
    if not existing:
        manifest.setdefault('test_areas', {})[name] = [x0, y0, x1, y1]
        manifest['tiles'] += tiles
        json.dump(manifest, open(f'{pp.ROOT}/manifest.json', 'w'))
    # --workers N: N requests at a time (2 keeps a big run near ~0.5 s/tile without
    # hammering the county's public server).
    workers = int(next((a.split('=', 1)[1] for a in _args if a.startswith('--workers=')), '1'))
    from concurrent.futures import ThreadPoolExecutor
    t0, got = time.time(), 0
    with ThreadPoolExecutor(workers) as ex:
        for i, ok in enumerate(ex.map(pp.fetch, tiles)):
            got += ok
            if (i + 1) % 250 == 0:
                print(f'  {i + 1}/{len(tiles)} ({got} fetched, {time.time() - t0:.0f} s)', flush=True)
    print(f'done: {got} tiles fetched in {time.time() - t0:.0f} s')
