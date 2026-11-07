# Phase 1 benchmark only: time one PyGNOME run (incl. forcing fetch) on a Fly machine. Build context = repo root.
FROM mambaorg/micromamba:1.5.10-bookworm-slim
RUN micromamba install -y -n base -c conda-forge python=3.12 pygnome=1.1.23 netcdf4 && micromamba clean -a -y
WORKDIR /app
COPY scripts/spillrisk/fetch_sscofs.py scripts/spillrisk/run_spill.py scripts/spillrisk/land_bna.py scripts/spillrisk/
COPY scripts/bake-shiptraffic/salish_land.geojson scripts/bake-shiptraffic/
COPY data/spillrisk/oils/AD00020.json data/spillrisk/oils/
COPY scripts/spillrisk/fly/bench.sh /app/bench.sh
USER root
RUN chown -R $MAMBA_USER /app
USER $MAMBA_USER
CMD ["/bin/bash", "/app/bench.sh"]
