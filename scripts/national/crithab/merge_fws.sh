#!/bin/zsh
# National dataset `crithab`, Fish and Wildlife Service half: download ECOS's every-species archive (one zip per species,
# polygons and stream lines in assorted field spellings) and merge it into one GeoPackage with `poly` and `line` layers
# (WGS84), keeping each shape's source file name (`srcfile`, the species fallback). Then run build.py.
#   zsh scripts/national/crithab/merge_fws.sh   (≈420 MB download, ~15 min; offload drive)
set -uo pipefail
RAW=${0:A:h:h:h:h}/data/national/crithab/raw
cd $RAW
curl -sS -f -z crithab_all_shapefiles.zip -o crithab_all_shapefiles.zip https://ecos.fws.gov/docs/crithab/crithab_all/crithab_all_shapefiles.zip
TMP=$RAW/unzipped; rm -rf $TMP; mkdir -p $TMP
unzip -o -q crithab_all_shapefiles.zip -d $TMP
for z in $(find $TMP -name 'FCH_*.zip' -not -name '._*'); do unzip -o -q $z -d ${z%.zip}; done
rm -f crithab.gpkg
find $TMP -iname '*.shp' -not -name '._*' | while read f; do
  n=$(basename "$f" .shp)
  g=$(ogrinfo -ro -so "$f" "$n" 2>/dev/null | sed -n 's/^Geometry: //p')
  case "$g" in *Line*) L=line;; *Polygon*) L=poly;; *) continue;; esac
  ogr2ogr -q -f GPKG crithab.gpkg "$f" -nln $L -append -addfields -t_srs EPSG:4326 -nlt PROMOTE_TO_MULTI \
    -sql "SELECT *, '$n' AS srcfile FROM \"$n\"" 2>/dev/null
done
rm -rf $TMP   # exFAT gives each small file a 1 MB block: the unzipped tree costs ~17 GB, the merge keeps what matters
ogrinfo -ro -so crithab.gpkg poly | grep "Feature Count"; ogrinfo -ro -so crithab.gpkg line | grep "Feature Count"
