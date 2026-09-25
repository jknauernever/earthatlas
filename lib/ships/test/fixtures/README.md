# /ships test fixtures

| File | What it is |
|---|---|
| `gfw-doc-miss-freya.json` | **Real** GFW response entry, copied verbatim from GFW's documentation ("Basic search" example, `/docs/examples/vessels/vessels-example1`). |
| `gfw-doc-claudina.json` | **Real** GFW entry, verbatim from `/docs/quick-start` (has a registry owner and combinedSourcesInfo). |
| `gfw-live-gabu-reefer-2026-09-24.json` | **Real, recorded live** 2026-09-24: `GET /v3/vessels?ids[0]=0b7047cb5-…&registries-info-data=ALL` (dataset v4.0). |
| `gfw-live-cresty-2026-09-24.json`, `gfw-live-goldeneye-2026-09-24.json` | **Real, recorded live** 2026-09-24 (one detail call returned both). Sister ships that share an AIS identity inside GFW's data: the regression case for never matching GFW entries by AIS id. |
| `gfw-live-linnea-rose-2026-09-24.json` | **Real, recorded live** GFW detail entry for LINNEA ROSE (MMSI 368330140), Josh's QA boat. |
| `mc-live-linnea-rose-2026-06-21.ndjson` | **Real** MarineCadastre identity rows for LINNEA ROSE, derived from the 146 positions in `ais-2026-06-21.csv.zst` (the shape build_tracks.py writes). |
| `gfw-doc-don-tito.json` | **Real** GFW entry, verbatim from `/docs/v3/vessels/get-one-vessel` (AIS only, no registry). |

`scenarios.js` builds two kinds of entries:
- `gabuReefer()`: the documented GABU REEFER case (`/docs/v3/general-api-doc/data-caveats`, "Why am I seeing multiple ids"). The ids, MMSIs, callsigns and dates come from that table; we assembled them into GFW's JSON shape. The docs give dates only, so times are set to 00:00Z (the ongoing identity ends at the documented 2023-10-19).
- **Synthetic test scenarios**, named `TEST …` and clearly fake, for cases the documentation does not show: conflicting registries, shared MMSIs, ownership changes. They exist only inside throwaway test schemas and are never shown to users.

Record more live responses with `npm run ships:import-gfw -- --save <dir> …`.

## Wikidata (and the EURODAM cross-source case)

| File | What it is |
|---|---|
| `wd-live-eurodam-2026-09-25.json` | **Real, recorded live** 2026-09-25 by `scripts/ships/wikidataClient.js`: `request` (the `wbgetentities` URL), `response` exactly as received for Q548546 (MS Eurodam), and `lookup` / `lookup_raw` (the SPARQL label / ISO / watercraft lookups for the items it references). |
| `wd-live-misc-2026-09-25.json` | **Real, recorded live** the same way: Q52331308 (Horizon Kodiak, three official names with dates), Q135414827 (Point Nemo, ex New Jersey Responder, type change over time; its IMO sits on two of our NOAA vessels), Q5338367 (Edison Chouest Offshore: a company carrying an IMO *company* number in P458). |
| `gfw-live-eurodam-2026-09-25.json` | **Real, recorded live** GFW detail entry (`registries-info-data=ALL`) for IMO 9378448. |
| `mc-live-eurodam-2026-06.ndjson` | **Real** MarineCadastre identity rows for MMSI 245206000 from `scripts/ships/bake-ais/build/identity-2026-06.ndjson`. |

`wikidata-db.test.js` also builds a few **SYNTHETIC** cases from these (Q-ids ≥ Q900000000, MMSIs 36700090x / 367000999), each marked in the test name.
| `commons-live-eurodam-2026-09-25.json` | **Real, recorded live** Wikimedia Commons `imageinfo` response (licence extmetadata, 640 px thumbnail) for EURODAM's two P18 files. |

`typeLookup.test.js` and the licence-filter test use small **SYNTHETIC** rows / metadata, marked as such in the test names.
