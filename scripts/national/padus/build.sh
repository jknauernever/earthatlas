#!/bin/zsh
# National PAD-US map tiles for every EarthAtlas subsite (Josh 2026-11-01): the whole USGS PAD-US 4.1 Combined layer,
# all 656,986 records, as one PMTiles archive with two vector layers:
#   padus          fee land, easements, designations and marine areas
#   proclamation   approved / proclamation boundaries (outer lines that overlap the land inside them)
# Each feature keeps the fields a map or card needs (name, manager, designation, GAP protection status, public access,
# acres, state) plus `id` (the record's row in the source file).
#
# Zoom tiers (Josh 2026-11-02): each area first appears at the zoom its manager and size call for, so a national view
# shows the big federal and state lands crisply instead of a speckle of 257,000 city parks (avg 60 acres):
#   z0+  federal or joint management, or 100,000+ acres
#   z5+  state, or 10,000+ acres
#   z8+  nonprofit, special district, tribal, territorial
#   z10+ everything else (local parks, private, unknown)
#
# Input: data/national/padus/raw/padus41_combined.parquet — the Source Cooperative copy (data.source.coop/cboettig/padus)
# of the USGS release (doi:10.5066/P96WBCHS); USGS's own national files need a ScienceBase sign-in (docs/NATIONAL_DATA.md).
# Output: data/national/padus/build/<version>/tiles.pmtiles + dataset.json (the catalog entry). Publish with
#   node --env-file=.env.local scripts/national/publish.mjs padus <version>
# Served by api/national-tiles.js (?d=padus); src/lib/national/padus.js styles it.
#
#   zsh scripts/national/padus/build.sh [version]     (about 30–60 min, local only; version defaults to 4.1-<yyyymmdd>)
set -euo pipefail
ROOT=${0:A:h:h:h:h}
SRC=$ROOT/data/national/padus/raw/padus41_combined.parquet
VERSION=${1:-4.1-$(date +%Y%m%d)}
WORK=${PADUS_WORK:-$ROOT/data/national/padus/work}        # the FlatGeobuf inputs (offload drive, through the link)
OUT=$ROOT/data/national/padus/build/$VERSION
mkdir -p $WORK $WORK/tmp $OUT
FIELDS='_cng_fid,FeatClass,Own_Type,Mang_Type,Mang_Name,Loc_Mang,Des_Tp,Loc_Ds,Unit_Nm,GAP_Sts,Pub_Access,GIS_Acres,State_Nm,IUCN_Cat,Date_Est'
for part in padus proclamation; do
  where=$([[ $part == padus ]] && echo "FeatClass <> 'Proclamation'" || echo "FeatClass = 'Proclamation'")
  # -wrapdateline: split shapes at the 180° line (Aleutians, Pacific monuments), or tiles stretch them around the world
  [[ -s $WORK/$part.fgb ]] || ogr2ogr -q -skipfailures -f FlatGeobuf -t_srs EPSG:4326 -nlt PROMOTE_TO_MULTI -wrapdateline -datelineoffset 10 \
    -sql "SELECT ${FIELDS//_cng_fid/_cng_fid AS id}, SHAPE FROM padus41_combined WHERE $where" -dialect SQLite \
    $WORK/$part.fgb $SRC
  print "$part: $(ogrinfo -ro -so $WORK/$part.fgb $part 2>/dev/null | sed -n 's/Feature Count: //p') features"
done
TIERS='{"padus":["any",["in","Mang_Type","FED","JNT"],[">=","GIS_Acres",100000],
  ["all",[">=","$zoom",5],["any",["==","Mang_Type","STAT"],[">=","GIS_Acres",10000]]],
  ["all",[">=","$zoom",8],["in","Mang_Type","NGO","DIST","TRIB","TERR"]],
  [">=","$zoom",10]]}'
tippecanoe -o $OUT/tiles.pmtiles -j $TIERS --force -t $WORK/tmp -Z0 -z13 \
  --drop-smallest-as-needed --extend-zooms-if-still-dropping --simplification=4 --detect-shared-borders \
  --attribution='USGS GAP PAD-US 4.1' \
  -L padus:$WORK/padus.fgb -L proclamation:$WORK/proclamation.fgb
cat > $OUT/dataset.json <<JSON
{
 "name": "Protected Areas Database of the United States (PAD-US) 4.1",
 "source": { "publisher": "U.S. Geological Survey, Gap Analysis Project", "url": "https://www.usgs.gov/programs/gap-analysis-project/science/protected-areas",
             "doi": "https://doi.org/10.5066/P96WBCHS", "copy": "https://source.coop/cboettig/padus" },
 "license": "Public domain (17 U.S.C. § 105)",
 "coverage": "United States and territories",
 "cadence": "USGS releases about once a year",
 "layers": { "padus": "fee land, easements, designations, marine areas", "proclamation": "approved or proclamation boundaries" },
 "fields": "id, FeatClass, Own_Type, Mang_Type, Mang_Name, Loc_Mang, Des_Tp, Loc_Ds, Unit_Nm, GAP_Sts, Pub_Access, GIS_Acres, State_Nm, IUCN_Cat, Date_Est",
 "zoom_tiers": { "0": "federal or joint management, or 100,000+ acres", "5": "state, or 10,000+ acres", "8": "nonprofit, district, tribal, territorial", "10": "everything else" },
 "summary": { "records": 656986 }
}
JSON
ls -la $OUT
