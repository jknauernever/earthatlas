#!/bin/zsh
# One-time (re-runnable) setup of the national data layout (docs/NATIONAL_DATA.md), moving what the /spills work
# downloaded on 2026-11-01 into it. Laptop: data/national/<dataset>/{raw,work,build}; big folders link to the offload
# drive (/Volumes/Josh WD 4TB/earthatlas-offload/data/national/<dataset>/…). Moves never overwrite (mv -n).
set -uo pipefail
ROOT=${0:A:h:h:h}
L=$ROOT/data/national
W="/Volumes/Josh WD 4TB/earthatlas-offload/data/national"
OLD_W="/Volumes/Josh WD 4TB/earthatlas-offload/data/spills/national"
S=$ROOT/data/spills
[[ -d "/Volumes/Josh WD 4TB" ]] || { print "offload drive not mounted"; exit 1 }
mkdir -p $L "$W"

# big ones: raw (and padus' tile work/build) on the offload drive
for d in padus crithab; do mkdir -p "$W/$d/raw" $L/$d/work; [[ -L $L/$d/raw ]] || ln -s "$W/$d/raw" $L/$d/raw; done
mkdir -p "$W/padus/work" "$W/padus/build"
for x in work build; do [[ -e $L/padus/$x && ! -L $L/padus/$x ]] && rmdir $L/padus/$x 2>/dev/null; [[ -L $L/padus/$x ]] || ln -s "$W/padus/$x" $L/padus/$x; done
mkdir -p "$W/crithab/build"; [[ -L $L/crithab/build ]] || ln -s "$W/crithab/build" $L/crithab/build
# small ones on the laptop
for d in esa-species phmsa nrc census; do mkdir -p $L/$d/raw $L/$d/work $L/$d/build; done

mvn() { [[ -e "$1" ]] && mv -n "$1" "$2" 2>/dev/null; true }
# offload drive: PAD-US and critical habitat
mvn "$OLD_W/padus41_combined.parquet" "$W/padus/raw/"
mvn "$OLD_W/padus_selected.geojsonl" "$W/padus/work/"
for f in crithab.gpkg crithab.json crithab_poly.geojson crithab_line.geojson crithab_all_shapefiles.zip crithab_all_shapefiles nmfs; do mvn "$OLD_W/$f" "$W/crithab/raw/"; done
# laptop: NRC, PHMSA, Census, ECOS species, critical-habitat caches
for f in $S/CY??.xlsx $S/DataDictionary.xlsx; do mvn $f $L/nrc/raw/; done
for f in $S/work/nrc_cand_??.csv $S/work/census_geocode.csv; do mvn $f $L/nrc/work/; done
[[ -d $S/phmsa && ! -L $S/phmsa ]] && { for f in $S/phmsa/*(N); do mvn $f $L/phmsa/raw/; done; rmdir $S/phmsa/inbox $S/phmsa 2>/dev/null }
mkdir -p $L/phmsa/raw/inbox
for f in $S/2024_Gaz_place_national.txt $S/gaz.zip; do mvn $f $L/census/raw/; done
mvn $S/work/national/states.geojson $L/census/work/
for f in $S/padus/IN/tl_2022_us_state.*(N); do [[ -e $L/census/raw/${f:t} ]] || cp $f $L/census/raw/; done
[[ -e $L/padus/work/designations.csv ]] || cp $S/work/padus/designations.csv $L/padus/work/ 2>/dev/null
mvn $S/work/national/ecos_listed.json $L/esa-species/raw/
for f in crithab_zones.pkl crithab_species.json; do mvn $S/work/national/$f $L/crithab/work/; done
for f in $S/work/national/padus_near*.json(N); do mvn $f $S/work/; done
rmdir $S/work/national 2>/dev/null
[[ -L $S/national ]] && rm $S/national
rmdir "$OLD_W" 2>/dev/null
print "layout:"; for d in $L/*; do print "  ${d:t}: $(ls $d | tr '\n' ' ')"; done
