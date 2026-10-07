# Permits for BC terminals — sources (study, 2026-10-07)

Facts only; each source probed live on 2026-10-07 with one or two requests. A two-terminal DEV pilot is built (see the end). Companion to
docs/PERMITS_SOURCES.md (Washington). Our list has 33 BC terminals (lib/ships/data/salish-terminals.json, country CA).

## Who regulates what (BC side)

| Topic | Agency | Washington analogue |
|---|---|---|
| Waste discharges to water, land, air outside Metro Vancouver | BC Ministry of Environment and Parks — Environmental Management Act (EMA) authorizations | Ecology NPDES / State Waste Discharge (PARIS) |
| Air emissions inside Metro Vancouver (most BC terminals) | Metro Vancouver (GVRD Air Quality Management Bylaw 1082) | NWCAA / PSCAA |
| Projects on federal port lands | Vancouver Fraser Port Authority — Project and Environmental Review (PER) permits | SEPA + county permits |
| Large projects | BC Environmental Assessment Office (EAO); federal Impact Assessment Agency | SEPA EIS / NEPA |
| Pipelines and their marine terminals (Trans Mountain Westridge) | Canada Energy Regulator (CER) | — |
| Fish habitat works | DFO Fisheries Act authorizations | WDFW HPA |
| Pollutant reporting | ECCC National Pollutant Release Inventory (NPRI) | EPA TRI |
| Compliance and enforcement (provincial) | BC Natural Resource Compliance and Enforcement Database (NRCED) | ECHO enforcement + PARIS |

## 1. BC EMA waste discharge authorizations — verified, best primary source

- BC Data Catalogue dataset `waste-discharge-authorizations-all-authorizations`, **Open Government Licence – BC**.
  One XLSX (`all_ams_authorizations.xlsx`, 1.7 MB): **9,083 rows** with Authorization Number, Authorization Type (Permit,
  Petroleum Storage and Distribution Facilities Storm Water Regulation, Hazardous Waste Regulation, …), Company, Issue /
  Expiry Date (Excel serial), Waste Type (Effluent / Air / Refuse), State (Active / Cancelled), BCENICID industry codes,
  regional district, nearest municipality, facility type, **facility address, latitude, longitude**.
- Name search of the file found Parkland Refining (B.C.) (refinery effluent 4970, air 6244, 6584), Trans Mountain
  Pipeline ULC, Westshore Terminals (6819), Neptune Bulk Terminals (6898), PKM Canada Marine Terminal, Suncor / Petro-Canada,
  Imperial Oil, Chevron Canada, FortisBC (Tilbury), Lafarge Canada and others — 291 rows by name.
- Documents: AMS "Find an authorization document" search (`j200.gov.bc.ca/pub/ams/Default.aspx?PossePresentation=DocumentSearch`,
  an ASP.NET Posse app; reachable, search mechanics not yet studied).
- Join to terminals: by coordinates (like ECHO's radius search) + company name, hand-checked.

## 2. NRCED (BC compliance and enforcement) — verified API

- JSON API: `https://nrpti-api-f00029-prod.apps.silver.devops.gov.bc.ca/api/public/search?dataset=<Order,Inspection,
  AdministrativePenalty,…>&keywords=<text>&pageSize=&pageNum=` (the public site nrced.gov.bc.ca is an Angular app over it).
- Test: "Westshore" returned an Inspection record issued to Westshore Terminals Ltd. (NRIS id 113400) with full record JSON.
- Records: inspections, orders, administrative penalties, court convictions, warnings, tickets — with documents. Source code
  and API notes: github.com/bcgov/NRPTI. Licence: not stated on the probe (BC public record).

## 3. Metro Vancouver air permits — partial

- Permits are PDFs in a SharePoint library (e.g. `…/air-quality-regulatory-program/AirQualityPermits/0237 - A-Z Foam Ltd. -
  Air Quality Permit Amendment - Issued November 22, 2023.pdf`, permit numbers `GVA####`). The library listing returns 401
  and the list API 404; no public index found. Individual permit links are only reachable when known (e.g. from search).
- Next step if wanted: find the permit numbers (GVA…) per facility from Metro Vancouver's public notices or search, then link.

## 4. Vancouver Fraser Port Authority PER — blocked to scripts

- portvancouver.com returns **HTTP 403** to scripted requests (bot protection). PER permits and project pages exist publicly
  but can't be read by script without bypassing that protection (we won't). Options: link out per terminal by hand, or ask
  the port authority for a data export.

## 5. BC Environmental Assessment Office — verified API

- `https://projects.eao.gov.bc.ca/api/public/search?dataset=Project&keywords=Tilbury` returns JSON (EPIC). Projects carry
  proponent, location, status, documents. Covers big projects only (e.g. Tilbury LNG expansions, Roberts Bank).

## 6. NPRI — verified on open.canada.ca

- CKAN search finds "Reporting facilities – pollutant release and transfer data" and per-year facility tables (Open
  Government Licence – Canada). Facility ids + coordinates; a reporting record like EPA TRI, not a permit.

## Not probed yet

- Canada Energy Regulator compliance and incident open data (for Trans Mountain Westridge).
- DFO Fisheries Act registry; Impact Assessment Agency registry.

## Proposed plan (for Josh's decision)

1. Pilot on 2 BC terminals (Westridge, Westshore): BC EMA authorizations by location + name, NRCED records, EAO projects.
2. Facility noun for BC: there is no FRS equivalent; the anchor would be our own facility entry with the EMA authorization
   numbers (and NPRI id) as its source records.
3. Metro Vancouver and the port authority: link-out only until a public index or export is found.

## Pilot (DEV only, 2026-10-07): Westridge + Westshore

Code `lib/ships/bcPermits.js`, script `scripts/ships/import-bc-permits.mjs` (`--dry-run` lists the register rows to hand-check),
migration 027 (facility_links roles `bc_ema_authorization`, `nrced_record`, `eao_project`), data = the two `bc-…` entries in
`lib/ships/data/salish-facilities.json`, tests `lib/ships/test/bcPermits*.test.js`. Same model as Washington: facility noun →
terminal_facilities → permits (`epa_system` 'BC-EMA', statute 'BC EMA') → documents (NRCED files, links only) → inspections →
EAO projects. Request facts learned while building:

- **EMA register**: the workbook's register sheet is `sheet1.xml` ("All_Authorizations"; `Sheet1` is empty). Dates are Excel serial
  days. **Longitude is listed without its minus sign** (Burnaby = 122.95); a few rows carry placeholder points (e.g. 60, 140).
  Matching = rows within 1 km of the berth points or with the company's name anywhere in BC, then a hand check (kept in the data file
  with why, plus the rows left out and why).
- **NRCED API**: `keywords` is a full-text search where words are OR-ed ("Westshore Terminals" unquoted = 62 hits, mostly other
  "terminals"); a quoted phrase narrows it (`"Westshore Terminals"` = 4). Numbers in descriptions are not matched (searching
  "6819" finds an address "6819 100 Avenue"). `populate=true` returns each record's documents with their public URLs
  (`nrs.objectstore.gov.bc.ca/...pdf`). The public search always uses the redacted subset. Ministry inspections (source
  `nris-epd`) say `Authorization Number: <n>` in their description: that number is the EMA authorization they inspected, which
  joins a record to its permit. No per-record public page exists in NRCED's app; EarthAtlas links the record's files and the
  stored record. "Trans Mountain" = 709 records along the whole pipeline, so the facility is searched by place ("Westridge").
- **EAO EPIC**: project pages are `projects.eao.gov.bc.ca/p/<_id>/project-details` (route read from EPIC's own main.js).
  Records carry EAO staff names / emails / phones: dropped before storing (fixtures: `[withheld]`).
- **NPRI**: not done (optional; would need the per-year facility tables from open.canada.ca).

Result (dev): Westridge = EMA 3678 (permit, Active), 14058 (storm water regulation registration, Active), 109085 (approval,
Expired 2020-02-15); NRCED inspections 2025-04-01 and 2024-04-04 (3678, warnings) and 2018-11-14 (109085, compliant); EAO
"Trans Mountain Expansion (TMX)" (certificate 2017-01-10; its description names the Westridge Marine Terminal); the 1997
"Trans Mountain Pipe Line Modification" kept as a candidate (doesn't say which site). Westshore = EMA 6819 (permit, Active, 1983)
and 16534 (municipal wastewater regulation registration, Active, 2000); NRCED inspections 2018-02-06 (6819, warning), 2019-02-12
(6819 and 16534, advisories), 2023-05-25 (dangerous goods inspection, advisory); no EAO project with Westshore as proponent.

## Rollout to all 33 BC terminals (DEV only, 2026-10-07)

Josh approved the dev rollout. Each of the 31 other terminals was hand-checked from `--dry-run` (register rows within 1.5 km of the
berth points, or with the company's name anywhere in BC), with the same evidence standard: same company plus the address or
coordinates at the dock; neighbours and same-name-only rows left out, each with its reason. A terminal with no matching
authorization carries an explicit `bc.ema.none` note, shown on the card. One NRCED search (Parkland: two) and one EAO search per
terminal; EAO projects hand-checked.

- Register: one authorization can fill several rows (one per waste type, e.g. Chemtrade 18: Air and Effluent); they are read as
  one permit and stored together (`{ authorization, rows }`).
- Two address facts came from public pages read once: Pembina's Vancouver Wharves page names PKM Canada Marine Terminal LP
  (the register holder of 1386); the port authority's project record for Univar places it at 1545 Bay Street (register 5508).
- NRCED "Vancouver Airport Fuel" = 111 records, project-wide EAO inspections located only "Richmond": none tied to the marine
  terminal, so all are kept as candidates (and only the first 100 were read).
- 14 terminals have no matching EMA authorization (the 7 grain terminals, Fibreco, Squamish Terminals, Duke Point, PCT, VAFFC,
  Shellburn, Sechelt). Their permits may sit with Metro Vancouver (air permits) or the
  port authority, neither readable by script.

