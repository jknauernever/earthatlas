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

## WA rollout — test terminals on dev (2026-10-06)

`scripts/ships/propose-facility.mjs <terminal key> [--words a,b] [--radius 0.75]` proposes candidates (ECHO within the
radius of each berth, ranked by name words) for hand review. Added on dev: Kinder Morgan Harbor Island (FRS 110032894027,
PARIS 88394523; air = Puget Sound Clean Air Agency, ICIS-Air WAPSC0005303316002; stormwater WAR301429 whose 2024 coverage
letter names the site "KMLT LLC Harbor Island Terminal N Dock"; no SEPA Register record with Kinder Morgan as applicant in King
County) and Tesoro Port Angeles (FRS 110032897015; no water or air permit in EPA's records, no PARIS facility, not on ORCAA's
2025-04-24 registered-sources list; SEPA: Tesoro Logistics' 2016 "Port Angeles Dock Piping Replacement Project", City of Port
Angeles lead). Migration 026 widens facility kinds. PSCAA and ORCAA publish no per-facility permit search or enforcement list online; what they do publish (posted orders
of approval, notices, registered sources) is catalogued in "WA local clean air agencies" below (2026-10-07).
Fixed: `--only` imports no longer withdraw the facilities they weren't given.

## WA DNR aquatic land leases (2026-10-07)

Statewide public source: DNR's AQ_ENC_Public_Prod map service (lease number, lessee, type, status, start date, acres; **no end
date**). Full catalogue, the matches to our 59 WA terminals and the two private lease documents Lovel sent: **docs/DNR_LEASES.md**.
Built on dev: migration 030 (`terminal_land_records`), `lib/ships/dnrLeases.js`, `npm run ships:import-wa-leases`; shown on the
terminal card's Permits tab ("State aquatic land under the dock").

## EFSEC — Energy Facility Site Evaluation Council (checked 2026-10-07)

What EFSEC publishes (efsec.wa.gov): a facility list (19 entries, filterable by status: application review, awaiting
construction, operational, under construction, withdrawn, suspended, decommissioning), one page per facility with its Site
Certification Agreement (SCA), compliance and permit documents (e.g. Grays Harbor Energy Center's Title V permit), and a document
search (5,273 documents; filters facility, county, energy type, date, document type in 20 categories, status). The keyword
parameter did not filter when fetched; EFSEC's older documents (e.g. 2011 meeting minutes) are PDFs under
`/sites/default/files/2025-05/`.

Jurisdiction (RCW 80.50.020 / .060, read 2026-10-07): an "energy facility" includes facilities able to receive **more than an
average of 50,000 barrels a day of crude or refined petroleum or LPG transported over marine waters**, petroleum pipelines over
6 inches and 15 miles, and gas pipelines over 14 inches and 15 miles. The chapter applies to new construction and to a
reconstruction or enlargement whose **net increase** meets those thresholds; normal maintenance is exempt.

**None of our 59 WA terminals is an EFSEC facility.** None appears on EFSEC's facility list. The list's facilities are solar,
wind, battery, nuclear, transmission and gas-fired plants (Chehalis, Grays Harbor Energy Center at Satsop, Columbia Generating
Station, …); the two nearest to our terminals are the Grays Harbor Energy Center (Elma; not at the Port of Grays Harbor docks)
and Goldeneye Battery Storage (east of Sedro-Woolley, Skagit County; application review since 2024-06-27). The refinery docks
were built before chapter 80.50 (Tesoro's 1955, ARCO's 1971).

EFSEC history touching our sites (not shown on the site; for Josh):
- **BP Cherry Point Cogeneration Project** (next to the BP refinery): EFSEC issued a Site Certification Agreement and, with EPA, a
  PSD permit for a 720 MW gas-fired cogeneration plant; EPA: "This project replaces the previously permitted 720 MW project which
  was never constructed" (a 520–570 MW replacement application was received 2006-07-06). On 2011-08-24 EFSEC adopted Resolution
  331 transferring the SCA and permits from Cherry Point Cogeneration, LLC to **BP West Coast Products, LLC** (special meeting
  minutes, `efsec.wa.gov/sites/default/files/2025-05/20110824_SpclMtg.pdf`). The project is not on EFSEC's current list; whether
  the SCA was later terminated, and whether anything was built, was not found in public pages (would need EFSEC's document search
  by facility or a records request).
- **Vancouver Energy (Tesoro Savage)**, a proposed 360,000 bbl/day crude-by-rail terminal at the Port of Vancouver: EFSEC
  recommended denial in 2017; Governor Inslee denied it on 2018-01-29 and the Port cancelled the lease effective 2018-03-31
  (Earthjustice, Port press coverage). It would have used Port of Vancouver docks near our wa-pov-* terminals; it is not one of
  them.

## Counties (shoreline permits and SEPA; checked 2026-10-07)

**Who issues shoreline permits at our docks.** Shoreline Substantial Development, Conditional Use and Variance permits are issued
by the **local government with jurisdiction: the city inside city limits, the county outside them** (Shoreline Management Act;
decisions are filed with Ecology, which approves conditional uses and variances). By the Census places already stored on our
terminals (migration 028), **48 of the 59 WA terminals are inside a city** (Seattle 14, Tacoma 14, Vancouver 6, Longview 3,
Bellingham 2, Port Angeles 2, Hoquiam 2, Aberdeen, Anacortes, Everett, Olympia, Oak Harbor), so their shoreline permits come
from the city, not the county. **11 are in unincorporated county**: Whatcom (BP Cherry Point, Phillips 66 Ferndale, Petrogas/ALA
wharf), Skagit (Marathon and HF Sinclair at March Point), Snohomish (Point Wells), Kitsap (Navy Manchester — federal), Cowlitz
(Kalama Export, TEMCO Kalama, LANXESS Kalama, Weyerhaeuser Longview log dock). Jefferson County holds none of our terminals.

**SEPA lead agency.** For a project needing a county permit, the county is SEPA lead (WAC 197-11-922/926); for air permits the
clean air agency is (NWCAA for Whatcom/Skagit/Island); Ecology for its own permits. The SEPA Register shows this per record, with
the county's own file numbers (Whatcom `SEP…`, `SHR…` shoreline, `LDP…`, `VAR…`, `MPP/CUP`; Skagit `PL##-####`, `BP##-####`,
`PLAN2-YYYY-####`) — so the Register is the one statewide, public, searchable index of county shoreline files, from 2000 on.

| County | Our terminals (unincorporated) | Online permit records | Shoreline decisions online |
|---|---|---|---|
| Whatcom | BP, Phillips 66, Petrogas/ALA | Civic Access portal (Tyler); the county website refused automated access (HTTP 403), not read | Notices of application and SEPA packets in the SEPA Register (e.g. SHR2020-00002, SHR2020-00006); hearing examiner decisions not checked |
| Skagit | Marathon, HF Sinclair | EnerGov self-service (Tyler) "Apply and Check Permit Status" (account needed); Property Search and Recorded Documents search open | Hearing Examiner decisions online for 2026 only; 2005–2025 by email request |
| Snohomish | Point Wells | "PDS Online Records" search tool (not all records digitized) and PDS permit portal; Point Wells has its own project page | via Online Records (not tested) |
| Kitsap | Navy Manchester (federal) | online-only applications ("Prepare, Apply, Manage"); public search not checked | not checked |
| Cowlitz | Kalama ×3, Weyerhaeuser | Building & Planning page; no public search found | not found |
| King, Pierce, Clark, Clallam, Thurston, Grays Harbor, Island | none (all ours are inside cities) | King: MyBuildingPermit; Pierce: PALS+ and a public ArcGIS "Permits_Pierce_County" FeatureServer; Clark: Property Information Center + CC LMS (since 2019-03-02); Clallam: new online permit system; Grays Harbor: SmartGov (account for documents); Island: online portal since 2025-04-21; Thurston: not found | (city permits apply instead: Seattle SDCI, Tacoma, Vancouver, …) |

**Pilot (Whatcom, 2 terminals, dev).** Source: the county's notices of application as filed in the SEPA Register, joined by the
lead-agency file numbers. Petrogas/ALA Ferndale wharf (wa-intalco-wharf): **SHR2020-00002** "Petrogas Marine Loading Arm"
(Shoreline Substantial Development Permit; applied 2020-02-04, notice 2020-03-27, SEPA ODNS 2020-06-24) and **SHR2020-00006**
"Ferndale Wharf Dredging" (SSDP; applied 2020-03-02, notice 2020-03-12, SEPA ODNS 2020-10-09). BP Cherry Point: **no shoreline
permit for the wharf found** in the Register's Whatcom records for BP (2000–2026). The permit **decision** (approved/conditions/
date) is not in those filings: it needs the county portal, the hearing examiner, or Ecology's filing. Shown on the card under
"Shoreline permits for work at the dock" with the notice, SEPA records and "permit decision not published online".

**What the rest would take.** (1) The 4 other unincorporated counties: the same SEPA-Register join (search by our applicants'
names, cached already for most refineries; ~1–3 requests per terminal) gives file numbers and notices; decisions need each
county's portal (Skagit and Grays Harbor need accounts; Whatcom blocks scripts) or records requests. (2) The 48 city terminals:
the same join for city leads (Seattle SDCI "Land Use / Master Use Permit – Shoreline" has a public permit search, Tacoma and
Vancouver have portals) — a separate city catalogue. (3) Ecology receives every shoreline permit decision (permit data sheets);
no public searchable list of them was found; if Ecology holds one, it would cover all jurisdictions at once (a question for Josh to put to Ecology, not asked).

## WA local clean air agencies: PSCAA, ORCAA, SWCAA (catalogue + build, dev 2026-10-07)

Facts only, read live 2026-10-07 (79 agency requests, ≥ 1.5 s apart, EarthAtlas User-Agent, all cached under
`scripts/ships/facilities/cache/air-*`; request log `air-requests.log`; plus ~17 web searches). No login, form protection or CAPTCHA
met or bypassed; terms pages not read (public agency records cleared by Josh 2026-10-06). NWCAA: see §5 above (already built).
Code `lib/ships/waAirAgencies.js`, data `lib/ships/data/wa-air-permits.json`, import `npm run ships:import-wa-air`
(prod: `zsh scripts/ships/prod.sh import-wa-air`, 0 requests from the cache), fetch helper `scripts/ships/air-fetch.mjs`
(scanned PDFs read with macOS Vision OCR by `scripts/ships/ocr-pdf.swift`; the stored text says so).

### Puget Sound Clean Air Agency (PSCAA): King, Pierce, Snohomish, Kitsap — pscleanair.gov (CivicPlus CMS)

| What | Where | Scriptable? |
|---|---|---|
| **Title V (Air Operating Permits)**: 24 sources, permit no., name, issue + amendment dates, AOP / Statement of Basis / attachments PDFs | `/182/List-of-Approved-Permits` (one HTML table) | yes, plain GET (already read by `parsePscaaRow`) |
| **Orders of Approval (Notices of Construction, NOC)**: the construction permits; no list or search. Only orders PSCAA chose to post: project pages (`/460` Recent Permitting Projects → e.g. `/709` Ash Grove, `/636` + `/736` PSE LNG), News Flash public notices (`/CivicAlerts.aspx?AID=<n>`: notice text + application, worksheet, draft / final order, SEPA docs), and Document Center files (`/DocumentCenter/View/<n>`, e.g. "NOC Order of Approval 11265 & Worksheet - Targa Sound Terminal" linked from `/300/Documents`) | per URL, plain GET; the Document Center folder tree and the News Flash archive lists load by script and were **not** enumerated; documents were found by site-restricted web search + the agency's own pages |
| Worksheets carry: NOC number, **registration number**, installation address, applied date, description, permit history (earlier NOC numbers), SEPA basis, BACT review, responses to comments | the worksheet PDFs | text layer (some scanned pages: OCR) |
| New construction projects (current applications, 15-day comment window), permits open for comment | `/176`, `/175`, `/183` | plain GET; only what is current |
| **Registrations** (annual-fee sources) | no public list ("We do not issue registration certificates", `/396`) | — |
| **Notices of Violation / civil penalties**: not published per facility (`/223` explains how to respond to a penalty; no list). PSCAA reports them to EPA ICIS-Air: ECHO shows them as `LeadAgency: Local` under the site's ICIS-Air id (prefix **WAPSC**), and formal actions' `CaseFormalActions.CaseName` carries PSCAA's own penalty number (e.g. "23-0086CP") | ECHO DFR (already stored) | yes (ECHO) |
| Board packets (`/AgendaCenter/ViewFile/Agenda/_<date>-<n>`): budget/vouchers; no enforcement list found in the July 2026 packet | PDF | yes |

ICIS-Air ids: newer PSCAA sources are `WAPSC00000000` + the PSCAA registration number (Schnitzer 21432 and PSE LNG 30022 match the
registration on their PSCAA orders); older ones use the AFS plant id (`WAPSC000530` + county FIPS + plant number), which is not the
registration number (SeaPort Sound: registration 13828, ICIS-Air WAPSC0005305300021).

### Olympic Region Clean Air Agency (ORCAA): Clallam, Jefferson, Grays Harbor, Mason, Pacific, Thurston — orcaa.org (WordPress)

| What | Where | Scriptable? |
|---|---|---|
| **List of all registered sources** (~700: name, registration class OP1/OP2/RC0–RC5, category, address, city, zip) | `/wp-content/uploads/RegisteredAOPSources-24Apr2025.pdf`, linked from `/for-business/notices-registered-businesses/` | PDF, text layer |
| **Air Operating Permits**: 11 sources, AOP + Technical Support Document PDFs | `/for-business/air-operating-permits-aop/` | plain GET |
| **NOC notices** (one page per application since ~2023: Notice Type, Posted, Name of Business, Address, Source class, Notice #, Status, **Date Finalized**, Application, related files, **Final Determination** = the Order of Approval PDF); older ones (2018–2022) are multi-applicant pages "Public Comment Due mm/dd/yyyy" with Applicant / Location / NOC number / description only | `/notices/<slug>/` | plain GET; found through the site search `/?s=<words>` (HTML, paged) |
| Orders of Approval / Final Determinations | `/wp-content/uploads/<n>NOC<n>-FinalDetermination.pdf` | PDF, often **scanned** (OCR) |
| **Enforcement**: no list of NOVs or penalties; occasional news releases (e.g. "Olympia plant agrees to settlement…") | site search | — |
| Tesoro Port Angeles is not on the April 2025 registered-sources list (no source at 1720 W Ediz Hook Rd), holds no AOP, and no notice names it | | |

### Southwest Clean Air Agency (SWCAA): Clark, Cowlitz, Lewis, Skamania, Wahkiakum — swcleanair.gov (classic ASP)

| What | Where | Scriptable? |
|---|---|---|
| **Air Discharge Permit search** (all active sources; ~1,190 plant names, each `<id>~<name>`) → per plant: previous names, every permit since the 1970s (number, ADP + TSD PDFs, public notice dates, **Date Final**, appeal end, SEPA determination no.) | `/permits/permitADPsearch.asp` (form) → POST `permitADPlist.asp` `SelType=PLT&PlantID=<id~name>` | yes: a public search form, one POST per plant (also by ADP number, business, date) |
| Title V permits, Title V opt-out permits, recent ADPs, applications received, permits open for comment, SEPA actions | `/permits/title5final.asp`, `/permits/t5OptOutSearch.asp`, `/permits/adpfinal.asp`, `/permits/applications.asp`, … | plain GET (not read) |
| **Annual facility inspection reports** per facility | `/epages/annualinspection.asp` → POST `INSList.asp` | public form (not read) |
| Facility details, equipment, source tests, annual emissions | `/epages/*` | public forms (not read) |
| Enforcement: no NOV / penalty list seen; news releases | `/agency/newsrelease.asp` | not read |
| Our terminals in the plant list: Port of Vancouver USA (679), United Grain Corporation (883), NuStar Terminals Service Main (360) + Annex (170), Kalama Export Company (1024), Port of Kalama (1639), TEMCO (611), Lanxess Corporation (464), Port of Longview Berth 1, 5, 6 and 7 (678), EGT LLC (2672), Weyerhaeuser Longview Export Yard (2958) | | |

**Pilot (2 terminals)**: United Grain Vancouver (ADP 12-3005, final 2012-03-13; 25 permits and letters listed back to 1971) and EGT
Longview (ADP 23-3607, issued 2023-11-20; 8 permits back to 2007), each with a cited dock quote. **The rest** (~10 more Columbia River
terminals) takes 1 POST per plant + 1–2 PDFs (newest ADP, OCR when scanned) ≈ 25–35 requests, then hand-checking holder and address,
and the facility entries for those terminals.

### What was built (dev)

- 39 terminal × agency entries: PSCAA 31 (17 existing facilities + 14 port terminals), ORCAA 6, SWCAA 2. Each stores what was searched,
  when and the result; "none found" words are shown on the terminal's Permits tab with the searched sources linked.
- Permits (system PSCAA / ORCAA / SWCAA, statute "WA air"; number + holder checked in the agency's own text): PSCAA 11265 + 11917
  (SeaPort Sound), 11386 / 11386A / 12449 (Puget LNG), 11986 (Schnitzer / General Metals), 12003 (Ash Grove); ORCAA 24NOC1693 + 3
  registrations (Grays Harbor T1: BWC Terminals, REG Grays Harbor), AGP registration (T2), 23NOC1627 (AGP, T4), Port of Olympia and
  Port of Port Angeles registrations; SWCAA 12-3005, 23-3607. Documents added to EPA-listed permits: Ash Grove AOP 11339 modification
  + draft renewal.
- "Covers this dock" quotes: 11265 (marine loading of natural gasoline), 11386A + 12449 (TOTE marine vessel LNG fueling), 11386
  worksheet → TOTE terminal (LNG bunkering of ships at the TOTE terminal), US Oil AOP 12593 (marine tank loading), 24NOC1693 (marine
  vessel MDI compartment washing), 23NOC1627 (AGP Terminal 4), 12-3005 (receiving grain from barge), 23-3607 (east ship loader).
- Enforcement: ECHO "Local" actions are now named by agency (WAPSC → PSCAA, WANCA → NWCAA) and formal actions show the agency's case /
  penalty number with a link to ECHO's case report.
- Permits of terminals whose facility entry doesn't exist yet (ORCAA ports, SWCAA) are stored once the facility exists (re-run the
  import; the import reports them meanwhile).

## 6. SEPA review per permit (dev, 2026-10-07)

Lovel: "I'm interested to see the SEPA reviews that should be associated with each permit." Facility-level SEPA links (§2,
`sepaMatch`) stay; migration 031 adds `permit_sepa`, code `lib/ships/permitSepa.js` (rules, pure) + `lib/ships/permitSepaDb.js`,
run by `npm run ships:import-facilities` after the documents. Which permits get an answer: NPDES permits and coverages, state
(PARIS) permits, ICIS-Air records, and RCRA ids that Ecology lists a permit document for (corrective action / dangerous waste
permits). Reporting ids (GHGRP, TRI, RMP, ...) get none.

**What was studied first.** (1) SEPA Register record pages: lead agency, the lead agency's file number, document type, dates,
proposal name, description, a "Related" field (another SEPA number) and the attached documents' names. NWCAA records name the air
approval they reviewed in the proposal or document names ("OAC 660b", "OAC 1261 - Tesoro Refining - Tank 113 Roof Mod - SEPA
DNS.pdf"); Ecology hazardous-waste records name the permit number ("Draft Corrective Action Permit WAD069548154") or the agreed
order ("Agreed Order No. DE 16299"); county records name the project ("bp Cherry Point Advance Mitigation Project 5").
(2) PARIS fact sheets: each Ecology NPDES / state permit fact sheet has a section "State Environmental Policy Act (SEPA)
compliance". For renewals it quotes the exemption: "State law exempts the issuance, reissuance or modification of any wastewater
discharge permit from the SEPA process as long as … (RCW 43.21C.0383). The exemption applies only to existing discharges, not to
new discharges." (BP WA0022900 2022 fact sheet p. 18; Marathon WA0000761 2024 fact sheet p. 23). Ecology's hazardous-waste
support documents have a "State Environmental Policy Act" section describing the DNS for the agreed order's interim actions.
(3) NWCAA Air Operating Permits list the approvals (OACs, Regulatory Orders) they incorporate, some with their SEPA MDNS
conditions (BP AOP 015R2 terms 5.6.21–23, "OAC 1064b … SEPA MDNS (3/8/2022)").
(4) The SEPA Register "All text" search finds a permit number written anywhere on a record (verified: WAD069548154 → 202002476).

**Rules (explicit; a weaker match is kept as a candidate and not shown; never a guess):**
- `names_permit` — the SEPA record (proposal, description, file number or document names) names the permit number.
- `doc_cites_review` — a SEPA passage of the permit's own fact sheet / support document names an identifier the SEPA record
  carries (SEPA number, the lead agency's file number, an agreed-order number), AND the record's lead agency is the agency that
  issues the permit. (BP's 2022 NPDES fact sheet names Whatcom County's DNS SEP2021-00086 while answering a comment about another
  project; the lead-agency condition keeps that out.)
- `approval_in_permit` — air: a SEPA record led by the air agency that issues the permit names an approval (OAC n / RO n) and the
  permit's Air Operating Permit lists that approval (page cited). The Statement of Basis is not used: it also lists approvals that
  are not part of the permit ("OAC 765 is not included in the AOP").
- `same_project` — the permit's name without the company / site words (≥ 3 words, at least one of the project's own, numbers
  kept: "advance mitigation project 5" ≠ "… 4") appears as one phrase in the proposal name of a SEPA record already matched to the
  facility (the description only when the record has no proposal name: later addenda's descriptions name the project they rely on).
- `register_related` — one hop through the Register's own "Related" field, only from a record linked by an identifier above.
- Statements: the SEPA section of the permit's fact sheet (newest final PARIS fact sheet: highest permit version, not a draft /
  addendum / supplement / public-notice version; else every Ecology "support document") is quoted verbatim with its page and classed
  exempt / relies on an earlier review / describes a determination.
- `none_found` — no review and no exemption / determination statement: the answer lists every Register search (the facility's
  applicant / place searches and the "All text" search for the permit number), the number of records checked, and the document read
  (or that no fact sheet is listed, e.g. stormwater general-permit coverages). Absence is never shown as "no SEPA review happened".
- Candidates (`same_lead_agency`): records matched to the facility and led by the permit's issuer with nothing tying them to the
  permit. Stored, not shown.

**Evidence stored.** Each permit document read is a `document_sepa_text` source record (under the document's own source): URL,
SHA-256, bytes, page count, the SEPA passages verbatim with page numbers and, for an air permit, the approvals it lists with the
first page. The file itself is not kept. Permit-number search hits are stored as `sepa_record` like the facility's.

**Fetching.** `scripts/ships/doc-fetch.mjs` (one at a time, ≥ 1.5 s, EarthAtlas User-Agent, cached as text in the gitignored
cache; the PDF is deleted after pdftotext). One document per permit (every support document for a hazardous-waste id: Phillips 66 Ferndale has two, the dangerous waste permit and the corrective action permit); one Register search per searched permit number.

## 7. The 33 cargo / cruise / Columbia River terminals (dev pilot, 2026-10-07)

Pattern as in "WA rollout": `propose-facility.mjs` (ECHO within 0.75 mi of each berth) → hand check (same company + the
terminal's address or a point at the dock; a port authority's own permits count for port-run terminals; neighbours and
same-name-only records left out with the reason) → entry in `salish-facilities.json` (migration 032 adds the kinds
container / cruise / ro-ro / general cargo terminal) → import. Each facility records its air agency (`air_agency`); a terminal
with nothing found gets a `no_facility` note (what was searched, what was left out, the air agency), shown on its Permits tab.

Air agency by county: King, Pierce, Snohomish → PSCAA; Whatcom → NWCAA; Clallam, Thurston, Grays Harbor → ORCAA;
Clark, Cowlitz → SWCAA. ORCAA / SWCAA documents are not fetched here.

Pilot (2 terminals): Husky Terminal → facility `wa-husky-terminal-tacoma` (FRS 110035431912, industrial stormwater WAR004486,
+ 2 project FRS ids at 1101 Port of Tacoma Rd); Grays Harbor Terminal 2 → `wa-pogh-terminal-2` (FRS 110055010009, WAR303317,
+ AGP Grain Terminal Expansion). Measured requests: Husky 48 (ECHO 6, DFR 3, SEPA searches 2 + 29 record pages, PARIS 4,
permit-number searches 4), Terminal 2 14 (+ 1 Register test search). **SEPA Register searches are OR-of-words**: a two-word
Proposal search such as "Pier 4" returns unrelated records statewide (23 Pierce County candidates for Husky, each a record-page
request). Use one distinctive word per search. A Register search takes ~20 s to answer.
Projected for the other 31 terminals at the measured rate: ~430–950 requests, over the 400 budget, so the rollout stopped after
the pilot (Josh decides).
