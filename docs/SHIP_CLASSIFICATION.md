# EarthAtlas ship classification (2026-09-25)

Status: groups/classes, ranking, unspecified buckets and the hazardous-cargo flag
**decided by Josh on 2026-09-25** (§5). Code: `lib/ships/taxonomy.js` (pure,
unit-tested). Nothing here is written to the database as a claim: the
classification is computed on read (`getVessel().classification`) and exported
for the track bake (`scripts/ships/export-type-lookup.mjs`, §6). The UI is not
wired to it yet.

## 1. Principles

1. **Each source's raw type stays its own claim.** AIS type code (NOAA, `ais_published`),
   GFW type (`inferred` model, or GFW's copy of the AIS type as `ais_self_reported`),
   Wikidata P31 class (`community_curated`). Never overwritten or merged into one stored value.
2. **The taxonomy is an interpretation layer**, computed on read from those claims.
   Change the crosswalk → the answer changes; the evidence doesn't.
3. **Two levels, both filterable.** `group` (passenger, cargo, tanker…) and `class`
   (cruise ship, container ship…). Every group has an explicit
   **`<group>_unspecified`** class ("Passenger, type not known") for vessels whose
   sources only give the group. A class is never guessed.
4. **Ranked sources decide; the GFW model dissents** (§4).
5. Generic Wikidata classes ("ship", "motor ship", "steamship", "catamaran",
   "shipwreck") are *true but say nothing about the job* → they abstain.

## 2. The taxonomy (groups → classes)

Stable ids + English labels; the single exported list is `TAXONOMY` in
`lib/ships/taxonomy.js` (also embedded in the type-lookup export). Ids never change
meaning; labels may. `labelOf(id)` resolves any group or class id.

| Group | Classes (id + label) |
|---|---|
| `passenger` Passenger | `cruise_ship` Cruise ship; `ferry` Ferry (passenger / ro-pax / car); `high_speed_craft` High-speed craft; `excursion` Excursion / tour boat; `other_passenger` Other passenger ship; `passenger_unspecified` Passenger, type not known |
| `cargo` Cargo | `container_ship` Container ship; `bulk_carrier` Bulk carrier; `general_cargo` General cargo / multi-purpose; `reefer` Refrigerated cargo (reefer); `roro_cargo` Ro-ro cargo; `vehicle_carrier` Vehicle carrier; `heavy_lift` Heavy-lift ship; `livestock_carrier` Livestock carrier; `cargo_unspecified` Cargo, type not known |
| `tanker` Tanker | `oil_tanker` Oil tanker; `chemical_tanker` Chemical tanker; `lng_carrier` LNG carrier; `lpg_carrier` LPG carrier; `gas_carrier` Gas carrier (unspecified); `bunker_tanker` Bunkering tanker; `other_tanker` Other tanker; `tanker_unspecified` Tanker, type not known |
| `tug_tow` Tug / tow | `tug` Tug; `towing` Towing / pushing; `tug_tow_unspecified` Tug / tow, type not known |
| `government` Government | `search_rescue` Search & rescue; `patrol` Patrol / law enforcement / coast guard; `icebreaker` Icebreaker; `buoy_tender` Buoy tender; `pollution_response` Pollution response; `training` Training ship; `government_unspecified` Government, type not known |
| `port_service` Port service | `pilot` Pilot boat; `dredger` Dredger; `salvage` Salvage; `port_tender` Port tender; `port_service_unspecified` Port service, type not known |
| `offshore` Offshore energy | `offshore_support` Offshore support (PSV / AHTS / crew transfer); `offshore_construction` Offshore construction (crane / pipelay / cable / diving); `offshore_unit` Drilling / production unit (rig, drillship, FPSO, FSRU); `offshore_unspecified` Offshore, type not known |
| `fishing` Fishing | `fishing_vessel` Fishing vessel; `trawler` Trawler; `fish_carrier` Fish carrier / live-fish carrier; `fish_factory` Fish factory ship; `fishing_unspecified` Fishing, type not known |
| `research` Research & survey | `seismic_survey` Seismic survey; `research_vessel` Research / survey vessel; `research_unspecified` Research, type not known |
| `naval` Naval | `warship` Warship; `naval_auxiliary` Naval auxiliary; `naval_unspecified` Naval, type not known |
| `recreational` Pleasure & sailing | `yacht` Yacht; `sailing_vessel` Sailing vessel; `recreational_unspecified` Pleasure craft, type not known |
| `other` Other | `museum_ship` Museum ship; `wig` Wing-in-ground craft; `other_unspecified` Other, type not known |
| `non_vessel` Not a vessel | `non_vessel_unspecified` Not a vessel |
| `unknown` Unknown | `unknown_unspecified` Type not known |

Judgement calls in the `government` / `port_service` split (decided 2026-09-25;
flag any you disagree with):
- `government`: patrol / law enforcement / coast guard, search & rescue (many
  rescue boats are charities such as RNLI / DGzRS; still grouped here),
  icebreaker, buoy tender, **pollution response** (in the US often contracted
  private responders), **training ships** (mostly state maritime academies),
  hospital ships, AIS 58 medical transport, AIS 59 noncombatant.
- `port_service`: pilot, dredger (AIS 33 = dredging *or* underwater operations),
  salvage, port tender, AIS 34 diving operations, and Wikidata's generic
  "working vessel" / "service vessel".
- Ferries stay a **class** under Passenger (no separate group).

## 3. Crosswalks

### 3a. AIS ship-and-cargo type (NOAA MarineCadastre; `docs/MARINECADASTRE_AIS.md`)

Raw claim: `vessel_type`, `value_norm = AIS_<code>`, evidence `ais_published`.
Counts = our dev-DB vessels (Salish Sea bake, 2026-09-25); a vessel that broadcast several codes counts once per code.

| AIS code | Meaning (ITU-R M.1371) | Our vessels | → group / class |
|---|---|---:|---|
| 0 | not available | — | unknown |
| 1–19, 255 | not a defined type | 10 | unknown |
| 20–29 | wing-in-ground | 1 | other / wig |
| 30 | fishing | 966 | fishing |
| 31, 32 | towing (≤ / > 200 m or 25 m wide) | 155 + 45 | tug_tow / towing |
| 33 | dredging or underwater operations | 15 | port_service / dredger (note: may be underwater ops) |
| 34 | diving operations | 19 | port_service |
| 35 | military operations | 31 | naval |
| 36 | sailing | 2,191 | recreational / sailing_vessel |
| 37 | pleasure craft | 6,860 | recreational |
| 38, 39 | reserved | 6 | unknown |
| 40–49 | high-speed craft | 24 | passenger / high_speed_craft (some carry cargo only) |
| 50 | pilot vessel | 7 | port_service / pilot |
| 51 | search and rescue | 193 | government / search_rescue |
| 52 | tug | 216 | tug_tow / tug |
| 53 | port tender | 15 | port_service / port_tender |
| 54 | anti-pollution | 50 | government / pollution_response |
| 55 | law enforcement | 38 | government / patrol |
| 56, 57 | spare, local use | 10 | unknown |
| 58 | medical transport | 2 | government |
| 59 | noncombatant ship (RR Res. 18) | 6 | government |
| 60–69 | passenger (+ hazard category) | 357 | passenger |
| 70–79 | cargo (+ hazard category) | 2,051 | cargo |
| 80–89 | tanker (+ hazard category) | 418 | tanker |
| 90–99 | other | 169 | other (abstains in §4) |
| 1001, 1002 | USCG ext.: fishing | — | fishing |
| 1003, 1004, 1016 | USCG ext.: cargo | — | cargo |
| 1012–1015 | USCG ext.: passenger | — | passenger |
| 1017, 1024 | USCG ext.: tanker | — | tanker |
| 1019 | USCG ext.: recreational | — | recreational |
| 1023, 1025 | USCG ext.: tug tow | — | tug_tow |
| 1021 | USCG ext.: SAR aircraft | — | non_vessel |
| other 1001–1025 | USCG ext.: other | — | other |

USCG extended-code *groups* follow NOAA's table; the individual 1001–1025 names
are not all legible/verified (UNVERIFIED, see `docs/MARINECADASTRE_AIS.md`).
AIS type codes are self-declared by whoever configured the transponder (NOAA/USCG
may have corrected them); they are coarse by design. A group-only row maps to
`<group>_unspecified`. The second digit 1–4 in the 2x, 4x, 6x, 7x, 8x, 9x ranges is
the **hazardous-cargo category A–D**, a separate flag (§6).

### 3b. GFW vessel types (`docs/GFW_VESSELS_API.md`)

Raw claim: `vessel_type` from `selfReportedInfo.shiptype` (`ais_self_reported`) and
`combinedSourcesInfo.shiptypes` (`inferred`, per year).

| GFW type | Our vessels (inferred) | → group / class |
|---|---:|---|
| PASSENGER | 4,784 | passenger / passenger_unspecified |
| CARGO | 379 | cargo / cargo_unspecified |
| CARRIER | 10 | cargo / reefer (GFW: refrigerated carriers that tranship catch) |
| BUNKER | — | tanker / bunker_tanker |
| FISHING | 430 | fishing / fishing_unspecified |
| SEISMIC_VESSEL | 14 | research / seismic_survey |
| SUPPORT | — | other (meaning beyond the name UNVERIFIED) |
| GEAR | 114 | non_vessel (AIS-equipped fishing gear) |
| OTHER | 1,176 | other / other_unspecified (abstains) |
| DISCREPANCY | — | unknown |
| NA | 549 | unknown |

Note: GFW's PASSENGER count (4,784) is far above NOAA's passenger codes (357) in the
same area: GFW's model labels many Salish pleasure craft "passenger" (e.g. LINNEA ROSE
is AIS 37 pleasure craft). This is why the GFW model now ranks below AIS (§4, decided 2026-09-25).

### 3c. Wikidata P31 classes (`docs/WIKIDATA_SHIPS.md`)

Raw claim: `vessel_type`, `value_norm = WD_<Q-id>`, evidence `community_curated`.
"Items" = IMO-bearing Wikidata items with that P31 (2026-09-25; an item can have
several). The table covers 116 classes = **97,288 of 98,391** P31 statements on
IMO items; the remaining 317 rare classes (1,103 statements, e.g. cutter, whaler,
barge, pusher, merchant vessel, naval vessel, fish feed carrier) are unmapped →
the taxonomy returns "not in crosswalk" and the raw claim still shows.

| Q-id | Wikidata label | Items | → group / class | Note |
|---|---|---:|---|---|
| Q11446 | ship | 57,332 | — (not a type; abstains) |  |
| Q15276 | bulk carrier | 6,669 | cargo / bulk_carrier |  |
| Q105999 | cargo ship | 4,948 | cargo / cargo_unspecified |  |
| Q17210 | container ship | 3,615 | cargo / container_ship |  |
| Q14928 | oil tanker | 3,067 | tanker / oil_tanker |  |
| Q1420024 | fishing vessel | 2,210 | fishing / fishing_vessel |  |
| Q14970 | tanker | 2,183 | tanker / tanker_unspecified |  |
| Q191826 | tug | 1,293 | tug_tow / tug |  |
| Q1201871 | platform supply vessel | 1,283 | offshore / offshore_support |  |
| Q1752434 | general cargo ship | 1,210 | cargo / general_cargo |  |
| Q25653 | ferry | 954 | passenger / ferry |  |
| Q1917626 | multi-purpose vessel | 947 | cargo / general_cargo |  |
| Q473932 | roll-on/roll-off ship | 776 | cargo / roro_cargo | Wikidata ro-ro also covers some ro-pax |
| Q15254 | chemical tanker | 617 | tanker / chemical_tanker |  |
| Q39804 | cruise ship | 611 | passenger / cruise_ship |  |
| Q2055880 | passenger vessel | 600 | passenger / passenger_unspecified |  |
| Q2928814 | LPG carrier | 558 | tanker / lpg_carrier |  |
| Q1504307 | reefer ship | 500 | cargo / reefer |  |
| Q356847 | car carrier | 489 | cargo / vehicle_carrier |  |
| Q1571437 | jackup rig | 420 | offshore / offshore_unit |  |
| Q391022 | research vessel | 385 | research / research_vessel |  |
| Q5810820 | dredger | 291 | port_service / dredger |  |
| Q402092 | motor ship | 284 | — (not a type; abstains) |  |
| Q15247 | LNG carrier | 270 | tanker / lng_carrier |  |
| Q689880 | oil platform | 243 | offshore / offshore_unit | oil platform |
| Q353699 | container feeder ship | 224 | cargo / container_ship |  |
| Q331795 | patrol vessel | 212 | government / patrol |  |
| Q189323 | cement carrier | 199 | cargo / bulk_carrier | cement carrier |
| Q1009600 | bunker vessel | 184 | tanker / bunker_tanker |  |
| Q970092 | crane vessel | 181 | offshore / offshore_construction |  |
| Q14978 | icebreaker | 170 | government / icebreaker |  |
| Q1760328 | roll-on/roll-off passenger ship | 160 | passenger / ferry |  |
| Q1797381 | coastal trading ship | 156 | cargo / general_cargo |  |
| Q21505397 | motor yacht | 146 | recreational / yacht |  |
| Q117112843 | multi-purpose offshore vessel | 142 | offshore / offshore_support |  |
| Q326561 | fishing trawler | 128 | fishing / trawler |  |
| Q557281 | anchor handling tug supply vessel | 120 | offshore / offshore_support |  |
| Q509222 | drillship | 119 | offshore / offshore_unit |  |
| Q3784092 | car ferry | 109 | passenger / ferry |  |
| Q443802 | luxury yacht | 107 | recreational / yacht |  |
| Q130326199 | preserved watercraft | 107 | — (not a type; abstains) |  |
| Q12859788 | steamship | 104 | — (not a type; abstains) |  |
| Q170173 | yacht | 103 | recreational / yacht |  |
| Q15262 | train ferry | 102 | passenger / ferry | train ferry; some carry freight only |
| Q852190 | shipwreck | 99 | — (not a type; abstains) |  |
| Q1617851 | high-speed craft | 99 | passenger / high_speed_craft |  |
| Q2072352 | passenger ferry | 98 | passenger / ferry |  |
| Q162986 | replenishment oiler | 97 | naval / naval_auxiliary |  |
| Q697196 | ocean liner | 96 | passenger / other_passenger | ocean liner |
| Q1151009 | heavy lift ship | 96 | cargo / heavy_lift |  |
| Q190403 | catamaran | 91 | — (not a type; abstains) |  |
| Q1303735 | survey vessel | 84 | research / research_vessel |  |
| Q1131532 | pipe-laying ship | 83 | offshore / offshore_construction |  |
| Q1430652 | semi-submersible platform | 73 | offshore / offshore_unit |  |
| Q11479409 | offshore patrol vessel | 70 | government / patrol | offshore patrol vessel; navies operate many |
| Q1165999 | lake freighter | 64 | cargo / bulk_carrier | lake freighter |
| Q1229765 | watercraft | 62 | — (not a type; abstains) |  |
| Q2550720 | trailing suction hopper dredger | 57 | port_service / dredger |  |
| Q660668 | training vessel | 56 | government / training |  |
| Q1623035 | buoy tender | 51 | government / buoy_tender |  |
| Q348741 | cable layer | 49 | offshore / offshore_construction |  |
| Q1922243 | passenger-cargo ship | 48 | passenger / other_passenger | passenger-cargo ship |
| Q1123401 | roll-on/roll-off container | 47 | cargo / roro_cargo |  |
| Q170483 | sailing ship | 47 | recreational / sailing_vessel |  |
| Q15266 | livestock carrier | 46 | cargo / livestock_carrier |  |
| Q939770 | pilot boat | 43 | port_service / pilot |  |
| Q1678525 | live fish carrier | 43 | fishing / fish_carrier |  |
| Q178193 | steamboat | 41 | — (not a type; abstains) |  |
| Q2447856 | traditional ship | 40 | — (not a type; abstains) |  |
| Q117674967 | offshore support vessel | 40 | offshore / offshore_support |  |
| Q11229656 | tank landing ship | 40 | naval / warship |  |
| Q204577 | schooner | 39 | recreational / sailing_vessel |  |
| Q18916020 | river cruise ship | 37 | passenger / cruise_ship | river cruise ship |
| Q15252 | floating production storage and offloading | 37 | offshore / offshore_unit |  |
| Q11997320 | sea rescue vessel | 35 | government / search_rescue | many rescue boats are run by charities (RNLI, DGzRS); still grouped as government |
| Q17416980 | tour boat | 34 | passenger / excursion |  |
| Q10387679 | floating storage regasification unit | 34 | offshore / offshore_unit | FSRU |
| Q15272 | ore-bulk-oil carrier | 34 | cargo / bulk_carrier | ore-bulk-oil carrier |
| Q115497568 | pollution control vessel | 33 | government / pollution_response |  |
| Q19292005 | harbor tugboat | 33 | tug_tow / tug |  |
| Q114409407 | crew transfer vessel | 31 | offshore / offshore_support |  |
| Q3276983 | cruiseferry | 30 | passenger / ferry |  |
| Q15888 | hospital ship | 29 | government / government_unspecified | hospital ship |
| Q109936535 | double-ended ferry | 29 | passenger / ferry |  |
| Q161705 | frigate | 27 | naval / warship |  |
| Q3112873 | three-masted schooner | 26 | recreational / sailing_vessel |  |
| Q776704 | diving support vessel | 26 | offshore / offshore_construction |  |
| Q575727 | museum ship | 25 | other / museum_ship |  |
| Q1361559 | jack-up crane ship | 24 | offshore / offshore_construction |  |
| Q1272711 | seebäderschiff | 23 | passenger / excursion |  |
| Q1797385 | coastguard ship | 22 | government / patrol |  |
| Q671079 | troopship | 22 | naval / naval_auxiliary |  |
| Q628983 | working vessel | 21 | port_service / port_service_unspecified | working vessel (judgement) |
| Q11903334 | oil recovery ship | 21 | government / pollution_response |  |
| Q3758612 | gas carrier | 20 | tanker / gas_carrier |  |
| Q2477625 | ultra large container ship | 20 | cargo / container_ship |  |
| Q2135586 | shuttle tanker | 19 | tanker / oil_tanker |  |
| Q7918428 | vehicle cargo ship | 18 | cargo / vehicle_carrier |  |
| Q820378 | salvage ship | 18 | port_service / salvage |  |
| Q431858 | factory ship | 17 | fishing / fish_factory |  |
| Q5461999 | flotel | 17 | offshore / offshore_support | flotel |
| Q2607934 | guided missile destroyer | 16 | naval / warship |  |
| Q108815497 | stun and bleed vessel | 16 | fishing / fish_carrier | stun-and-bleed vessel |
| Q2518299 | replenishment ship | 16 | naval / naval_auxiliary |  |
| Q1286790 | auxiliary vessel | 16 | naval / naval_auxiliary |  |
| Q7448069 | self-discharger | 15 | cargo / bulk_carrier | self-discharger |
| Q1581130 | full-rigged ship | 14 | recreational / sailing_vessel |  |
| Q820385 | salvage tug | 14 | tug_tow / tug |  |
| Q1121471 | paddle steamer | 13 | passenger / excursion |  |
| Q4847899 | barquentine | 13 | recreational / sailing_vessel |  |
| Q1470795 | fruit juice tanker | 13 | tanker / other_tanker |  |
| Q3337312 | service vessel | 12 | port_service / port_service_unspecified | service vessel (judgement) |
| Q544823 | nuclear-powered icebreaker | 12 | government / icebreaker |  |
| Q19267382 | oceanographic research vessel | 12 | research / research_vessel |  |
| Q216057 | barque | 12 | recreational / sailing_vessel |  |
| Q12688575 | drilling rig | 5 | offshore / offshore_unit |  |

## 4. Combining sources (decided 2026-09-25 — `combine()` / `classifyClaims()`)

For a vessel, from its active `vessel_type` claims (for a time window; "now" keeps
AIS observations however old, but drops Wikidata types whose validity ended):
1. Map each claim through its source's crosswalk. `unknown` and generic Wikidata
   classes abstain; a bare `other` (AIS 90, GFW OTHER) counts only if nothing more
   specific votes.
2. **Ranking (Josh, 2026-09-25):** GFW's *model-inferred* type (`inferred`) ranks
   **below** AIS (`ais_published` / `ais_self_reported`), registry and Wikidata
   (`community_curated`). The ranked sources decide; the model decides only when
   no ranked source votes (`basis: 'model_only'`).
3. **Group**: the one group the deciding votes agree on. Disagreement among ranked
   sources stays a **conflict** (`group: null`, nothing picked; the export writes
   `unknown` + `x: 1`).
4. **Class**: the one specific class inside that group; none →
   `<group>_unspecified`; two different specific classes → `<group>_unspecified`
   + `conflict: true` (never guessed).
5. Model votes that disagree come back as **`dissent`** (group/class/source + labels),
   shown as a lower-ranked view, never blocking.
6. No votes at all → `unknown` / `unknown_unspecified`.

EURODAM: AIS 60 → passenger; GFW PASSENGER (model) agrees; Wikidata cruise ship
(Q39804) → **Passenger · Cruise ship**. LINNEA ROSE: AIS 37 → **Pleasure & sailing ·
type not known**, with GFW's model "passenger" as dissent (before the decision this
was a blocking conflict).

### Salish dev DB, as of now (2026-09-25, 16,990 active vessels)

| | Vessels |
|---|---:|
| Specific class | **3,383** |
| Group only (`<group>_unspecified`) | **12,117** |
| Conflict between ranked sources (no group) | **162** |
| …with a group but two different specific classes (inside the group-only row) | 48 |
| `unknown` (no usable vote) | 18 |
| No type claim at all | 1,310 |
| Decided by the GFW model alone | 2,253 |
| With a lower-ranked GFW-model dissent | 3,373 |
| AIS self-declared hazardous cargo | 215 |

Largest specific classes: sailing vessel 2,165 (AIS 36), bulk carrier 228, tug
184, search & rescue 183, towing 155, container ship 91, vehicle carrier 65,
pollution response 50, cruise ship 46. By group: pleasure & sailing 8,750, cargo
2,106, passenger 1,811, fishing 993, other 553, tanker 411, tug/tow 375,
government 285, not-a-vessel 111, port service 56, naval 30, research 12, offshore 7.

(Before the ranking decision, over only the 1,776 vessels with a Wikidata type:
595 specific / 1,047 group only / 117 conflicts.)

## 5. Decisions (Josh, 2026-09-25)

| # | Question | Decision |
|---|---|---|
| 1 | Group list | Ferries stay a class under Passenger. **`service` split** into `government` and `port_service` (judgement calls listed in §2). Other groups unchanged. |
| 2 | GFW model vs AIS | GFW model-inferred type ranks **below** AIS, registry and Wikidata; shown as dissent, not conflict. Conflicts among ranked sources stay conflicts. |
| 3 | Filtering | Users filter by group AND class; every group has an explicit `<group>_unspecified` class; `combine()` never guesses a class. One exported list (`TAXONOMY`) with stable ids + English labels. |
| 4 | Hazard categories | AIS second digit 1–4 → separate self-declared `hazardous_cargo` flag, category A–D (§6). |
| 5 | Evidence class for Wikidata | Keep `community_curated`. |

Still open:
- **Time**: the export classifies each MMSI window from the claims overlapping it,
  but does not split a window if the type changes inside it.
- **Long-tail Wikidata classes** (317 rare classes, 1.1 % of statements): by hand
  as they appear, or automatically via Wikidata's P279 tree?
- **2,751 ambiguous export entries** (§6): MMSIs held by two of our vessels in
  overlapping windows (e.g. EURODAM's tenders inside GFW's grouping). The bake
  must not pick one; worth a review pass.

## 6. Hazardous cargo and the track-bake export

**Hazardous cargo (self-declared).** `aisHazard(code)`: in the WIG (2x), HSC (4x),
passenger (6x), cargo (7x), tanker (8x) and other (9x) ranges, second digit 1–4 =
carrying dangerous goods / harmful substances / marine pollutants, **category A–D**
(ITU-R M.1371 / NOAA tables; newer ITU text: IMO categories X, Y, Z, OS). It is what
the ship's AIS says (evidence class unchanged). `getVessel().classification.hazardous_cargo`
lists each such claim (category, code, evidence, source, from/to), so the card can
say "carries hazardous cargo (self-declared, category C)".

**Type lookup for the track bake.** `npm run ships:export-type-lookup` →
`scripts/ships/bake-ais/build/type-lookup.json` (gitignored):
`{ meta, taxonomy, mmsi: { "<mmsi>": [{ f, t, g, c, h?, x?, a? }] } }`.
- Built only from MMSI claims attached to a vessel through an **accepted** entity link,
  inside each claim's own window (transmitted/registry MMSIs only; Wikidata MMSIs never).
  Windows of the same MMSI + vessel are merged.
- `g`/`c` = the vessel's classification from the type claims overlapping that window (§4).
- `h` = hazard categories, `x: 1` = ranked sources conflict (written as unknown),
  `a: 1` = another vessel holds the same MMSI in an overlapping window: **don't pick**.
- Dev run 2026-09-25: **1.9 MB**, 15,082 MMSIs, 17,268 windows: specific class 3,461,
  group only 12,310, unknown 1,497, conflict 217, ambiguous 2,751, hazardous 215.
