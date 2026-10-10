#!/usr/bin/env python3
"""
Fill the z3-4 hole in the cut US-wide months (Josh 2026-10-09). The first cut (cls2) removed US lines inside the Salish
box at every zoom, but the Salish tiles start at z5, so the Salish Sea was empty when zoomed out to z3-4. The month's
class-only tiles (tracks-cls1.pmtiles, uncut, still beside it on Blob) have the right z3-4, so this joins z3-4 from cls1
with z5-10 from the published cut tiles. No pack, no line processing; add_classes.py --cut-salish now builds the same.

  python3 splice_z34.py --month 2025-07 --out build/splice
Output: <out>/<month>/tracks.pmtiles + manifest.json, for publish.mjs --classes (rules us-v2-cls5). Deps: tile-join.
"""
import argparse, json, os, subprocess, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from add_classes import INDEX, UA, CUT_RULES, get  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--month', required=True)
    ap.add_argument('--index', default=INDEX)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    ym = a.month
    wd = os.path.join(a.out, ym)
    os.makedirs(wd, exist_ok=True)
    with urllib.request.urlopen(urllib.request.Request(f'{a.index}?t={os.getpid()}', headers=UA), timeout=60) as r:
        entry = json.load(r)['months'][ym]
    cls = entry.get('classes') or {}
    if cls.get('rules') != 'us-v2-cls2':
        sys.exit(f'{ym}: published tiles are {cls.get("rules")}, not the cls2 cut; nothing to splice')
    cut_url = entry['tiles']
    uncut_url = cut_url.rsplit('/', 1)[0] + '/tracks-cls1.pmtiles'
    cut = get(cut_url, os.path.join(wd, 'cut.pmtiles'))
    uncut = get(uncut_url, os.path.join(wd, 'uncut.pmtiles'))
    low, rest, pm = (os.path.join(wd, f) for f in ('z34.pmtiles', 'z5plus.pmtiles', 'tracks.pmtiles'))
    subprocess.run(['tile-join', '-o', low, '-f', '--no-tile-size-limit', '--maximum-zoom=4', uncut], check=True)
    subprocess.run(['tile-join', '-o', rest, '-f', '--no-tile-size-limit', '--minimum-zoom=5', cut], check=True)
    subprocess.run(['tile-join', '-o', pm, '-f', '--no-tile-size-limit', low, rest], check=True)
    for f in (low, rest, cut, uncut):
        os.remove(f)
    with urllib.request.urlopen(urllib.request.Request(cls['manifest'], headers=UA), timeout=60) as r:
        prev = json.load(r)
    manifest = {'month': ym, 'rules': CUT_RULES, 'spliced': {'z3_4': uncut_url, 'z5_10': cut_url},
                'cut_box': prev.get('cut_box'), 'from_tiles': prev['from_tiles'], 'from_pack': prev['from_pack'],
                'stats': prev['stats'], 'types': prev.get('types'), 'pmtiles_bytes': os.path.getsize(pm)}
    json.dump(manifest, open(os.path.join(wd, 'manifest.json'), 'w'), indent=1)
    print(json.dumps(manifest), flush=True)


if __name__ == '__main__':
    main()
