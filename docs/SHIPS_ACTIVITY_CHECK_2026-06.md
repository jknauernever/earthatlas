# GFW-estimated vs NOAA-counted activity — June 2026, Salish Sea

The accuracy check behind the estimated terminal visits and anchorage stays on /ships (docs/SHIPS_ACTIVITY_FUSION.md, Part 2).
Josh agreed the rule on 2026-10-06. Tools: scripts/ships/bake-gfw/activity.py (estimates), scripts/ships/activity-compare.mjs
(this comparison, read-only against production), workflow ships-gfw-activity-check (branch `ships-activity-check`, fetches one
month in GitHub Actions). Input: GFW hourly presence, Salish area, June 2026 (13 requests, 1.94M rows, 8,569 ships).

## Rule (gfw1)

- A stop = consecutive hourly positions at most 2 grid cells (0.01°) apart, i.e. about an hour at under ~1.2 kn. GFW gives one
  position per ship per hour and no speed; its `hours` field is always 1.
- Terminal: a stopped position within **0.65 km** of a berth. Candidates = the nearest berth's terminal + every terminal with a
  berth within **1 km** of it (no chaining). Credited to one terminal only when the ship's kind fits only that one; otherwise shared.
- Anchorage: a stopped position whose cell centre is inside the polygon (no edge buffer).
- **Tugs are not counted from estimates.**

## Findings

| Setting tried | Terminals: NOAA ≥2 h found | GFW confirmed | Right terminal |
|---|---|---|---|
| 1 km, chained 1.5 km groups (first run) | 90% | 51% | 74% |
| 0.65 km, chained groups | 85% | 61% | 71% |
| **0.65 km, neighbours ≤1 km, ≤2 cells/h (agreed)** | **84%** | **56%** | **90%** |

- Cargo ships and tankers: 89% of NOAA's visits found, 66% of GFW's confirmed (US 67%, BC ~58%: NOAA's receivers are US-only,
  so some unconfirmed BC stops are real). Oil docks match closely, e.g. BP Cherry Point 24/24 visits and 15/15 ships.
- Relaxing the speed (1 → 3 cells/h) changed almost nothing; counting single positions found 85% of tug visits but only 39% were real.
- Anchorage edge buffers (0.3–0.5 km) tripled stays and cut confirmation to 25–36%: no buffer.
- **31 of 112 anchorages contain no grid centre** (circles about 1 km across that fall between the 0.01° points; e.g. Anacortes
  Center, Vancouver Harbour E), so hourly positions can never land inside them. Counting a position whose grid cell overlaps them
  was tried (2026-10-07) and over-counted badly (2–17% of their stays confirmed; Vancouver Harbour D 342 vs NOAA's 1). Their cards
  say "too small to estimate from hourly positions" instead.
- Anchorages are keyed by (source_id, source_key), never row id: ids differ between the dev and production databases.
- **Tugs:** totals look close (US 806 GFW vs 756 NOAA) but only ~55% are the same visits, and per terminal they are unreliable
  (10 of 31 within ±50%; Cherry Point 78 NOAA vs 27; Tacoma NuStar/P66 0 vs 73 = the Brusco tug base next door). Tugs moor beside
  the terminals; hourly ~1 km positions can't tell berth from base. Distance/assist filters lost a third of real visits for +9 points.
  Tug counts come from per-minute AIS only (NOAA; Part 1).
- Ship kind: GFW presence rows have no tanker type (tankers come as OTHER), so the kind is EarthAtlas's own (by GFW vessel id, else
  the MMSI held at the time).
- NOAA's table keeps every rule version (tc1–tc4); comparisons read tc4 only.

## Terminals

| Terminal | Visits NOAA | Visits GFW (credited) | Shared with a neighbour | Ships NOAA / GFW | NOAA found by GFW | NOAA ≥2 h found | GFW confirmed | Right terminal |
|---|---|---|---|---|---|---|---|---|
| **All** | **1682** | **1202** | **637 stops** | | **62%** | **84%** | **56%** | **90%** |
| bc-fibreco | 140 | 185 | 8 | 16 / 42 | 93% | 96% | 67% | 74% |
| wa-ash-grove-seattle | 85 | 137 | 0 | 15 / 31 | 69% | 86% | 40% | 100% |
| bc-westridge | 210 | 0 | 235 | 68 / 0 | 70% | 90% | — | — |
| wa-covich-williams | 66 | 107 | 0 | 56 / 82 | 76% | 86% | 47% | 100% |
| wa-lafarge-seattle | 76 | 96 | 0 | 19 / 33 | 74% | 85% | 56% | 100% |
| bc-parkland-burnaby | 110 | 52 | 2 | 31 / 28 | 25% | 68% | 67% | 71% |
| wa-bp-cherry-point | 102 | 51 | 0 | 24 / 20 | 46% | 93% | 92% | 100% |
| wa-p66-ferndale | 81 | 49 | 0 | 17 / 12 | 58% | 82% | 94% | 100% |
| wa-anacortes-petcoke | 51 | 49 | 0 | 13 / 12 | 76% | 83% | 80% | 100% |
| wa-hfs-puget-sound | 92 | 0 | 85 | 24 / 0 | 48% | 82% | — | — |
| bc-lehigh-delta | 28 | 63 | 0 | 11 / 19 | 68% | 100% | 49% | 58% |
| wa-us-oil-tacoma | 35 | 51 | 0 | 16 / 16 | 71% | 86% | 49% | 100% |
| wa-seaport-sound-tacoma | 46 | 35 | 0 | 15 / 14 | 70% | 92% | 91% | 100% |
| bc-suncor-burrard | 49 | 31 | 0 | 24 / 16 | 29% | 100% | 45% | 100% |
| wa-km-harbor-island | 80 | 0 | 171 | 25 / 0 | 58% | 86% | — | — |
| bc-sechelt-aggregates | 62 | 11 | 0 | 19 / 8 | 18% | 17% | 100% | 100% |
| wa-marathon-anacortes | 57 | 0 | 85 | 21 / 0 | 54% | 95% | — | — |
| wa-maxum-pier15 | 54 | 0 | 196 | 30 / 0 | 76% | 90% | — | — |
| bc-harmac | 18 | 31 | 0 | 8 / 13 | 67% | 100% | 39% | 100% |
| bc-shellburn | 48 | 0 | 235 | 17 / 0 | 31% | 71% | — | — |
| wa-shell-seattle | 41 | 0 | 196 | 17 / 0 | 68% | 83% | — | — |
| bc-vaffc-marine | 17 | 23 | 0 | 8 / 15 | 59% | 88% | 43% | 100% |
| bc-duke-point | 7 | 28 | 0 | 6 / 10 | 43% | 100% | 11% | 100% |
| bc-lafarge-richmond | 0 | 34 | 0 | 0 / 10 | — | — | 0% | — |
| bc-port-mellon | 10 | 19 | 0 | 6 / 10 | 60% | 100% | 32% | 100% |
| bc-ioco | 0 | 27 | 0 | 0 / 8 | — | — | 0% | — |
| bc-crofton | 15 | 10 | 0 | 7 / 5 | 40% | 100% | 60% | 100% |
| wa-marathon-port-angeles | 11 | 11 | 0 | 3 / 3 | 100% | 100% | 91% | 100% |
| wa-nustar-tacoma | 1 | 20 | 81 | 1 / 3 | 100% | — | 75% | 0% |
| wa-maxum-fairhaven | 3 | 16 | 0 | 3 / 7 | 67% | 100% | 13% | 100% |
| wa-intalco-wharf | 7 | 7 | 0 | 4 / 4 | 100% | 100% | 100% | 100% |
| bc-vancouver-wharves | 5 | 8 | 8 | 4 / 6 | 100% | 100% | 38% | 100% |
| bc-westshore | 9 | 4 | 0 | 9 / 4 | 44% | 44% | 100% | 100% |
| bc-pct-port-moody | 5 | 6 | 0 | 5 / 6 | 100% | 100% | 83% | 100% |
| bc-cascadia | 5 | 5 | 0 | 4 / 4 | 100% | 100% | 100% | 100% |
| bc-fortis-tilbury-lng | 5 | 5 | 0 | 2 / 2 | 100% | 100% | 100% | 100% |
| bc-shell-bare-point | 0 | 10 | 0 | 0 / 6 | — | — | 0% | — |
| bc-neptune | 9 | 0 | 23 | 6 / 0 | 100% | 100% | — | — |
| wa-p66-tacoma | 9 | 0 | 81 | 2 / 0 | 100% | 100% | — | — |
| wa-temco-tacoma | 5 | 4 | 0 | 4 / 4 | 100% | 100% | 100% | 100% |
| wa-nbk-manchester | 2 | 6 | 0 | 1 / 3 | 100% | 100% | 33% | 100% |
| wa-t86-grain | 4 | 4 | 0 | 3 / 3 | 100% | 100% | 100% | 100% |
| wa-naswi | 3 | 4 | 0 | 1 / 1 | 100% | 100% | 75% | 100% |
| wa-seaport-seattle | 6 | 0 | 161 | 3 / 0 | 100% | 100% | — | — |
| bc-cargill | 4 | 0 | 23 | 4 / 0 | 75% | 75% | — | — |
| bc-g3 | 4 | 0 | 17 | 3 / 0 | 75% | 75% | — | — |
| bc-alliance-grain | 2 | 0 | 7 | 2 / 0 | 50% | 50% | — | — |
| wa-schnitzer-tacoma | 1 | 1 | 0 | 1 / 1 | 100% | 100% | 100% | 100% |
| bc-lantic | 1 | 0 | 7 | 1 / 0 | 100% | 100% | — | — |
| bc-viterra-pacific | 1 | 0 | 7 | 1 / 0 | 100% | 100% | — | — |
| bc-univar-nv | 0 | 1 | 0 | 0 / 1 | — | — | 0% | — |
| bc-fraser-grain | 0 | 1 | 0 | 0 / 1 | — | — | 0% | — |
| bc-richardson | 0 | 0 | 16 | 0 / 0 | — | — | — | — |
| bc-chemtrade-nv | 0 | 0 | 2 | 0 / 0 | — | — | — | — |

## Anchorages (top 40)

| Anchorage | Stays NOAA | Stays GFW | Ships NOAA / GFW | NOAA found by GFW | NOAA ≥2 h found | GFW confirmed |
|---|---|---|---|---|---|---|
| **All** | **1620** | **1750** | | **62%** | **66%** | **64%** |
| Smith Cove West | 590 | 563 | 287 / 302 | 75% | 78% | 79% |
| Elliott Bay East | 130 | 158 | 59 / 72 | 72% | 81% | 58% |
| Yukon Harbor | 92 | 71 | 75 / 56 | 55% | 57% | 72% |
| Vancouver Harbour Anchorage C | 23 | 68 | 19 / 54 | 70% | 73% | 21% |
| Smith Cove East | 47 | 33 | 21 / 22 | 62% | 68% | 85% |
| English Bay Anchorage 9 | 21 | 57 | 12 / 34 | 52% | 57% | 26% |
| Vendovi East General Anchorage | 35 | 32 | 22 / 24 | 74% | 77% | 78% |
| Vancouver Harbour Anchorage Y | 1 | 62 | 1 / 42 | 100% | 100% | 2% |
| Commencement Bay | 25 | 36 | 7 / 24 | 88% | 86% | 17% |
| Anacortes West | 33 | 24 | 17 / 18 | 52% | 50% | 79% |
| Port Angeles General Anchorage | 27 | 23 | 21 / 19 | 74% | 83% | 87% |
| Bellingham Bay | 18 | 31 | 12 / 26 | 44% | 50% | 26% |
| English Bay Anchorage 8 | 20 | 26 | 12 / 13 | 80% | 88% | 62% |
| English Bay Anchorage 5 | 14 | 31 | 11 / 15 | 79% | 83% | 39% |
| English Bay Anchorage 18 | 16 | 29 | 14 / 14 | 69% | 83% | 76% |
| English Bay Anchorage 12 | 10 | 34 | 9 / 12 | 80% | 100% | 68% |
| Indian Arm Anchorage L | 21 | 22 | 17 / 13 | 57% | 59% | 77% |
| Vancouver Harbour Anchorage B | 15 | 26 | 13 / 23 | 87% | 92% | 42% |
| Indian Arm Anchorage K | 7 | 28 | 7 / 21 | 71% | 100% | 21% |
| English Bay Anchorage 3 | 7 | 26 | 7 / 12 | 71% | 71% | 54% |
| Anacortes Center | 33 | 0 | 23 / 0 | 0% | 0% | — |
| Constance Bank 3e | 22 | 10 | 10 / 10 | 91% | 90% | 100% |
| English Bay Anchorage 14 | 14 | 18 | 14 / 10 | 50% | 60% | 83% |
| English Bay Anchorage 16 | 17 | 15 | 14 / 15 | 76% | 86% | 87% |
| Vancouver Harbour Anchorage E | 26 | 0 | 20 / 0 | 0% | 0% | — |
| Constance Bank 2 | 11 | 15 | 9 / 9 | 73% | 80% | 87% |
| Ruston General Anchorage | 10 | 15 | 6 / 6 | 70% | 88% | 87% |
| Port Gardner | 10 | 14 | 7 / 13 | 80% | 80% | 57% |
| Cowichan Bay Anchorage E | 4 | 19 | 3 / 5 | 75% | 100% | 74% |
| English Bay Anchorage 2 | 9 | 13 | 8 / 10 | 100% | 100% | 85% |
| Constance Bank 1 | 8 | 14 | 8 / 10 | 100% | 100% | 57% |
| English Bay Anchorage 17 | 10 | 12 | 10 / 10 | 70% | 70% | 75% |
| Elliott Bay West | 22 | 0 | 18 / 0 | 0% | 0% | — |
| Anacortes East | 9 | 13 | 9 / 8 | 44% | 67% | 62% |
| Hat Island Tug and Barge | 10 | 12 | 6 / 6 | 100% | 100% | 83% |
| English Bay Anchorage 1 | 9 | 11 | 7 / 4 | 67% | 67% | 100% |
| Vendovi South General Anchorage | 8 | 11 | 6 / 9 | 63% | 57% | 64% |
| Cap Sante Tug and Barge | 18 | 0 | 4 / 0 | 0% | 0% | — |
| Vancouver Harbour Anchorage X | 17 | 0 | 16 / 0 | 0% | 0% | — |
| English Bay Anchorage 11 | 6 | 11 | 6 / 10 | 100% | 100% | 55% |
