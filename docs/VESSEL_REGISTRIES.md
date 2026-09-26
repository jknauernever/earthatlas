# Official vessel registries (reference for /ships)

Studied 2026-09-25. Facts come from live responses and the publishers' own pages
on that day; anything not checked against a live response or an official page is
marked **UNVERIFIED**. Rules behind the design: `src/ships/CLAUDE.md`.

Why: commercial sites (VesselFinder, MarineTraffic) show far more per ship than we
do, but their data is licensed. For US and Canadian vessels much of it originates
in open government registries, which we may use.

| Source | Status | Code |
|---|---|---|
| USCG NVDC "Merchant Vessels of the United States" (MVUS) | **Skipped: access refused to automated clients** | — |
| USCG PSIX (Port State Information Exchange) | **Imported** (targeted, by our vessels' identifiers) | `lib/ships/psix.js`, `scripts/ships/psixClient.js`, `scripts/ships/import-psix.mjs` |
| FCC ULS ship radio station licences | **Imported** (weekly bulk file, scoped to our MMSIs / call signs) | `lib/ships/fccUls.js`, `scripts/ships/import-fcc.mjs` |
| Transport Canada, Canadian Register of Vessels (large) | **Imported** (bulk export + per-vessel API) | `lib/ships/tcRegistry.js`, `lib/ships/xlsx.js`, `scripts/ships/import-tc.mjs` |
| Transport Canada, Small Commercial Vessel Registry | **Skipped: nothing to match on** (no names, no IMO, no call sign) | — |

Shared: `lib/ships/registry.js` (dates, flags, privacy rule), `lib/ships/ingestRegistry.js`,
resolver `resolveRegistryEntity` / `decideRegistry` in `lib/ships/resolve.js` (v1.4),
migration `lib/ships/migrations/005_registries.sql`, crosswalks in `lib/ships/taxonomy.js`
(`docs/SHIP_CLASSIFICATION.md` §3d–3f). Tests: `lib/ships/test/registries.test.js`
(offline), `lib/ships/test/registries-db.test.js` (throwaway schema).

All three imported sources are stored with evidence class **`registry`**. They are
official registries; where a field is declared by the applicant rather than verified
(FCC particulars), the claim says so in `detail.declared_by_applicant`.

---

## 1. USCG NVDC — Merchant Vessels of the United States (MVUS)

| Item | Fact |
|---|---|
| What | "A data file of merchant and recreational vessels documented under the laws of the United States" (NVDC documented vessels with a valid Certificate of Documentation). Vessel particulars + **managing owner** name and address, official number, tonnage, length, port of documentation (homeport), trade endorsements; since recent editions also hailing port, manufacturer id and hull identification number. (From the USCG ReadMe as quoted by search-engine snippets; the ReadMe itself could not be fetched, so field list **UNVERIFIED**.) |
| Where | `https://www.dco.uscg.mil/.../Merchant-Vessels-of-the-United-States/` (page) and a ReadMe PDF "Revised September 03, 2025". Historically also sold on CD-ROM via NTIS. |
| Cadence / size | Periodic (ReadMe revisions Nov 2024, Sep 2025 seen in search results); size **UNVERIFIED**. |
| Access | **`www.dco.uscg.mil` answers every non-browser request with an Akamai "Access Denied" (HTTP 403)**, including `robots.txt`, the page and the ReadMe PDF (curl with a descriptive User-Agent, and the WebFetch tool). That is an access control: we do not work around it (no browser-UA spoofing). |
| Licence | U.S. Government work (17 U.S.C. § 105) — **UNVERIFIED** for this file (terms page unreachable). |
| Decision | **Skipped.** PSIX (below) carries most of the same vessel particulars from the same Coast Guard systems, minus owner, hailing port and trade endorsements. If Josh wants MVUS, the options are asking NVDC for the file or downloading it by hand in a browser (a person, not a script), then importing the local file. |

## 2. USCG PSIX — Port State Information Exchange

| Item | Fact |
|---|---|
| What | "Vessel specific information derived from the US Coast Guard's Marine Information Safety and Law Enforcement System (MISLE). The information contained in PSIX represents a weekly snapshot of Freedom of Information Act (FOIA) data compiled within the MISLE database." (CGMIX XML page, fetched 2026-09-25.) US and foreign vessels (foreign ones through port-state control). |
| Access | SOAP 1.1/1.2 web service, no key: **`https://cgmix.uscg.mil/xml/PSIXData.asmx`** (WSDL `?WSDL`). Each operation exists as a .NET DataSet and as an `…XMLString` variant (we use the XML strings). Web UI: `https://cgmix.uscg.mil/psix/`. An "XLSX export" (`/XML/PSIXExportSearch.aspx`) exists but is an activity export filtered by Coast Guard district/unit, not a vessel list. |
| Operations | `getVesselSummary(VesselID, VesselName, CallSign, VIN, HIN, Flag, Service, BuildYear)` → VesselId, name, call sign, service type, build year, status, out-of-service date, `Identification` (official number or IMO), HIN, manufacturer hull number, flag. `getVesselParticulars(VesselID)` → + service sub-type, cargo authority, identification **type** ("Official Number (U.S.)", IMO…). `getVesselDimensions` (feet; types "Hull(Overall) Simplified/Formal", "Convention", "Length", "Length Between Perpendiculars", "Design Draft"). `getVesselTonnage` (types Simplified / Convention (Subpart B) / Regulatory…, Displacement, Dead Weight). `getVesselDocuments` (COD, COI, SOLAS/ISM/IAPP certificates… with issue + expiry + status). `getVesselCases(VesselID, MinSearchDate, MaxSearchDate)` → MISLE activities (inspections, port-state exams, operational controls) with zoned start times. `getVesselDeficiencies(ActivityNumber)`, `getOperationControls(ActivityID)`, `getVesselInspectionTypes(ActivityID)` (per activity; **not imported yet**). Service-type vocabulary (from the WSDL documentation): Commercial Fishing Vessel, Fish Processing Vessel, Freight Barge, Freight Ship, Industrial Vessel, Mobile Offshore Drilling Unit, Offshore Supply Vessel, Oil Recovery, Passenger (Inspected / Uninspected), Passenger Barge (Inspected / Uninspected), Public Freight, Public Tankship/Barge, Public Vessel Unclassified, Recreational, Research Vessel, School Ship, Tank Barge, Tank Ship, Towing Vessel, Unclassified, Unknown. |
| Identifiers | PSIX VesselId (MISLE), official number **or** IMO (`Identification` + its type), call sign, HIN, manufacturer hull number. **No MMSI.** |
| Characteristics | year built, service type/sub-type, status (+ out-of-service date), flag, dimensions (L/B/D, draft), tonnage (gross/net, see caveat), certificates with validity, inspection/exam history. **No owner / operator** in the web service (the web UI has a "contact" section; not used). |
| Licence / terms | U.S. Government work, public domain (17 U.S.C. § 105); the data is explicitly the FOIA-releasable part of MISLE. CGMIX pages show the standard U.S. Government information-system consent banner ("provided for USG-authorized use only … routinely monitored"); the XML service itself is published for public use. **Josh: flagging the banner wording; we consider the published public web service fine to use.** Attribution we show: "U.S. Coast Guard PSIX". |
| robots / limits | `https://cgmix.uscg.mil/robots.txt` redirects to a validation-error page (no robots file). No published rate limit. We send a descriptive User-Agent and **one request at a time, ≥ 400 ms apart**. |
| Quirks (verified on live data) | Dates: `IssueDtTm1` is zoned ISO, `IssueDtTm`/`ExpiredDtTm` are "Month D,YYYY" (no zone: stored at UTC day precision, expiry valid through that day). Blank values are "N/A". Tonnage rows come in pairs labelled `"Long Ton"` / `"Short Ton"`; these are measurement tonnages, and the labels **appear** to mean gross / net (EURODAM: "Long Ton" 86,273 = its published GT; "Short Ton" 53,711) → mapped that way, **UNVERIFIED**. A draft arrives in the `LengthInFeet` column. Many superseded certificates stay listed with status EXPIRED / DEACTIVATED. An empty result is an empty SOAP element (`<…Response />`). |

## 3. FCC ULS — ship radio station licences

| Item | Fact |
|---|---|
| What | Every FCC ship-station licence (radio services **SA** "Ship recreation or voluntarily equipped", **SB** "Ship compulsory equipment", **SE** "Ship exemption"), current and historical (status A active, E expired, C cancelled, T terminated). A licence assigns the **call sign and the MMSI** to a named vessel. |
| Access | Weekly complete file **`https://data.fcc.gov/download/pub/uls/complete/l_ship.zip`** (44 MB zipped, 2026-09-20 edition: `File Creation Date: Sun Sep 20 10:49:57 EDT 2026`), plus daily transaction files (not used). Pipe-delimited `.dat` files; rows join on `unique_system_identifier` (USI = one licence). Counts in that file: HD 402,484 · EN 402,484 · SH 402,483 · HS 1,194,754 · SR 132,025 · SV 1,068 · CO 377 · LA 615 · SE 368. `data.fcc.gov/robots.txt` only disallows one bot. |
| Format | FCC "Public Access Database Definitions" (`pa_ddef`). **www.fcc.gov refuses automated clients (HTTP 403)**, so the definitions were read from a verbatim public mirror of `public_access_database_definitions_sql_20250417` (GitHub tgies/uls). Used: **HD** licence header (call sign, status, radio service, grant / expiry / cancellation dates, certifier name+title, demographics), **EN** entity (licensee name, contact, FRN, applicant type), **SH** ship (general/special class, ship name, "official number of ship", gross tonnage, length, **station_number = MMSI**), **SR** safety equipment (EPIRB id, capacity), **SV** voyages, **HS** history log. Class codes: FCC Form 605 Schedule B (general: MM merchant, PL pleasure, SV rescue, FV fishing, GV official service; specific: ITU List V abbreviations, e.g. MTB motorboat, YAT yacht, SLO sloop, VLR sailing ship, PA passenger ship, TUG, PH fishing vessel, CHR trawler…). Applicant types (ULS code definitions, Attachment C): B club, C corporation, G government, I individual, J joint venture, L LLC, M military recreation, O consortium, P partnership, R RACES, T trust, U unincorporated association. Codes D, E, F, H, N, Z occur in the file but are not in that list (UNVERIFIED meaning). |
| Identifiers | call sign, **MMSI**, ship name, "official number" (as filed: a USCG official number, **or a state registration number** for undocumented boats, e.g. `WN0431DM`), licence USI, EPIRB id. No IMO. |
| Characteristics | declared ship class, gross tonnage, length (unit not documented: against AIS length for 1,266 of our vessels the median ratio is **1.00 → metres**, ~3 % look like feet; UNVERIFIED), licence term and status, licensee (a radio licence holder — **not stated to be the owner**; stored as the new role `radio_licensee`). |
| Licence | FCC data: U.S. Government work, public domain (17 U.S.C. § 105); ULS public access files are published for bulk download. Attribution we show: "FCC Universal Licensing System (ship licences)". Terms page on www.fcc.gov unreachable to scripts (403): licence **UNVERIFIED** beyond § 105. |
| Quirks | Particulars are declared by the applicant and loose: BLACKFISH VI (a USCG-inspected passenger boat) is filed as "PL pleasure / PA passenger ship"; so is LINNEA ROSE (a private pleasure boat). MMSIs are reused over decades: 368616000 sits on three licences (SEARCHER 1997–2007, YANKEE 2010–2020, BLACKFISH VI 2024–2034), which is why every licence claim carries the licence term as its validity. Dates are MM/DD/YYYY (day precision). Some owners type their state registration number into the AIS call-sign field (AIS allows 7 characters): LINNEA ROSE broadcasts `WN0431D`, its licence files `WN0431DM`, its real call sign is `WDN9773`. |

## 4. Transport Canada — Canadian Register of Vessels

| Item | Fact |
|---|---|
| Datasets | open.canada.ca **"Canadian Register of Large Vessels"** (`bf00b7f4-e370-46b7-94e4-0bdedc98531b`): XLSX EN/FR (`https://opendatatc.tc.canada.ca/large-vessel-registry_dataset_en.xlsx`, 3.1 MB, Last-Modified 2026-09-25, **26,852 rows**, 23 columns), data dictionary PDF, JSON/XML API. **"Small Commercial Vessel Registry"** (`5cb32773-…`): XLSX, 19,167 rows, 15 columns — official number (`C00287BC`), first registry date, hull number, descriptors, material, dimensions, power: **no vessel name, no IMO, no call sign**. Catalogue frequency: large "continual", small "P1M" (monthly); files were re-generated 2026-09-25. |
| Large-vessel columns | Official Number, Vessel Name, IMO Vessel Number, Hull Number, Year of Build (**YYYYMM**, month 00 = not recorded; some 4-digit and junk values), Year of Latest Rebuild, Port of Registry, Certificate Issuing date or Registration date, Vessel Descriptor (PLEASURE CRAFT 12,443 · FISHING 8,799 · BARGE 2,266 · TUG 1,136 · PASSENGER 922 · WORKBOAT 719 · FERRY 166 · CARGO 155 · FLOATING STRUCTURE 113 …), Gross / Net Tonnage, Construction Type, Construction Material, Length / Breadth / Depth (**metres**), Engine Type, Number of Engines, Propulsion Type, Speed (Knots), Propulsion Method, Engine Propulsion Power, Unit/Brake Power. 1,163 rows carry a checksum-valid IMO. |
| API | Vessel Registration Query System, `http://data.tc.gc.ca/v1.3/api/eng/vessel-registration-query-system/canadian-registry-large-vessels/{official-number|vessel-name|status|port-of-registry}/{value}` (JSON; http only). Adds **Status** (REGISTERED, SUSPENDED…), **Former Vessel Name**, Registry Date, **Certificate Expires**, Number of Encumbrances, Vessel Type (main / sub1 / sub2), **Builder** name + address. No owners. The API guide (DOCX on `opendatatc.blob.core.windows.net`) did not resolve (DNS) on 2026-09-25. |
| Identifiers | official number, IMO (some), hull number, name, former name. **No call sign, no MMSI, no owner** in either the export or the API. |
| Licence | **Open Government Licence – Canada 2.0** (catalogue `license_title`). Commercial use allowed; attribution required: "Contains information licensed under the Open Government Licence – Canada." (+ we name Transport Canada). |
| robots / limits | None published for the API. We make **one API request per second**, only for rows we attach or consider. |

---

## 5. Privacy (proposed rule — Josh must approve any change, and any display of an individual)

Registries name **owners and licensees**. For pleasure craft these are private people.
The rule, implemented in `lib/ships/registry.js` `partyPrivacy()`:

1. **Individuals' names are never stored.** FCC applicant type I (individual), and the
   types that often carry people's names or are undefined (P partnership, T trust,
   B club, M, R, and unknown codes), are stored as the placeholder
   `Name withheld (privacy rule)` / `WITHHELD`. In the raw record, the licensee's name
   fields, licensee id, FRN and city/state are replaced by `[withheld]` **before
   storage**; the SHA-256 of the original line is kept, so the stored evidence stays
   verifiable against the public FCC file. (The FCC file is public and re-fetchable,
   so nothing is lost: if Josh ever approves storing names, a re-import restores them.)
2. **Contact data is never stored for anyone**: phone, fax, email, street, ZIP, PO box,
   attention line (EN), and the certifier's name/title and demographic fields (HD).
3. **Organisations** (C corporation, L LLC, G government, J, O, U) are stored. They are
   **displayable only on a commercial licence** (radio service SB / SE). An organisation on a
   recreational licence (SA — e.g. a one-boat LLC, which often is a person) is stored
   but not displayable.
4. Each party claim carries `detail.display` (true/false), `detail.display_reason`
   (`private_individual`, `party_type_may_be_individual`, `organisation_on_recreational_licence`)
   and `detail.party_kind`. `getVessel()` replaces the value of every `display: false`
   claim with the placeholder before it leaves the server, and `getRecord()` withholds
   non-displayable names in FCC raw records too — so the UI cannot leak them by mistake.
5. PSIX (web service) and Transport Canada publish **no owners**, so nothing else is affected.
   A private boat's HIN / state registration number is stored (it identifies the boat, not a person).

Deviation from "raw records exactly as received": FCC rows with personal data are
stored redacted (rule 1–2). Josh to confirm.

## 6. Resolution (resolver v1.4, `decideRegistry` + `resolveRegistryEntity`)

A registry record **only attaches to one existing vessel. It never creates a vessel
and never merges vessels.** Justification: our vessels are what AIS/GFW observed; a
licence or registration with no observation adds no track, and creating ~400k
licence-vessels would bloat the DB and invite wrong merges later. A registry record
that matches an AIS-observed MMSI always finds that vessel already (every AIS MMSI is
on a vessel), so "create only if it matches an AIS MMSI" reduces to "attach"; if it
matches with a conflict, it stays unresolved with candidates. Unresolved records are
kept as evidence.

Order:
1. An accepted link is never moved; new conflicting evidence only adds candidates.
2. **IMO** (checksum-valid, exactly one): the Wikidata attach rule — the one vessel
   holding that IMO as a registry IMO → `IMO_EXACT`; if its IMO is AIS-only, a second
   identifier must agree (MMSI / call sign / name → `IMO_AIS_MMSI|CALLSIGN|NAME`).
   Several holders or several IMOs → unresolved.
3. **Identifiers** (per source):
   - FCC: the licence MMSI's term must **overlap** the vessel's MMSI window, the
     **name** must agree, and the **call sign** must agree (`REG_MMSI_CALLSIGN_NAME`) —
     or the vessel's AIS call-sign field must carry the licence's state registration
     number cut to 7 characters (`REG_MMSI_REGNO_NAME`, the LINNEA ROSE case).
     MMSI + name without a call sign, or MMSI with a different name / call sign →
     `MMSI_TEMPORAL` candidate only.
   - PSIX (no MMSI, no dates for identity): **call sign + name** (`REG_CALLSIGN_NAME`),
     unless PSIX lists the vessel out of service before we first observed that call
     sign (then a `CALLSIGN_MATCH` candidate). Temporal overlap cannot be checked
     (PSIX is a current snapshot); call signs are ITU-assigned and the name must agree too.
   - Any: the same **US official number** already on exactly one vessel through another
     registry + name → `OFFICIAL_NUMBER_NAME` (e.g. PSIX ↔ FCC). Name differs → `REGISTRY_LINK` candidate.
   - Official numbers are a strong identifier **within one numbering scheme**; FCC's
     "official number" is only used when it looks like a USCG number (digits).
4. Never by name alone, never by MMSI alone. **Name + length** (within 1 m / 10 %),
   among vessels transmitting from the registry's country (MID 316 for Canada; 338/366–369
   for PSIX), at most 3 → `NAME_DIMENSION_MATCH` **candidates** only.
5. IMO and identifiers pointing at different vessels, or identifiers matching several
   vessels → unresolved with candidates.

## 7. Scope and cost

- FCC: bulk file (cheap); only licences whose MMSI or call sign one of our AIS/GFW
  sources carries are imported (not the ~395k others).
- PSIX: one search per vessel by its strongest identifier (IMO → official number from
  an attached FCC licence → call sign for US MMSIs), then 6 requests per hit.
- TC: rows whose IMO we hold (+ API record) and rows whose name matches one of our
  Canadian-MMSI vessels (candidates at most, no API call).
- Long-job logs and downloads: `scripts/ships/bake-ais/build/registries/` (gitignored).

## 8. Dev import results (2026-09-25/26, `earthatlas-ships-dev`, 16,990 active vessels)

| Source | Fetched | Accepted | Unresolved (with candidates) | Methods |
|---|---:|---:|---:|---|
| FCC ULS | 7,414 licences (7,088 by our MMSI, 326 by call sign only) of 402,483 in the file | 4,995 | 2,419 (853) | REG_MMSI_CALLSIGN_NAME 4,759 · OFFICIAL_NUMBER_NAME 126 · REG_CALLSIGN_NAME 107 · REG_MMSI_REGNO_NAME 3. Most unresolved = older licences whose term doesn't overlap our observations (reused MMSIs) |
| USCG PSIX | 9,034 searches (6,048 with hits, 25 too ambiguous) → 6,795 PSIX vessels; 49,804 requests | 5,440 | 1,355 (652) | OFFICIAL_NUMBER_NAME 2,422 · IMO_AIS_CALLSIGN 1,895 · REG_CALLSIGN_NAME 610 · IMO_EXACT 300 · IMO_AIS_NAME 213 |
| Transport Canada | 1,219 export rows (149 by IMO + API record; 1,070 by name only) of 26,852 | 140 (after a TC-only re-resolve) | 1,079 (615, nearly all NAME_DIMENSION_MATCH) | IMO_EXACT 104 · IMO_AIS_NAME 36 |

- **No vessel was created** (16,990 before and after). 7,335 vessels gained registry data.
- Vessels with a registry value (of which the attribute is new to the vessel): registration status 7,335 (7,335) · vessel type 7,277 (23) · certificates 7,152 (7,152) · length 5,736 (281) · gross tonnage 5,691 (**4,133**) · flag 5,474 (2,402) · net tonnage 5,200 (5,200) · depth 5,176 (5,176) · official number 4,977 · **year built 4,348** · USCG activities 3,728 · hull id 2,864 · draft 2,047 (1,680) · displayable organisation licensee 604 · builder / hull material / propulsion / port of registry ~140 (Canada).
- Licensee privacy: 3,432 vessels' licensee is a private individual (name not stored), 104 party types that may be individuals (not stored), 624 organisations on recreational licences (stored, hidden), 604 organisations on commercial licences (shown).
- Classification (`classifyClaims`, "now"): specific class 3,383 → **3,562**; group only 12,117 → 11,757; conflicts 162 → **355**; no type claim 1,310 → 1,287. Changes: 200 fishing vessels gain the class "fishing vessel" (PSIX), 51 "passenger" → pleasure craft; new conflicts are mostly real AIS-vs-USCG disagreements (AIS 37 pleasure vs PSIX "Passenger (Uninspected)" six-pack charters: 48; AIS 30 fishing vs PSIX "Recreational": 38). Open decision for Josh: rank USCG service type above AIS type, or keep them as conflicts.
- Resolution is order-dependent across registries (a PSIX IMO can make a Transport Canada record attachable, a PSIX official number can attach an FCC licence). A TC-only re-resolve after the PSIX run moved TC from 134 to 140 accepted; a second pass over FCC/PSIX (`npm run ships:reresolve -- --source …`) would converge further.
