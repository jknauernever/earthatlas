"""Shared paths and NRC parsing for the national dataset scripts (docs/NATIONAL_DATA.md)."""
import os, re
from pyproj import Transformer

REPO = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
NATIONAL = os.path.join(REPO, 'data', 'national')


def ds(name, *parts):
    """A path inside data/national/<dataset>/ (raw, work, build/<version>…)."""
    return os.path.join(NATIONAL, name, *parts)


# Petroleum materials, as NAME_OF_MATERIAL reads in the NRC files ("OIL, FUEL: NO. 2-D", "UNKNOWN SHEEN", "HYDRAULIC OIL").
OIL = re.compile(r'OIL|FUEL|DIESEL|GASOLINE|CRUDE|LUBE|HYDRAULIC|PETROLEUM|BUNKER|KEROSENE|JET|MOTOR|SHEEN|BILGE|ASPHALT|NAPHTHA|TRANSFORMER|GREASE|SLOP')


def report_text(r):
    return ' '.join(r.get(k) or '' for k in ('BODY_OF_WATER', 'TRIBUTARY_OF', 'ADDITIONAL_MEDIUM_INFO', 'INCIDENT_LOCATION')).upper()


def dms(d, m, s, q, lon=False):
    try:
        d = float(d); m = float(m or 0); s = float(s or 0)
    except (TypeError, ValueError):
        return None
    if m >= 60 or s >= 60:
        return None
    v = abs(d) + m / 60 + s / 3600
    q = str(q or '').strip().upper()
    if q.startswith(('S', 'W')) or (lon and not q.startswith('E')):   # western hemisphere: a missing quadrant is W
        v = -v
    return v


def raw_coords(r):
    """(lat, lon) entered in an NRC report, anywhere; None when missing or malformed."""
    lat = dms(r['LAT_DEG'], r['LAT_MIN'], r['LAT_SEC'], r['LAT_QUAD'])
    lon = dms(r['LONG_DEG'], r['LONG_MIN'], r['LONG_SEC'], r['LONG_QUAD'], lon=True)
    return (lat, lon) if lat is not None and lon is not None else None


# ─── Projection zones: distances in meters, measured in an equal-area projection made for each part of the country ──
ZONES = [  # (id, EPSG/ESRI code, lon min, lat min, lon max, lat max)
    ('ak', 'EPSG:3338', -180, 50, -129, 72),
    ('hi', 'ESRI:102007', -161, 18, -154, 23),
    ('pr', 'EPSG:32161', -68, 17, -64, 19),
    ('gu', 'EPSG:32655', 144, 13, 147, 21),       # Guam, Northern Mariana Islands
    ('as', 'EPSG:32702', -172, -15, -168, -10),   # American Samoa
    ('us', 'EPSG:5070', -125, 24, -66, 50),       # lower 48 (checked last)
]
FWD = {z[0]: Transformer.from_crs(4326, z[1], always_xy=True).transform for z in ZONES}


def zone_of(lon, lat):
    for z in ZONES:
        if z[2] <= lon <= z[4] and z[3] <= lat <= z[5]:
            return z[0]
    return None


def in_us(lat, lon):
    return lat is not None and lon is not None and zone_of(lon, lat) is not None
