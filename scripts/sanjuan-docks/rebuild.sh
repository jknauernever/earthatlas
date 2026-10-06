#!/bin/zsh
# Rebuild everything the /sanjuan-docks map reads, in order, so every number on the
# page (legend counts come from these files' metadata) reflects the latest data:
#   1. permit map (WDFW + county pre-2010 + SmartGov from data/sanjuan-docks/)
#   2. reviewer-confirmed docks found in the 2025 aerials (review/labels.json)
#   3. the merged dock file (OSM + Friends + aerial + permit-only, parcels)
# Run after a SmartGov fetch, a review round, or an OSM refresh (--refresh-osm).
set -e
cd "${0:A:h}/../.."
node scripts/bake-sanjuan-docks.mjs
python3 scripts/sanjuan-docks/ml/export_confirmed.py
python3 scripts/sanjuan-docks/bake-dock-locations.py "$@" | grep -v Warn
