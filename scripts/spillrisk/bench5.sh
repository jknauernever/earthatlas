#!/bin/zsh
# Phase 1 benchmark: five source points x 72 h, best estimate + PyGNOME uncertainty, ANS crude, 1000 elements.
cd "$(dirname $0)/../.."
E=data/spillrisk/env/bin/python; F=data/spillrisk/forcing/sscofs-20261105-03z-surface.nc; R=data/spillrisk/runs; O=data/spillrisk/oils/AD00020.json
typeset -A P
P=(haro "-123.20 48.55" rosario "-122.75 48.55" cherrypoint "-122.765 48.862" pugetsound "-122.43 47.65" juandefuca "-123.70 48.25")
for k in haro rosario cherrypoint pugetsound juandefuca; do
  [[ -f $R/b5-$k.json ]] && continue
  $E -I scripts/spillrisk/run_spill.py $F ${=P[$k]} 72 $O $R/b5-$k.npz --uncertain 2>>$R/b5-warnings.log | tee -a $R/b5.log
done
