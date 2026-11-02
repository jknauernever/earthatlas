"""
/spills step 2b: protected areas from USGS PAD-US 4.1 (Protected Areas Database of the United States), one state file each
for IL, IN, MI and WI (sciencebase.gov/catalog/item/6759abcfd34edfeb8710a004, PADUS4_1_State_<ST>_GDB_KMZ.zip, unzipped
into data/spills/padus/<ST>/).

Keeps the combined Fee + Designation + Easement layer inside the Lake Michigan box, without proclamation boundaries, where
the area is managed for nature or multiple uses (GAP status 1-3), plus land a public agency owns outright that has no
known mandate for nature (GAP 4 fee land of federal, state, local and regional agencies: most city and county parks).
GAP 4 farmland easements and private land are left out.

  data/spills/venv/bin/python scripts/bake-spills/padus.py
Outputs: data/spills/work/padus/<ST>.geojson (WGS84) and data/spills/work/padus/designations.csv (code → name).
"""
import os, subprocess, sys
sys.path.insert(0, os.path.dirname(__file__))
from common import ROOT, BOX

OUT = os.path.join(ROOT, 'work', 'padus')
FIELDS = 'FeatClass,Mang_Type,Mang_Name,Loc_Mang,Des_Tp,Loc_Ds,Unit_Nm,GAP_Sts,Pub_Access,GIS_Acres,Source_PAID,Agg_Src,Src_Date'
WHERE = ("FeatClass <> 'Proclamation' AND (GAP_Sts IN ('1','2','3') OR "
         "(GAP_Sts = '4' AND FeatClass = 'Fee' AND Mang_Type IN ('FED','STAT','LOC','DIST')))")

os.makedirs(OUT, exist_ok=True)
lat0, lat1, lon0, lon1 = BOX
for st in ('IL', 'IN', 'MI', 'WI'):
    gdb = os.path.join(ROOT, 'padus', st, f'PADUS4_1_State{st}.gdb')
    out = os.path.join(OUT, f'{st}.geojson')
    if os.path.exists(out):
        os.remove(out)   # the GeoJSON driver can't overwrite in place
    subprocess.run(['ogr2ogr', '-q', '-f', 'GeoJSON', out, gdb, f'PADUS4_1Comb_DOD_Trib_NGP_Fee_Desig_Ease_State_{st}',
                    '-spat', str(lon0), str(lat0), str(lon1), str(lat1), '-spat_srs', 'EPSG:4326', '-t_srs', 'EPSG:4326',
                    '-nlt', 'MULTIPOLYGON', '-lco', 'COORDINATE_PRECISION=5', '-where', WHERE, '-select', FIELDS,
                    '--config', 'OGR_ORGANIZE_POLYGONS', 'SKIP'], check=True)
    print(st, os.path.getsize(out) // 1024, 'KB', flush=True)
subprocess.run(['ogr2ogr', '-f', 'CSV', '-overwrite', os.path.join(OUT, 'designations.csv'),
                os.path.join(ROOT, 'padus', 'IN', 'PADUS4_1_StateIN.gdb'), 'Designation_Type'], check=True)
