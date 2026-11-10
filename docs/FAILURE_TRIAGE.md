# Failure triage: known patterns

`.github/workflows/failure-triage.yml` reads this file before judging a failed data workflow. Add a line whenever a new
kind of failure turns up, with how it was settled. Verdicts:

- **transient**: the next attempt will very likely pass with no change (network blip, read lag, one-off 5xx). Triage
  re-runs the failed jobs once. If the re-run fails too, Josh is told.
- **upstream_outage**: a service we fetch from says it is down or in maintenance. Bakes retry on their own schedule;
  Josh is told only if the alert is still open after 48 hours.
- **needs_josh**: anything that will fail again until a person acts: a code bug, a missing/expired/revoked secret,
  a quota or billing limit, a source that changed format or moved, a permissions error, a job that keeps timing out.
  When unsure, choose this.

## Seen before

| Pattern in the log | Verdict | Notes |
|---|---|---|
| `URLError` / `getaddrinfo` / `Temporary failure in name resolution` / `ECONNRESET` / `fetch failed` on one call | transient | Runner network blips (2026-11-01 rain bakes). Retries exist in `_rain_common.py`, permits, overlap bakes. |
| `TimeoutError: The read operation timed out` posting to `clouds-ingest` (mrms / gsmap / gmgsi) | transient | Several runs in a row 2026-11-10 18:50–19:20, then recovered with no change. `publish()` in `_rain_common.py` now retries it; a failure after those retries that clears within the hour is still transient. |
| Blob `verify … total X vs Y`, or a pointer/index read back at the old version right after an upload | transient | Vercel Blob read-after-write lag on overwritten files (ct-voyages 2026-10-29, aisstream-month 2026-11-04). Fixed with re-read loops; a recurrence after those fixes is still transient. |
| HTTP 520–524 / 502 / 503 from Cloudflare in front of GFW, SkyTruth, NOAA etc. once | transient | |
| GFW `404` with "temporarily unavailable because of infrastructure constraints" | upstream_outage | NOT an outage that clears by retrying: GFW switched off `group-by=VESSEL_ID`/`MMSI` with `spatial-aggregation=false` on purpose on 2026-11-03 (their notice and API release notes; no restore date). Since 2026-11-09 the tracks bake asks GFW first (`probe.py --gate` in the plan job) and skips its fetch while paused, so this failure should only appear if the pause starts or returns mid-run. Say in `summary` that GFW has the feature switched off and that the bake resumes by itself when GFW restores it; tracked in the open issue "Data source paused: GFW per-vessel positions". The job's `PROBE` lines (scripts/ships/bake-gfw/probe.py) show what GFW serves at that moment: trust their verdict line. |
| SkyTruth Cerulean maintenance / HTML page instead of JSON | upstream_outage | Announced windows by email (e.g. 2026-11-06 20:00 UTC). |
| Copernicus / CMEMS / LiveOcean / GSMaP FTP "service unavailable", empty listing for the newest file | upstream_outage | LiveOcean failed several runs 2026-10-14/15 then recovered on its own. |
| `BlobError` about client `put` options (`addRandomSuffix`, `allowOverwrite`, `cacheControlMaxAge`) | needs_josh | Code bug (soc-critical-habitat 2026-11-03, fixed d845dd5). |
| `401` / `403` / `invalid token` / `CRON_SECRET missing` / expired credentials | needs_josh | A secret needs rotating or setting. |
| Python `ImportError`, JS `SyntaxError`/`TypeError`/`ReferenceError`, a `KeyError` on source data | needs_josh | Code or source-format change. |
| Same workflow failing the same way 3+ runs in a row | needs_josh | Even if each one looks transient. Exception: every one of them is the same upstream outage message (or PROBE says so) → still upstream_outage; the 48 h rule escalates it once. |

## Ignore

- `Node.js 20 is deprecated` warnings: not the cause of any failure.
