#!/bin/zsh
# /ships production data operations: the only production-writing entry point Claude may run without
# asking (Josh, 2026-09-26; .claude/settings.local.json allows `zsh scripts/ships/prod.sh *`).
# Fixed subcommands only; anything else is refused.
#
#   zsh scripts/ships/prod.sh migrate            back up prod `ships`, then apply pending migrations (additive)
#   zsh scripts/ships/prod.sh import-ports       back up, then countries, World Port Index, GFW anchorage names, match
#   zsh scripts/ships/prod.sh import-anchorages  back up, then official anchorage areas: US (MarineCadastre + eCFR), Canada (DFO), non-designated (82 FR 10313)
#   zsh scripts/ships/prod.sh upload-salish      upload the baked Salish track tiles to Vercel Blob
#   zsh scripts/ships/prod.sh pack-table         write US per-ship shard tables into month manifests (Blob)
#   zsh scripts/ships/prod.sh index <run id>     add a cloud bake run's finished months to the US index (Blob)
#
# Secrets come from .env.local (gitignored, excluded by .vercelignore) and are never printed:
#   SHIPS_PROD_DATABASE_URL  prod ships DB, direct (unpooled) connection
#   BLOB_READ_WRITE_TOKEN    Blob store write token
#   CRON_SECRET              for the US index upload-token endpoint
set -euo pipefail
cd "${0:A:h}/../.."
envval() { grep -E "^$1=" .env.local | tail -1 | cut -d= -f2- | tr -d "\"'" }
need() { [ -n "$(envval $1)" ] || { echo "prod.sh: $1 is not set in .env.local" >&2; exit 2 } }
PG=$(brew --prefix libpq 2>/dev/null)/bin
BACKUPS=~/Projects/earthatlas-backups

backup() {
  mkdir -p $BACKUPS
  local f=$BACKUPS/ships-prod-$(date +%Y%m%d-%H%M%S)-before-$1.dump
  $PG/pg_dump "$(envval SHIPS_PROD_DATABASE_URL)" -n ships -Fc --no-owner --no-privileges -f "$f"
  echo "backup: $f ($(du -h "$f" | cut -f1))"
}
# A ships script against PRODUCTION: the explicit SHIPS_DATABASE_URL wins over .env.local's dev value.
prod_node() { SHIPS_DATABASE_URL="$(envval SHIPS_PROD_DATABASE_URL)" node --env-file=.env.local "$@" }

case "${1:-}" in
  migrate)
    need SHIPS_PROD_DATABASE_URL
    backup migrate
    prod_node scripts/ships/migrate.mjs
    ;;
  import-ports)
    need SHIPS_PROD_DATABASE_URL
    backup import-ports
    for step in countries wpi anchorages; do
      echo "== $step"; prod_node scripts/ships/import-ports.mjs $step
    done
    # Port visits arrive when a ship's Ports tab is opened (api/ships op=ports names them then), so on
    # a fresh database there may be nothing to match yet.
    echo "== match"; prod_node scripts/ships/import-ports.mjs match || echo "match: nothing to match yet (no port visits stored)"
    ;;
  import-anchorages)
    # Needs migration 009 on prod first (prod.sh migrate). Reads the files downloaded by the dev imports' --fetch
    # (scripts/ships/bake-ais/build/anchorages/), so prod gets exactly what was QA'd on localhost.
    need SHIPS_PROD_DATABASE_URL
    backup import-anchorages
    for step in us ca nondesignated; do
      echo "== $step"; prod_node scripts/ships/import-anchorages.mjs $step
    done
    ;;
  upload-salish)
    need BLOB_READ_WRITE_TOKEN
    node --env-file=.env.local scripts/ships/bake-ais/upload.mjs
    ;;
  upload-mpa)
    # Marine protected areas tiles baked by scripts/ships/bake-mpa/bake.mjs (NOAA MPA Inventory),
    # to the path src/ships/trackSource.json `mpa.tiles` points at. Josh approved 2026-09-27.
    need BLOB_READ_WRITE_TOKEN
    url=$(python3 -c "import json; print(json.load(open('src/ships/trackSource.json'))['mpa']['tiles'])")
    file=scripts/ships/bake-mpa/build/${url:t}
    [ -f "$file" ] || { echo "prod.sh: $file not found (run the MPA bake first)" >&2; exit 2 }
    BLOB_READ_WRITE_TOKEN="$(envval BLOB_READ_WRITE_TOKEN)" npx vercel blob put "$file" --access public --pathname "ships/mpa/${url:t}" \
      --content-type application/octet-stream --allow-overwrite true --rw-token "$(envval BLOB_READ_WRITE_TOKEN)" | grep -o 'https://[^ ]*' | head -1
    ;;
  pack-table)
    need CRON_SECRET
    node --env-file=.env.local scripts/ships/bake-us/pack-table.mjs
    ;;
  index)
    need CRON_SECRET
    run=${2:-}; [[ "$run" =~ '^[0-9]+$' ]] || { echo "usage: prod.sh index <GitHub run id>" >&2; exit 2 }
    dir=scripts/ships/bake-us/build/entries-$run
    rm -rf "$dir"; mkdir -p "$dir"
    gh run download "$run" -p 'entry-*' -D "$dir" >/dev/null
    git show origin/ships-us-bake:scripts/ships/bake-us/publish.mjs > scripts/ships/bake-us/build/publish-index.mjs
    node --env-file=.env.local scripts/ships/bake-us/build/publish-index.mjs --index "$dir"
    ;;
  *)
    sed -n '2,16p' "$0"; exit 2
    ;;
esac
