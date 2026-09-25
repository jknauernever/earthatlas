# /ships test fixtures

| File | What it is |
|---|---|
| `gfw-doc-miss-freya.json` | **Real** GFW response entry, copied verbatim from GFW's documentation ("Basic search" example, `/docs/examples/vessels/vessels-example1`). |
| `gfw-doc-claudina.json` | **Real** GFW entry, verbatim from `/docs/quick-start` (has a registry owner and combinedSourcesInfo). |
| `gfw-live-gabu-reefer-2026-09-24.json` | **Real, recorded live** 2026-09-24: `GET /v3/vessels?ids[0]=0b7047cb5-…&registries-info-data=ALL` (dataset v4.0). |
| `gfw-live-cresty-2026-09-24.json`, `gfw-live-goldeneye-2026-09-24.json` | **Real, recorded live** 2026-09-24 (one detail call returned both). Sister ships that share an AIS identity inside GFW's data: the regression case for never matching GFW entries by AIS id. |
| `gfw-doc-don-tito.json` | **Real** GFW entry, verbatim from `/docs/v3/vessels/get-one-vessel` (AIS only, no registry). |

`scenarios.js` builds two kinds of entries:
- `gabuReefer()`: the documented GABU REEFER case (`/docs/v3/general-api-doc/data-caveats`, "Why am I seeing multiple ids"). The ids, MMSIs, callsigns and dates come from that table; we assembled them into GFW's JSON shape. The docs give dates only, so times are set to 00:00Z (the ongoing identity ends at the documented 2023-10-19).
- **Synthetic test scenarios**, named `TEST …` and clearly fake, for cases the documentation does not show: conflicting registries, shared MMSIs, ownership changes. They exist only inside throwaway test schemas and are never shown to users.

Record more live responses with `npm run ships:import-gfw -- --save <dir> …`.
