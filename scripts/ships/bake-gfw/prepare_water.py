#!/usr/bin/env python3
"""
Coastline data for the GFW water routing, prepared ONCE and reused by every bake job.

  python3 prepare_water.py [--sources DIR] [--nhn-units 08hb001,...]

Produces (LAND_DIR = cache/land, or $GFW_LAND_DIR):
  osm/land_polygons.{shp,shx,dbf,prj,cpg}   OSM land polygons, split, WGS84 (global; ~0.9 GB zip, 1.3 GB unzipped)
                                            https://osmdata.openstreetmap.de/download/land-polygons-split-4326.zip  (ODbL)
  extras-v1.pkl                             Alaska DNR 1:63,360 + NRCan NHN BC coastal units + the NHN work-unit index
                                            (see land.py), ~100 MB; only the Pacific stage uses it.

Sources are downloaded into SOURCES (default cache/sources) only when missing:
  akdnr/coast63360_<oid>.geojson.gz   Alaska DNR MapServer layer 4, paged by OBJECTID (37,362 polygons, ~15 MB gz)
  nhn/NHN_INDEX_WORKUNIT_LIMIT_2.zip  NHN work-unit index (242 MB)
  nhn/nhn_rhn_<unit>_shp_en.zip       48 BC coastal NHN units (~1 GB; only 4 layers are unzipped)

CI: the workflow keeps LAND_DIR in the Actions cache (key water-v1); on a cache miss it runs this
script (≈ 25 min, ~2.2 GB of downloads). Uploading extras-v1.pkl to Blob instead is optional.
"""
import argparse, os, subprocess, sys, urllib.request, zipfile
import land

HERE = os.path.dirname(os.path.abspath(__file__))
UA = 'earthatlas-bake/1.0 (+https://earthatlas.org)'
OSM_ZIP = 'https://osmdata.openstreetmap.de/download/land-polygons-split-4326.zip'
DNR = 'https://arcgis.dnr.alaska.gov/arcgis/rest/services/OpenData/Physical_AlaskaCoast/MapServer/4/query'
NHN = 'https://ftp.maps.canada.ca/pub/nrcan_rncan/vector/geobase_nhn_rhn'
NHN_UNITS = ('08dda00 08dbc00 08egbx1 08faax1 08fabx1 08fd002 08fd004 08fd0x1 08fd0x3 08fd0x5 08fe0x1 08fe0x2 08ff001 '
             '08fg001 08fg002 08fg003 08fg004 08fg005 08fg006 08gabx1 08gb0x1 08gc0x0 08gd001 08ge0x0 08gf001 08gf002 '
             '08ha0x2 08ha0x3 08hac00 08hac02 08had00 08hb001 08hb002 08hb0x3 08hc0x1 08hd001 08hd002 08he0x1 08he002 '
             '08he003 08hf001 08hf002 08hf003 08hf0x4 08mha00 08mhbx1 08oa000 08ob000').split()


def get(url, f):
    if os.path.exists(f) and os.path.getsize(f) > 0:
        return f
    os.makedirs(os.path.dirname(f), exist_ok=True)
    print('download', url, flush=True)
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=600) as r, open(f + '.tmp', 'wb') as o:
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            o.write(b)
    os.replace(f + '.tmp', f)
    return f


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sources', default=os.path.join(HERE, 'cache', 'sources'))
    ap.add_argument('--skip-extras', action='store_true')
    a = ap.parse_args()
    # OSM land polygons
    if not os.path.exists(land.OSM_SHP):
        z = get(OSM_ZIP, os.path.join(a.sources, 'osm', 'land-polygons-split-4326.zip'))
        os.makedirs(os.path.dirname(land.OSM_SHP), exist_ok=True)
        with zipfile.ZipFile(z) as zf:
            for n in zf.namelist():
                if os.path.basename(n).startswith('land_polygons.'):
                    with zf.open(n) as src, open(os.path.join(os.path.dirname(land.OSM_SHP), os.path.basename(n)), 'wb') as dst:
                        dst.write(src.read())
    print('osm ok', land.OSM_SHP, flush=True)
    if a.skip_extras or os.path.exists(land.EXTRAS):
        return
    # Alaska DNR, paged by OBJECTID
    dnr_dir = os.path.join(a.sources, 'akdnr')
    for lo in range(74725, 112087, 1000):
        get(f'{DNR}?where=OBJECTID%3E%3D{lo}+AND+OBJECTID%3C{lo + 1000}&outFields=OBJECTID,FEATURE&outSR=4326&geometryPrecision=6&f=geojson',
            os.path.join(dnr_dir, f'coast63360_{lo}.geojson.raw'))
        raw = os.path.join(dnr_dir, f'coast63360_{lo}.geojson.raw')
        gz = os.path.join(dnr_dir, f'coast63360_{lo}.geojson.gz')
        if not os.path.exists(gz):
            subprocess.run(['gzip', '-6', '-c', raw], stdout=open(gz, 'wb'), check=True)
    # NHN
    nhn_dir = os.path.join(a.sources, 'nhn')
    idx = get(f'{NHN}/index/NHN_INDEX_WORKUNIT_LIMIT_2.zip', os.path.join(nhn_dir, 'NHN_INDEX_WORKUNIT_LIMIT_2.zip'))
    with zipfile.ZipFile(idx) as zf:
        zf.extractall(nhn_dir)
    for u in NHN_UNITS:
        z = get(f'{NHN}/shp_en/08/nhn_rhn_{u}_shp_en.zip', os.path.join(nhn_dir, f'nhn_rhn_{u}_shp_en.zip'))
        d = os.path.join(nhn_dir, 'u', u)
        os.makedirs(d, exist_ok=True)
        with zipfile.ZipFile(z) as zf:
            for n in zf.namelist():
                if any(k in n for k in ('WORKUNIT_LIMIT_2', 'HN_LITTORAL_1', 'HD_ISLAND_2', 'HD_WATERBODY_2')):
                    zf.extract(n, d)
    land.build_extras(dnr_dir, nhn_dir)


if __name__ == '__main__':
    sys.exit(main())
