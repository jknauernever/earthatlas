"""
Places named in an NRC report's location fields — a harbor, bay, inlet, point, island, channel or town — matched to USGS
GNIS (national dataset `gnis`) and Census places (`census`), for reports with no coordinates or street address.
Shared by the /spills bakes (states.py, analyze.py) and any other NRC consumer.

  places = NamedPlaces()                 # loads GNIS and the Census gazetteer once
  places.prepare(rows, cxy_of)           # every report row once: which names are too big to point at
  m = places.match(r, cxy)               # → dict(lon, lat, kind, name, fid, src) or None

Rule (measured on the 2015–2026 national reports, docs/NATIONAL_DATA.md):
  - fields LOCATION_ADDRESS, INCIDENT_LOCATION, BODY_OF_WATER, TRIBUTARY_OF, in that order (not the caller's description);
    longest name first (5 words down to 1), after normalizing abbreviations (PT → POINT, HBR → HARBOR, CRK → CREEK…)
  - names in the report's own state, ≤ 30 km from its nearest city
  - GNIS names of 2+ words that are not all generic ("NORTH BAY", "MAIN CHANNEL" are out); one-word Census places only
    when 4+ letters and not an ordinary English word
  - skipped: a name inside a longer matched name (CHESAPEAKE in CHESAPEAKE BAY); a name followed by a street suffix or
    after a house number; a populated place named for a stream (SUGAR CREEK); a name whose reports' nearest cities lie
    > 25 km apart (Puget Sound, Houston Ship Channel: too big to point at); a name whose points within 30 km lie > 5 km
    apart (ambiguous); a match < 1 km from the city (no gain)
  - a water or coastal feature beats a GNIS populated place beats a Census place
Kinds: 'place' (bay, cove, harbor, inlet, sound, point, island, beach, bar, channel, gut, rapids, falls, bend) or 'town'.
"""
import collections, csv, math, os, re, sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from lib import ds  # noqa: E402

GNIS_URL = 'https://edits.nationalmap.gov/apps/gaz-domestic/public/summary/{}'
ABBR = {'PT': 'POINT', 'PNT': 'POINT', 'HBR': 'HARBOR', 'HARBOUR': 'HARBOR', 'CRK': 'CREEK', 'CK': 'CREEK', 'LK': 'LAKE',
        'RIV': 'RIVER', 'RVR': 'RIVER', 'ISL': 'ISLAND', 'MT': 'MOUNT', 'BCH': 'BEACH', 'CHNL': 'CHANNEL', 'BYU': 'BAYOU',
        'SAINT': 'ST', 'SAINTE': 'ST', 'STE': 'ST', 'FT': 'FORT'}
POINTLIKE = {'Bay', 'Cape', 'Island', 'Beach', 'Bar', 'Gut', 'Rapids', 'Falls', 'Bend', 'Isthmus', 'Channel'}
LINEAR = {'Stream', 'Lake', 'Reservoir', 'Canal', 'Swamp', 'Sea'}
GENERIC = set('NORTH SOUTH EAST WEST N S E W NE NW SE SW UPPER LOWER MIDDLE LITTLE BIG GREAT MAIN THE OLD INNER OUTER SHIP SMALL BOAT '
              'HARBOR BAY COVE CREEK RIVER LAKE ISLAND POINT CHANNEL SOUND BEACH INLET BAYOU CANAL BRANCH FORK SLOUGH BASIN MARINA '
              'POND RUN BROOK STREAM SPRING SPRINGS GULF OCEAN PORT DOCK PIER LANDING NEW LONG MILL'.split())
WATERY_TOWN = re.compile(r'\b(CREEK|RIVER|LAKE|BAYOU|BROOK|RUN|FORK|BRANCH|SPRINGS?)\b')
SUFFIX = r'(ST|STREET|AVE|AVENUE|RD|ROAD|DR|DRIVE|LN|LANE|BLVD|HWY|HIGHWAY|WAY|PKWY|CT|COURT|PL|PLACE|CIR|TER|TRL|PIKE|FWY|EXPY|BRIDGE)'
FIELDS = ('LOCATION_ADDRESS', 'INCIDENT_LOCATION', 'BODY_OF_WATER', 'TRIBUTARY_OF')
PREF = {'place': 0, 'gnis-town': 1, 'census': 2}
NEAR_KM, SPREAD_KM, AMBIG_KM = 30, 25, 5
STATE_USPS = dict(Alabama='AL', Alaska='AK', Arizona='AZ', Arkansas='AR', California='CA', Colorado='CO', Connecticut='CT',
                  Delaware='DE', Florida='FL', Georgia='GA', Hawaii='HI', Idaho='ID', Illinois='IL', Indiana='IN', Iowa='IA',
                  Kansas='KS', Kentucky='KY', Louisiana='LA', Maine='ME', Maryland='MD', Massachusetts='MA', Michigan='MI',
                  Minnesota='MN', Mississippi='MS', Missouri='MO', Montana='MT', Nebraska='NE', Nevada='NV', Ohio='OH',
                  Oklahoma='OK', Oregon='OR', Pennsylvania='PA', Tennessee='TN', Texas='TX', Utah='UT', Vermont='VT',
                  Virginia='VA', Washington='WA', Wisconsin='WI', Wyoming='WY', Guam='GU')
STATE_USPS.update({'District of Columbia': 'DC', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
                   'North Carolina': 'NC', 'North Dakota': 'ND', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD',
                   'West Virginia': 'WV', 'Puerto Rico': 'PR', 'Virgin Islands': 'VI', 'American Samoa': 'AS',
                   'Northern Mariana Islands': 'MP'})


def toks(s):
    s = re.sub(r"[’']", '', (s or '').upper())
    return [ABBR.get(w, w) for w in re.sub(r'[^A-Z0-9]+', ' ', s).split()]


def km(a, b):
    return math.hypot((a[0] - b[0]) * 111.32 * math.cos(math.radians(a[1])), (a[1] - b[1]) * 110.574)


def grams(tt):
    for n in range(min(5, len(tt)), 0, -1):
        for i in range(len(tt) - n + 1):
            yield ' '.join(tt[i:i + n])


class NamedPlaces:
    def __init__(self):
        words = '/usr/share/dict/web2'
        self.common = {w.strip().upper() for w in open(words) if w.strip().islower()} if os.path.exists(words) else set()
        self.names = collections.defaultdict(list)   # (name, ST) → [(lon, lat, kind, label, fid)]
        self.linear = set()                           # (name, ST) of GNIS streams, lakes, canals
        for r in csv.DictReader(open(ds('gnis', 'raw', 'DomesticNames_National.txt'), encoding='utf-8-sig'), delimiter='|'):
            c, st = r['feature_class'], STATE_USPS.get(r['state_name'])
            if not st:
                continue
            nm = ' '.join(toks(r['feature_name']))
            if c in LINEAR:
                self.linear.add((nm, st))
                continue
            if c not in POINTLIKE and c != 'Populated Place':
                continue
            if len(nm.split()) < 2 or all(t in GENERIC for t in nm.split()):
                continue
            try:
                lon, lat = float(r['prim_long_dec']), float(r['prim_lat_dec'])
            except ValueError:
                continue
            if lon == 0 and lat == 0:
                continue
            kind = 'place' if c in POINTLIKE else 'gnis-town'
            self.names[(nm, st)].append((lon, lat, kind, f"{r['feature_name']} ({c.lower()})", r['feature_id']))
        for f in [ds('census', 'raw', '2024_Gaz_place_national.txt')]:
            for r in csv.DictReader(open(f, encoding='latin-1'), delimiter='\t'):
                r = {k.strip(): v for k, v in r.items()}
                base = re.sub(r'\s+(city|village|town|CDP|borough|municipality|zona urbana|comunidad)$', '', r['NAME'])
                nm = re.sub(r'\b(CITY OF|VILLAGE OF|TOWN OF|TWSP|TWP|TOWNSHIP|CHARTER)\b', ' ', ' '.join(toks(base))).strip()
                nm = ' '.join(nm.split())
                if ' ' not in nm and (len(nm) < 4 or nm in self.common):
                    continue
                self.names[(nm, r['USPS'])].append((float(r['INTPTLONG']), float(r['INTPTLAT']), 'census', base, None))
        self.spread = {}

    def _hits(self, r):
        st = (r.get('LOCATION_STATE') or '').strip().upper()
        city = ' '.join(toks(r.get('LOCATION_NEAREST_CITY')))
        out = []
        for fi, f in enumerate(FIELDS):
            tt = toks(r.get(f))
            text = ' '.join(tt)
            for g in grams(tt):
                if (g, st) not in self.names or g == city or (city and (g in city or city in g)):
                    continue
                if re.search(r'\b' + re.escape(g) + r' ' + SUFFIX + r'\b', text) or re.search(r'\b\d+ ' + re.escape(g) + r'\b', text):
                    continue
                out.append((fi, g, text))
        # a name inside a longer matched name in the same field (CHESAPEAKE inside CHESAPEAKE BAY)
        return [h for h in out if not any(o[0] == h[0] and o[1] != h[1] and f' {h[1]} ' in f' {o[1]} ' for o in out)], st

    def prepare(self, rows, cxy_of):
        """How far apart the nearest cities of the reports naming each place lie: big waters name many cities."""
        seen = collections.defaultdict(set)
        for r in rows:
            c = cxy_of(r)
            if not c:
                continue
            hits, st = self._hits(r)
            for _, g, _ in hits:
                seen[(g, st)].add((round(c[0], 3), round(c[1], 3)))
        for k, pts in seen.items():
            p = list(pts)[:60]
            self.spread[k] = max((km(a, b) for a in p for b in p), default=0)

    def match(self, r, cxy):
        if not cxy:
            return None
        hits, st = self._hits(r)
        cands = []
        for fi, g, _ in hits:
            if self.spread.get((g, st), 0) > SPREAD_KM:
                continue
            for lon, lat, kind, label, fid in self.names[(g, st)]:
                if kind != 'place' and WATERY_TOWN.search(g):
                    continue
                if kind != 'place' and (g, st) in self.linear:
                    continue
                d = km((lon, lat), cxy)
                if d <= NEAR_KM:
                    cands.append((fi, -len(g), PREF[kind], g, lon, lat, kind, label, fid, d))
        if not cands:
            return None
        cands.sort()
        name = cands[0][3]
        same = [c for c in cands if c[3] == name]
        pts = [(c[4], c[5]) for c in same]
        if max(km(a, b) for a in pts for b in pts) > AMBIG_KM:
            return None
        best = min(same, key=lambda c: c[2])
        if best[9] < 1:
            return None
        _, _, _, g, lon, lat, kind, label, fid, _ = best
        return dict(lon=lon, lat=lat, kind='place' if kind == 'place' else 'town', name=label, fid=fid,
                    src='USGS GNIS' if fid else 'U.S. Census places', url=GNIS_URL.format(fid) if fid else None)
