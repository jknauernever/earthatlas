# GFW Data Pipeline v5 (switch on 2026-10-21): impact on EarthAtlas /ships

**2026-10-10 change:** our switch moved from 2026-10 to **2026-11** (`fetch.py` `V5_FROM_MONTH`, Josh's decision): from 2026-10-09 GFW's `public-global-presence:v5.0` returned `null` for every query (catalogue: no end date), so October could not update; v4.0 (data through 2026-10-06) covers all of October. November must start on v5.0 (v4.0 gets no updates after 2026-10-21).

GFW notice (2026-10-02): `latest` returns v5 from 2026-10-21; v4 stays available as `:v4.0` but gets no more updates; v3 deprecated.

**Pinned to `:v4.0` (2026-10-02)** everywhere we call GFW, so nothing changes under us on 10-21:
`api/gfw-tiles.js` (presence, SAR dark vessels), `scripts/ships/bake-gfw/fetch.py` (hourly track positions),
`scripts/ships/gfwClient.js` (vessel identity, port visits), `lib/ships/portCard.js` (port-visit dataset label).
All four `:v4.0` datasets answered (MEASURED 2026-10-02).

## Comparison, v4.0 vs v5.0 (MEASURED 2026-10-02, ~10 calls)
| Test | v4.0 | v5.0 |
|---|---|---|
| Hourly presence, Haro Strait (123.35–123.05 W, 48.45–48.75 N), 2026-09-20 | 2,406 rows, 257 vessels | 2,302 rows, 255 vessels |
| … same GFW vessel ids | 242 of 257 | 242 of 255 |
| … positions for the same MMSI + hour | 2,232 in both; 2,022 identical (91 %) | 174 only in v4, 70 only in v5 |
| … vessel types seen | CARGO FISHING NA OTHER PASSENGER | CARGO INACTIVE INSUFFICIENT_DATA OTHER_NON_FISHING PASSENGER |
| … name / type / flag differs for the same MMSI | 66 of 242 (all type changes in the examples, e.g. OTHER → PASSENGER) | |
| Identity search EURODAM (245206000) | id 6d8a6e1eb…, PASSENGER | **same id**, INSUFFICIENT_DATA |
| Identity search SALISH SEA GLORY (316059231) | id 1fea3c99b…, PASSENGER | **same id**, PASSENGER |
| Port visits, EURODAM, 2026-09-01…29 | 24 | 24, same ports and days |

## What it means
- **Vessel ids are stable** in these samples, so our GFW ship records (`gfw_ais_vessel`, keyed by vessel id) carry over.
- **Positions shift slightly** (~9 % of shared vessel-hours moved, some hours added/dropped): a month must not mix v4
  and v5 days. Switch at a month boundary, or re-fetch whole months.
- **Types change** (more PASSENGER instead of OTHER; new INACTIVE / INSUFFICIENT_DATA / OTHER_NON_FISHING). Our map lines
  already prefer EarthAtlas's own type lookup; GFW types are low-rank ('inferred'). INACTIVE added to bake-gfw/lines.py KIND.
- **Port visits** unchanged for this ship; GFW says >5,000 anchorages were added, so other ports may gain visits.

## Decision for Josh (not yet made)
Keep v4 for the 21 published months and use v5 from the next month boundary, or re-fetch all months under v5
(~12 h of GFW time, free). Either way, flip the `:v4.0` pins in one commit.

## Full-day comparison (MEASURED 2026-10-02): all 15 Pacific-Northwest areas, 2026-09-27, v4.0 vs v5.0
| | v4.0 | v5.0 |
|---|---|---|
| rows (vessel-hours) | 93,569 | 93,342 |
| vessels | 4,976 | 4,938 (4,889 shared ids; 87 only v4, 49 only v5) |
| fields | – | adds `speed` (knots, per vessel-hour) |
| positions, same MMSI + hour | 92,541 shared; 82.6 % identical | moved ones are ships under way (median 4.5 km): v5 picks a different point within the hour |
| identity per MMSI (4,889) | | 1,633 type changes (OTHER → PASSENGER 558, OTHER → OTHER_NON_FISHING 533, FISHING → PASSENGER 176, …); 2 names; 1 call sign |
| new type labels | | INACTIVE, INSUFFICIENT_DATA, OTHER_NON_FISHING, '' |
Verdict: no field removed, nothing breaks; not more complete, different within-hour sampling.

## Decision (Josh 2026-10-02)
Keep v4 for everything published (through 2026-09, including its late revisions); every month from 2026-10 is fetched in
v5.0 from its first day (`scripts/ships/bake-gfw/fetch.py` `dataset_for` / `V5_FROM_MONTH`), so no month mixes versions.
Follow-up: v5's `speed` could feed the hover readout for v5 months.
