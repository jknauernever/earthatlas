# Permits for terminals and facilities — sources (study, 2026-10-06)

Facts only. Everything marked **verified** was read live on 2026-10-06 with a single
one-facility test (BP Cherry Point). Anything not verified says so.

## Why (Josh + Lovel, 2026-10-06)

Lovel (Friends of the San Juans) wants **every permit issued for a terminal or the facility
it serves** (e.g. the Marathon / HF Sinclair refinery and its wharf), **a flag where none is
found**, and **for each permit or permit application, whether it went through SEPA review**
(and what the determination was). Lovel will send the list of permit-issuing agencies
(county / state / federal). Same "nouns + assertions" model as the /sanjuan-docks permits.

## Key finding

**ECHO has no SEPA data.** It is the federal backbone for "which environmental permits
exist" (water, air, hazardous waste, toxics), keyed to EPA's own facility noun (the FRS
Registry ID). SEPA is a Washington process; its public record is **Ecology's SEPA Register**,
which carries parcel numbers, lead agency, the lead agency's file number and the
determination. Answering Lovel needs both, joined through the facility.

## 1. EPA ECHO web services — verified

- No key, no sign-up. JSON over GET. Host `https://echodata.epa.gov/echo/`.
- Swagger specs: `https://echodata.epa.gov/echo/swaggerx.swagger_json?p_prefix=<P>` with
  P = ECHO (all-media search), CWA, AIR, RCRA, SDW, DFR (Detailed Facility Report), CASE
  (enforcement), EFF (effluent charts), DMR (loading tool), NNCR, COMPSCREEN, ECATT*.
  (RCRA returned an empty body on 2026-10-06.) The ECHO site showed an "intermittent service
  disruptions" banner that day.
- Licence: US federal government data (no use restrictions known; **to confirm** on ECHO's
  About the Data page before publishing).

**Search** `echo_rest_services.get_facilities?output=JSON&p_lat=&p_long=&p_radius=<miles>`
returns a QueryID, then `get_qid?qid=` returns the rows (FRS RegistryID, name, address,
compliance flags, NAICS/SIC). 76 filter parameters (state, county, name, FRS id, NAICS, ...).
Test: 4 miles around the BP Cherry Point berth = 38 FRS facilities (refinery, Phillips 66,
Chevron Ferndale terminal, Intalco, Olympic Pipe Line stations, and **project-level records
such as "BP Cherry Point Refinery / Advance Mitigation Project 5"**).

**Detailed Facility Report** `dfr_rest_services.get_dfr?output=JSON&p_id=<FRS id>`
(116 KB for BP). Sections: Permits, Notices (NOVs), FormalActions, ICISFormalActions,
CaseFormalActions, Inspections/ComplianceHistory (CAA, CWA, RCRA), TRI, GHG, WebFire
documents, AWS docs, watersheds, demographics. The **Permits** section lists every program
record under that FRS id. For BP Cherry Point (FRS 110070752633) there are 29:
- CWA / ICIS-NPDES: **WA0022900** (major individual permit, expires 2027-06-30, Effective)
  plus 6 construction-stormwater general-permit coverages (WAR311052, WAR311117, ...),
  each named for a **project** (Clean Fuels Project, MS-3/MS-4 substation, ...).
- CAA: ICIS-Air WANCA0005307310007 (Major; programs MACT, NESHAP, NSPS, **PSD**, SIP,
  **Title V**), GHGRP 1006468, RMP 100000048307, CEDRI.
- RCRA WAD069548154 (LQG, legacy TSDF), TRI, SEMS (not on NPL), SDWIS, TSCA (×8).
- Fields per row: Statute, EPASystem, SourceID (the permit/program id), name, address,
  lat/lon + accuracy, Universe, Areas, **ExpDate**, FacilityStatus. **No issue date, no
  issuing-agency name, no application date** in the DFR row.
- Notices show `LeadAgency: Local` for CAA NOVs (NWCAA, not EPA).
- **Field meanings: docs/ECHO_DFR_DATA_DICTIONARY.md** (EPA's DFR data dictionary, copied
  2026-10-06). Notable: FRS links all program records for one site; names differ across
  systems by design; "an expired date does not mean the facility is operating without a
  permit" (renewal usually pending, permit administratively continued).

Second test, **Marathon Anacortes** (FRS 110000537250, found by Josh): 24 program records —
NPDES **WA0000761** (major individual, expires 2029-03-31) + 6 stormwater coverages (incl.
"Tesoro Crude Railcar Unloading Facility"), ICIS-Air WANCA0005305700005 (Major; MACT, NESHAP,
NSPS, PSD, Title V), GHGRP 1003904, RMP, RCRA LQG, SEMS, TRI; old names Tesoro / Andeavor /
Shell / Texaco all under one FRS id; 22 notices and 8 formal actions (e.g. NWCAA CAA orders
$21,600 2024-10-16, $12,000 2022-10-26; Ecology CWA penalty $5,000 2025-05-14).

**Bulk ICIS-NPDES download** (verified header only, not downloaded):
`https://echo.epa.gov/files/echodownloads/npdes_downloads.zip`, 355 MB, refreshed weekly
(last-modified 2026-10-04). `ICIS_PERMITS.csv` has PERMIT_NAME, **ORIGINAL_ISSUE_DATE,
ISSUE_DATE, ISSUING_AGENCY, EFFECTIVE_DATE, EXPIRATION_DATE, RETIREMENT_DATE,
TERMINATION_DATE**, VERSION_NMBR (permit history), plus NPDES_PERM_COMPONENTS and feature
coordinates (outfalls). This is where permit dates/versions come from for water permits.
The equivalent for air is the ICIS-Air download (**not yet studied**).

What ECHO does **not** have: SEPA, shoreline permits, USACE 404/Section 10, WDFW HPA, WA
DNR aquatic leases, county land-use permits, the permit documents themselves for NPDES
(WA Ecology's PARIS system holds those — **not yet studied**).

## 2. WA Ecology SEPA Register — verified

- `https://apps.ecology.wa.gov/separ/Main/SEPA/Search.aspx` — ~191,000 records (19,144
  pages of 10), SEPA and NEPA documents posted since 2000; documents attached since Oct 2016.
- **Plain GET works**: `Search.aspx?SearchFields=<All|Applicant|Location|...>&SearchText=<q>&PageSize=50&Page=1`.
  "Applicant = BP Products" returned 2 pages; "Location = Cherry Point" 15 hits.
- Record page `Record.aspx?SEPANumber=<n>` (HTML). Example 202303911 (verified): Lead
  agency Whatcom County, **lead agency file # SEPA2023-00051**, document type **MDNS**,
  issued 2023-08-16, comments due, proposal name + description, **parcel numbers (16)**,
  section/township/range, applicant, documents (`Document/DocumentOpenHandler.ashx?DocumentId=`;
  here a 14 MB MDNS distribution packet PDF).
- Document types include DNS, MDNS, DS/Scoping, EIS, DNS/Adopt, NEPA, ODNS/NOA, Addendum,
  CONSULT, CANADA (Canadian proposals that may affect WA).
- No API, no bulk export found. HTML only. Terms of use: not read; public agency records cleared by Josh 2026-10-06 (see end).

Marathon / Tesoro Anacortes in the Register (Applicant = "Tesoro", one page of 50): ~33
refinery records 2008–2023, lead agencies **Skagit County** (land-use projects: Clean Products
Upgrade 2016–17, Unit Train Unloading Facility 2011, CCU Feed Import 2014, ...), **Northwest
Clean Air Agency** (air permit actions: SNCR 2022, Alky unit 2016, flare gas recovery 2014,
...) and **Ecology** (Agreed Order DE 16299, 2021). So NWCAA air permits (Notice of
Construction / Order of Approval) appear in the Register with their own SEPA determinations —
one more permit-issuing system to study (NWCAA's own permit list).

**The permit ↔ SEPA join.** The SEPA environmental checklist (WAC 197-11-960, question
A.10) asks the applicant to list the government approvals/permits the proposal needs, so the
checklist PDF names the permits a review covered. Some project names also match across
systems: SEPA 202303911 "bp Cherry Point Advance Mitigation Project 5" ↔ ECHO FRS
110071668371 "BP Cherry Point Refinery / Advance Mitigation Project 5" ↔ construction
stormwater coverages. Joins available: parcel numbers, applicant, project name, lead-agency
file # (= the county permit system's own number).

**Caveat for "flag missing SEPA" (to verify before showing any flag):** absence from the
Register is not proof SEPA did not happen — the Register starts in 2000, some actions are
categorically exempt under WAC 197-11-800, and some permit renewals may not trigger new
review. A flag must say "no SEPA record found in the Register" and cite the search, never
"no SEPA review".

## 3. Facility nouns — build on what we already hold (Josh 2026-10-06)

Permits attach to the **facility** (EPA FRS id = the refinery site), not to our curated
terminal (the dock). We already hold facility records from several sources; FRS joins them
as one more source, it does not replace them:

| Already held | What it is | Ids it carries |
|---|---|---|
| Climate TRACE v5.10 (728k sources, global) | emitting facilities incl. refineries, power, cement, ports | CT source_id; capacity (e.g. BP Ferndale 240,000 BBL/day); ownership file with parent LEI. **No EPA/FRS id** (checked: refining CSV) |
| WA Ecology facilities | Class 1/3/4 oil-handling facilities + dock points | Ecology OBJECTID |
| USACE Navigation Facilities | docks | NAV_UNIT_ID |
| IMO GISIS port facilities | ISPS port facilities | IMO facility number |
| EIA refineries / product terminals (2021/22 zips) | plant / terminal points | EIA site_id |
| GEM trackers (GCTT, GGIT) | coal / LNG terminals | GEM unit ids |
| OSM | site polygons, piers | OSM element ids |
| BC Ports and Terminals | BC terminals | WFS feature id |
| salish-terminals.json (59) | our curated terminals | links to all of the above |

So a facility noun is seeded from these (Climate TRACE gives global reach), and the EPA
FRS id is attached by location + name match (reviewed, like terminals), bringing permits,
violations and reports with it. Terminals link to the facility they serve
(e.g. wa-bp-cherry-point → BP Cherry Point refinery site).

## 4. Still to study (before planning any of these)

- Ecology PARIS (permit documents, fact sheets for NPDES — fact sheets often state SEPA basis).
- ICIS-Air bulk download (air permit dates/versions); NWCAA Title V / NSR permit lists.
- County permit systems: Whatcom (eTRAKiT?), Skagit, Pierce, King, Snohomish, Clallam, Kitsap.
- USACE Seattle District permit decisions / ORM; WDFW HPA (APPS); WA DNR aquatic leases.
- Lovel's agency list (pending) decides which of these come next.

## 5. Full text / documents per permit (checked 2026-10-06)

We store only metadata today: the ECHO DFR JSON, SEPA Register record fields, and SEPA document URLs. No document is
downloaded. Where the documents live (verified live unless marked):

- **NPDES individual permits + stormwater coverages (Ecology-issued): PARIS.** Plain GET deep links per permit number:
  `apps.ecology.wa.gov/paris/PermitDocumentSearch.aspx?PermitNumber=WA0000761` lists 10 documents for Marathon (current
  permit 2024-03-18, fact sheet, drafts 2013/2014, public-comment notices, 2016 modification, supplemental fact sheet and
  response to comments); each downloads from `DownloadDocument.aspx?id=<n>` (PDF, e.g. 963,933 B). WAR302760 lists 10.
  The search result row also links FacilitySummary / FacilityDetails (`FacilityId=6`), Inspections, Enforcements and DMR data
  (not opened yet). PARIS search itself is an ASP.NET postback; the document page is GET.
- **Ecology Industrial Section refinery pages** (`ecology.wa.gov/.../industrial-facilities-permits/tesoro-refinery`,
  `bp-refinery`, `phillips-66-refinery`, `hf-sinclair-puget-sound-refinery`, `us-oil-refining`, `seaport-sound-terminal`,
  `tesoro-logistics-anacortes`): current wastewater permit + support document, hazardous-waste corrective action permit +
  support document (`fortress.wa.gov/ecy/industrial/UIPermit/ViewDocument.aspx?DocumentId=<n>`), penalty letters, the
  Ecology cleanup-site page (`fortress.wa.gov/ecy/gsp/Sitepage.aspx?csid=<n>`, not opened).
- **Air (Title V + construction approvals): NWCAA** `nwcleanairwa.gov/resources/aop-page/` (81 PDFs): per facility the
  AOP (Title V permit), Statement of Basis, OACs (Orders of Approval to Construct = the NSR permits that carry SEPA),
  Orders, PSD permits, renewal application, consent decree. NWCAA permit numbers (BP 015R2, Tesoro 013R2M1) are not EPA's
  ICIS-Air id (WANCA…): needs a curated crosswalk per facility.
- **ECHO itself**: the stored DFR already holds WebFireDocuments (EPA emissions/test report links) — not shown yet.
- **SEPA Register**: record documents (`Document/DocumentOpenHandler.ashx?DocumentId=`), URLs already stored; packets can be
  large (BP AMP5 MDNS packet 14 MB).
- Not checked: GHGRP (FLIGHT), TRI, RCRAInfo handler reports, SEMS pages; RMP plans are not believed to be online (to verify).

### Layer 1 built (dev, 2026-10-06)

Migration 023 (documents + document_links), lib/ships/permitDocuments.js, run by `npm run ships:import-facilities`.
Two refineries: 20 listings → 95 documents linked (PARIS: every NPDES permit/coverage ECHO lists, all pages via the grid
postback; Ecology Industrial pages → individual NPDES + RCRA corrective-action permit, rest to the facility; NWCAA AOP
row → the ICIS-Air record named in the data file). Files are linked, not downloaded (layer 3 not authorized).
Not yet listed: ECHO WebFIRE documents (already inside the stored DFRs), PARIS inspections/enforcement/DMR pages.

### PARIS by facility + Tesoro Logistics (dev, 2026-10-06)

Migration 024. PARIS FacilityDetails pages (FacilityId: Marathon 6, BP 13, TLO 6344; GridView postback paging) give every
permit version with issue / effective / expiration dates and ALL filed documents (permit documents, inspections,
enforcement, appeals, submittals): 1,229 documents. State-only permits (TLO's State Waste Discharge permit ST0045528) are
added as system 'WA-PARIS'. Tesoro Logistics Operations is its own facility (FRS 110055599277, PARIS 6344) that OWNS the
Marathon wharf (Ecology TLO page + refinery NPDES fact sheet). "Covers this dock" = permit_terminal_coverage, only where a
permit document's own text names the dock (5 cited: Marathon AOP §1.11 + NPDES S1.F, BP AOP p.19 + NPDES S1.F, TLO draft
fact sheet p.9). ST0045528 renewal draft in public comment 2026-09-23 → 2026-10-23; its fact sheet cites the SEPA
exemption for permit reissuance (RCW 43.21C.0383).


## Licensing decision (Josh 2026-10-06)

Public agency records (EPA ECHO, WA Ecology SEPA Register / PARIS / Industrial Section pages, NWCAA) are treated as cleared
for EarthAtlas use; their terms pages were deliberately not read. Credit and link each source. Recorded in ships.sources.
