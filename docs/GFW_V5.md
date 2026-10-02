# GFW Data Pipeline v5 (switch on 2026-10-21): impact on EarthAtlas /ships

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
