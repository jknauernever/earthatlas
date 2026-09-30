"""
Area configuration for the /ships GFW hourly track bake (scripts/ships/bake-gfw/).

Everything the fetch / bake / index steps do is per NAMED AREA TILE, so growing from
Pacific Canada + Alaska to the US gap fill and then the world is a config change here:

  STAGES[name] = list of area tiles (name, W, S, E, N), lon in -180..180, W < E.
                 A box never crosses the antimeridian: split it (see the Aleutians).

Fetch requests are made per tile and per span of days; fetch.py splits a request in
time (7 → 3 → 1 days) and then in space (quadrants) whenever GFW answers 413 / 524 or
a response is larger than MAX_ROWS, so dense tiles need no hand tuning.

NOAA PREFERENCE RULE (Josh 2026-09-29): where NOAA per-minute AIS exists for a month and
area, NOAA wins and GFW is not drawn there. NOAA's areas are the boxes in NOAA_AREAS; a
month counts as covered when NOAA has published it (Salish: trackSource.json months; US-wide:
the us index months). GFW positions inside a covered box are dropped before lines are built,
so a GFW line stops at the box edge and never doubles a NOAA line. The US-wide boxes are an
approximation of MarineCadastre's coverage (US EEZ without Alaska), documented as such.
"""

# Pacific Canada + all Alaska waters + the Salish Sea (stage 1, 2026-09-29).
PACNW = [
    ('salish',   -126.3, 46.9, -122.0, 49.6),
    ('wvi',      -134.0, 46.9, -126.3, 49.6),
    ('bcsouth',  -134.0, 49.6, -122.0, 52.0),
    ('bcnorth',  -134.0, 52.0, -127.5, 55.0),
    ('bcninl',   -127.5, 52.0, -122.0, 55.0),
    ('seak',     -138.0, 55.0, -129.5, 60.0),
    ('gulf',     -152.0, 55.0, -138.0, 61.5),
    ('cook',     -156.0, 55.0, -152.0, 61.5),
    ('akpen',    -166.0, 51.0, -156.0, 58.0),
    ('offshore', -156.0, 46.9, -134.0, 55.0),
    ('bering',   -180.0, 58.0, -156.0, 66.0),
    ('aleut',    -180.0, 50.0, -166.0, 58.0),
    ('aleutw',    170.0, 50.0,  180.0, 58.0),
    ('beringw',   170.0, 58.0,  180.0, 66.0),
    ('arctic',   -180.0, 66.0, -122.0, 72.5),
]

# US waters outside PACNW (stage 2: GFW only for months after NOAA's latest).
US = [
    ('uswest',  -130.5, 30.0, -116.5, 46.9),
    ('usgulf',   -98.0, 23.5,  -80.0, 31.0),
    ('useast',   -82.0, 24.0,  -65.0, 45.5),
    ('hawaii',  -179.9, 16.0, -150.0, 30.0),
    ('prvi',     -68.5, 16.5,  -63.5, 19.5),
    ('guam',     143.5, 12.5,  147.0, 21.0),
    ('greatlakes', -92.5, 41.0, -75.5, 49.5),
]


def world_grid(step=10):
    """Stage 3: the world in step° boxes (lat -78..84). fetch.py splits dense ones further;
    empty (inland) boxes cost one small request per span and are harmless."""
    out = []
    lat = -78
    while lat < 84:
        n = min(84, lat + step)
        lon = -180
        while lon < 180:
            out.append((f'w{lon:+04d}{lat:+03d}', lon, lat, lon + step, n))
            lon += step
        lat = n
    return out


STAGES = {'pacnw': PACNW, 'us': US, 'world': None}   # world is generated (world_grid)


def stage(name):
    if name == 'world':
        return world_grid()
    if name not in STAGES:
        raise SystemExit(f'unknown stage {name!r} (have {", ".join(STAGES)})')
    return STAGES[name]


# NOAA MarineCadastre coverage, for the preference rule. 'months' names where the covered months come from.
NOAA_AREAS = [
    dict(name='salish', bbox=(-126.2, 47.0, -122.05, 49.6), months='salish'),     # src/ships/trackSource.json months
    dict(name='us-west', bbox=(-130.5, 30.0, -116.5, 48.4), months='us'),          # us index months (US EEZ, approx.)
    dict(name='us-gulf-east', bbox=(-98.0, 23.5, -65.0, 45.5), months='us'),
    dict(name='us-hawaii', bbox=(-179.9, 16.0, -150.0, 30.0), months='us'),
    dict(name='us-prvi', bbox=(-68.5, 16.5, -63.5, 19.5), months='us'),
]
