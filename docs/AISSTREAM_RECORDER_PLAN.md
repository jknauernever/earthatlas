# aisstream recorder: plan (not built)

Drafted 2026-10-18 for Josh.

## Status (2026-10-18, 07:15 UTC): built and live
- **Recording since 2026-10-18 04:48 UTC** on Fly.io: app `earthatlas-aisstream`, one `shared-cpu-1x` 256 MB
  machine in `sjc` (Fly has no Seattle region), 1 GB volume `aisdata` at `/data`, restart policy `always`.
  Secrets: `AISSTREAM_API_KEY`, `CRON_SECRET`. Code: `scripts/ships/aisstream/` (`recorder.mjs`, `compact.py`,
  `daypack.py`, `Dockerfile`, `fly.toml`). Deploy: `cd scripts/ships/aisstream && fly deploy --remote-only --ha=false`
  (a few seconds' gap; identities and latest positions are saved to the volume and survive restarts).
  Logs: `fly logs -a earthatlas-aisstream`. Files: `fly ssh console -a earthatlas-aisstream`.
- **What it publishes to Blob** (uploads through `api/cron/ships-upload-token.js`; one-file tokens, the recorder never
  holds the Blob write token):
  - `ships/live/salish-v6.json`, every 60 s: the latest position per ship (last 24 h) plus 30-minute trails for ships
    under way, about 55 KB gzipped. Read by /whalewatch's LIVE view (live boats drawn in amber).
  - `ships/tracks/aisstream-v1/index.json` + `YYYY-MM-DD/tracks-HHMM.pack` (hourly while the day is recorded) /
    `tracks.pack` (final, after 01:00 UTC the next day): /ships track packs (SHTP layout, 1024 shards, a time on every
    point, the NOAA bake's split rules, no land mask). Read by `api/ship-tracks.js` (region `ais`) for one ship's
    recorded tracks: /whalewatch trips, /ships picked-ship tracks.
  - `ships/bake-inputs/salish-v6/aisstream/points/YYYY-MM-DD.parquet` + `index.json` (after each UTC day): the NOAA
    MarineCadastre daily-points schema; `status.json` hourly.
- **/ships map** (push 3a7931e): `.github/workflows/ships-aisstream-month.yml` (daily 02:23 UTC) fetches the month's
  recorded days (`scripts/ships/bake-ais/fetch_aisstream_points.py`), bakes them with `build_tracks.py` as region
  `ais-v1` (same box and OSM land masks as salish-v6) and publishes `ships/tracks/ais-v1/YYYY-MM/` + `index.json`
  (`publish.mjs`, `SHIPS_TILESET=ais-v1`). `api/ship-tracks.js` serves it (`op=aisindex`, tiles `r=aism`,
  `r=aism&mmsi=` from the day packs). /ships draws it in the Salish box from z5 for months NOAA hasn't published.
  First run published 2026-10 from a hand-uploaded partial day (04:48–06:30 UTC); the recorder's full day replaces it.
- **Alert:** `.github/workflows/data-watchdog.yml` (hourly) opens a `data-alert` issue assigned to Josh when the live
  snapshot is 20+ minutes old and closes it when recording resumes. Failed month-bake runs are caught by its
  failed-run check.
- **Cleanup:** `api/cron/aisstream-cleanup.js` (Vercel cron, hourly) deletes superseded `tracks-HHMM.pack` copies
  (not in the index, 3 h+ old); never `tracks.pack`; nothing if the index is unreadable.
- **Changed from the plan below:** raw hourly files stay **private on the Fly volume** (30 days), and compaction and
  packing run **on the recorder** (DuckDB); only the month bake runs in GitHub Actions. MMSIs are kept when 9 digits
  long (as NOAA does).
- **Local proof:** an 84-second test produced 431 rows from 406 vessels, a schema **identical to the NOAA cache
  files**, and zero duplicate vessel-minutes.
- **Known limits:** inside the Salish box, GFW hourly lines still draw alongside the recorded tracks for the days both
  cover (GFW tiles carry no times to filter on). Terminal visits and anchorage stays for these months still come from
  GFW estimates. aisstream publishes no license or terms (Josh chose to proceed, 2026-10-18); the source is not yet in
  the `ships.sources` table. Not yet seen: the alert firing for real; a full day's disk use on the 1 GB volume.
- **Only if needed:** a static egress IP ($3.60/mo) if aisstream's 3-connections-per-IP limit starts refusing us.

**Goal:** record aisstream.io continuously and write one Parquet file per UTC day in **exactly
the shape of the NOAA MarineCadastre daily points** that /ships already bakes
(`scripts/ships/bake-ais/cache/points/salish-v6/YYYY-MM-DD.parquet`). Months after NOAA's
last published month then get NOAA-style tracks from the same bake code.

Facts this plan rests on come from [AISSTREAM.md](AISSTREAM.md):
- aisstream has no history, so **every day not recorded is lost for good**.
- Over the Salish Sea it delivers about half NOAA's positions (moving ships median 60 s,
  p90 about 210 s; NOAA median 70 s, p90 92 s). Juan de Fuca and the outer coast are much thinner.
- Limits are 3 connections per account and 3 per IP. Browser connections are not allowed.
  There's no SLA, and the August 2026 outage lasted about a week.
- No license or terms are published (see the decisions below).

## 1. What it records
- **One connection, one box:** the `salish-v6` box (W -126.2, S 47.0, E -122.05, N 49.6),
  the same as /ships' detailed region and the NOAA cache. Message types: PositionReport,
  StandardClassBPositionReport, ExtendedClassBPositionReport, ShipStaticData,
  StaticDataReport (filtering the rest saves bandwidth). Compression stays on.
- **Volume:** about 350 positions a minute were measured at a Saturday-evening peak, so very
  roughly 0.3–0.5 M rows a day and about 400 MB a day of raw JSON on the wire. A day's
  Parquet should be at or under NOAA's 7–12 MB for this box.
- **A bigger area (US-wide) is a separate decision.** Its volume is unmeasured, and aisstream
  says it is "very close to bandwidth capacity". It would need a 1–2 minute sizing sample first.

## 2. Turning messages into NOAA-shaped rows
| NOAA column | From aisstream |
|---|---|
| `mmsi` | `UserID` (rows with an invalid MMSI, e.g. `987654321` or not 9 digits, are dropped and counted) |
| `base_date_time` | MetaData `time_utc`, truncated to the second (NOAA's "practical resolution is whole second") |
| `latitude`, `longitude` | from the position message (not the rounded MetaData) |
| `sog`, `cog`, `heading` | `Sog`, `Cog`, `TrueHeading` (511 → null, as NOAA nulls n/a) |
| `status` | `NavigationalStatus` (Class A). Class B has none, so null. |
| `vessel_name`, `imo`, `call_sign`, `vessel_type`, `draft` | the **latest static message seen for that MMSI** (msg 5 for Class A, msg 24 part A/B for Class B), joined onto each row the way NOAA's rows carry them |
| `length`, `width` | Dimension A+B, C+D (0 → null) |
| `cargo` | null (aisstream has no separate cargo code) |
| `transceiver` | `A` for msg 1–3, `B` for msg 18/19 |

**Rules:**
- **At most one row per MMSI per UTC minute**, keeping the first. This matches NOAA's
  "one position per vessel per minute" and drops the two-receiver near-duplicates.
- Positions at 0,0 or out of range are dropped, the same as the bake's rule 1.
- The **identity map** (MMSI → last static message) is saved every hour, so a restart
  doesn't leave the next 6 minutes of rows without names.
- Every row is raw self-reported AIS. Unlike NOAA, there are no USCG corrections. The day's
  manifest says so, so the site's evidence label can say "AIS as broadcast, via aisstream.io".

## 3. Recording, uploading and gap accounting
1. **The recorder** is a small Node process (`ws` plus zlib, no database) holding the
   connection. It reconnects with exponential backoff and jitter, sends the full
   subscription within 3 s, and reconnects if **no message arrives for 120 s**. That last rule
   is needed because outages are silent: the socket stays open with no data.
2. **Every hour** it uploads that hour's rows as gzipped NDJSON to Blob
   (`ships/bake-inputs/salish-v6/aisstream/raw/YYYY-MM-DD/HH.ndjson.gz`). It writes through the
   existing one-file upload-token pattern (`api/cron/ships-upload-token.js` plus
   `CRON_SECRET`), so the recorder never holds the Blob write token. That needs a new
   allowlisted prefix.
3. **Coverage ledger:** each hourly file carries a 60-slot bitmap of the minutes the socket
   was connected *and* receiving, plus message counts. Then a day can say "recorded 1,412 of
   1,440 minutes", and the site can show that inline with the source.
4. **Daily compaction** runs as a GitHub Action, like the other bakes (software build work,
   within Actions' terms). After each UTC midnight it reads the day's 24 hourly files, writes
   `aisstream-points/YYYY-MM-DD.parquet` with the NOAA schema (DuckDB, as `fetch_points.py`
   does), and records coverage in an index. Raw hourly files are deleted after 30 days.
5. **Health check:** a Vercel cron every 10 minutes reads the newest hourly file and coverage.
   If nothing is newer than 75 minutes, it flags it (how to notify is still to be decided).

## 4. Feeding /ships
- **Which source a month uses:** a month NOAA has published uses NOAA (unchanged). A month
  NOAA hasn't published uses recorded aisstream days where the coverage ledger shows them,
  and GFW hourly lines for the rest. That's the same "steps aside when NOAA lands" rule GFW
  follows today.
- `build_tracks.py` runs unchanged on aisstream days. Its 30-minute track-break rule
  absorbs aisstream's 2–3 minute holes. The month's tiles are rebuilt daily while the month
  is current, then frozen, then replaced when NOAA's batch arrives (the `ships-noaa-month`
  workflow already does that swap).
- **Provenance:** tracks and cards from these days carry "AIS: aisstream.io (live feed
  recorded by EarthAtlas)" plus the day's recorded-minutes share. That's the inline-source rule.
- **Optional live layer:** the same recorder can publish a latest-positions snapshot. This is
  out of scope here because it changes the Blob write volume.

## 5. Where it runs (costs as of 2026-10-18)
| Option | Monthly cost | Pros | Cons |
|---|---|---|---|
| **Fly.io**, shared-cpu-1x 256 MB, always on | **about $1.94** ([Fly pricing](https://fly.io/docs/about/pricing/)) | Built for long-running processes. Auto-restarts. Deploys from a Dockerfile in this repo. | A new vendor account with a card. One more dashboard. |
| **Vercel cron chain**: cron every 10 min, each run holds the socket about 13 min (`maxDuration` 800 s), so runs overlap | **about $20–27** (est.): 2 GB × ~960 h × $0.0106/GB-h ≈ $20, plus Active CPU at $0.128/h, a few dollars if CPU stays ≤ 5%. Pro may cover part of this; Vercel's docs disagree on Pro's included usage. ([Fluid pricing](https://vercel.com/docs/fluid-compute/pricing), [limits](https://vercel.com/docs/functions/limitations), [cron: once per minute on Pro](https://vercel.com/docs/cron-jobs/usage-and-pricing)) | No new vendor. Same deploys, env vars and logs. | Memory is billed the whole time it waits. Overlap briefly uses 2 of the 3 connections, and the overlapping copies need deduping. A failed deploy or cron hiccup leaves a gap. **Every recorder change ships with a site build** (billed builds). |
| **Hetzner Cloud** CX23 VPS | **about €4.49** (€3.99 + €0.50 IPv4). Third-party figures; Hetzner raised prices in April 2026 and the cheap tier is sometimes not orderable. | Cheap, fixed price. Room for a bigger area later. | We'd manage the OS ourselves (updates, security, restarts). New vendor. |
| **Josh's Mac** (launchd, like `mv-weekly`) | $0 | Fine for the test phase. | Gaps whenever the laptop sleeps or travels, and those days are lost. **Test only.** |
| GitHub Actions | $0 (public repo) | — | **Not allowed:** Actions terms bar use "as part of a serverless application" and "any other activity unrelated to the production, testing, deployment, or publication of the software project" ([GitHub terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features)). Jobs are also capped at 6 h ([limits](https://docs.github.com/en/actions/reference/limits)). |

**Shared costs, any host:**
- **Blob:** about 720 hourly uploads plus 30 daily files a month at $5 per million advanced
  operations ≈ $0.004. Storage is about 3–4 GB of Parquet a year (7–12 MB a day) plus about
  0.3 GB of rolling raw files (est.), at $0.023/GB-month ≈ $0.10 a month after a year ([Blob pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing)).
- **aisstream:** free. **Actions compaction:** free (public repo).

**Recommendation: Fly.io.** It's the cheapest host built for an always-on socket, and
recorder changes don't trigger site builds. Choose the Vercel chain if no new vendor matters
more than about $20 a month.

## 6. Rollout (test small, per Josh's rule)
1. **Local proof (Josh's Mac, 1 hour, $0):** record one hour of the `salish-v6` box, compact
   it into a one-hour "day" Parquet, and diff its columns and types against a NOAA cache file.
   Run `build_tracks.py` on that hour in test mode and check the tracks look like NOAA's.
2. **Host proof (24 h on the chosen host):** check the coverage ledger, the reconnect
   behavior, the day's row count, and Parquet size against NOAA's.
3. **Go live** (with Josh's OK): keep recording and switch on daily compaction. The
   current-month bake starts using recorded days. Each push needs Josh's explicit go-ahead.
4. **Check after NOAA's next batch:** when NOAA publishes a month we also recorded, compare
   the two (vessels and positions per day, Juan de Fuca share). That gives the real, same-day
   coverage ratio.

## 7. Decisions for Josh
1. **Host:** Fly.io (recommended), the Vercel chain, or Hetzner.
2. **License risk:** aisstream publishes no terms. Recording it and publishing derived tracks
   is exactly what about 19 open issues ask permission for, and none has been answered.
   Proceed, or wait for an answer.
3. **Area:** the `salish-v6` box (recommended), or size a bigger area first.
4. **Start date:** every day before recording starts is permanently missing from aisstream.
   GFW hourly stays the only source for 2026-07 up to the start date.
5. **Raw retention:** 30 days of raw hourly files (recommended), or keep them all (about
   0.3 GB a month, est.).
