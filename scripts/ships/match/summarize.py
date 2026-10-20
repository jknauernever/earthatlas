#!/usr/bin/env python3
"""
B: what the same-MMSI pairs look like (scripts/ships/match/cache/features.json from profile.py). Read-only; prints tables.
Buckets by the decisive evidence first, then by the softer signals, so the plan is sized on the real pairs.
"""
import json, os, collections
HERE = os.path.dirname(os.path.abspath(__file__))
F = json.load(open(os.path.join(HERE, 'cache', 'features.json')))

def bucket(f):
    pos = f.get('pos') or {}
    if f['imo'] == 'conflict' or f['official'] == 'conflict': return 'A different registry ids (two ships)'
    if pos.get('same_minute_far', 0) >= 3: return 'B both broadcast at once, far apart (two ships)'
    if f['imo'] == 'agree' or f['official'] == 'agree': return 'C same registry id (one ship)'
    if f['blank_mmsi']: return 'D blank MMSI (MMSI says nothing)'
    cs, ln, ns = f['callsign'], f['length'], f['name_sim']
    if cs == 'conflict' and ln == 'conflict': return 'E call sign AND length differ (two ships)'
    if cs == 'conflict': return 'F call sign differs, rest unclear'
    if ns is None: return 'G a name missing'
    if ns >= 0.92 and ln != 'conflict': return 'H names match, nothing conflicts (one ship?)'
    if ns >= 0.92: return 'I names match, length differs'
    return 'J names differ'

c = collections.Counter(bucket(f) for f in F)
print(f'{len(F)} same-MMSI pairs on dev\n')
for k, n in sorted(c.items()): print(f'{n:6d}  {k}')
small = sum(1 for f in F if min(f['claims']) <= 10)
print(f'\n{small} pairs ({100 * small // len(F)}%) have one record with <= 10 claims (a fragment)')
withpos = [f for f in F if (f.get('pos') or {}).get('a_min') and (f.get('pos') or {}).get('b_min')]
print(f'{len(withpos)} pairs have positions for BOTH identities in the Salish Sea year; {sum(1 for f in withpos if f["pos"]["same_minute"])} of them broadcast in the same minute at least once')
