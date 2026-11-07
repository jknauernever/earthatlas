#!/bin/bash
set -e
eval "$(micromamba shell hook -s bash)"; micromamba activate base
mkdir -p data/spillrisk/forcing data/spillrisk/runs
echo "cpus $(nproc) mem $(free -m | awk '/Mem/{print $2}') MB"
t0=$(date +%s)
python -I scripts/spillrisk/fetch_sscofs.py ${DAY:-20261105} ${CYC:-03} 72 | tail -1
t1=$(date +%s); echo "fetch_s $((t1-t0))"
python -I scripts/spillrisk/land_bna.py scripts/bake-shiptraffic/salish_land.geojson data/spillrisk/forcing/salish_land_gshhg.bna -124.85 47.0 -122.05 49.0
python -I scripts/spillrisk/run_spill.py data/spillrisk/forcing/sscofs-${DAY:-20261105}-${CYC:-03}z-surface.nc -123.20 48.55 72 data/spillrisk/oils/AD00020.json data/spillrisk/runs/fly-haro.npz --uncertain 2>/dev/null
echo "total_s $(( $(date +%s) - t0 ))"
