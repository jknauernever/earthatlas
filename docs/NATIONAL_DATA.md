# EarthAtlas national datasets

National datasets are built once, kept current, and shared by every subsite. A subsite is a *consumer* of a national
dataset, never its owner: /spills was the first (2026-11), and anything else that needs protected areas, critical
habitat, pipeline accidents or spill reports reads the same data.

## Where things live

| What | Where |
|---|---|
| Raw downloads (large) | offload drive `/Volumes/Josh WD 4TB/earthatlas-offload/data/national/<dataset>/raw/` (repo: `data/national/<dataset>/raw`, a link) |
| Raw downloads (small) and caches a weekly job needs | laptop `data/national/<dataset>/raw/` and `…/work/` (gitignored) |
| Builds, before upload | `data/national/<dataset>/build/<version>/` + `dataset.json` (the catalog entry) |
| Fetch / build scripts | `scripts/national/<dataset>/` |
| Published files | Vercel Blob `national/<dataset>/<version>/…` (never overwritten; 3 newest versions kept) |
| Catalog | Blob `national/catalog.json` — every dataset's current version, files, source, license, coverage, cadence |
| App side | `src/lib/national/catalog.js` (`loadCatalog`, `nationalDataset`, `nationalFile`, `nationalTilesUrl`) |
| Map tiles | `api/national-tiles?d=<dataset>&v=<version>&z&x&y` (PMTiles; local build in dev, Blob in prod) |

Publish a version: `node --env-file=.env.local scripts/national/publish.mjs <dataset> <version>`.

Formats: **PMTiles** for maps; **GeoParquet** (offload drive) for analysis; **small JSON** (per state or per year) for
cards and lookups. Every dataset keeps its source's own field names in the raw files and adds plain-language labels
in the app.

## Datasets

| id | What | Source | License | Updates | Getting it |
|---|---|---|---|---|---|
| `padus` | Protected Areas Database of the U.S. 4.1, Combined layer: fee land, easements, designations, marine areas, proclamation boundaries (656,986 records) | USGS GAP, doi:10.5066/P96WBCHS | Public domain | USGS releases ~yearly | USGS's national files need a ScienceBase sign-in (DOI or login.gov); we use the identical GeoParquet copy on Source Cooperative (`data.source.coop/cboettig/padus/padus-4-1/combined.parquet`). State files (`PADUS4_1_State_<ST>_GDB_KMZ.zip`) download by script from `sciencebase.gov/catalog/file/get/6759abcfd34edfeb8710a004?name=…` |
| `crithab` | ESA critical habitat, final designations, both agencies: polygons and stream lines, with species, listed population, federal status and a profile link | U.S. Fish & Wildlife Service ECOS (`ecos.fws.gov/docs/crithab/crithab_all/crithab_all_shapefiles.zip`, one zip per species) + NOAA Fisheries (`maps.fisheries.noaa.gov/server/rest/services/All_NMFS_Critical_Habitat/MapServer`, one layer per species) | Public domain | As designations change | FWS files spell fields many ways (SCINAME, Sci_Name, SCINAM, SNAME…; file name is the fallback); skip PROPOSED/EXCLUDED; NMFS: skip `All_*` compilations and `Proposed_*` layers |
| `esa-species` | Federally listed species (2,385 entities): status, listing date, ECOS profile link | FWS ECOS species export (`ecos.fws.gov/ecp/pullreports/catalog/species/report/species/export`) | Public domain | Continuous | One request |
| `phmsa` | Pipeline accidents: hazardous liquids (F 7000-1, 2010–) and gathering/gravity lines (F 7000-2, 2021–); gas distribution, transmission & gathering, and LNG incidents (F 7100.1/.2/.3) | PHMSA | Public domain | Batch re-export of all files (last 2026-10-15); operators file within 30 days | phmsa.dot.gov blocks scripted downloads: a person downloads the zips (the weekly job picks them up from ~/Downloads). The two liquid forms (and the three gas forms) number reports separately — ids carry a prefix (G, D, T, L) |
| `nrc` | National Response Center incident reports, every call (FOIA files CY<yy>.xlsx), plus Census geocoding of street addresses | U.S. Coast Guard NRC | Public domain | Current year re-exported every few days | Scriptable; download with If-Modified-Since |
| `census` | 2024 Gazetteer places; 2022 state boundaries (TIGER) | U.S. Census Bureau | Public domain | Yearly | Scriptable |

## Rules

- Keep raw inputs exactly as downloaded, per version; derive everything else.
- Never publish people's names from agency forms (preparers, contacts).
- Every value a subsite shows links to its source (the catalog entry carries `source.url`).
- Big inputs stay on the offload drive; anything a weekly job needs must be on the laptop (or cached there).
- Test small (one state), then run once for real; state time and cost first for anything over ~5 minutes or ~100 calls.
