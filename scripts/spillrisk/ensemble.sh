#!/bin/zsh
# Phase 1 benchmark: 10-member perturbed ensemble at one point (no built-in uncertainty, best estimate only).
# Perturbations are a benchmark choice, not a published scheme: wind speed x N(1, 0.2), wind direction + N(0, 15 deg),
# current speed x U(0.85, 1.15), random-walk seed per member. Member 0 is unperturbed.
# usage: scripts/spillrisk/ensemble.sh <name> <lon> <lat> [members=10] [workers=1]
cd "$(dirname $0)/../.."
E=data/spillrisk/env/bin/python; F=data/spillrisk/forcing/sscofs-20261105-03z-surface.nc; R=data/spillrisk/runs; O=data/spillrisk/oils/AD00020.json
name=$1; lon=$2; lat=$3; N=${4:-10}; W=${5:-1}; shift 5 2>/dev/null; EXTRA=("$@")
params=$($E -I -c "
import numpy as np; r=np.random.default_rng(42)
for i in range($N):
    ws, wr, cs = (1.0, 0.0, 1.0) if i == 0 else (max(0.4, r.normal(1, 0.2)), r.normal(0, 15), r.uniform(0.85, 1.15))
    print(i, round(ws, 3), round(wr, 1), round(cs, 3))")
t0=$(date +%s); pids=()
while read i ws wr cs; do
  [[ -f $R/ens-$name-$i.json ]] && continue
  while :; do alive=(); for p in $pids; do kill -0 $p 2>/dev/null && alive+=$p; done; pids=($alive); (( ${#pids} < W )) && break; sleep 1; done
  { $E -I scripts/spillrisk/run_spill.py $F $lon $lat 72 $O $R/ens-$name-$i.npz --seed $i --wind-scale $ws --wind-rot $wr --cur-scale $cs ${EXTRA[@]} 2>>$R/ens-warnings.log >>$R/ens-$name.log } &
  pids+=$!
done <<< "$params"
wait
echo "ensemble $name members=$N workers=$W extra=${EXTRA[*]} wall_s=$(( $(date +%s) - t0 ))" | tee -a $R/ens-$name.log
