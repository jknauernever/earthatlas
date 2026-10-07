# Permits for BC terminals — sources (study, 2026-10-07)

Facts only; each source probed live on 2026-10-07 with one or two requests. Nothing built yet. Companion to
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
