#!/usr/bin/env python3
"""
Precompute per-parcel proximity to Friends of the San Juans nearshore datasets.

For every tax parcel (keyed by FID, same as ndvi_parcel_stats.json) this writes:
  kelp      merged bull kelp patches within KELP_FT of the parcel (count, acres, nearest ft)
  eelgrass  deep-water-edge eelgrass segments within EELGRASS_FT (count, length, depths, sites)
  forage    documented spawning beaches within FORAGE_FT (names, species); potential beach habitat
            only where it fronts the parcel (POTENTIAL_FT) and the parcel's own shoreform is not rocky
  herring   herring spawning grounds within HERRING_FT of the parcel
  shoreform nearest Friends geomorphic shoreform segment within SHOREFORM_FT (class + attributes)
  fish      Beamer & Fresh fish-use scores (max high-resolution-model score per species) for segments within FISH_FT
  mods      shoreline modifications: armor within ARMOR_FT (length), docks / groins / ramps /
            railways / pilings within STRUCTURE_FT, mooring buoys & floats within BUOY_FT
  shore     nearest surveyed shoreline segment at any distance (feet + place name) — every parcel

Ported unchanged (same distances, same rules, same record shape) from Salish Sea Explorer's
scripts/compute-nearshore-stats.py, so /shoreline's property popup reads exactly what SSE's did.
Only the paths differ: parcels come from the fresh county download (fetch-county.mjs) and the
Friends + fish-use layers from public/shoreline-data. Records are keyed by the download's FID
(PINs repeat across multi-part parcels); bake-parcels.mjs attaches them to the same features.

Usage:  python3 scripts/shoreline/nearshore-stats.py
Needs:  shapely>=2, pyproj  (pip install shapely pyproj)
Inputs: data/shoreline/raw/parcels.geojson, public/shoreline-data/*
Output: data/shoreline/build/nearshore.json
"""
import json
import os
import sys
import time
from datetime import datetime, timezone

import numpy as np
import shapely
from pyproj import Transformer
from shapely import STRtree
from shapely.geometry import shape

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(ROOT, 'public', 'shoreline-data')
RAW = os.path.join(ROOT, 'data', 'shoreline', 'raw')
BUILD = os.path.join(ROOT, 'data', 'shoreline', 'build')

KELP_FT = 500
EELGRASS_FT = 500
FORAGE_FT = 200  # documented spawning beaches: widened from 100 (2026-09-02) so parcels behind a road / community lot still read as shoreline
# Potential (unsurveyed) beach habitat only counts where it actually fronts the parcel, and
# never for a parcel whose own shoreline is bedrock — Friends' rule (2026-09-14): potential
# forage fish spawning must not include any rocky geology.
POTENTIAL_FT = 25
ROCKY_SHOREFORM = 'Rocky Shoreline'
HERRING_FT = 100  # herring spawning grounds within this distance (client asked for same as forage fish)
SHOREFORM_FT = 200  # nearest Friends shoreform segment; widened from 50 for the same reason as FORAGE_FT
FISH_FT = 200  # Beamer & Fresh shoreline segments (fish use scores) — same reach as the shoreform
ARMOR_FT = 50  # shoreline armor touching / hugging the parcel line
STRUCTURE_FT = 100  # docks, groins, ramps, railways, pilings
BUOY_FT = 300  # mooring buoys and floats sit offshore

# Beamer & Fresh species column suffixes (HRM_<code>) — keep in sync with src/config/fishUse.ts FISH_SPECIES
FISH_CODES = ['Ck', 'Chum', 'Pk', 'Herr', 'Lance', 'Smelt', 'Hex']

# WGS84 → NAD83(HARN) / Washington North (US survey feet) so buffers are in feet
TO_FT = Transformer.from_crs('EPSG:4326', 'EPSG:2926', always_xy=True)


def load(name, folder=DATA):
    p = os.path.join(folder, name)
    t = time.time()
    with open(p) as f:
        d = json.load(f)
    feats = d['features']
    print(f'  loaded {name}: {len(feats):,} features ({time.time() - t:.1f}s)', flush=True)
    return feats


def to_ft(geom):
    return shapely.transform(geom, lambda xy: np.column_stack(TO_FT.transform(xy[:, 0], xy[:, 1])))


def geoms_ft(feats):
    out = []
    for f in feats:
        g = f.get('geometry')
        if not g:
            out.append(None)
            continue
        try:
            out.append(to_ft(shape(g)))
        except Exception:
            out.append(None)
    return out


def main():
    t0 = time.time()
    print('Loading data…', flush=True)
    parcels = load('parcels.geojson', RAW)
    kelp = load('friends-bull-kelp-patches.geojson')  # merged patches, see build-kelp-patches.py
    eel = load('friends-deepwater-eelgrass.geojson')
    doc = load('friends-documented-forage-spawning.json')
    pot = load('friends-potential-forage-spawning.json')
    her = load('friends-herring-spawning.json')
    sf = load('friends-shoreline-geology.json')
    fish = load('fish-use.geojson')  # one file for all seven fish-use layers (HRM_<code> columns), see build-fish-use.py
    armor = load('friends-armor.json')
    docks = load('friends-docks.geojson')
    groins = load('friends-groins.json')
    ramps = load('friends-boat-ramps.json')
    rails = load('friends-marine-railway.json')
    buoys = load('friends-mooring-buoys.json')
    piles = load('friends-pilings.json')

    print('Projecting to feet…', flush=True)
    kelp_g = geoms_ft(kelp)
    eel_g = geoms_ft(eel)
    doc_g = geoms_ft(doc)
    pot_g = geoms_ft(pot)
    her_g = geoms_ft(her)
    sf_g = geoms_ft(sf)
    fish_g = geoms_ft(fish)
    armor_g = geoms_ft(armor)
    docks_g = geoms_ft(docks)
    groins_g = geoms_ft(groins)
    ramps_g = geoms_ft(ramps)
    rails_g = geoms_ft(rails)
    buoys_g = geoms_ft(buoys)
    piles_g = geoms_ft(piles)

    def tree(gs):
        idx = [i for i, g in enumerate(gs) if g is not None and not g.is_empty]
        return STRtree([gs[i] for i in idx]), idx

    kelp_t, kelp_i = tree(kelp_g)
    eel_t, eel_i = tree(eel_g)
    doc_t, doc_i = tree(doc_g)
    pot_t, pot_i = tree(pot_g)
    her_t, her_i = tree(her_g)
    sf_t, sf_i = tree(sf_g)
    fish_t, fish_i = tree(fish_g)
    armor_t, armor_i = tree(armor_g)
    docks_t, docks_i = tree(docks_g)
    groins_t, groins_i = tree(groins_g)
    ramps_t, ramps_i = tree(ramps_g)
    rails_t, rails_i = tree(rails_g)
    buoys_t, buoys_i = tree(buoys_g)
    piles_t, piles_i = tree(piles_g)
    print(f'  indexes built ({time.time() - t0:.0f}s)', flush=True)

    def hits(tr, idx, geoms, query_geom, dist_ft):
        """Indices (into the original list) of features within dist_ft of query_geom, with distances."""
        cand = tr.query(query_geom.buffer(dist_ft))
        out = []
        for c in cand:
            i = idx[c]
            d = geoms[i].distance(query_geom)
            if d <= dist_ft:
                out.append((i, d))
        return out

    results = {}
    n_hit = 0
    t1 = time.time()
    for n, pf in enumerate(parcels):
        g = pf.get('geometry')
        if not g:
            continue
        try:
            pg = to_ft(shape(g))
        except Exception:
            continue
        if pg.is_empty:
            continue
        props = pf.get('properties') or {}
        fid = str(props.get('FID', n))
        rec = {}

        kh = hits(kelp_t, kelp_i, kelp_g, pg, KELP_FT)
        if kh:
            # Patch area from geometry (EPSG:2926 is in US survey feet)
            acres = sum(kelp_g[i].area for i, _ in kh) / 43560.0
            rec['kelp'] = {'n': len(kh), 'acres': round(acres, 3), 'distFt': round(min(d for _, d in kh))}

        eh = hits(eel_t, eel_i, eel_g, pg, EELGRASS_FT)
        if eh:
            length = 0.0
            depths, maxd, sites = [], None, []
            for i, _ in eh:
                p = eel[i].get('properties') or {}
                length += float(p.get('LENGTH') or 0)
                m = p.get('MEAN')
                if m not in (None, 0, ''):
                    depths.append(float(m))
                mx = p.get('MAX_')
                if mx not in (None, 0, ''):
                    maxd = float(mx) if maxd is None else max(maxd, float(mx))
                s = str(p.get('SITE') or '').strip()
                if s and s not in sites:
                    sites.append(s)
            rec['eelgrass'] = {
                'n': len(eh),
                'lengthFt': round(length),
                'meanDepth': round(sum(depths) / len(depths), 1) if depths else None,
                'maxDepth': round(maxd, 1) if maxd is not None else None,
                'distFt': round(min(d for _, d in eh)),
                'sites': sites[:5],
            }

        # Nearest shoreform first: it decides whether potential beach habitat may count
        sh = hits(sf_t, sf_i, sf_g, pg, SHOREFORM_FT)
        own_form = ''
        if sh:
            i0, _ = min(sh, key=lambda x: x[1])
            own_form = str((sf[i0].get('properties') or {}).get('PIAT_shoreforms') or '').strip()

        dh = hits(doc_t, doc_i, doc_g, pg, FORAGE_FT)
        ph = [] if own_form == ROCKY_SHOREFORM else hits(pot_t, pot_i, pot_g, pg, POTENTIAL_FT)
        if dh or ph:
            beaches = []
            seen = set()
            for i, d in sorted(dh, key=lambda x: x[1]):
                p = doc[i].get('properties') or {}
                name = str(p.get('NAME') or p.get('NAME_2') or '').strip()
                key = (name, str(p.get('SPECIES') or ''))
                if key in seen:
                    continue
                seen.add(key)
                beaches.append({
                    'name': name,
                    'species': str(p.get('SPECIES') or '').strip(),
                    'smelt': str(p.get('SMELT_IND') or '').strip().upper() in ('Y', 'YES', '1', 'TRUE'),
                    'sandLance': str(p.get('SAND_LANCE_IND') or '').strip().upper() in ('Y', 'YES', '1', 'TRUE'),
                    'distFt': round(d),
                    'shoreform': str(p.get('C_Type_FOSJ') or '').strip(),
                })
            rec['forage'] = {'documented': beaches[:6], 'potentialN': len(ph)}
            if ph:
                pi, pd = min(ph, key=lambda x: x[1])
                rec['forage']['potentialDistFt'] = round(pd)
                rec['forage']['potentialForm'] = str((pot[pi].get('properties') or {}).get('C_Type_FOSJ') or '').strip()

        hh = hits(her_t, her_i, her_g, pg, HERRING_FT)
        if hh:
            names = []
            for i, _ in hh:
                nm = str((her[i].get('properties') or {}).get('Name') or '').strip()
                if nm and nm not in names:
                    names.append(nm)
            rec['herring'] = names or ['Herring spawning ground']
            rec['herringDistFt'] = round(min(d for _, d in hh))

        if sh:
            i, d = min(sh, key=lambda x: x[1])
            p = sf[i].get('properties') or {}
            def clean(v):
                v = '' if v is None else str(v).strip()
                return '' if v in ('<Null>', 'None') else v
            rec['shoreform'] = {
                'code': clean(p.get('PIAT_shoreforms')),
                'unitId': clean(p.get('ShoreForm_Unit_ID')),
                'distFt': round(d),
                'ffhab': clean(p.get('FFhab')),
                'landUse': clean(p.get('LandUse')),
                'shoreDesig': clean(p.get('ShoreDESIG')),
                'protection': clean(p.get('PIATprotection')),
                'restoration': clean(p.get('PIATrestoration')),
                'publicOwnership': clean(p.get('SomePublicOwnership')) == 'Y',
            }

        # --- Beamer & Fresh fish use scores: max high-resolution-model score per species across nearby segments ---
        # 6 decimals, not 3: the priority bins (src/config/fishUse.ts) end exactly on data values, so coarser
        # rounding pushes edge segments up a level. A score of 0 is kept (it ranks as moderate, never "low").
        fh = hits(fish_t, fish_i, fish_g, pg, FISH_FT)
        if fh:
            scores = {}
            for code in FISH_CODES:
                hmax = 0.0
                for i, _ in fh:
                    p = fish[i].get('properties') or {}
                    hmax = max(hmax, float(p.get(f'HRM_{code}') or 0))
                scores[code] = {'hrm': round(hmax, 6)}
            i, d = min(fh, key=lambda x: x[1])
            p = fish[i].get('properties') or {}
            def cl(v):
                v = '' if v is None else str(v).strip()
                return '' if v in ('<Null>', 'None') else v
            rec['fish'] = {
                'distFt': round(d),
                'scores': scores,
                'segment': {
                    'name': cl(p.get('Name')), 'geoUnit': cl(p.get('GeoUnit')), 'systemType': cl(p.get('RITT_SysTy')),
                    'subType': cl(p.get('RITT_SubTy')), 'materialClass': cl(p.get('MatrlClass')), 'featureType': cl(p.get('FType')),
                },
            }

        # --- Shoreline modifications (Friends field surveys) ---
        mods = {}
        ah = hits(armor_t, armor_i, armor_g, pg, ARMOR_FT)
        if ah:
            zone = pg.buffer(ARMOR_FT)
            length = sum(armor_g[i].intersection(zone).length for i, _ in ah)
            mods['armor'] = {'n': len(ah), 'lengthFt': round(length), 'distFt': round(min(d for _, d in ah))}
        dh2 = hits(docks_t, docks_i, docks_g, pg, STRUCTURE_FT)
        if dh2:
            yn = lambda v: str(v or '').strip().upper() in ('Y', 'YES', '1', 'TRUE')
            items = []
            for i, d in sorted(dh2, key=lambda x: x[1])[:8]:
                p = docks[i].get('properties') or {}
                items.append({
                    'distFt': round(d),
                    'material': str(p.get('Material') or '').strip(),
                    'floatMaterial': str(p.get('FloatMaterial') or '').strip(),
                    'creosote': yn(p.get('Creosote')),
                    'grating': yn(p.get('Grating')),
                    'condition': str(p.get('Condition') or '').strip(),
                })
            mods['docks'] = items
        for key, tr, idx, gs in (('groins', groins_t, groins_i, groins_g), ('ramps', ramps_t, ramps_i, ramps_g), ('railways', rails_t, rails_i, rails_g)):
            h = hits(tr, idx, gs, pg, STRUCTURE_FT)
            if h:
                mods[key] = {'n': len(h), 'distFt': round(min(d for _, d in h))}
        ph2 = hits(piles_t, piles_i, piles_g, pg, STRUCTURE_FT)
        if ph2:
            count = 0
            creo = False
            for i, _ in ph2:
                p = piles[i].get('properties') or {}
                try:
                    count += int(float(p.get('Count_') or 0))
                except Exception:
                    pass
                creo = creo or str(p.get('Creosote') or '').strip().lower() in ('y', 'yes', '1', 'true')
            mods['pilings'] = {'n': len(ph2), 'count': count, 'creosote': creo, 'distFt': round(min(d for _, d in ph2))}
        bh = hits(buoys_t, buoys_i, buoys_g, pg, BUOY_FT)
        if bh:
            types = {}
            for i, _ in bh:
                t = str((buoys[i].get('properties') or {}).get('Type') or '?').strip().upper() or '?'
                types[t] = types.get(t, 0) + 1
            mods['buoys'] = {'n': len(bh), 'distFt': round(min(d for _, d in bh)), 'types': types}
        if mods:
            rec['mods'] = mods

        # --- Nearest shoreline, any distance (for inland properties: "0.6 mi to Deer Harbor") ---
        try:
            ni = fish_t.nearest(pg)
            if ni is not None:
                i = fish_i[ni]
                d = fish_g[i].distance(pg)
                pname = str((fish[i].get('properties') or {}).get('Name') or '').strip()
                rec['shore'] = {'distFt': round(d), 'name': pname.title() if pname.isupper() else pname}
        except Exception:
            pass

        if rec:
            results[fid] = rec
            n_hit += 1
        if n % 2000 == 0 and n:
            print(f'  {n:,}/{len(parcels):,} parcels, {n_hit:,} with hits ({time.time() - t1:.0f}s)', flush=True)

    out = {
        'meta': {
            'generated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'kelpFt': KELP_FT,
            'eelgrassFt': EELGRASS_FT,
            'forageFt': FORAGE_FT,
            'potentialFt': POTENTIAL_FT,
            'herringFt': HERRING_FT,
            'shoreformFt': SHOREFORM_FT,
            'fishFt': FISH_FT,
            'armorFt': ARMOR_FT,
            'structureFt': STRUCTURE_FT,
            'buoyFt': BUOY_FT,
            'parcels': len(parcels),
            'parcelsWithHits': n_hit,
        },
        'parcels': results,
    }
    os.makedirs(BUILD, exist_ok=True)
    dest = os.path.join(BUILD, 'nearshore.json')
    with open(dest, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print(f'Wrote {dest} — {n_hit:,} parcels with hits, {os.path.getsize(dest)/1024:.0f} KB, {time.time() - t0:.0f}s total')


if __name__ == '__main__':
    sys.exit(main())
