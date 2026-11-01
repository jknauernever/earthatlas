"""Shared definitions for the /spills bake (scripts/bake-spills)."""
import os, re

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'spills'))
STATES = {'IL', 'IN', 'WI', 'MI'}
# Petroleum materials, as NAME_OF_MATERIAL reads in the NRC files ("OIL, FUEL: NO. 2-D", "UNKNOWN SHEEN", "HYDRAULIC OIL").
OIL = re.compile(r'OIL|FUEL|DIESEL|GASOLINE|CRUDE|LUBE|HYDRAULIC|PETROLEUM|BUNKER|KEROSENE|JET|MOTOR|SHEEN|BILGE|ASPHALT|NAPHTHA|TRANSFORMER|GREASE|SLOP')
# Lake Michigan and its named bays, harbors and connected waters, as written in the report text.
LM_TEXT = re.compile(r'\bL(AKE|\.)?\s*MICHIGAN|GREEN\s+BAY|GRAND\s+TRAVERSE|CALUMET|CHICAGO\s+(RIVER|HARBOR)|MILWAUKEE\s+(RIVER|HARBOR)|'
                     r'STURGEON\s+BAY|LITTLE\s+TRAVERSE|MUSKEGON\s+LAKE|WHITE\s+LAKE|LAKE\s+MACATAWA|BURNS\s+(HARBOR|WATERWAY)|INDIANA\s+HARBOR|'
                     r'BURNHAM\s+HARBOR|MONROE\s+HARBOR|BELMONT\s+HARBOR|DIVERSEY\s+HARBOR|MONTROSE\s+HARBOR|NAVY\s+PIER')
# Other Great Lakes waters: a report naming one of these is not matched to Lake Michigan by its text.
OTHER_GL = re.compile(r'LAKE\s+(SUPERIOR|HURON|ERIE|ONTARIO|ST\.?\s*CLAIR)|DETROIT\s+RIVER|ST\.?\s*CLAIR\s+RIVER|SAGINAW|ST\.?\s*MARYS\s+RIVER')
BOX = (41.2, 46.8, -89.8, -83.9)   # lat min/max, lon min/max: Lake Michigan basin with a margin


def report_text(r):
    return ' '.join(r.get(k) or '' for k in ('BODY_OF_WATER', 'TRIBUTARY_OF', 'ADDITIONAL_MEDIUM_INFO', 'INCIDENT_LOCATION')).upper()


def in_box(lat, lon):
    return lat is not None and lon is not None and BOX[0] < lat < BOX[1] and BOX[2] < lon < BOX[3]


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


def report_coords(r):
    lat = dms(r['LAT_DEG'], r['LAT_MIN'], r['LAT_SEC'], r['LAT_QUAD'])
    lon = dms(r['LONG_DEG'], r['LONG_MIN'], r['LONG_SEC'], r['LONG_QUAD'], lon=True)
    return (lat, lon) if in_box(lat, lon) else None


def has_coords(r):
    return report_coords(r) is not None
