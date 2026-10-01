#!/usr/bin/env python3
"""
Tidal flats, marsh and shoals for the GFW water routing: NOT NAVIGABLE (Josh 2026-09-30).

The coastlines we route on (OSM, Alaska DNR, NRCan NHN) are high-water lines, and the
"water if any source says water" union treats tidal flats and marsh as open water (cruise
ships' estimated paths crossed the Mendenhall Wetlands beside Juneau airport). So these OSM
features count as LAND for routing, for every vessel (GFW hourly rows carry no length, so
small craft get no exception):
  natural=wetland (any wetland=*: tidalflat, saltmarsh, marsh, …), natural=mud, natural=shoal,
  and anything tagged tidal=yes whose natural=* is wetland / mud / sand / shoal / shingle
  (tidal=yes on a river or riverbank is water and is ignored).
Inland wetlands are included too; they lie on land already, so they change nothing.

  python3 fetch_flats.py --stage pacnw            # Overpass per 5° box, cached raw → cache/land/flats-v1.pkl

Source: OpenStreetMap via the Overpass API (overpass-api.de), © OpenStreetMap contributors, ODbL 1.0.
Generic User-Agent; one query at a time; raw responses cached (cache/sources/overpass-flats/).
"""
import argparse, gzip, json, math, os, pickle, time, urllib.parse, urllib.request
import shapely
from shapely.geometry import Polygon, LineString
from shapely.ops import polygonize, unary_union
import areas, land

HERE = os.path.dirname(os.path.abspath(__file__))
UA = 'earthatlas-bake/1.0 (+https://earthatlas.org)'
URL = 'https://overpass-api.de/api/interpreter'
FLATS = os.path.join(land.LAND_DIR, 'flats-v1.pkl')
TIDAL_NATURAL = ('wetland', 'mud', 'sand', 'shoal', 'shingle')


def query(bbox):
    w, s, e, n = bbox
    b = f'{s},{w},{n},{e}'
    return (f'[out:json][timeout:300];(nwr["natural"~"^(wetland|mud|shoal)$"]({b});'
            f'nwr["tidal"="yes"]["natural"~"^({"|".join(TIDAL_NATURAL)})$"]({b}););out geom;')


# Two public mirrors, more patient retries: one busy or unreachable server no longer fails the bake (2026-10-01: overpass-api.de 504s /
# network unreachable from a GitHub runner for ~2 h failed a route job).
MIRRORS = [URL, 'https://overpass.kumi.systems/api/interpreter']


def fetch(bbox, raw_dir, depth=0):
    """One box → elements. On repeated timeouts the box is split in four (dense or busy servers)."""
    key = '_'.join(f'{v:+.2f}' for v in bbox)
    f = os.path.join(raw_dir, f'flats_{key}.json.gz')
    if os.path.exists(f):
        return json.load(gzip.open(f)).get('elements', [])
    data = urllib.parse.urlencode({'data': query(bbox)}).encode()
    for attempt in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(MIRRORS[attempt % len(MIRRORS)], data=data, headers={'User-Agent': UA}), timeout=400) as r:
                body = r.read()
            j = json.loads(body)
            if 'remark' in j and ('runtime error' in j['remark'] or 'timed out' in j['remark']):
                raise RuntimeError(j['remark'][:200])
            os.makedirs(raw_dir, exist_ok=True)
            open(f + '.tmp', 'wb').write(gzip.compress(body, 6)); os.replace(f + '.tmp', f)
            return j.get('elements', [])
        except Exception as e:
            print(f'  retry {key}: {e}', flush=True)
            time.sleep(min(30 * (attempt + 1), 120))
    if depth >= 3:
        raise RuntimeError(f'overpass failed for {bbox}')
    w, s_, e, n = bbox
    mx, my = (w + e) / 2, (s_ + n) / 2
    out = []
    for q in [(w, s_, mx, my), (mx, s_, e, my), (w, my, mx, n), (mx, my, e, n)]:
        out.extend(fetch(q, raw_dir, depth + 1))
    return out


def polygons(elements):
    out = []
    for el in elements:
        try:
            if el['type'] == 'way' and el.get('geometry'):
                c = [(p['lon'], p['lat']) for p in el['geometry']]
                if len(c) >= 4 and c[0] == c[-1]:
                    out.extend(land.polys(shapely.make_valid(Polygon(c))))
            elif el['type'] == 'relation':
                outer = [LineString([(p['lon'], p['lat']) for p in m['geometry']]) for m in el.get('members', [])
                         if m.get('type') == 'way' and m.get('role') in ('outer', '') and len(m.get('geometry') or []) >= 2]
                inner = [LineString([(p['lon'], p['lat']) for p in m['geometry']]) for m in el.get('members', [])
                         if m.get('type') == 'way' and m.get('role') == 'inner' and len(m.get('geometry') or []) >= 2]
                if outer:
                    g = unary_union(list(polygonize(unary_union(outer))))
                    if inner:
                        g = g.difference(unary_union(list(polygonize(unary_union(inner)))))
                    out.extend(land.polys(g))
        except Exception:
            continue
    return out


def boxes_for(tiles, step=5.0):
    for name, w, s, e, n in tiles:
        y = s
        while y < n:
            x = w
            while x < e:
                yield (x, y, min(e, x + step), min(n, y + step))
                x += step
            y += step


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--stage', default='pacnw')
    ap.add_argument('--raw', default=os.path.join(HERE, 'cache', 'sources', 'overpass-flats'))
    a = ap.parse_args()
    t0 = time.time()
    seen, polys, n_el = set(), [], 0
    for b in boxes_for(areas.stage(a.stage)):
        els = [e for e in fetch(b, a.raw) if (e['type'], e['id']) not in seen]
        seen.update((e['type'], e['id']) for e in els)
        n_el += len(els)
        polys.extend(polygons(els))
        print(f'  {b}: {len(els)} new features, {len(polys)} polygons total', flush=True)
    os.makedirs(os.path.dirname(FLATS), exist_ok=True)
    pickle.dump(dict(flats=polys, note=dict(elements=n_el, polygons=len(polys), stage=a.stage)), open(FLATS + '.tmp', 'wb'), protocol=4)
    os.replace(FLATS + '.tmp', FLATS)
    print(f'flats → {FLATS}: {n_el} OSM features, {len(polys)} polygons, {time.time()-t0:.0f}s')


if __name__ == '__main__':
    main()
