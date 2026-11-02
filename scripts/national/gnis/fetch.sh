#!/bin/zsh
# National dataset `gnis`: USGS Geographic Names Information System, Domestic Names (the U.S. Board on Geographic Names
# national file: ~980,000 named natural features and places, one point each; "Irregular" updates; use constraint None,
# acknowledge USGS). One 46 MB zip, downloaded only when newer (If-Modified-Since).
#   zsh scripts/national/gnis/fetch.sh   → data/national/gnis/raw/DomesticNames_National.txt
set -euo pipefail
RAW=${0:A:h:h:h:h}/data/national/gnis/raw
mkdir -p $RAW
cd $RAW
code=$(curl -sS -w '%{http_code}' -z DomesticNames_National_Text.zip -o DomesticNames_National_Text.zip.part \
  https://prd-tnm.s3.amazonaws.com/StagedProducts/GeographicNames/DomesticNames/DomesticNames_National_Text.zip)
if [[ $code == 200 && -s DomesticNames_National_Text.zip.part ]]; then
  mv DomesticNames_National_Text.zip.part DomesticNames_National_Text.zip
  unzip -o -q -j DomesticNames_National_Text.zip '*DomesticNames_National.txt' -d .
  print "GNIS updated: $(wc -l < DomesticNames_National.txt) lines"
else
  rm -f DomesticNames_National_Text.zip.part; print "GNIS unchanged (HTTP $code)"
fi
