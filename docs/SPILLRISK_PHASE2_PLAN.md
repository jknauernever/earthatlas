# Oil spill scenarios: Phase 2 plan, the run service (draft 2026-11-05, not started)

Builds on `docs/SPILLRISK_PHASE0.md` and `docs/SPILLRISK_PHASE1_BENCHMARK.md`. Speed package chosen by Josh:
(1) in-memory ensemble wind, (2) stream hours as they compute, (5) one 16-core machine per job running all members at
once, (6) pre-created stopped machines, (8) precompute preset points each forecast cycle.

**Done when** an API call with a point, oil and volume returns hourly probability bands, a best-estimate path and a
weathering summary reliably. Targets (proposed): first hours on screen in about 10 s and the full 72 h in about 30 s from
a stopped machine; presets instant. Nothing goes to production without Josh's go-ahead.

## Shape

```
browser ── POST /api/spillrisk?op=run {lon,lat,oil,vol,turnstile} ──► Vercel function
              │  1 validate: inside start region + on water (water mask)       │
              │  2 snap to 250 m cell; key = model ver|cycle|cell|oil|vol|hours │
              │  3 cache hit → manifest URL right away (presets always hit)     │
              │  4 miss → rate limits + caps → insert job (Neon) → start a     │
              │    stopped Fly worker (Machines API) → {job, poll URL}          │
              ◄── GET op=status&job=… (polled ~2 s) → chunks ready so far ──────┘
Fly worker (perf-16x, own volume with the current SSCOFS cycle):
  claim job (SKIP LOCKED) → load forcing once → fork 10 members (copy-on-write, shared forcing) →
  every 12 model hours write a chunk to Blob → manifest done → take next job → idle 30 s → stop
Vercel cron every 6 h (~4 h after each SSCOFS cycle): enqueue "prep" (fetch cycle to each worker's volume)
  then "presets" (precompute every preset point for the default oil and volume)
```

## Work items

1. **Shoreline and water mask (shared regional dataset).** Run the /ships OSM recipe (`make_land.py` osm: OSM
   coastline land minus inland water, ODbL) for a box that covers where oil can reach in 72 h from the Salish Sea:
   proposed W −126.2 to E −121.95, S 46.9 to N 50.6. SSCOFS itself runs from 44.4 to 52.1°N and −129.5 to −122.0°W. Outputs
   go in the shared data layout, not inside the subsite: the land polygon, the BNA for PyGNOME, and a ~100 m water-mask bitset
   (~1–2 MB) that the API uses to reject clicks on land. Publish to Blob.
2. **Worker** (`scripts/spillrisk/worker/`, Docker image on Fly):
   - Load the forcing and land map once, then fork the members. Copy-on-write sharing should bring memory well
     under the measured 1.6 GB per member (to be measured).
   - Ensemble of 10 (member 0 unperturbed) using the Phase 1 perturbations, which are flagged as our choice, not
     published.
   - Each chunk holds, per hour:
     - band polygons ("likely" / "possible" / "less likely"), merged from 250 m cells
     - the cell list with each cell's share of runs (for the Phase 3 impact lookups)
     - member 0's particles (the best-estimate path)
     - member 0's oil budget (on surface / evaporated / dispersed / on shore)
   - The manifest records the inputs, SSCOFS cycle, model and PyGNOME versions, timings and the source list.
3. **Forcing prep.** This is the Phase 1 fetcher (OPeNDAP, surface layer + model wind, retries) running on each worker
   onto its own volume. The worker keeps the current and previous cycle and switches to a new cycle only when it is complete (f072 present).
4. **API** (`api/spillrisk.js` plus `lib/spillrisk/`):
   - ops `run`, `status`, `presets` (read from `/api/ships?op=terminalsLayer`, read-only)
   - water-mask check, snapping, cache lookup
   - jobs queue in Postgres
   - Fly Machines API start (FLY_API_TOKEN in Vercel env)
   - Turnstile on new runs (already set up for accounts)
   - per-IP limits (hashed IP, never stored raw)
   - a global daily cap on new runs
   - retention pruning by cron
5. **Fly app** `earthatlas-spillrisk`: two pre-created, stopped perf-16x machines, each with a ~5 GB volume. They start on demand
   and stop after 30 s idle.
6. **Testing (small):**
   - Locally first: the worker runs as a local process against `vercel dev`, on 1–2 points.
   - Then one job on a dev Fly machine to measure (a) stopped-machine start, (b) click to first hour, (c) click to 72 h,
     (d) memory with forked members.
   - The full preset precompute runs once, in production, only when Josh says.

## Costs (estimates)

Fly prices are from docs.fly.io (2026-11-05): performance-1x $33/month and performance-2x $66/month work out to about
$0.0000127 per CPU-second. Perf-16x is assumed linear (16 cores ≈ $0.0002/s) but **not checked**.

| Item | Estimate |
|---|---|
| New (uncached) click on perf-16x: ~25 s job + start + 30 s idle tail | **~$0.01–0.015** (bursts share the tail) |
| Cached click, any preset click | $0 compute |
| Presets: ~50 points × default oil/volume × 4 cycles/day, machine fully busy | ~$14/month |
| Forcing prep: 2 workers × 4 cycles/day × ~2 min on 16 cores | ~$6/month |
| Volumes 2 × 5 GB + stopped root filesystems | ~$2/month |
| Results on Blob: ~1–2 MB per new run | small; depends on retention (decision 5) |
| Postgres for jobs/limits | $0 extra as a schema in an always-awake DB, or a new Neon DB at ~$1–5/month (decision 3) |

**Monthly, by traffic** (new uncached runs per day): 10/day ≈ $25 all-in · 100/day ≈ $60 · 1,000/day ≈ $400. The
global daily cap (decision 4) bounds the worst case: e.g. a 300/day cap holds the run cost to about $135/month at most.

## Decisions for Josh

1. **Start region** (where clicks are accepted): the Salish Sea only, proposed as the SSCOFS wet area inside −125.0…−122.0,
   47.0…50.3 (Puget Sound, Hood Canal, Strait of Juan de Fuca to the mouth, San Juans, Strait of Georgia). Oil may drift
   beyond it, and leaving the modeled area is shown as "left the modeled area". Alternative: the whole SSCOFS domain incl. the WA/OR outer coast and
   Columbia River.
2. **Snap size:** 250 m (recommended; clicks that close share a result) vs 500 m (more cache hits).
3. **Jobs database:** a `spillrisk` schema in an existing always-awake DB ($0 extra, less isolated) vs a new Neon
   database `earthatlas-spillrisk` (clean isolation, the house pattern, about $1–5/month).
4. **Spending guard:** pool size (2 machines recommended), per-IP limits (proposed 5 new runs/hour, 20/day,
   cached and preset runs unlimited), and a global daily cap on new runs (proposed 300). Past the cap, show presets
   only, with a plain note.
5. **Shared-link retention:** keep every result 1 year (recommended; ~1–2 MB each) vs 30 days.
6. **Presets precomputed:** default oil and volume only (recommended, ~$14/month) vs all 4 oils (~$55/month).
7. **Defaults:** which oil and volume are the default. Volume values need cited sources before Phase 3 shows them.
   Phase 2 can run on keys, with the values set later.
8. **Band thresholds:** ≥ 2/3 of runs "likely", ≥ 1/3 "possible", any "less likely" (placeholders).

## Not in Phase 2

The impact layers and list, the public page, and the methods page (Phase 3). Hindcast, reverse lookup and live-vessel spills (Phase 4).
