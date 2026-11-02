"""Shared definitions for the /spills bake (scripts/bake-spills). NRC parsing and national paths come from
scripts/national/lib.py (one copy for every dataset)."""
import os, re, sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'national'))
from lib import NATIONAL, ds, OIL, report_text, dms, raw_coords  # noqa: E402,F401

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'spills'))
STATES = {'IL', 'IN', 'WI', 'MI'}
# Lake Michigan and its named bays, harbors and connected waters, as written in the report text.
LM_TEXT = re.compile(r'\bL(AKE|\.)?\s*MICHIGAN|GREEN\s+BAY|GRAND\s+TRAVERSE|CALUMET|CHICAGO\s+(RIVER|HARBOR)|MILWAUKEE\s+(RIVER|HARBOR)|'
                     r'STURGEON\s+BAY|LITTLE\s+TRAVERSE|MUSKEGON\s+LAKE|WHITE\s+LAKE|LAKE\s+MACATAWA|BURNS\s+(HARBOR|WATERWAY)|INDIANA\s+HARBOR|'
                     r'BURNHAM\s+HARBOR|MONROE\s+HARBOR|BELMONT\s+HARBOR|DIVERSEY\s+HARBOR|MONTROSE\s+HARBOR|NAVY\s+PIER')
# Other Great Lakes waters: a report naming one of these is not matched to Lake Michigan by its text.
OTHER_GL = re.compile(r'LAKE\s+(SUPERIOR|HURON|ERIE|ONTARIO|ST\.?\s*CLAIR)|DETROIT\s+RIVER|ST\.?\s*CLAIR\s+RIVER|SAGINAW|ST\.?\s*MARYS\s+RIVER')
BOX = (41.2, 46.8, -89.8, -83.9)   # lat min/max, lon min/max: Lake Michigan basin with a margin


def in_box(lat, lon):
    return lat is not None and lon is not None and BOX[0] < lat < BOX[1] and BOX[2] < lon < BOX[3]


def report_coords(r):
    """Report coordinates inside the Lake Michigan box (analyze.py)."""
    c = raw_coords(r)
    return c if c and in_box(*c) else None


def has_coords(r):
    return report_coords(r) is not None


# ESI scientific names (GEN_SPEC) → the name iNaturalist knows: "X spp." → the genus/family, plus NOAA typos and old names.
SCI_FIX = {
    'Anticlea elegans s glauca': 'Anticlea elegans', 'Aplodinotus grunnieus': 'Aplodinotus grunniens', 'Bubulcus ibis': 'Ardea ibis',
    'Catostomus commersoni': 'Catostomus commersonii', 'Stizostedion vitreum vitreum': 'Sander vitreus',
}


def sci_name(gen_spec):
    s = ' '.join((gen_spec or '').replace('spp.', '').replace('sp.', '').split())
    return SCI_FIX.get(s, s)
