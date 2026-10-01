#!/usr/bin/env python3
"""
Bake one month of GFW hourly track lines (scripts/ships/bake-gfw/, rules in lines.py).

  python3 bake.py route --month 2026-08 --stage pacnw [--areas a,b] [--group NAME] [--workers 4]
  python3 bake.py tile  --month 2026-08                  # every group's features → tiles + pack + manifest
  python3 bake.py index                                   # local index.json over every baked month (dev)
  python3 bake.py traffic [--stage pacnw]                 # cumulative traffic raster from every raw month on disk

  route: raw reports (fetch.py) → features (routed, est=0 observed / est=1 estimated) in
         WORK/<month>/<group>.ndjson.gz + <group>.stats.json. One job per (month, group); a
         line that crosses from one group's areas to another's is split there, so groups are
         big regions. Resumable: an existing part is skipped unless --force.
  tile:  WORK/<month>/*.ndjson.gz → OUT/<month>/{tracks.pmtiles, tracks.pack, manifest.json}
         (tippecanoe -Z5 -z10 as the Salish bake; temp file + rename, so a reader never sees a
         half-written file). The pack holds every line grouped by MMSI (api/ship-tracks ?mmsi=).
NOAA preference rule (areas.py NOAA_AREAS): positions inside a NOAA box in a month NOAA has
published are dropped before lines are built. Salish months come from src/ships/trackSource.json,
US months from the US-wide index (trackSource.us.index).
Env: GFW_RAW, GFW_WORK, GFW_OUT override cache/raw, cache/work, cache/out.
"""
import argparse, calendar, datetime as dt, glob, gzip, json, multiprocessing as mp, os, struct, subprocess, sys, time, urllib.request
from collections import Counter, defaultdict
import areas
import lines as L

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
RAW = os.environ.get('GFW_RAW', os.path.join(HERE, 'cache', 'raw'))
WORK = os.environ.get('GFW_WORK', os.path.join(HERE, 'cache', 'work'))
OUT = os.environ.get('GFW_OUT', os.path.join(HERE, 'cache', 'out', L.RULES['version']))
PACK_SHARDS = 1024


def month_bounds(ym):
    y, m = map(int, ym.split('-'))
    a = calendar.timegm((y, m, 1, 0, 0, 0))
    b = calendar.timegm((y + (m == 12), m % 12 + 1, 1, 0, 0, 0))
    return a, b


def noaa_boxes(ym):
    """NOAA boxes that NOAA has published for this month (preference rule)."""
    ts = json.load(open(os.path.join(ROOT, 'src', 'ships', 'trackSource.json')))
    have = {'salish': set(ts.get('months') or []), 'us': set()}
    try:
        have['us'] = set(json.load(urllib.request.urlopen(ts['us']['index'], timeout=60)).get('months', {}))
    except Exception as e:   # no index reachable: treat US months as not covered, and say so
        print(f'  WARNING: US index unreadable ({e}); US boxes not excluded', flush=True)
    return [a['bbox'] for a in areas.NOAA_AREAS if ym in have[a['months']]]


def raw_files(area, ym):
    a, b = month_bounds(ym)
    out = []
    for f in glob.glob(os.path.join(RAW, area, f'{area}_*.json.gz')):
        parts = os.path.basename(f)[:-8].split('_')
        d0 = calendar.timegm(time.strptime(parts[1], '%Y-%m-%d'))
        span = int(parts[2][:-1]) if len(parts) > 2 and parts[2].endswith('d') else 1
        if d0 < b and d0 + span * 86400 > a:
            out.append(f)
    return sorted(out)


def load(ym, area_names, boxes_excl):
    a, b = month_bounds(ym)
    ident, pts, st = {}, defaultdict(dict), Counter()
    for area in area_names:
        for f in raw_files(area, ym):
            for e in json.load(gzip.open(f)).get('entries') or []:
                for rows in (e or {}).values():
                    for r in rows or []:          # GFW sends null for an area with no vessels
                        t = calendar.timegm(time.strptime(r['date'], '%Y-%m-%d %H:%M'))
                        if not a <= t < b:
                            continue
                        st['rows'] += 1
                        vid = r['vesselId']
                        if not vid:
                            st['rows_no_vessel'] += 1; continue
                        la, lo = r['lat'], r['lon']
                        if any(w <= lo <= e_ and s <= la <= n for w, s, e_, n in boxes_excl):
                            st['rows_in_noaa_area'] += 1; continue
                        if t in pts[vid]:
                            st['dup_vessel_hour'] += 1; continue
                        pts[vid][t] = (la, lo)
                        if vid not in ident:
                            ident[vid] = dict(vid=vid, name=r.get('shipName') or '', mmsi=r.get('mmsi') or '', imo=r.get('imo') or '',
                                              flag=r.get('flag') or '', gtype=r.get('vesselType') or '')
    st['vessels'] = len(pts)
    return ident, {v: sorted(p.items()) for v, p in pts.items()}, st


ROUTER = None
TRAFFIC_DIR = os.path.join(os.environ.get('GFW_LAND_DIR', os.path.join(HERE, 'cache', 'land')), 'traffic-v1')   # one .npz per month


def _init(boxes, traffic=None):
    global ROUTER
    import land
    ROUTER = L.Router(land.Land(boxes), traffic)


def _piece(p):
    try:
        return ROUTER.piece(p)
    except Exception as e:   # never lose a month to one bad geometry; count it
        return [], Counter(piece_errors=1, **{'piece_error_' + type(e).__name__: 1})


def props(idn, ym, t0, t1, n, est):
    p = {'vid': idn['vid'], 'name': idn['name'], 'mmsi': int(idn['mmsi']) if str(idn['mmsi']).isdigit() else None,
         'imo': idn['imo'], 'flag': idn['flag'], 'vtype': idn['gtype'], 'kind': L.KIND.get(idn['gtype'], 'other'),
         'month': ym, 't0': t0, 't1': t1, 'n': n, 'src': 'gfw'}
    if est:
        p['est'] = 1
    return {k: v for k, v in p.items() if v not in (None, '')}


def cmd_route(a):
    tiles = areas.stage(a.stage)
    if a.areas:
        tiles = [t for t in tiles if t[0] in set(a.areas.split(','))]
    group = a.group or (a.areas.replace(',', '+') if a.areas else a.stage)
    wd = os.path.join(WORK, a.month)
    part = os.path.join(wd, f'{group}.ndjson.gz')
    if os.path.exists(part) and not a.force:
        print('exists, skipped:', part); return
    os.makedirs(wd, exist_ok=True)
    t0 = time.time()
    excl = noaa_boxes(a.month)
    ident, tracks, st = load(a.month, [t[0] for t in tiles], excl)
    print(f'loaded {a.month} {group}: {dict(st)} noaa_excluded={excl} {time.time()-t0:.0f}s', flush=True)
    pieces = [(v, p) for v, s in tracks.items() for p in L.split_raw(s)]
    st['raw_pieces'] = len(pieces)
    drawn = [(v, p) for v, p in pieces if L.drawable(p)]
    st['lines_before_routing'] = len(drawn)
    boxes = [tuple(t[1:]) for t in tiles]
    rc = Counter()
    # Traffic raster: this month's rows (every vessel) + the cumulative raster when present (traffic.py).
    import traffic as TR
    tr = TR.Traffic()
    have = sorted(glob.glob(os.path.join(TRAFFIC_DIR, '*.npz')))
    for f in have:
        tr = tr.merged(TR.Traffic.load(f))
    if not any(os.path.basename(f) == f'{a.month}.npz' for f in have):
        tr = tr.merged(TR.Traffic.from_tracks(tracks))
    st['traffic_months'] = len(have) + (0 if any(os.path.basename(f) == f'{a.month}.npz' for f in have) else 1)
    st['traffic_cells'] = int(len(tr.keys))
    ctx = mp.get_context('fork')
    _init(boxes, tr)   # load land before forking (copy-on-write)
    with gzip.open(part + '.tmp', 'wt', compresslevel=6) as fh, ctx.Pool(a.workers) as pool:
        for k, ((vid, _), (runs, c)) in enumerate(zip(drawn, pool.imap(_piece, [p for _, p in drawn], chunksize=8))):
            rc.update(c)
            for est, coords, ta, tb, n in runs:
                if len(set(coords)) < 2:
                    continue
                parts = L.to180_parts(coords)
                if not parts:
                    continue
                geom = {'type': 'LineString', 'coordinates': parts[0]} if len(parts) == 1 else {'type': 'MultiLineString', 'coordinates': parts}
                fh.write(json.dumps({'type': 'Feature', 'geometry': geom, 'properties': props(ident[vid], a.month, ta, tb, n, est)},
                                    separators=(',', ':')) + '\n')
                rc[f'features_est{est}'] += 1
            if (k + 1) % 5000 == 0:
                print(f'  {k + 1}/{len(drawn)} {time.time()-t0:.0f}s', flush=True)
    os.replace(part + '.tmp', part)
    stats = dict(month=a.month, group=group, areas=[t[0] for t in tiles], noaa_excluded=excl, load=dict(st), route=dict(rc),
                 secs=round(time.time() - t0), rules=L.RULES)
    json.dump(stats, open(os.path.join(wd, f'{group}.stats.json'), 'w'), indent=1)
    print(json.dumps(stats), flush=True)


# EarthAtlas's own ship type by MMSI (2026-10-01). GFW's vessel types lump tankers into CARGO / OTHER, so under the
# Ship tracks kind filter (default: tankers) most GFW lines vanished. The tile step re-types each line from the SAME
# MMSI → type-over-time lookup the NOAA bake uses (lib/ships/typeLookup.js, served at /api/ships?op=typeLookup):
# only when exactly one type is known for that MMSI during the line's own time span, never for an MMSI shared by
# two vessels (a: 1) or with conflicting sources (x: 1). Otherwise GFW's type stays. The line keeps vtype (GFW's own).
GROUP_KIND = {'cargo': 'cargo', 'tanker': 'tanker', 'passenger': 'passenger', 'fishing': 'fishing', 'tug_tow': 'tug',
              'port_service': 'tug', 'recreational': 'pleasure', 'government': 'other', 'research': 'other',
              'offshore': 'other', 'naval': 'other', 'other': 'other'}


class ShipTypes:
    def __init__(self, lookup):
        self.m = lookup or {}
        self.stats = Counter()

    @classmethod
    def load(cls, src):
        if not src:
            return cls(None)
        if src.startswith('http'):
            hdr = {'User-Agent': 'earthatlas-bake/1.0 (+https://earthatlas.org)', 'Accept-Encoding': 'gzip'}
            if os.environ.get('CRON_SECRET'):          # the op is secret-locked (api/ships.js BAKE_OPS)
                hdr['Authorization'] = f"Bearer {os.environ['CRON_SECRET']}"
            req = urllib.request.Request(src, headers=hdr)
            with urllib.request.urlopen(req, timeout=300) as r:
                body = r.read()
                if r.headers.get('Content-Encoding') == 'gzip':
                    body = gzip.decompress(body)
            d = json.loads(body)
        else:
            d = json.load(open(src))
        print(f'type lookup: {len(d.get("mmsi", {}))} MMSIs ({d.get("meta", {}).get("generated_at")})', flush=True)
        return cls(d.get('mmsi'))

    @staticmethod
    def _secs(iso):
        return None if iso is None else calendar.timegm(time.strptime(iso[:19], '%Y-%m-%dT%H:%M:%S'))

    def apply(self, pr):
        if not self.m or 'mmsi' not in pr:
            return
        kinds = set()
        for e in self.m.get(str(pr['mmsi']), []):
            f, t = self._secs(e.get('f')), self._secs(e.get('t'))
            if (f is not None and f > pr['t1']) or (t is not None and t < pr['t0']):
                continue
            if e.get('a') or e.get('x') or not e.get('g'):
                kinds.add(None); continue
            kinds.add(GROUP_KIND.get(e['g'], 'other'))
        if len(kinds) == 1 and None not in kinds:
            k = kinds.pop()
            self.stats['retyped' if k != pr.get('kind') else 'confirmed'] += 1
            pr['kind'] = k
        else:
            self.stats['gfw_type_kept'] += 1


def cmd_tile(a):
    wd = os.path.join(WORK, a.month)
    parts = sorted(glob.glob(os.path.join(wd, '*.ndjson.gz')))
    if not parts:
        sys.exit(f'no route parts in {wd}')
    od = os.path.join(OUT, a.month)
    os.makedirs(od, exist_ok=True)
    t0 = time.time()
    nd = os.path.join(od, 'tracks.ndjson')
    shards = [[] for _ in range(PACK_SHARDS)]
    n_feat, vessels, est1 = 0, set(), 0
    typer = ShipTypes.load(os.environ.get('GFW_TYPE_LOOKUP'))
    with open(nd, 'w') as fh:
        for p in parts:
            for line in gzip.open(p, 'rt'):
                f = json.loads(line); pr = f['properties']
                typer.apply(pr)
                fh.write(json.dumps(f, separators=(',', ':')) + '\n')
                n_feat += 1; vessels.add(pr['vid']); est1 += pr.get('est', 0)
                if 'mmsi' in pr:
                    cs = f['geometry']['coordinates']
                    for c in ([cs] if f['geometry']['type'] == 'LineString' else cs):
                        shards[pr['mmsi'] % PACK_SHARDS].append(json.dumps(
                            {'mmsi': pr['mmsi'], 'kind': pr['kind'], 'vtype': pr.get('vtype'), 't0': pr['t0'], 't1': pr['t1'], 'n': pr['n'],
                             'est': pr.get('est', 0), 'vid': pr['vid'], 'c': c}, separators=(',', ':')))
    tmp = os.path.join(od, 'tracks.tmp.pmtiles')
    subprocess.run(['tippecanoe', '-o', tmp, '-l', 'tracks', '-f', '-q', '-Z5', '-z10', '--simplification=10',
                    '--simplification-at-maximum-zoom=1', '--drop-densest-as-needed', '--read-parallel', nd], check=True)
    os.replace(tmp, os.path.join(od, 'tracks.pmtiles')); os.remove(nd)
    blobs = [gzip.compress(('\n'.join(sh) + '\n').encode(), 9) if sh else b'' for sh in shards]
    offs, pos = [], 0
    for b_ in blobs:
        offs.append(pos); pos += len(b_)
    offs.append(pos)
    pk = os.path.join(od, 'tracks.pack')
    with open(pk + '.tmp', 'wb') as fh:
        fh.write(b'SHTP'); fh.write(struct.pack('<I', PACK_SHARDS)); fh.write(struct.pack(f'<{PACK_SHARDS + 1}I', *offs))
        for b_ in blobs:
            fh.write(b_)
    os.replace(pk + '.tmp', pk)
    groups = [json.load(open(p[:-len('.ndjson.gz')] + '.stats.json')) for p in parts if os.path.exists(p[:-len('.ndjson.gz')] + '.stats.json')]
    manifest = dict(tileset=L.RULES['version'], month=a.month, built=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                    source='Global Fishing Watch 4Wings presence, HOURLY, HIGH (0.01°), group-by VESSEL_ID; CC BY-NC 4.0',
                    rules=L.RULES, areas=sorted({x for g in groups for x in g['areas']}),
                    noaa_excluded=groups[0]['noaa_excluded'] if groups else [],
                    stats=dict(lines=n_feat, estimated_features=est1, vessels=len(vessels), ship_types=dict(typer.stats)),
                    groups={g['group']: dict(load=g['load'], route=g['route'], secs=g['secs']) for g in groups},
                    pmtiles_bytes=os.path.getsize(os.path.join(od, 'tracks.pmtiles')), pack=dict(shards=PACK_SHARDS, bytes=os.path.getsize(pk)),
                    secs=round(time.time() - t0))
    json.dump(manifest, open(os.path.join(od, 'manifest.json'), 'w'), indent=1)
    print(json.dumps({k: manifest[k] for k in ('month', 'stats', 'pmtiles_bytes', 'pack', 'secs')}), flush=True)


def cmd_traffic(a):
    """Per-month traffic rasters (distinct vessels per 0.01° cell) for every raw month on disk (or --months);
    route jobs sum every month file present. A re-fetched month simply replaces its own file."""
    import traffic as TR
    months = a.months.split() if a.months else sorted({os.path.basename(f).split('_')[1][:7] for f in glob.glob(os.path.join(RAW, '*', '*.json.gz'))})
    tiles = areas.stage(a.stage)
    os.makedirs(TRAFFIC_DIR, exist_ok=True)
    for ym in months:
        _, tracks, st = load(ym, [t[0] for t in tiles], [])   # NOAA boxes NOT excluded: all observed traffic counts
        m = TR.Traffic.from_tracks(tracks)
        m.save(os.path.join(TRAFFIC_DIR, f'{ym}.npz'))
        print(f'  {ym}: {st["vessels"]} vessels, {len(m.keys)} cells → {TRAFFIC_DIR}/{ym}.npz', flush=True)


def cmd_index(a):
    months = {}
    for m in sorted(glob.glob(os.path.join(OUT, '*', 'manifest.json'))):
        j = json.load(open(m))
        months[j['month']] = dict(built=j['built'], areas=j['areas'], lines=j['stats']['lines'], vessels=j['stats']['vessels'],
                                  pmtiles_bytes=j['pmtiles_bytes'], pack_bytes=j['pack']['bytes'], noaa_excluded=j['noaa_excluded'])
    idx = dict(version=L.RULES['version'], months=months, updated=dt.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'))
    f = os.path.join(OUT, 'index.json')
    json.dump(idx, open(f + '.tmp', 'w'), indent=1); os.replace(f + '.tmp', f)
    print(f'{f}: {list(months)}')


def main():
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest='cmd', required=True)
    r = sp.add_parser('route'); r.add_argument('--month', required=True); r.add_argument('--stage', default='pacnw')
    r.add_argument('--areas'); r.add_argument('--group'); r.add_argument('--workers', type=int, default=4); r.add_argument('--force', action='store_true')
    t = sp.add_parser('tile'); t.add_argument('--month', required=True)
    sp.add_parser('index')
    tr = sp.add_parser('traffic'); tr.add_argument('--stage', default='pacnw'); tr.add_argument('--months', help='space-separated YYYY-MM (default: every raw month on disk)')
    a = ap.parse_args()
    {'route': cmd_route, 'tile': cmd_tile, 'index': cmd_index, 'traffic': cmd_traffic}[a.cmd](a)


if __name__ == '__main__':
    main()
