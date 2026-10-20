#!/usr/bin/env python3
"""
B (match score, Josh 2026-10-19): features for every same-MMSI pair of vessel records (scripts/ships/match/export-pairs.mjs),
from the records' identity facts AND our own AIS positions (salish-v6 daily points cache, which carries the name, call sign
and length each ship broadcast with every position). Read-only; writes scripts/ships/match/cache/features.json.

  python3 scripts/ships/match/profile.py [--limit N]

Per pair: name similarity (Jaro-Winkler on normalized names), call sign / length / IMO / USCG number agree-conflict-missing,
shared licensee/owner, record sizes, blank MMSI, and from positions: how many positions each record's identity broadcast on
the shared MMSI, whether both broadcast in the same minute (and how far apart), and how their broadcasting periods relate
(overlapping / one after the other).
"""
import json, re, sys, os, math
import duckdb

HERE = os.path.dirname(os.path.abspath(__file__))
POINTS = os.path.join(HERE, '..', 'bake-ais', 'cache', 'points', 'salish-v6', '2*.parquet')
LIMIT = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else None
norm = lambda s: re.sub(r'[^A-Z0-9]', '', (s or '').upper())

def jaro_winkler(a, b):
    if not a or not b: return 0.0
    if a == b: return 1.0
    d = max(len(a), len(b)) // 2 - 1
    ma, mb = [False] * len(a), [False] * len(b)
    m = 0
    for i, ch in enumerate(a):
        for j in range(max(0, i - d), min(len(b), i + d + 1)):
            if not mb[j] and b[j] == ch: ma[i] = mb[j] = True; m += 1; break
    if not m: return 0.0
    t, k = 0, 0
    for i in range(len(a)):
        if ma[i]:
            while not mb[k]: k += 1
            if a[i] != b[k]: t += 1
            k += 1
    j = (m / len(a) + m / len(b) + (m - t / 2) / m) / 3
    p = 0
    while p < min(4, len(a), len(b)) and a[p] == b[p]: p += 1
    return j + p * 0.1 * (1 - j)

def blank_mmsi(m):
    s = str(m)
    return (len(s) != 9 or s.endswith('000000') or len(set(s)) == 1 or s in ('123456789', '987654321', '111111111')
            or not s[0] in '234567')

def agree(x, y, eq=lambda u, v: u == v):
    if not x or not y: return 'missing'
    return 'agree' if any(eq(u, v) for u in x for v in y) else 'conflict'

data = json.load(open(os.path.join(HERE, 'cache', 'pairs.json')))
pairs, R = data['pairs'][:LIMIT] if LIMIT else data['pairs'], data['records']
# Pairs sorted by MMSI; positions loaded 200 MMSIs at a time (all of them at once would be ~100M+ rows in memory).
pairs = sorted(pairs, key=lambda p: p.get('mmsi') or '')
con = duckdb.connect()
loaded = set()
def ensure(mm):
    if mm in loaded: return
    batch = []
    for p in pairs:
        x = p.get('mmsi') or ''
        if x.isdigit() and int(x) not in loaded and int(x) not in batch and int(x) >= mm: batch.append(int(x))
        if len(batch) >= 200: break
    con.execute('DROP TABLE IF EXISTS pts')
    con.execute(f"""CREATE TABLE pts AS SELECT mmsi, date_trunc('minute', base_date_time) m, base_date_time t, latitude lat, longitude lon,
                      regexp_replace(upper(coalesce(vessel_name, '')), '[^A-Z0-9]', '', 'g') nm, regexp_replace(upper(coalesce(call_sign, '')), '[^A-Z0-9]', '', 'g') cs
                      FROM read_parquet('{POINTS}') WHERE mmsi IN (SELECT unnest(?::INTEGER[]))""", [batch])
    loaded.update(batch)

def hav(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    return 6371 * 2 * math.asin(math.sqrt(math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2))

out = []
for i, p in enumerate(pairs):
    A, B, mm = R[p['a']], R[p['b']], p.get('mmsi') or ''
    f = {'a': p['a'], 'b': p['b'], 'mmsi': mm, 'blank_mmsi': blank_mmsi(mm)}
    f['name_sim'] = max([jaro_winkler(x, y) for x in A['names'] for y in B['names']] or [None]) if A['names'] and B['names'] else None
    f['callsign'] = agree(A['callsigns'], B['callsigns'])
    f['length'] = agree(A['lengths'], B['lengths'], lambda u, v: abs(u - v) <= max(1, 0.1 * max(u, v)))
    f['imo'] = agree(A['imos'], B['imos'])
    f['official'] = agree(A['official'], B['official'])
    f['party'] = agree(A['parties'], B['parties'])
    f['claims'] = [A['claims'], B['claims']]
    f['sources'] = [sorted(A['sources']), sorted(B['sources'])]
    f['names'] = [A['names'][:4], B['names'][:4]]
    f['callsigns'] = [A['callsigns'][:3], B['callsigns'][:3]]
    f['lengths'] = [sorted(set(A['lengths']))[:3], sorted(set(B['lengths']))[:3]]
    # Positions on the shared MMSI, each assigned to the record whose name or call sign it broadcast (a position that
    # matches both records, or neither, stays unassigned: it cannot tell them apart).
    if mm.isdigit():
        an, bn, ac, bc = set(A['names']), set(B['names']), set(A['callsigns']), set(B['callsigns'])
        ensure(int(mm))
        rows = con.execute('SELECT m, lat, lon, nm, cs FROM pts WHERE mmsi = ? ORDER BY t', [int(mm)]).fetchall()
        ma, mb = {}, {}
        for m, lat, lon, nm, cs in rows:
            ina, inb = (nm in an) or (cs and cs in ac), (nm in bn) or (cs and cs in bc)
            if ina and not inb: ma.setdefault(m, (lat, lon))
            elif inb and not ina: mb.setdefault(m, (lat, lon))
        both = [hav(ma[m], mb[m]) for m in ma.keys() & mb.keys()]
        f['pos'] = {'a_min': len(ma), 'b_min': len(mb), 'same_minute': len(both), 'same_minute_far': sum(d >= 5 for d in both),
                    'max_km': round(max(both), 1) if both else None,
                    'a_span': [str(min(ma))[:10], str(max(ma))[:10]] if ma else None, 'b_span': [str(min(mb))[:10], str(max(mb))[:10]] if mb else None}
    out.append(f)
    if (i + 1) % 1000 == 0: print(f'  {i + 1}/{len(pairs)}', file=sys.stderr)
json.dump(out, open(os.path.join(HERE, 'cache', 'features.json'), 'w'))
print(len(out), 'pairs →', os.path.join('scripts/ships/match/cache/features.json'), file=sys.stderr)
