# IMO GISIS: what's available and what EarthAtlas can use

Study date: **2026-09-27**. Signed in as Josh's approved GISIS public account ("Public User / earthatlas").
This was a read-only study: searches and page views only, plus one small export sample (a 75-row casualty CSV). Nothing was imported and nothing was sent to IMO.
Base URL: `https://gisis.imo.org/Public/`. Every fact below was observed on 2026-09-27 unless it is marked **UNVERIFIED**.

---

## 0. Bottom line

- **Terms are the blocker, not the technology.** The IMO Web Accounts policy that covers all `imo.org` services says the services are for personal, non-commercial use. It says you may not "copy, distribute, transmit, display … reproduce, publish" information obtained from them, and it prohibits "unauthorized use of automated software to retrieve, display, copy, store or otherwise use data" (§3). See §2.
- The IMO *website* terms are looser. They allow non-commercial reuse with attribution. That does not override the stricter clause above for GISIS data, and **ship/company particulars are further licensed from S&P Global.**
- **Bulk downloads that do exist** (official buttons):
  - Maritime Security (ISPS): CSV downloads of all declared/approved port facilities, their contacts, and security agreements.
  - MARPOL Annex VI Reg. 4.2 "Download all data": 7,414 scrubber/equivalent notifications, per ship by IMO number.
  - Marine casualties: CSV of any search result.
  - PRF alleged inadequacies: "Download all data".
  - PAR piracy: "Download report" of any search.
  - EEDI: an anonymized xlsx.
- **No API or web service was found** for any public module (UNVERIFIED that none exists; none is linked).
- **Scrubbers (Josh's question): yes, per ship, with IMO number.** Coverage depends on the flag state notifying. For example, Carnival Vista has no entry. See §5.
- **Recommended path (PROPOSED):** email IMO (info@imo.org or the GISIS feedback page, Josh to send) and ask for written permission to show ISPS port-facility, casualty and Reg. 4.2 data on EarthAtlas, a non-commercial conservation site, with attribution. Until then, use GISIS only as a manual cross-check, not as a displayed source.

---

## 1. Module catalogue (29 modules on the public home, 2026-09-27)

Source: https://gisis.imo.org/Public/

These modules were studied in depth: Ship and Company Particulars, Maritime Security, Contact Points, Recognized Organizations, Marine Casualties and Incidents, Port Reception Facilities, Judicial Sale of Ships, Pollution Prevention Equipment and Anti-fouling Systems, Status of Treaties, Piracy and Armed Robbery, Facilitation of International Maritime Traffic, and MARPOL Annex VI.

These modules are listed on the home page but were not opened (descriptions are from the home page only): Non-mandatory Instruments, Simulators, Global SAR Plan, Condition Assessment Scheme, Cargoes, GMDSS, National Maritime Legislation, STCW-related information, Test Laboratories and Halon Facilities, Crew Change and Repatriation of Seafarers, Maritime Single Window, Evaluation of Hooks, Survey and Certification, Member State Audits, Ballast Water Chemicals, Ballast Water Management (exemptions granted to ships, BWE areas), and the Inter-agency migrant smuggling platform.

### 1.1 Ship and Company Particulars (`SHIPS/`)

**Ownership and licence.** Every page carries this footer: "Information on ship and company particulars is made available under the terms of the Shipping Information Agreement between S&P Global and the IMO Secretariat. Please contact S&P Global Market Intelligence for queries relating to ship and company particulars." The data is S&P's (formerly IHS Maritime).

**Search options**
- Basic search: IMO no., name (with "search former name" and "exact name" options), flag, call sign, MMSI. Flags: False Flag, Ship under UN sanction, Owning/operating entity under UN sanction.
- Company search: IMO Company Number or name.
- Advanced search (`ShipSearch.aspx`): AND/OR criteria on IMO no., name, former names, flag, call sign, MMSI, ship type (11 general / 310 detailed), GT, year of build, Registered Owner IMO Company No., and status (23 values, e.g. Broken Up, In Casualty Or Repairing).

**Limits**
- Basic search stops at 30 hits: "(More than 30 ships found... try Advanced search.)"
- Advanced search pages 15 rows at a time.
- No export or download control on any SHIPS page.
- The maximum result count for advanced search was not tested (UNVERIFIED).

**Ship detail** (`ShipDetails.aspx?IMONumber=…`). The page shows "Updated: 2026-09-27". Fields: name (with effective-dated history), IMO, flag (with effective-dated history), call sign, MMSI, UN-sanction flags, type (with history), date of build, GT, and **Registered owner only** (name, IMO Company No., nationality of registration, address, status, effective date).
- No DOC company, operator, manager or beneficial owner is shown on the ship page.
- The **company** page does give counts: "Ships as owner / operator / manager / group beneficial owner".

Examples:
- IMO 9814155 HIGH LEADER: Chemical/Products Tanker, built 2018-06, GT 29,447, call sign 5LVT9, MMSI 636025095. Flag Liberia (effective 2025-04), previously Panama (effective 2018-06). Registered owner d'Amico Tankers DAC (5103459), Dublin, effective 2025-04-01.
- IMO 7808138 CATHLAMET: Passenger/Ro-Ro (Vehicles), built 1981-06, GT 2,477, call sign WYR7641, MMSI 366773070, flag US (effective 1981-06). Registered owner WASHINGTON STATE TRANSPORT (0414246).
  - Company page (`CompanyDetails.aspx?IMOCompanyNumber=0414246`): full name "State of Washington (Department of Transportation)"; ships as owner 22, operator 3, manager 3.
  - An advanced search on owner 0414246 returned 27 ships, including historic ones such as HYAK and KLAHOWYA.

**Definitions page note:** "IMO Number … issued by IHS Maritime on behalf of the IMO under IMO Resolution A.600(15)."

### 1.2 Maritime Security / ISPS (`ISPS/`)

**Tabs:** Organizational Contacts, Port Facilities, Security Arrangements, Download.

**Quick search** by port or facility name, port UN/LOCODE, or IMO Port Facility Number.
- Partial matches work: "Westridge" gives CAVAN-0022.
- "Anacortes" and "USANA" return nothing.

**Download page** (`ISPS/Download.aspx`): "Data from the Maritime Security module may be downloaded in bulk in the formats listed below … continuously updated … CSV format with UTF-8 encoding."
- Files: Organizational contacts; **Declared port facilities**; Declared port facility contacts; **Approved port facilities**; Approved port facility contacts; Alternative security agreements; Equivalent security arrangements for ships; Equivalent security arrangements for port facilities.
- These are whole-database files, so they were **not downloaded**. No size is shown.

**Facility detail** (`ViewFacility.aspx?ID=…`) fields:
- Port (name + UN/LOCODE)
- Facility name
- **IMO Port Facility Number** (LOCODE-NNNN)
- Alternative names
- Description (e.g. Bulk/Other, CDC)
- **Latitude/Longitude** (degrees and decimal minutes)
- PFSP approved? Approval date; latest review date; latest Statement of Compliance; withdrawn?; alternative/equivalent arrangements
- **Named security contact with phone and email** (personal data; do not republish)
- A "Save as PDF" control

Examples:
- **Canada** has 142 ports with facilities. Vancouver (CAVAN) has 17 facilities, including:
  - **Westridge Marine Terminal CAVAN-0022**: 49° 17.26' N, 122° 57.00' W; "CDC"; PFSP 2004-06-30; reviewed 2025-10-27; SoC 2025-11-03; updated 2025-11-04.
  - PARKLAND BURNABY REFINERY CAVAN-0021
  - Cascadia, Pacific, G3, Fraser Grain, Alliance Grain, Canada Place and Ballantyne cruise terminals, DP World, GCT Vanterm, South Fraser Marine Terminal
- Burnaby (CABUB): Shellburn Terminal – Shell Canada CABUB-0004, and Suncor Burrard Products Terminal CABUB-0003 (49° 17.22' N, 122° 53.50' W; updated 2025-02-21).
- Other BC ports listed include Nanaimo, Victoria, Esquimalt, North Vancouver, Port Moody/Vancouver, Prince Rupert and Delta.
- **United States** has 51 ports, and the US declares **Captain-of-the-Port areas, not terminals.**
  - Seattle (USSEA) has a single facility, "**Puget Sound Port Area**" USSEA-0001 (47° 35' N, 122° 20' W; updated 2024-01-19).
  - Its "alternative names" field lists Aberdeen, Anacortes (USOTS), Bellingham, Everett, Ferndale, Grays Harbor, March Point, Olympia, Port Angeles, Port Gamble, Port Townsend, Seattle and Tacoma.
  - So **Cherry Point, Anacortes refineries, etc. are NOT individual GISIS facilities.** For US terminals GISIS is useless; Canada is terminal-level.

### 1.3 Contact Points (`CP/`)

Contact lists grouped by function (BWM exemptions, insurance certificates, STCW certificate verification, CSC container orgs, continuous synopsis records, FAL, GMDSS, IMDG, LC/LP, MAS, crew change, wreck removal, PSC/casualty investigation, ship registries, solid bulk) and by country. These are government and organization contacts. Export was not checked (UNVERIFIED). Of little use to /ships beyond finding the right national authority.

### 1.4 Recognized Organizations (`RO/`)

Browse by flag Administration or by RO: which classification societies each flag authorizes (MSC/Circ.1010). Export was not checked (UNVERIFIED). Possible minor use: explaining "class society" on a ship card.

### 1.5 Marine Casualties and Incidents (`MCIR/`)

**Two parts:**
- Search Occurrences (`Search.aspx`)
- Marine Safety Investigation Reports dashboard: "4658 available for download"; "4070 occurrences with investigation reports", newest first, with PDF reports per reporting State.

The data combines "factual data collected from various sources" with State-submitted investigation reports. From the module page: "The accuracy of the data … cannot be guaranteed."

**Search fields:** ship name, IMO, flag, coastal administration, date range, severity (very serious / casualty / incident), investigation-report state, reference number. Additional fields: ship type, SOLAS ship, consequences (people, ship, environment: oil cargo/bunker, chemicals, packaged DG), casualty event, summary text, location, place name, safety-recommendation focus/acceptance, actions taken, investigation status. It also offers "Show results on map". Results show 10 per page.

**Export:** a Download icon produces a CSV of the current result set. Sample: coastal admin = Canada gave 75 rows, file `GISIS-MCIR-20260928-045312.csv` (15 KB), which is still in `~/Downloads`.
- CSV columns: Reference, Number of ships involved, Ships involved (name + IMO), SOLAS status, Flag Administrations, Ship types, Occurrence date and time, Casualty event, Casualty severity, **Coordinates** (deg-min text, sometimes blank), Place, Location, Number of investigation reports, Administrations submitting investigation reports.

**Coverage is thin and stale for our area:**
- Canada: 75 occurrences, newest 2019-09-23.
- United States: 179 occurrences, newest 2021-04-13 (SEACOR POWER).
- Salish/BC examples:
  - C0011088 MAGELLAN (IMO 5217062), 2016-12-12, very serious, 49° 12' N 123° 03' W, "Fraser River off Victoria-Fraserview, Vancouver, BC".
  - C0010448 NATHAN E. STEWART (IMO 8968210), 2016-10-13, very serious, Bella Bella BC (no coordinates).
- Compared with what /ships already has (USCG CGMIX IIR/PSIX, WA Ecology, `lib/ships/incidents*.js`), GISIS adds only rare, very-serious, investigated cases. Its value is the IMO number and the link to State investigation reports, not volume.

### 1.6 Port Reception Facilities (`PRF/`)

**Tabs:** Browse by port/terminal, Search (simple + advanced), Alleged Inadequacies, Contact Points.
- Browse by LOCODE: `ViewFacilities.aspx?LOCODE=CAVAN&wasteid=0`.
- Canada has 137 ports/terminals. Salish examples: Burnaby, Delta, Nanaimo, North Vancouver, Port Moody/Vancouver, Vancouver, Victoria, West Vancouver.

**Per-facility fields** (Vancouver shows "Facility 1 of 28", updated 2022-04-25):
- Waste type (MARPOL I/II/IV/V/VI categories, BWM ballast/sediments)
- Service provider name, address, phone, email, web
- Facility type (fixed / tanker-barge / truck)
- Min/max quantity, discharge rate
- Availability, notice hours, charging system, notes
- Example: Tymac Launch Service Ltd., oily bilge water, 10–129 m³, 24/7, 96 h notice.

**Coordinates:** none.

**Export:** none on facility pages. **Alleged Inadequacies** (628 reports, 63 pages) has "**Download all data**", which was not run.

### 1.7 Judicial Sale of Ships (`JSS/`)

Beijing Convention repository, in force 17 Feb 2026. Tabs: Status, Notifications, Certificates, Avoid and Suspension, each by State. It holds notices and certificates of judicial sales of ships. Nothing is exported. Contents per State were not opened (UNVERIFIED). This could explain ownership changes after an arrest or sale, but it is niche.

### 1.8 Pollution Prevention Equipment and Anti-fouling Systems (`PPE/`)

Tabs: Manufacturers, Equipment, Approvals, Anti-fouling Systems. The Approvals tab covers **type approvals of equipment models** (15 ppm separators and alarms, OCMs, sewage plants, incinerators, BWMS). **These are not per ship, and there is no EGCS/scrubber category.** Export was not checked (UNVERIFIED).

### 1.9 Status of Treaties (`ST/`)

List of treaties with entry-into-force date, contracting-State count and % of world tonnage (e.g. AFS 2001: 2008-09-17; BWM 2004: 2017-09-08). Also a Ratification tab by State. Export was not checked (UNVERIFIED). This is also published by IMO as a PDF elsewhere (UNVERIFIED).

### 1.10 Piracy and Armed Robbery (`PAR/`)

**Tabs:** Search Incidents, Coastal Reports, Download Reports.
- The home page shows recent incidents (4 pages), e.g. "Columbia River", Hong Kong flag, 2026-07-07, Malacca Strait.

**Search:** an AND/OR builder with 19 fields: ship name, IMO, flag, date, coastal State, area, location, general position, parts raided, ship status, weapons, attackers, crew consequences, lives lost, wounded, missing, hostage, assaulted, ransom.

**Reports** (after a search): "Full list of incidents", "Regional analysis", "View on map".
- A one-row sample did not produce a file in the automation session (format **UNVERIFIED**; it probably opens in a popup).

No Salish-area relevance. It is global and mostly Asia, Indian Ocean and West Africa.

### 1.11 Facilitation of International Maritime Traffic (`FAL/`)

Stowaway incident statistics, e-addresses of government authorities, FAL Article VIII notifications (national differences), NMFC information, and national authorities. Not relevant to /ships.

### 1.12 MARPOL Annex VI (`MARPOL6/`)

Notification lists under Regs 4.2, 11.4, 13.2.2, 13.7.1, 15.2 (VOC-regulated ports/terminals), 17.2/17.3 (reception facilities), 18.1, 18.2.5 (non-availability of compliant fuel), 18.9.6 (supplier failures) and 19.6, plus specimens, **EEDI database info** and **EGCS discharge water provisions**. See §5 for scrubbers.
- **EEDI:** anonymized and rounded xlsx ("EEDI_database … GISIS.xlsx", last updated 2 Dec 2025). No ship identity.
- **EGCS discharge provisions** (`EGCSDischarge.aspx`), one line per State:
  - Chile: all discharges prohibited in territorial waters.
  - Germany: prohibited in inland waterways and ports.
  - Denmark, Finland, Sweden: open-loop prohibited from 1 Jul 2025; all EGCS discharges from 2029.
  - Panama: prohibited in territorial sea.
  - Singapore: open loop prohibited in port since 2020.
  - **Canada and the US are not listed** as of 2026-09-27.

---

## 2. Terms of use (quoted)

**GISIS Disclaimer** (https://gisis.imo.org/Public/Shared/Public/Disclaimer.aspx, 2026-09-27):
- (1) GISIS exists "to allow on-line access to information supplied to the IMO Secretariat by Maritime Administrations"; the databases are "maintained updated by the National Maritime Administrations".
- (3–5) No liability for accuracy or timeliness; "Decisions based on information contained in this site are the sole responsibility of the user."
- (6) Report errors to info@imo.org.
- The disclaimer has **no reproduction clause.**

**IMO Web Accounts policy**, which applies to "all IMO sites within 'imo.org' domain name" (https://webaccounts.imo.org/Common/PrivacyPolicy.aspx, linked from the GISIS footer, 2026-09-27), §3 "Personal and Non-Commercial Use Limitation":
> "Unless otherwise specified and authorized by the IMO, the Services we provide are for your personal and non-commercial use. You may not modify, copy, distribute, transmit, display, perform, reproduce, publish, license, create derivative works from, transfer, or sell any information, software, products or services obtained from the Services. Specifically, this includes a prohibition on the unauthorized use of automated software to retrieve, display, copy, store or otherwise use data obtained from our Services."

The same section also says: "You may not obtain or attempt to obtain any materials or information through any means not intentionally made available through the Services." §11: use "implies acknowledgement and acceptance".

**IMO website terms** (https://www.imo.org/en/about/pages/imo-website-terms-and-conditions-of-use.aspx, fetched 2026-09-27): IMO "grants permission to Users … to copy, reproduce, distribute, translate, and adapt the information, documents and materials … subject to the full attribution to IMO as the source and copyright holder", for "personal, non-commercial purposes"; "Reuse of the Materials for commercial purposes is expressly prohibited."

**S&P Global** holds the ship and company particulars under a private agreement with IMO. No reuse right is offered; users are told to contact S&P.

**How to read these terms (interpretation, not legal advice):**
- Official download buttons are "intentionally made available", so downloading a file for your own analysis looks fine.
- *Publishing or displaying* GISIS data on EarthAtlas falls under "distribute … display … publish". That needs IMO authorization under the Web Accounts policy, even though EarthAtlas is non-commercial.
- The website terms point the other way (non-commercial reuse with attribution is allowed), so the two texts conflict. Ask IMO which one governs.
- Scraping pages that have no download button, especially SHIPS, is explicitly prohibited.
- Rate limits: none are stated. The ban on overburdening servers applies.

---

## 3. What would help /ships

| Need | GISIS has | Notes |
|---|---|---|
| Ship identity (IMO, name/flag history, owner) | Yes, per ship (S&P data) | Registered owner only. No DOC company, operator or manager on the ship page. No export. Scraping prohibited. **Manual verification only.** |
| Official port-facility list (terminals / official ports work) | **Yes for Canada**: official facility name + IMO facility no. (LOCODE-based) + lat/lon, bulk CSV | **US gives only COTP port areas** (one "Puget Sound Port Area"), so it cannot identify Cherry Point or Anacortes terminals. Contacts are personal data. |
| Incidents tab | Casualty CSV per search, with IMO numbers and some coordinates | Sparse and old for CA/US (newest 2019 and 2021). Adds investigation-report PDFs. |
| Port reception facilities | Per LOCODE: waste types and providers | No coordinates, no export (except alleged inadequacies). Low value. |
| Scrubbers | **Per ship, IMO no., maker/model, date**; bulk "Download all data" | See §5. |
| Piracy | Global incident search and report | Not relevant to the Salish Sea. |

---

## 4. Comparison table

| Module | What | Bulk / export? | Limits | Terms |
|---|---|---|---|---|
| Ship & Company Particulars | Ship identity, name/flag/type history, registered owner, company fleet counts | None | Basic 30 hits; advanced 15 per page | S&P Global agreement + IMO §3 (no publishing or automated retrieval) |
| Maritime Security (ISPS) | Port facilities: name, IMO facility no., LOCODE, lat/lon, PFSP dates, contacts | **CSV bulk** (8 files) + per-facility PDF | Size not shown; "continuously updated" | IMO §3; contacts are personal data |
| Contact Points | Authority contacts by function or country | UNVERIFIED | – | IMO §3 |
| Recognized Organizations | Class societies authorized per flag | UNVERIFIED | – | IMO §3 |
| Marine Casualties | Occurrences (IMO no., date, severity, coordinates, place) + investigation PDFs | **CSV of any search** | 10 per page on screen; CA 75, US 179 records | IMO §3; accuracy "cannot be guaranteed" |
| Port Reception Facilities | Waste reception providers per port | Only Alleged Inadequacies "Download all data" (628) | – | IMO §3 |
| Judicial Sale of Ships | Notices and certificates of judicial sales | None seen | New (2026) | IMO §3 |
| PPE & AFS | Type-approved equipment models (no scrubbers), AFS | UNVERIFIED | – | IMO §3 |
| Status of Treaties | Ratifications, % tonnage | UNVERIFIED | – | IMO §3 |
| Piracy & Armed Robbery | Global incidents, 19 search fields | "Download report" (format UNVERIFIED) + map | – | IMO §3 |
| FAL | Stowaways, e-addresses, FAL notifications | None seen | – | IMO §3 |
| MARPOL Annex VI Reg 4.2 | **Scrubber / equivalent notifications per ship (IMO no.)** | **"Download all data"** | 7,414 rows (742 pages) | IMO §3 |
| MARPOL VI EGCS discharge | National washwater rules | None seen | 7 States | IMO §3 |
| MARPOL VI EEDI | Anonymized EEDI xlsx | xlsx | No ship identity | IMO §3 |

---

## 5. Scrubbers (EGCS): MARPOL Annex VI Regulation 4.2 notifications

Page: https://gisis.imo.org/Public/MARPOL6/Notifications.aspx?Reg=4.2 ("Equivalent compliance method"), 2026-09-27.

**Per ship?** Yes. Each row has Notifying Party (flag), Type of equivalent (Fitting / Apparatus / Appliance / "Alternative Technology (EGCS)" / "vessel under construction…"), **IMO Number**, Manufacturer, Type or model number, **Submitted date**, and sometimes a certificate PDF (IAPP / approval letters) and additional info. **The row has no ship name**; join on IMO.

**Filters:**
- By flag, with the URL parameter `&CID=<ISO3>` (e.g. `CID=LBR`).
- By IMO number.
- 10 rows per page.

**Scrubber type (open / closed / hybrid):** **not a separate field.** It appears only when the notifying flag wrote it into the free-text maker/model, for example:
- "PureSox ECA Open Loop U-type system"
- "EGCS (wet, open loop scrubber system)"
- "Inline Hybrid Loop Scrubber System"
- "Lang Tech Hybrid Scrubber"

Other rows give only a model code (e.g. "Wartsila Moss AS, WM455-HS") and need a lookup table.

**Dates:** the submission date only. There is no install, removal or withdrawal date, and some ships have duplicate rows.

**Coverage:** 7,414 rows total. Per flag:

| Flag | Rows |
|---|---|
| Liberia | 1,605 |
| Marshall Islands | 1,132 |
| Panama | 1,121 |
| Singapore | 742 |
| Hong Kong | 568 |
| Malta | 454 |
| Cyprus | 206 |
| Bahamas | 218 |
| Greece | 156 |
| Denmark | 134 |
| Italy | 128 |
| Netherlands | 118 |
| Japan | 114 |
| UK | 103 |
| Norway | 69 |
| Germany | 18 |
| Canada | 12 |
| China | 0 |

The US and Bermuda counts did not resolve with the codes tried (UNVERIFIED). This covers only what flags notified, so **absence does not mean no scrubber.**

**Tests with cruise ships** (names confirmed via SHIPS):

| Ship | IMO | Result |
|---|---|---|
| OVATION OF THE SEAS | 9697753 | Bahamas, Apparatus, Wartsila Moss WM455-HS, submitted 2016-05-04 |
| NORWEGIAN BLISS | 9751509 | Bahamas, Apparatus, Lang Tech Hybrid Scrubber, 2018-04-20 |
| MAJESTIC PRINCESS | 9614141 | UK (Bermuda-flagged ship), "Alternative Technology (EGCS)", "MED 2008421 to be fitted to DG3 and DG4", 2019-09-24 |
| CARNIVAL VISTA | 9692569 | Panama: **no notification found** |

All four are Passenger/Cruise ships.

**Export:** a "Download all data" button covers the whole Reg. 4.2 list. It was not run, per the no-bulk rule. Format UNVERIFIED (other GISIS downloads are CSV).

**Terms:** IMO §3 as above. Publishing needs IMO authorization.

**Comparison:** https://www.mepalliance.org/list-of-scrubber-fitted-ships is an advocacy list with names and owners only, no IMO numbers and no reuse terms (per coordinator; not checked here). GISIS is the authoritative, IMO-keyed source, but it is incomplete and gives loop type only as free text.

---

## 6. PROPOSED uses for /ships (awaiting Josh)

1. **Ask IMO for permission first** (Josh sends; nothing sent by Claude). Request written authorization to display, with attribution and non-commercially:
   - ISPS port-facility list (names, IMO facility numbers, coordinates, no contacts)
   - Reg. 4.2 scrubber notifications
   - Casualty occurrences

   Ask whether periodic use of the official CSV download buttons is acceptable.
2. **If approved:**
   - **ISPS facilities (Canada) → official terminal names and IDs** for the terminals work: match `lib/ships/terminals.js` candidates by LOCODE plus distance. The US needs other sources (the US gives only COTP areas).
   - **Reg. 4.2 → "Scrubber notified to IMO"** on the ship card: model text, flag, submitted date, and a derived loop type only where the text says "open", "closed" or "hybrid". Always caveat "absence ≠ none".
   - **Casualties → Incidents tab**: an extra source keyed by IMO, linking the GISIS reference and the State investigation report.
3. **Without approval:** use GISIS only as a manual cross-check (e.g. confirming IMO numbers or owner history while debugging). Store and show nothing from it. Do not script against SHIPS under any circumstances.

## 7. Open questions

- Which text governs GISIS data reuse: the Web Accounts §3 ban or the website's non-commercial-with-attribution grant? (Ask IMO.)
- Sizes and exact columns of the ISPS CSVs and the Reg. 4.2 "Download all data" file. They were not downloaded; do it once, if Josh approves, for analysis only.
- Is there any undocumented API or web service for GISIS public data? None was found.
- PAR "Download report" format.
- Why do the US and Bermuda flag filters on Reg. 4.2 not resolve with USA/BMU? (Different code, or a different page state.)
- The casualty CSV sample (`~/Downloads/GISIS-MCIR-20260928-045312.csv`, 75 rows, Canada) is still on disk. Keep it or delete it as Josh prefers.

---

## Built (dev), 2026-09-27/28

**Josh's decision (2026-09-27), verbatim:** "For our purposes now, assume IMO has given us permission. I don't care about casualty data. Scrubber and facility info is a go."
Used on Josh's instruction assuming IMO permission; written permission not yet obtained; the IMO Web Accounts policy otherwise forbids republishing. The same text is in both `ships.sources` rows (`notes`). No casualty work was done.

Everything below is in the **dev** database only (`earthatlas-ships-dev`). Nothing is in production. Nothing is committed.

### Downloads (once each, official buttons, Josh's GISIS account)

| File (in gitignored `scripts/ships/gisis/raw/`) | What | Size | sha256 | Downloaded |
|---|---|---|---|---|
| `IMO-20260928-05101938.csv` | MARPOL Annex VI Reg. 4.2 "Download all data" | 1,043,926 bytes, 7,414 rows | `d87505031895da3c54f59eefaae388ea886bbf3341e7490b36fda5ae69cb5e21` | 2026-09-28 05:10 UTC (2026-09-27 22:10 PDT) |
| `MaritimeSecurity-CheckOnlineForLatest-20260928-05155984.csv` | ISPS "Declared port facilities", all countries | 3,243,960 bytes, 12,343 rows | `9d0703c73e2cb32c8ebc3c6ebc0db6cfc1da1ec4dad94893b065289acc7f6fab` | 2026-09-28 05:15 UTC |

- The ISPS download page offers only all-country files. The report page has a country dropdown, but choosing a country posts a form, so the all-country file was taken and filtered to Canada + United States on import.
- Not downloaded: the contact files (organizational contacts, facility contacts: named security officers, phones, emails), "Approved port facilities", security agreements, casualties.
- The raw folder has its own `.gitignore` (`*`): the exports are never committed. The import log is kept there too.

### What the exports contain (facts from the files)

- **Reg. 4.2 CSV columns:** Notifying Party, Type of equivalent compliance method, IMO Number (as "IMO 1234567"), Manufacturer, Type or model number, Submitted (YYYY-MM-DD), Has Certificate (Yes on all 7,414), Has Additional Info. **No ship name, no certificate link, no install or removal date.**
  - 6,431 distinct checksum-valid IMOs; 25 IMOs fail the check digit; 42 rows have no 7-digit IMO ("IMO N° OMI", 6-digit numbers, blank).
  - Not every row is a scrubber: the type column includes "Alternative fuel oils" (126 rows), "Thermal Waste Treatment Device", "Stage V acceptance in lieu of Tier III", "Other procedures", and 1,305 "Apparatus" rows whose text never says EGCS or scrubber (e.g. "Wartsila Moss AS, WM455-HS").
  - Some identical rows repeat (kept once).
- **ISPS CSV columns:** Country Code, Country Name, Port Name, Facility Name, IMO Port Facility Number, Description, Longitude, Latitude, Plan Approved?, Initial Approval Date, Review Date, SoC Issue Date, Security Plan Withdrawn?, Withdrawn Date, Last Updated. **No personal contact columns.** Canada 412 rows, United States 53.
  - Coordinates are degrees + **decimal minutes** ("491722N" = 49° 17.22′ N): 2,631 of the 24,564 full-length values have a last pair above 59, and the facility page for Westridge shows the same digits. 53 rows have no coordinates; 8 give whole minutes only.
  - Dates are "DD/MM/YYYY HH:MM:SS" with no zone; stored as calendar dates only.
  - The "Alternative names" field seen on facility pages (e.g. the Puget Sound Port Area's list of Anacortes, Bellingham…) is **not** in the export.

### Files

- `lib/ships/migrations/014_imo_gisis.sql` (additive: two CHECK constraints widened; applied to dev)
- `lib/ships/gisis.js` (sources, pure mapping, import, crosswalk linking)
- `lib/ships/resolve.js` → resolver **v1.6** (`decideGisisImo`; GISIS facility entities are never vessels)
- `lib/ships/terminals.js`: its link-retire step now skips role `imo_port_facility` (those links belong to `gisis.js`)
- `lib/ships/queries.js`: record view shows the IMO number / IMO Port Facility Number to look up, and the terminal(s) a record is linked to
- `lib/ships/data/gisis-terminal-crosswalk.json` (hand crosswalk, reviewed 2026-09-27)
- `scripts/ships/import-gisis.mjs` (`npm run ships:import-gisis -- [scrubbers|facilities|all]`), `scripts/ships/gisis/raw/.gitignore`
- `src/ships/VesselCard.jsx` (Overview line), `src/ships/SourceRecordPage.jsx` (attribute labels, linked terminal)
- Tests: `lib/ships/test/gisis.test.js`, `lib/ships/test/gisis-db.test.js`; fixtures `gisis-reg42-live-2026-09-28.json`, `gisis-isps-facilities-live-2026-09-28.json` (real rows, verbatim)

### Scrubbers (source `imo-gisis-scrubbers`)

- **Evidence:** one source entity per IMO number (`marpol6_reg42_imo`, key "IMO 9751509") whose record holds every row for that IMO exactly as exported; rows without a usable IMO get their own entity (`marpol6_reg42_row`) and are never linked.
- **Claims** (evidence class `registry` = a flag Administration's notification; period `unknown`; the submitted date is in `detail.submitted`, never used as an install date):
  - `scrubber` when the row's own text says EGCS / scrubber / exhaust gas cleaning / open, closed or hybrid loop. Value = manufacturer + model as notified.
  - `equivalent_compliance` for every other row, with the type column in `detail.type_raw`. A maker's name alone never makes a row a scrubber.
  - `detail.loop` = the loop types the row's text states (open / closed / hybrid; "OPEN/CLOSED Loop" states both); otherwise empty with `loop_basis: 'not stated'`.
- **Resolution (v1.6):** attach only when the IMO passes its check digit and exactly one vessel holds it as a registry-class IMO (IMO_EXACT). AIS-only holders, several holders or none → unresolved. A notification never creates a vessel.
- **Ship card (Overview):** "Scrubber: <maker model> · <loop, or 'loop type not stated'> · notified to IMO by <flag>, <date> [IMO]". The IMO link opens `/ships/source/<id>`. Non-EGCS rows show as "Reg. 4.2 equivalent (<type>): …", never as a scrubber. Nothing is shown when a ship has no notification (absence does not mean no scrubber).

**Dev results (import 2026-09-28):**

| | Count |
|---|---|
| Rows / entities / raw records | 7,414 / 6,498 / 6,498 |
| Claims | 7,250 (5,811 `scrubber`, 1,439 `equivalent_compliance`) |
| `scrubber` claims with a stated loop | 4,755 (open 4,104, hybrid 580, closed 11, open+hybrid 29, open+closed 9, all three 22); not stated 1,056 |
| Entities attached to one of our vessels (IMO_EXACT) | **553** |
| Unresolved | no vessel with that IMO 5,840; IMO only AIS-reported 38; check digit fails 25; no IMO 42 |
| Our vessels with a Scrubber line / with any Reg. 4.2 line | 449 / 553 |
| On those vessels: `scrubber` claims, loop stated / not stated | 496 claims: 422 / 74 |
| "Salish-seen" vessels (a stored GFW port visit with a stop inside -125.5,47,-122,50.5): 5,627; of them with any Reg. 4.2 line / a Scrubber line | 52 / 46 |

- Salish-seen ships with a Scrubber line include NORWEGIAN BLISS (Lang Tech hybrid, Bahamas 2018-04-20), NORWEGIAN ENCORE, ANTHEM OF THE SEAS, EMERALD / ISLAND / ROYAL / DISCOVERY PRINCESS, QUEEN ELIZABETH, EURODAM, the three MATSON (ANCHORAGE / KODIAK / TACOMA, US-flag hybrid), MSC and YM container ships.
- **HIGH LEADER (IMO 9814155) has no Reg. 4.2 notification** in the export, so its card shows no line.
- Some ships have two notifications from different flags (e.g. YM TOPMOST: Panama 2021, Singapore 2024); each shows as its own line.

### Port facilities (source `imo-gisis-port-facilities`)

- **Evidence:** 465 facility rows (Canada 412, United States 53), one entity each (`isps_port_facility`, key = IMO Port Facility Number). Only the 15 export columns are kept (an allow-list), so a contact column in a future export is dropped before storing. The current export had none to drop.
- **US rows are Captain-of-the-Port areas** (e.g. USSEA-0001 "Puget Sound Port Area", 47° 35′ N 122° 20′ W). They are stored and not matched to terminals.
- **Terminal links** (role `imo_port_facility`): from the hand crosswalk, written only when the facility and terminal names share a main word AND the GISIS point is within 2 km of one of the terminal's berths, or the crosswalk row explains why GISIS's point is wrong (`position_note`). Distance, agreement and GISIS's status fields go in the link's `detail`. Terminal names were not changed.
  - **28 links on 26 terminals** (G3 and Fraser Grain are each listed twice in GISIS).
  - 23 agree by name and position (0.02–0.96 km), e.g. Westridge CAVAN-0022 0.37 km, Suncor Burrard CABUB-0003 0.59 km, Shellburn CABUB-0004 0.54 km, IOCO CAPMO-0002 0.81 km, Chemtrade CAVAC-0005, Neptune CAVAC-0004, Cargill, Richardson, Pacific Terminal, G3, Fibreco, Westshore CADEL-0002, Fraser Grain, Richmond cement (Amrize) CARBC-0002, Squamish, Harmac, Lantic (Rogers Sugar), Crofton, Port Mellon, Texada.
  - 5 link by name with GISIS's position marked wrong and not used: Parkland Burnaby CAVAN-0021 (GISIS point in Victoria harbour, 100.6 km), Cascadia CAVAN-0004 (5.3 km, Canada Place's longitude), Alliance Grain CAVAN-0016 (2.3 km), Woodfibre CAHWS-0001 (6.3 km; whole minutes; the facility is the project's material offloading facility), Sechelt CAYHS-0002 (51.9 km; GISIS also marks its plan withdrawn 2023-03-30).
  - 4 candidates, not linked (for Josh): Seaspan Energy – Tilbury CADEL-0003 ↔ FortisBC Tilbury LNG (0.51 km; is the Seaspan LNG bunkering berth the same terminal?), South Fraser Marine Terminal CAVAN-0083 ↔ VAFFC (0.22 km, jet-fuel import; names differ), PKM Canada Marine Terminal CAVAC-0010 ↔ Vancouver Wharves (0.37 km; names differ), DP World Nanaimo CANNO-0001 ↔ Duke Point (0.78 km; only the port name is shared).
- **Where it shows:** the terminals API/UI is not built yet. The facility's record page (`/ships/source/<id>`) shows "IMO Port Facility Number CAVAN-0022" and "Terminal in EarthAtlas's list: Westridge Marine Terminal · matched by name and position (0.368 km …)". `listTerminals` returns the links.
- **Not added (proposed for Josh):** GISIS lists ship-serviced industrial facilities that are missing from `salish-terminals.json`:
  - Univar Solutions Canada, North Vancouver CAVAC-0001 ("CDC Facility", 49.29083, -123.023). This is the "Univar North Vancouver" gap noted in docs/OIL_GAS_INFRASTRUCTURE_SOURCES.md.
  - Shell Canada Products – Bare Point Terminal, Chemainus CACHM-0002 (48.92117, -123.70217).
  - Also in scope: West Coast Reduction CAVAN-0080, SSA Marine Lynnterm CAVAC-0031, Island Terminals Nanaimo CANNO-0007, DP World Fraser Surrey CASUY-0001, Myra Falls Mine Discovery Terminal CACAM-0001.
  - Adding them needs a GISIS berth basis in `terminals.js` (every current berth comes from USACE / Ecology / BC Ports and Terminals / OSM) and a hand-checked operator with a source URL (the terminal test requires one). So they were left out, not guessed.

### Tests

- `npm run test:ships`: **311 pass, 0 fail**, including the 13 `gisis.test.js` and 5 `gisis-db.test.js` tests.
- Real rows are recorded as fixtures; SYNTHETIC cases are marked in each test name. The DB test runs in a throwaway `ships_t_*` schema and covers idempotency: a re-import stores 0 new records and 0 new claims.
- Live idempotency: the facilities re-run stored 0 new records. The scrubber import was run once (about 35 minutes over the dev pooler); only the DB test re-ran it.

### Open

- Written IMO permission (Josh).
- The four candidate facility links and the missing-terminal list above.
- The Reg. 4.2 export has no certificate link. The card links our record, which names the IMO number to look up on the GISIS Reg. 4.2 page.
- A maker/model lookup (e.g. "Wartsila Moss … WM455-HS" is a scrubber model) would turn many `equivalent_compliance` rows into scrubbers. That would be EarthAtlas's interpretation, so it is not done without Josh.
