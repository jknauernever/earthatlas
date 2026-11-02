#!/bin/zsh
# National dataset `esa-species`: every federally listed species and population (status, listing date, ECOS profile link)
# from the U.S. Fish and Wildlife Service ECOS species catalog, one export request.
#   zsh scripts/national/esa-species/fetch.sh   → data/national/esa-species/raw/ecos_listed.json
set -euo pipefail
OUT=${0:A:h:h:h:h}/data/national/esa-species/raw
mkdir -p $OUT
curl -sS -f -G "https://ecos.fws.gov/ecp/pullreports/catalog/species/report/species/export" \
  --data-urlencode "format=json" --data-urlencode "columns=/species@cn,sn,status,desc,listing_date,country" \
  --data-urlencode "filter=/species@status in ('Endangered','Threatened')" -o $OUT/ecos_listed.json.part
mv $OUT/ecos_listed.json.part $OUT/ecos_listed.json
python3 -c "import json;print(len(json.load(open('$OUT/ecos_listed.json'))['data']),'listed entities')"
