#!/bin/zsh
# /ships production data operations: the only production-writing entry point Claude may run without
# asking (Josh, 2026-09-26; .claude/settings.local.json allows `zsh scripts/ships/prod.sh *`).
# Fixed subcommands only; anything else is refused.
#
#   zsh scripts/ships/prod.sh migrate            back up prod `ships`, then apply pending migrations (additive)
#   zsh scripts/ships/prod.sh import-ports       back up, then countries, World Port Index, GFW anchorage names, match
#   zsh scripts/ships/prod.sh import-anchorages  back up, then official anchorage areas: US (MarineCadastre + eCFR), Canada (DFO), non-designated (82 FR 10313)
#   zsh scripts/ships/prod.sh import-portwatch   back up, then IMF PortWatch ports (port-card trends)
#   zsh scripts/ships/prod.sh import-commons     back up, then Wikimedia Commons photos + type categories (args pass through)
#   zsh scripts/ships/prod.sh import-gfw         back up, then GFW vessel identities (args pass through, e.g. --mmsi-file F --resume)
#   zsh scripts/ships/prod.sh warm-ports         pre-load Salish port cards (args pass through)
#   zsh scripts/ships/prod.sh import-ct-ports    back up, then Climate TRACE port sources (port-card Ship emissions)
#   zsh scripts/ships/prod.sh upload-ct-voyages  upload the baked Climate TRACE voyage packs (ship-card Emissions) to Vercel Blob
#   zsh scripts/ships/prod.sh import-ct-stays    Climate TRACE port stays → terminals (needs migration 018 + the voyage bake's ct-stays file)
#   zsh scripts/ships/prod.sh import-official-ports  back up, then official port lists (DFO harbours, USACE port areas, Transport Canada) for the Salish box
#   zsh scripts/ships/prod.sh import-gisis       back up, then IMO GISIS scrubber notifications + ISPS port facilities (from the saved CSVs)
#   zsh scripts/ships/prod.sh import-eu-mrv      back up, then EU MRV verified ship emissions for ships we hold (from the saved XLSX files; needs migration 019)
#   zsh scripts/ships/prod.sh import-mep         back up, then the MEP Alliance scrubber lists (from the saved pages in scripts/ships/mep/raw; needs migration 021)
#   zsh scripts/ships/prod.sh import-terminals   back up, then the hand-checked Salish terminals (lib/ships/data/salish-terminals.json)
#   zsh scripts/ships/prod.sh terminal-places    back up, then county + city / town of every US terminal (Census geocoder, ~65 requests; needs migration 028)
#   zsh scripts/ships/prod.sh scrubber-edition   freeze the scrubber report as a dated edition (args pass through: --id 2026-10 --from 2025-01 --to 2026-06; needs migration 029)
#   zsh scripts/ships/prod.sh import-facilities  back up, then facilities + EPA permits/enforcement + WA SEPA reviews + permit documents (lib/ships/data/salish-facilities.json; reuses the cached responses in scripts/ships/facilities/cache; needs migrations 022-024)
#   zsh scripts/ships/prod.sh import-bc-permits  back up, then BC facilities + EMA authorizations + NRCED records + EAO projects + Metro Vancouver air permits (the bc- entries of salish-facilities.json; reuses the cached responses and PDFs in scripts/ships/facilities/cache, 0 requests when cached; needs migration 027)
#   zsh scripts/ships/prod.sh import-terminal-calls  back up, then terminal calls counted from our AIS (cache/terminal-calls/hits.csv)
#   zsh scripts/ships/prod.sh import-anchorage-stays back up, then anchorage stays counted from our AIS (cache/anchorage-stays/hits.csv; needs migration 020)
#   zsh scripts/ships/prod.sh import-anchorage-aliases back up, then "also known as" names for anchorages (GFW names already stored + the USCG VTS manual p. 3-6 record; needs migration 020)
#   zsh scripts/ships/prod.sh import-mc-v6       back up, then MarineCadastre AIS identities from the salish-v6 bake (build/v6)
#   zsh scripts/ships/prod.sh upload-salish      upload the baked Salish track tiles to Vercel Blob
#   zsh scripts/ships/prod.sh salish-index-seed  once (Part 1, Josh 2026-10-07): upload the hand-run months' coastline masks for ships-noaa-month, then write the Salish index + identity files (needs the upload-token allowlist deployed)
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
  import-official-ports)
    need SHIPS_PROD_DATABASE_URL
    backup import-official-ports
    prod_node scripts/ships/import-official-ports.mjs all "${@:2}"
    ;;
  import-gisis)
    need SHIPS_PROD_DATABASE_URL
    backup import-gisis
    prod_node scripts/ships/import-gisis.mjs all "${@:2}"
    ;;
  import-eu-mrv)
    need SHIPS_PROD_DATABASE_URL
    backup import-eu-mrv
    prod_node scripts/ships/import-eu-mrv.mjs --known "${@:2}"
    ;;
  import-mep)
    need SHIPS_PROD_DATABASE_URL
    backup import-mep
    prod_node scripts/ships/import-mep.mjs "${@:2}"
    ;;
  import-terminals)
    need SHIPS_PROD_DATABASE_URL
    backup import-terminals
    prod_node scripts/ships/import-terminals.mjs "${@:2}"
    ;;
  terminal-places)
    need SHIPS_PROD_DATABASE_URL
    backup terminal-places
    prod_node scripts/ships/terminal-places.mjs "${@:2}"
    ;;
  scrubber-edition)
    need SHIPS_PROD_DATABASE_URL
    prod_node scripts/ships/scrubber-edition.mjs "${@:2}"
    ;;
  import-facilities)
    need SHIPS_PROD_DATABASE_URL
    backup import-facilities
    prod_node scripts/ships/import-facilities.mjs "${@:2}"
    ;;
  import-bc-permits)
    need SHIPS_PROD_DATABASE_URL
    backup import-bc-permits
    prod_node scripts/ships/import-bc-permits.mjs "${@:2}"
    ;;
  import-terminal-calls)
    need SHIPS_PROD_DATABASE_URL
    backup import-terminal-calls
    prod_node scripts/ships/terminal-calls.mjs import "${@:2}"
    ;;
  import-anchorage-stays)
    need SHIPS_PROD_DATABASE_URL
    backup import-anchorage-stays
    prod_node scripts/ships/anchorage-stays.mjs import "${@:2}"
    ;;
  import-anchorage-aliases)
    need SHIPS_PROD_DATABASE_URL
    backup import-anchorage-aliases
    prod_node scripts/ships/anchorage-stays.mjs aliases "${@:2}"
    ;;
  import-mc-v6)
    need SHIPS_PROD_DATABASE_URL
    backup import-mc-v6
    prod_node scripts/ships/import-mc.mjs --build scripts/ships/bake-ais/build/v6 "${@:2}"
    ;;
  upload-salish)
    need BLOB_READ_WRITE_TOKEN
    node --env-file=.env.local scripts/ships/bake-ais/upload.mjs
    ;;
  salish-index-seed)
    need BLOB_READ_WRITE_TOKEN; need CRON_SECRET
    land=scripts/ships/bake-ais/cache/land
    for f in salish-v6-osm-inland-500m.parquet salish-v6-osm-land-0m.parquet; do
      [ -f "$land/$f" ] || { echo "prod.sh: $land/$f not found (is the WD drive plugged in?)" >&2; exit 2 }
      out=$(npx vercel blob put "$land/$f" --access public --pathname "ships/bake-inputs/salish-v6/$f" \
        --content-type application/octet-stream --allow-overwrite true --rw-token "$(envval BLOB_READ_WRITE_TOKEN)" 2>&1) || true
      [[ "$out" == *Success!* ]] || { echo "prod.sh: upload of $f failed:" >&2; echo "$out" | tail -5 >&2; exit 1 }
      url=https://fxj3imydg9misw9w.public.blob.vercel-storage.com/ships/bake-inputs/salish-v6/$f
      remote=$(curl -sI "$url?v=$(date +%s)" | tr -d '\r' | awk 'tolower($1)=="content-length:"{print $2}')
      [ "$remote" = "$(stat -f %z "$land/$f")" ] && echo "uploaded $f (verified)" || { echo "prod.sh: $f is $remote bytes on Blob" >&2; exit 1 }
    done
    node --env-file=.env.local scripts/ships/bake-ais/publish.mjs --seed scripts/ships/bake-ais/build/v6/track_tiles scripts/ships/bake-ais/build/v6
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
  warm-ports)
    # Pre-load Salish Sea port cards (2026 months) so they open instantly; settled months are kept for good.
    # Josh approved 2026-09-27. Extra args pass through (e.g. --months 2026-01..2026-06 --bbox W,S,E,N).
    need SHIPS_PROD_DATABASE_URL
    prod_node scripts/ships/warm-port-cards.mjs "${@:2}"
    ;;
  import-portwatch)
    need SHIPS_PROD_DATABASE_URL
    backup import-portwatch
    prod_node scripts/ships/import-portwatch.mjs "${@:2}"
    ;;
  import-commons)
    need SHIPS_PROD_DATABASE_URL
    backup import-commons
    prod_node scripts/ships/import-commons.mjs --resume "${@:2}"
    ;;
  import-gfw)
    need SHIPS_PROD_DATABASE_URL
    backup import-gfw
    prod_node scripts/ships/import-gfw.mjs "${@:2}"
    ;;
  import-ct-ports)
    # Reads the Climate TRACE facility bake (scripts/bake-climatetrace/build/features.geojsonl) QA'd on localhost.
    need SHIPS_PROD_DATABASE_URL
    backup import-ct-ports
    prod_node scripts/ships/import-climatetrace-ports.mjs "${@:2}"
    ;;
  import-ct-stays)
    # Reads scripts/ships/bake-ct-voyages/build/ct-stays-<v>.ndjson (the bake QA'd on localhost) and prod's own berths.
    need SHIPS_PROD_DATABASE_URL
    backup import-ct-stays
    prod_node scripts/ships/import-ct-stays.mjs "${@:2}"
    ;;
  upload-ct-voyages)
    # Packs baked by scripts/ships/bake-ct-voyages/bake.mjs, to the paths src/ships/trackSource.json `ctVoyages` names.
    need BLOB_READ_WRITE_TOKEN
    for kind in mmsi imo; do
      url=$(python3 -c "import json; print(json.load(open('src/ships/trackSource.json'))['ctVoyages']['$kind'])")
      file=scripts/ships/bake-ct-voyages/build/${url:t}
      [ -f "$file" ] || { echo "prod.sh: $file not found (run the voyage bake first)" >&2; exit 2 }
      # Judge the upload by its output and the stored size, not the CLI's exit code (it can exit non-zero after a
      # successful upload, which under `set -e` ended this loop after the first file, 2026-09-27).
      out=$(BLOB_READ_WRITE_TOKEN="$(envval BLOB_READ_WRITE_TOKEN)" npx vercel blob put "$file" --access public --pathname "ships/ct-voyages/${url:t}" \
        --content-type application/octet-stream --allow-overwrite true --rw-token "$(envval BLOB_READ_WRITE_TOKEN)" 2>&1) || true
      [[ "$out" == *Success!* ]] || { echo "prod.sh: upload of ${url:t} failed:" >&2; echo "$out" | tail -5 >&2; exit 1 }
      remote=$(curl -sI "$url" | tr -d '\r' | awk 'tolower($1)=="content-length:"{print $2}')
      local_size=$(stat -f %z "$file")
      [ "$remote" = "$local_size" ] && echo "uploaded $url ($local_size bytes, verified)" || echo "prod.sh: $url is $remote bytes on Blob, expected $local_size (CDN may still hold the old copy; re-check in a minute)" >&2
    done
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
    sed -n '2,29p' "$0"; exit 2
    ;;
esac
