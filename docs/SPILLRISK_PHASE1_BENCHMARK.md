# Oil spill scenarios: Phase 1 benchmark report (2026-11-05)

Benchmark only. Nothing is in the site, no database or Blob writes. Scripts are in `scripts/spillrisk/`. Environment,
forcing and outputs are in `data/spillrisk/` (gitignored). Sanity map: `docs/spillrisk-phase1-sanity.png`.

## What was run

- **Engine:** PyGNOME 1.1.23 (conda-forge) on Python 3.12, installed in an isolated micromamba environment.
- **Forcing:** one NOAA SSCOFS cycle (2026-11-05 03z, f000–f072). It was pulled through OPeNDAP as the surface sigma layer
  u/v plus the model's own 10 m wind, which is 73 requests, 100 s on the laptop and 134 s on Fly. Result: one 383 MB NetCDF
  (`fetch_sscofs.py`). PyGNOME read the FVCOM mesh and fields with no conversion beyond renaming.
- **Shoreline:** GSHHG land from the old /shiptraffic bake (box 47.0–49.0°N). PyGNOME's FVCOM land-map reader
  (`MapFromUGrid`) is marked unfinished and fails, so land comes from polygons (BNA).
  **Benchmark limitation:** see "Shoreline" below.
- **Oil:** ADIOS AD00020 Alaska North Slope. The amount is a **1,000 bbl test value** (not a preset). Weathering covers
  evaporation, natural dispersion and emulsification, with water at 10 °C and salinity 30 (benchmark constants).
- **Particles:** 1,000 per run, a 15-minute time step, a one-hour release, and random-walk diffusion of 10,000 cm²/s.
- **Points:** Haro Strait (−123.20, 48.55); Rosario Strait (−122.75, 48.55); off the BP Cherry Point refinery dock
  (−122.765, 48.862, from `/api/ships?op=terminalsLayer`); central Puget Sound (−122.43, 47.65); and Strait of Juan de Fuca (−123.70, 48.25).

## Runtime, memory, output

| Run | Where | Wall time | Peak memory | Output |
|---|---|---|---|---|
| 72 h, best estimate + built-in uncertainty, ×5 points | laptop (Apple silicon, 1 core each) | **12.5–16.9 s** (median 15.2) | 577–762 MB | 0.6–1.0 MB |
| Same (Haro) | **Fly performance-2x**, sjc | **22.2 s** (run 18.7 s) | 589 MB | 1.0 MB |
| Fly machine cold start | Fly | 26 s (18 s of it is the image pull, 350 MB image) | — | — |
| SSCOFS cycle fetch | Fly | 134 s | — | 383 MB |
| 10-member ensemble, all 10 at once | laptop, 8 cores | **45–46 s** for the whole ensemble (each member 41–43 s under contention) | ≤1.3 GB per member | ~1 MB per member |

Notes:
- The run itself is cheap. Most of a per-member ensemble run was spent copying the 383 MB forcing file to perturb the
  wind. Production should perturb the wind in memory, which should bring a member close to the 15 s single-run time
  (not measured).
- The ensemble job pool did not cap workers as intended (all 10 members started together). The 45 s figure is
  therefore "10 members on 8 cores".

## Probability method: built-in uncertainty vs. a small ensemble

The ensemble used 10 members. Member 0 is unperturbed. The others vary wind speed ×N(1, 0.2), wind direction +N(0°, 15°) and
current speed ×U(0.85, 1.15), each with its own random-walk seed. These perturbation sizes are a **benchmark choice, not a
published scheme**.

| | Haro Strait | Juan de Fuca |
|---|---|---|
| Built-in envelope, all hours (cells ≈ 0.3 km²) | 4,667 | 4,659 |
| Ensemble: any member reached the cell | 4,197 | 3,236 |
| Ensemble cells outside the built-in envelope | 552 (13%) | 141 (4%) |
| Ensemble "likely" cells (≥ 2/3 of runs) inside the envelope | 1,759 / 1,760 | 1,397 / 1,397 |
| First shore contact | best estimate h26 / uncertainty h8; ensemble **h16–h41**, 10/10 members reach shore | best h25 / unc h7; ensemble h24–h72, 9/10 reach shore |

What this shows:
- **Built-in uncertainty** gives a best-estimate path plus a "minimum regret" envelope. It is a yes/no outline with no
  probability, and NOAA designs it to be wide. It cannot produce "likely / possible / less likely" bands. It does
  produce a cautious "earliest possible shore contact" (h7–h8 here).
- **The ensemble** gives a real share of runs for each cell and hour, so the brief's bands come directly from it. Its
  "likely" area sits almost entirely inside the built-in envelope, which means the two methods agree on the core. It also gives a
  first-contact range ("between hour 16 and 41") that is easy to state in plain words.
- **Recommendation: about 10-member ensemble for the bands.** Member 0 (the unperturbed run) serves as the "most likely
  path". Built-in uncertainty is not needed on top. The band thresholds used here (≥2/3, ≥1/3, >0 of runs)
  are placeholders for you to decide.

## Cost per click (Fly published monthly prices; per-second billing)

Fly lists performance-1x (2 GB) at $33/month and performance-2x (4 GB) at $66/month. That works out to about
$0.0000127 per CPU-second and is billed only while a machine runs. Stopped machines cost $0.15/GB/month of disk.
These numbers come from docs.fly.io/about/pricing (2026-11-05). The sjc price could differ from the cheapest region and was not checked.

| Option | Wall time a visitor waits (excl. queue) | Compute cost per new click |
|---|---|---|
| A. Single run + built-in envelope (perf-2x) | ~25 s | ~$0.0006 |
| B. 10-member ensemble on one 8-core machine | ~30–45 s (laptop measured 45 s; in-memory wind is expected to be faster) | ~$0.002–0.003 |
| C. B, but member 0 is shown first and bands fill in as members finish | first result ~15–20 s, full bands ~30–45 s | same as B |
| Forcing fetch, 4 cycles/day | — | ~9 min of machine time a day (cents/day) + ~1.5 GB kept |

Cached repeats (same snapped cell, oil, volume and cycle) cost nothing. A cold machine start adds ~26 s. A machine kept warm
removes that wait but costs ~$66/month (perf-2x) or more for 8 cores. Starting per job is far cheaper at low traffic.

**Fallbacks if this is too slow:**
- Fewer particles per member (300–500; untested).
- 36–48 h default runs (run time scales roughly linearly with hours).
- Fewer members (6).
- Precompute a grid of release points each forecast cycle, so every click is a cache hit. That is a fixed cost per cycle,
  priced in Phase 2 only if needed.

## Shoreline (must fix before Phase 2)

The benchmark's GSHHG land stops at 49.0°N and closes off Burrard Inlet, the Fraser River, the Duwamish and the Tacoma
waterways (the reason /ships moved to OSM). In the sanity map, Cherry Point oil drifting north crossed 49.0°N and
counted as "off map". Fix: reuse /ships' OSM recipe (`scripts/ships/bake-ais/make_land.py`, osm, ODbL) for a box covering the
whole SSCOFS domain (to ~51.75°N), built once as a shared regional dataset. The existing
`salish-v6-land-osm.geojson` (to 49.6°N) is on the WD 4TB drive. Re-running the five points on it is pending until the
drive is plugged in.

## Forcing problems seen

- One OPeNDAP request returned "DAP server error". It succeeded on retry, and the fetcher now retries.
- SSCOFS longitudes are 0–360, so the fetcher converts them to −180…180.
- No other problems. f072 was available for the cycle used.

## Decisions for Josh (from this report)

1. Probability method: ensemble of ~10 (recommended) vs. built-in envelope.
2. Wait-time target and option A / B / C (C recommended).
3. Machine per job (recommended, cents per click) vs. a warm machine (~$66+/month).
4. Run length: 72 h is feasible (SSCOFS horizon; runtime fine).
5. Band thresholds and wording.

## Addendum (2026-11-05, later): speed options measured

Josh's preferred direction: (1) in-memory ensemble wind, (2) stream hours as they compute, (5) one 16-core machine per
job running every member at once, (6) pre-created stopped machines, (8) precompute the preset points each forecast cycle.
Options (1), (3) and (4) were measured at Haro Strait with 10-member ensembles on the laptop (8 workers on 8 cores):

| Variant | Ensemble wall time (10 members, 8 cores) | Member run (median) | Member total incl. load |
|---|---|---|---|
| Before (wind perturbed via a 383 MB file copy, all 10 at once) | 45 s | — | 41.5 s |
| **A. In-memory wind (option 1), 1,000 particles, 15-min step** | **26 s** | 8.6 s | 18.0 s |
| B. A + 400 particles (option 3) | 23 s | 6.6 s | 14.4 s |
| C. A + 30-minute step (option 4) | 20 s | 5.2 s | 13.3 s |

- **Option 1 is a pure gain.** It gives the identical result (every cell and band matched the file-copy ensemble) at about 1.7× the
  speed. Holding the wind in memory raises a member's peak to ~1.6 GB, so a 10-member job needs ~16 GB, which fits a
  16-core performance machine (32 GB). About 6 s of each member is now loading the wind into memory, which could drop further if
  members share one loaded copy (not built).
- **PyGNOME runs are repeatable.** The random-walk diffusion ignored the Python seed, and a re-run with another seed was
  identical cell for cell. So the B/C differences below come from the setting, not chance, and caching is exact.
- **B (400 particles) undercounts the spread.** Reach by 72 h stays close (Jaccard 0.80–0.89 against A), but the hourly
  "possible or likely" area halves (h72: 289 → 128 cells) because fewer particles touch fewer cells. It saves ~3 s. **Not
  recommended.**
- **C (30-minute step) shifts timing.** The first-shore-contact range narrows from h16–41 to h16–31, and hourly bands overlap only
  ~45–48% with A. That's expected in fast-turning tidal channels. It saves ~5 s. **Not recommended.**
- **Expected on the recommended setup (A on one 16-core machine, all 10 at once):** about one member's time, roughly 15–20 s
  for the full ensemble plus machine start. With hour-by-hour streaming (option 2), the first hours appear within a few
  seconds. The start time of a pre-created stopped machine and the 16-core run were not measured, and both need checking in Phase 2.

## Addendum: re-run on the /ships OSM shoreline (2026-11-05)

The five points were re-run on `salish-v6-land-osm.geojson` (OSM coastline minus inland water, ODbL; box to 49.6°N),
converted to BNA with 6,541 land polygons and 22,865 inland-water holes written as lakes. Map build time rose from 0.4 s to 3 s.
Run times were 20–21 s with all five running at once on 8 cores. Cherry Point oil now moves north into Semiahmoo/Boundary Bay
(72 h best-estimate footprint 61 km² vs 24 km² when GSHHG cut it off at 49.0°N). The other points changed little (Haro
first shore contact h21 vs h26). Map: `docs/spillrisk-phase1-sanity-osm.png` (left panel; the right panel is still
the GSHHG ensemble).
