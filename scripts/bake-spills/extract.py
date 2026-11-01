"""
/spills step 1: pull candidate Lake Michigan reports out of the NRC FOIA spreadsheets (nrc.uscg.mil/FOIAFiles/CY<yy>.xlsx).

Keeps every report whose incident state is one of the four Lake Michigan states (IL, IN, WI, MI), or whose water-body /
location text names a Great Lake water. Lake Michigan scope is decided later in analyze.py, from text AND coordinates,
so this step must not drop reports that only have coordinates. One row per material (the MATERIAL_INVOLVED sheet).

  data/spills/venv/bin/python scripts/bake-spills/extract.py 24          # one year (test)
  data/spills/venv/bin/python scripts/bake-spills/extract.py 15 16 ... 24
Inputs: data/spills/CY<yy>.xlsx. Output: data/spills/work/nrc_cand_<yy>.csv (one file per year, so years re-run alone).
"""
import csv, os, re, sys
import openpyxl

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'spills')
SHEETS = ['CALLS', 'INCIDENT_COMMONS', 'INCIDENT_DETAILS', 'MATERIAL_INVOLVED']
KEEP = {
    'CALLS': ['SEQNOS', 'DATE_TIME_RECEIVED', 'CALLTYPE', 'RESPONSIBLE_COMPANY', 'RESPONSIBLE_ORG_TYPE'],
    'INCIDENT_COMMONS': ['SEQNOS', 'DESCRIPTION_OF_INCIDENT', 'TYPE_OF_INCIDENT', 'INCIDENT_CAUSE', 'INCIDENT_DATE_TIME',
                         'INCIDENT_LOCATION', 'LOCATION_ADDRESS', 'LOCATION_STREET1', 'LOCATION_NEAREST_CITY', 'LOCATION_STATE',
                         'LOCATION_COUNTY', 'LOCATION_ZIP', 'DISTANCE_FROM_CITY', 'DISTANCE_UNITS', 'DIRECTION_FROM_CITY',
                         'LAT_DEG', 'LAT_MIN', 'LAT_SEC', 'LAT_QUAD', 'LONG_DEG', 'LONG_MIN', 'LONG_SEC', 'LONG_QUAD', 'POTENTIAL_FLAG'],
    'INCIDENT_DETAILS': ['SEQNOS', 'MEDIUM_DESC', 'ADDITIONAL_MEDIUM_INFO', 'BODY_OF_WATER', 'TRIBUTARY_OF', 'SHEEN_SIZE',
                         'SHEEN_SIZE_UNITS', 'WATER_SUPPLY_CONTAMINATED', 'OFFSHORE'],
    'MATERIAL_INVOLVED': ['SEQNOS', 'CHRIS_CODE', 'NAME_OF_MATERIAL', 'AMOUNT_OF_MATERIAL', 'UNIT_OF_MEASURE', 'IF_REACHED_WATER',
                          'AMOUNT_IN_WATER', 'UNIT_OF_MEASURE_REACH_WATER'],
}
STATES = {'IL', 'IN', 'WI', 'MI'}
GL = re.compile(r'LAKE\s+(MICHIGAN|SUPERIOR|HURON|ERIE|ONTARIO|ST\.?\s*CLAIR)|\bL\.?\s+(MICHIGAN|SUPERIOR|HURON|ERIE|ONTARIO)|ST\.?\s*CLAIR\s+RIVER|'
                r'DETROIT\s+RIVER|ST\.?\s*MARYS\s+RIVER|NIAGARA\s+RIVER|ST\.?\s*LAWRENCE|STRAITS?\s+OF\s+MACKINAC|GREAT\s+LAKES|GREEN\s+BAY|'
                r'GRAND\s+TRAVERSE|SAGINAW\s+BAY|CALUMET|MILWAUKEE\s+(RIVER|HARBOR)|CHICAGO\s+(RIVER|HARBOR)')
COLS = ['YEAR'] + [c for s in SHEETS for c in KEEP[s] if c != 'SEQNOS']
COLS.insert(1, 'SEQNOS')


def sheet_rows(ws, keep):
    it = ws.iter_rows(values_only=True)
    hdr = [str(h).strip() if h else None for h in next(it)]
    idx = [(k, hdr.index(k) if k in hdr else None) for k in keep]
    for r in it:
        if not r or r[0] is None:
            continue
        yield {k: (r[i] if i is not None and i < len(r) else None) for k, i in idx}


def run(yy):
    wb = openpyxl.load_workbook(os.path.join(ROOT, f'CY{yy}.xlsx'), read_only=True)
    data = {}
    for s in SHEETS:
        d = {}
        for rec in sheet_rows(wb[s], KEEP[s]):
            if s == 'MATERIAL_INVOLVED':
                d.setdefault(rec['SEQNOS'], []).append(rec)
            else:
                d.setdefault(rec['SEQNOS'], rec)
        data[s] = d
    os.makedirs(os.path.join(ROOT, 'work'), exist_ok=True)
    n = 0
    with open(os.path.join(ROOT, 'work', f'nrc_cand_{yy}.csv'), 'w', newline='') as out:
        w = csv.DictWriter(out, fieldnames=COLS, extrasaction='ignore')
        w.writeheader()
        for sq, com in data['INCIDENT_COMMONS'].items():
            det = data['INCIDENT_DETAILS'].get(sq, {})
            st = str(com.get('LOCATION_STATE') or '').strip().upper()
            txt = ' '.join(str(det.get(k) or '') for k in ('BODY_OF_WATER', 'TRIBUTARY_OF', 'ADDITIONAL_MEDIUM_INFO')) + ' ' + str(com.get('INCIDENT_LOCATION') or '')
            if st not in STATES and not GL.search(txt.upper()):
                continue
            for m in data['MATERIAL_INVOLVED'].get(sq, [{}]):
                row = {'YEAR': 2000 + int(yy)}
                row.update(data['CALLS'].get(sq, {})); row.update(com); row.update(det); row.update(m)
                row['DESCRIPTION_OF_INCIDENT'] = str(row.get('DESCRIPTION_OF_INCIDENT') or '')[:1200].replace('\n', ' ')
                w.writerow(row)
                n += 1
    print(yy, n, flush=True)


if __name__ == '__main__':
    for y in sys.argv[1:]:
        run(y)
