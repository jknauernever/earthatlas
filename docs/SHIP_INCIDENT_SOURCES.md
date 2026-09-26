# Ship INCIDENT sources (spills, casualties, detentions) for /ships cards

Research for /ships, 2026-09-25. STUDY ONLY: no code, no database writes. Facts only.
Anything not checked against a primary source or a live endpoint is marked **UNVERIFIED**.
Rules from `src/ships/CLAUDE.md` apply: licensing is a requirement, evidence is kept
separate from interpretation, and a wrong match is worse than no match.

**Scope:** open data on *events* involving a specific vessel: oil/chemical spills,
groundings, collisions, allisions, fires, sinkings, loss of propulsion, detentions,
port-state-control (PSC) deficiencies, injuries/fatalities. Priority: Salish Sea
(WA + BC), then US, then global.

**Test vessels.** BLACKFISH VI (MMSI 368616000, call sign WDP4981) and EURODAM
(IMO 9378448). **Salish test incidents:** F/V ALEUTIAN ISLE sinking off San Juan Island
(2022-08-13), WSF WALLA WALLA grounding in Rich Passage (2023-04-15), F/V KODIAK
ENTERPRISE fire in Tacoma (2023-04-08).

**Privacy.** Several of these sources contain private individuals' names: injury
narratives, "responsible party" fields, and state boat registration numbers. None are
reproduced here. An import must drop or redact them (see §12).

---

## 0. Summary table

| # | Source | Vessel identifiers in record | Salish coverage | Access | Licence | Verdict |
|---|---|---|---|---|---|---|
| 1 | **USCG CGMIX IIR** (Incident Investigation Reports) web service | **MISLE vessel ID + "PrimaryVesselIdentificationNumber"** (IMO for foreign ships, USCG official number for US ships) + name | Yes (WA; closed cases only) | Public SOAP API, no key | US federal work (no licence stated) | **Import first** |
| 2 | **USCG PSIX** web service (cases, operational controls, PSC deficiencies) | MISLE VesselId, name, call sign, IMO/ON ("Identification") | Yes (any vessel with a US CG contact) | Public SOAP API, no key; weekly snapshot | US federal work (no licence stated) | **Import first** (with #1) |
| 3 | **TSB Canada MARSIS** marine occurrences | **IMO, MMSI, call sign, official number, VRN** + name | Yes (BC; 11,278 BC vessel rows) | Monthly bulk CSV | **OGL-Canada** (commercial OK) | **Import first** for BC |
| 4 | NRC (National Response Center) spill reports | **Name only** (+ type, flag, length) | Yes (WA: 243 vessel rows in 2026 so far) | Yearly XLSX files | US federal work (no licence stated) | Import later, candidate-only matches |
| 5 | WA Ecology "Reported spills to water" (ArcGIS) | **None structured**: vessel name only inside free-text `CaseName` | Yes (WA, since 2015-07-01) | ArcGIS MapServer query | Ecology terms: **commercial use prohibited**, credit + link required | Candidate-only; licence limits |
| 6 | NOAA OR&R IncidentNews | **Name only**, in the incident title | Yes (WA/BC: 332 rows) | One CSV (~3 MB) | **Public domain** (stated) | Import later, candidate-only |
| 7 | SkyTruth Cerulean | MMSI (AIS-attributed, probabilistic) | Global incl. Salish | OGC API | **CC BY-SA 4.0 + conservation-use-only**; API robots.txt `Disallow: /` | Phase 4; ask SkyTruth first |
| 8 | NTSB CAROL marine | UNVERIFIED (vessel name; IMO per guide) | Few (major cases only) | Legacy CAROL retired 2026-10-01; new CAROL SPA | US federal work | Later; link-only |
| 9 | Transport Canada PSC detention list | IMO + name | Foreign ships in Canada | POST web form; `robots.txt` `Disallow: /` | Canada.ca terms | Do not automate |
| 10 | Tokyo MoU / Paris MoU / IMO GISIS / EMSA EMCIP | IMO | Global | Web search / login | Paris MoU forbids storage without written permission; others restricted/unclear | Do not import now |
| — | GFW Events | GFW vessel ID / MMSI | — | — | CC BY-NC | Not incidents (behaviour only) |
| — | BC government spill-incident pages | Not identified by vessel | BC | HTML only | © Gov. of BC | Not usable for vessel linking |

---

## 1. USCG CGMIX Incident Investigation Reports (IIR): **best US source**

The old "Marine Casualty and Pollution Data for Researchers" page no longer exists.
The dco.uscg.mil URL returns a **404 page** in a browser (and 403 to curl), and the
investigations office page (`dco.uscg.mil/.../cginv/`) no longer links to it. Data.gov
still describes it: `MISLE_DATA.zip` covering Jan 2002 – Jul 2015, hosted on
homeport.uscg.mil. Homeport's TLS certificate **expired 2026-03-04** (checked with
openssl) and the page did not load. **Treat the researcher dataset as dead or frozen at
2015.** The live replacement is CGMIX IIR. The cginv page describes it as "Incident
Investigation Reports (marine casualty reports auto generated from MISLE)".

| Field | Value (checked live 2026-09-25) |
|---|---|
| UI | https://cgmix.uscg.mil/IIR/Default.aspx. "Last Update: Monday, September 21, 2026" |
| Scope | "reportable marine casualties, as defined in Section 4.05 of Title 46 CFR, that were closed after October 2002". **Closed cases only**; open investigations are not shown |
| API | SOAP web service https://cgmix.uscg.mil/xml/IIRData.asmx (WSDL `?WSDL`, namespace `https://cgmix.uscg.mil/xml/`, SOAPAction `https://cgmix.uscg.mil/xml/<op>`). No key |
| Bulk | "IIR XLSX Export" at https://cgmix.uscg.mil/xml/IIRExportSearch.aspx: a POST form with filters for district, unit, vessel class/type, deaths, injuries, vessel loss, damage and date range. **Not submitted in this study** (form); its columns are **UNVERIFIED** |
| robots.txt | `cgmix.uscg.mil/robots.txt` returns an HTML error page, so there is no robots file |
| Terms | Disclaimer: USCG "is not liable for any loss … or for any reliance on its accuracy, completeness, or timeliness". Reports are redacted under the Privacy Act/HIPAA. No licence is stated; this is a US federal government work (17 U.S.C. §105), **UNVERIFIED** that it is free of third-party content |

**Operations (all per `ActivityId` except search):**
- `getIIRIncidentSearch(ActivityId, VesselService, VesselName, OrgName, InvolvedFacility, KeyWord)`
  → ActivityId, CasesId, Title, StartDtTm, CloseDtTm. **Gotcha:** `VesselService` must be
  `ALL` (empty returns nothing). Pass `ActivityId=0` to search by name or keyword. There is
  no date or region filter.
- `getIIRTitleInformation` → Title, StartDtTm, **IncidentSubTypeLookupName** (e.g. `Aground`,
  `Flooding`, `Pollution - Oil`, `Equipment Failure`), vessel Name, unit IDs.
- `getIIRInvolvedVessels` → **MISLEVesselId, Name, PrimaryVesselIdentificationNumber,
  VesselRoleLookupName**.
- `getIIRIncidentSummary` → serious-marine-incident flag, marine board flag, level of
  investigation, IMO incident type, USCG casualty classification (e.g. "Significant Marine
  Casualty"), IncidentInvolves (e.g. "Discharge of Oil", "Marine Casualty, Reportable").
  One row per "involves" value.
- `getIIRWaterSegments` → **Latitude, Longitude**, description, waterway name.
- `getIIRIncidentBrief` → narrative. May contain personal details, so redact or skip it for injury cases.
- `getIIRVesselDamageSummary` (dollars), `getIIRVesselStatusSummary` (Damaged/…),
  `getIIRPersonalCasualtySummary`, `getIIRInvolvedParties` (names "often removed", **do not
  import**), `getIIRInvolvedOrganizations` (company + address + role), `getIIRResponseResources`,
  `getIIRReferralForEnforcement(Action)`.

**TIME GOTCHA (verified on 4 cases):** `StartDtTm` carries a `-04:00`/`-05:00` offset, but
the wall-clock value is **UTC**. Evidence:
EURODAM 2024-07-23 brief says "approximately 1111 local" in Glacier Bay (AKDT, UTC−8) while
StartDtTm is `19:11-04:00`. EURODAM Sitka 2017 brief says 0830 AKDT; StartDtTm is `16:30-04:00`.
WALLA WALLA brief says "approximately 1635" (PDT); StartDtTm is `23:32-04:00`. ALEUTIAN ISLE
sank mid-afternoon PDT; StartDtTm is `20:35-04:00`. So: strip the offset and treat the value
as UTC. This follows the CLAUDE.md rule "a source timestamp with no zone marker is rejected",
since here the marker is present but wrong. Store the raw value and flag it.
`StartDtTm` is described as "the Date the Investigation was Opened" and in practice matches
the incident time. Use it as the event time with `period_kind=observed`.

**Test lookups:**
- **EURODAM:** 17 closed investigations, 2009–2024. Examples:
  8016476 "EURODAM Loss of Propulsion", 2024-07-23, Glacier Bay (58.9185, −136.9131),
  involved vessel MISLE 865188 / **9378448** (IMO), classification Routine.
  6250030 "EURODAM - Discharge of Oil", 2017-08-23, Port of Sitka, subtype `Pollution - Oil`,
  brief: hydraulic hose fitting, "estimated that 1 Liter of oil discharged"; involved org
  HOLLAND AMERICA LINE N.V., "Subject of Investigation". Eleven of the 17 are passenger or
  crew injury cases (keep them as counts only).
- **BLACKFISH VI:** the IIR name search returns nothing, and PSIX lists only 4 "Vessel
  Inspection" cases (below). So there are **no closed USCG casualty investigations on record**
  for it as of the 2026-09-21 snapshot.
- **WALLA WALLA:** 7669720 "WALLA WALLA - LOP/Grounding", subtype `Aground`, Rich Passage
  (47.5985, −122.54765), involved vessel MISLE 47442 / **546382** (USCG official number,
  matching the brief's "O.N. 546382"), status Damaged. There are 20+ other WALLA WALLA cases,
  mostly equipment failures.
- **ALEUTIAN ISLE:** 7543400 "ALEUTIAN ISLE - Sinking", subtype `Flooding`, "Significant
  Marine Casualty", (48.548, −123.1715), ON **558156**. A 2005 collision case also exists under
  the same name, so check the ON before assuming it is the same hull.
- **KODIAK ENTERPRISE:** 7665123 "KODIAK ENTERPRISE - Fire", 2023-04-08, plus 7 earlier cases.

**Vessel linkage quality:** strong. `PrimaryVesselIdentificationNumber` gives an IMO (7
digits, foreign) or a USCG official number (US), and `MISLEVesselId` is the same ID used by
PSIX. That lets us join straight to the registry import the other agent is building
(USCG NVDC/PSIX). Name-only search is only a discovery step.

---

## 2. USCG PSIX web service: cases, operational controls, PSC deficiencies

PSIX is being imported for **identity** by the concurrent registry work. Only the
incident-relevant parts are covered here.

| Field | Value (checked live 2026-09-25) |
|---|---|
| API | SOAP https://cgmix.uscg.mil/xml/PSIXData.asmx (namespace `https://cgmix.uscg.mil`). Bulk XLSX export at https://cgmix.uscg.mil/XML/PSIXExportSearch.aspx (POST form with filters incl. "Detention Reported to IMO" and deficiency system; **not submitted**) |
| Freshness | "a weekly snapshot of FOIA data … Information on unclosed cases or cases pending further action is considered privileged … and is precluded". Last Update 2026-09-21 |
| Terms | Same disclaimer as IIR; no licence stated (US federal work) |

**Ops used:**
- `getVesselSummary(VesselID, VesselName, CallSign, VIN, HIN, Flag, Service, BuildYear)` →
  VesselId (MISLE), name, call sign, service, `Identification` (IMO or ON), status.
- `getVesselCases(VesselID, MinSearchDate, MaxSearchDate)` → ActivityId, StartDtTm,
  **TypeLookupName** (`Vessel Inspection`, `Incident Investigation`, `Vessel Operational
  Control`, `Boarding`, `Vessel Transfer Monitor`), status, **USCGZonePort**,
  `PortStateControlRelatedExamination`.
- `getOperationControls(ActivityID)` → Imposed/Removed time, category, reason, **type**
  (e.g. "COTP Order (Restriction of Operations)", "Letter of Deviation"), unit, and
  `IsInternationalMaritimeOrganizationReportable` (which appears to be the detention signal;
  **UNVERIFIED** that it equals "detention").
- `getVesselDeficiencies(ActivityNumber)` → description, system/subsystem/component codes,
  cause, action code, resolved flag and date.

**Test lookups:**
- **BLACKFISH VI:** call sign WDP4981 → VesselId **1763413**, Passenger (Inspected), built 2024,
  `Identification` 1344473 (official number). Cases: 4 "Vessel Inspection"
  (2022-12-15, 2025-09-11, 2026-01-27, 2026-05-12, all Seattle, "Approved Inspection").
  **No incidents, no operational controls.**
- **EURODAM:** name → VesselId **865188**, call sign PHOS, `Identification` **9378448**, flag
  Netherlands. 130 cases: 98 inspections, 20 incident investigations (matching IIR IDs),
  5 operational controls, 4 boardings, 3 transfer monitors.
  Example: 8202052, **Sector Puget Sound**, "COTP Order (Restriction of Operations)",
  reason "Identified Hazardous/Unsafe Condition", imposed 2025-08-02 08:21, removed 12:49
  (offset `-04:00`; the time basis is **UNVERIFIED**, likely the same UTC quirk as IIR).
  PSC exam 8237466 (Juneau, 2025-09-22) lists deficiencies such as "11 - Life Saving
  Appliances … 17 - Rectify deficiencies prior to departure", resolved the same day.

**Card use:** "Incident investigation (USCG), date, port" can come straight from PSIX
cases, with details from IIR by ActivityId. Operational controls and PSC deficiencies are
separate event types (§12). **Do not label an operational control a "detention"** unless
the source says so.

---

## 3. TSB Canada MARSIS marine occurrences: **best BC source, best identifiers**

| Field | Value (checked live 2026-09-25) |
|---|---|
| Dataset | "Marine occurrence data from January 1995 to present", open.canada.ca id `ad8d1b73-df09-4521-9bdb-61c529328218` |
| Licence | **Open Government Licence – Canada** (`ca-ogl-lgo`): commercial use allowed, attribution required (OGL statement). Also "provided on an as-is basis … information pertaining to some occurrences may not have been validated" |
| Cadence | Monthly ("released on or soon after the 15th of each month"). The file already had occurrences to 2026-09-13 |
| Files | `https://www.tsb.gc.ca/sites/default/files/stats/MARSISdb_MDOTW_VW_OCCURRENCE_PUBLIC.csv` (97 MB), `…_OCCURRENCE_VESSEL_PUBLIC.csv` (78 MB), plus NAV/LSA/REC equipment and `…_INJURIES_PUBLIC.csv`; dictionary `https://www.tsb.gc.ca/sites/default/files/data/en/MARSISdb-dd.csv` |
| Access gotcha | curl with a bare UA gets **403**; a normal browser UA + Accept headers gets 200. No robots.txt (404) |
| Encoding gotcha | Vessel CSV starts with a **double UTF-8 BOM**; the dictionary is latin-1 |
| Size | 48,924 occurrences (dates in file 1975-01-01 → 2026-09-13), 74,408 vessel rows |

**Identifiers (vessel table):** `IMO` (18,092 rows filled), `MMSI` (10,120), `CallSign`
(33,522), `OfficialNo` (64,435), `VRN` (7,097), `VesselName`, flag, type, GT, year built.
**BC** (province = "BRITISH COLUMBIA (BC)"): 11,278 vessel rows. Since 2020: 2,969 rows, of which
IMO 1,326, MMSI 1,582, call sign 1,269, official number 2,461. 62 BC rows since 2020 carry a
US MMSI (3xx), so US vessels crossing into BC waters show up.

**Occurrence fields:** OccNo (e.g. `M25P0115`), OccDate + OccTime + **TimeZone** (UTC, PDT(+7),
PST(+8), … and 2,500 "HISTORICALLY UNSPECIFIED"), Latitude/Longitude as **unsigned values
plus hemisphere enums** (`LongEnum…` = W, so negate), NearestLocationDescription,
AccIncTypeDisplayEng (e.g. "TOTAL FAILURE OF ANY MACHINERY OR TECHNICAL SYSTEM"),
OccClass (Class 1–5), PollutionIND, TotalDeaths/injuries/missing, and **Summary** (narrative).
The vessel table adds per-vessel damage, `QuantityReleased` + units, product, UN number,
and per-vessel deaths/injuries.
**Fan-out gotcha:** the vessel view repeats a vessel once per damage/cargo sub-row (e.g. one
vessel ×4 on one OccNo), so deduplicate on (OccID, VesselID).

**Test lookups:**
- **EURODAM:** 2 occurrences, both with IMO **9378448**. `M25P0115`, 2025-06-13 19:17 PDT, Ogden
  Point, Victoria BC (48.4078 N, 123.4144 W), "azipod failure … while under the conduct of a
  pilot for berthing", no pollution. `M13L0146`, 2013-09-23, "RISK OF STRIKING (near allision)".
  The TSB record gives MMSI **245206000** for EURODAM (**UNVERIFIED** against a registry).
- **BLACKFISH VI / MMSI 368616000:** no rows.
- **ALEUTIAN ISLE:** one 2004 row, call sign WYX3438 (not the 2022 sinking, which was in US waters).

---

## 4. National Response Center (NRC) spill reports: US, name-only

| Field | Value (checked live 2026-09-25) |
|---|---|
| Page | https://nrc.uscg.mil/: yearly `FOIAFiles/CY90.xlsx` … `CY26.xlsx`, decade zips, `DataDictionary.xlsx` |
| Freshness | CY26.xlsx Last-Modified **2026-09-21**, 9.6 MB, latest incident 2026-09-09. Placeholder files exist through CY29 |
| Caveat (verbatim) | "The spreadsheets posted to the NRC website contain INITIAL incident data that has not been validated or investigated by a federal/state response agency." |
| Licence | None stated; US federal work. Records contain reporter-supplied **responsible-party names and addresses** (can be private individuals), so **do not import those columns** |
| robots.txt | redirects to an error page (none) |

**Sheets (CY26):** CALLS, INCIDENT_COMMONS (description, type, cause, date, location text,
city/state/county, lat/long as deg-min-sec with ~27% filled for vessel incidents: 840 of 3,091),
INCIDENT_DETAILS (fire, injuries, fatalities, damage, sheen size, body of water, …), INCIDENTS,
MATERIAL_INVOLVED (CHRIS code, CAS, UN number, amount + unit, **amount in water**),
**VESSELS_DETAIL** (VESSEL_NAME, VESSEL_TYPE, FLAG, length, fuel on board, aground flag), …
**No IMO, MMSI, call sign or official number fields.** Only 2 of 16,128 descriptions mention "IMO".

**Test lookups (CY26 only):** EURODAM: none. "BLACKFISH": one report (SEQNOS 1472632,
2026-09-02, Langley WA, **PLEASURE CRAFT** broke from mooring, 60 gal fuel aboard). This is
**not** BLACKFISH VI (different vessel type and place), which shows exactly why a name-only
match must never be auto-accepted. In 2026 WA had 243 vessel rows: 126 pleasure craft,
32 military, 30 fishing, and commercial names such as MATSON KODIAK, MSC ATHOS, YM MUTUALITY,
SKANSONIA.

---

## 5. Washington State Department of Ecology: reported spills to water

| Field | Value (checked live 2026-09-25) |
|---|---|
| Layer | `https://gis.ecology.wa.gov/serverext/rest/services/SPPR/Spills_map_series/MapServer/130` "ReportedSpillsToWater - AllScales" (used by the "Spills Maps" Experience Builder app linked from Ecology's [Spill incidents](https://ecology.wa.gov/spills-cleanup/spills/spill-preparedness-response/responding-to-spill-incidents/spill-incidents) page). Anonymous query works; maxRecordCount 2000 |
| Coverage | 4,844 records, 2015-07-01 → 2026-06-29. Legend: "Reported spills (of one gallon or more) … on or after 7/1/2015". `Source_Type='Vessel'`: 1,347 |
| Fields | IncidentID, **ERTS_number**, County, City, Address, Location, Latitude, Longitude, Medium (Puget Sound / Lake / Stream/River), Incident_Category (e.g. "Oil Spill,Loss of vessel - Sinking"), Source_Type, **Source** (RECREATIONAL VESSEL 795, FISHING VESSEL 249, PUBLIC VESSEL 77, TUG 43, CARGO BARGE 17, FERRY 11, PASSENGER SHIP 10, CARGO SHIP 7, CONTAINER SHIP 5, TANK SHIP 1, …), Oil_type, Quantity_total, **QuantityToWater**, Quantity_recovered, Activity, Cause_Type, Cause, Regulated, Impact, Date_incident (epoch ms), **CaseName** |
| Vessel identity | **No structured vessel field.** The name appears only inside `CaseName` free text, e.g. "FV Aleutian Isle, sinking & oil spill, San Juan Island, 8/13/2022". Some recreational case names embed a state registration number (personal; do not show) |
| Data quality | One Kitsap record ("Kitsap Naval Bangor") has longitude −120.55 (inland, clearly wrong). Validate positions against the county |
| Other access | `gis.ecology.wa.gov/serverext/rest/services/SPPR?f=json` returned **403** (Azure gateway); `…/Spills` needs a token. The storymap URL is 403 to curl. There is **no data.wa.gov dataset** (the catalogue search for "spill" returned only other states) |
| Licence | Ecology [copyright page](https://ecology.wa.gov/About-us/Accountability-transparency/Website-information/Copyright-information): data use allowed "provided the Washington State Department of Ecology is credited as the data provider and a link is provided", **but "Commercial and political use of any Ecology Material are specifically prohibited."** The app's Terms of Use dialog is an "as is" disclaimer. **Flag: whether EarthAtlas counts as commercial is Josh's call** |

**Test lookups:** EURODAM: none. "BLACKFISH": `F/V Blackfish Spill`, 2015-12-10, FISHING VESSEL,
20 gal diesel. This is **not** BLACKFISH VI (built 2024). ALEUTIAN ISLE: ERTS 716940,
1,428 gal ULSD + 2,467 gal oily water mixture to water. KODIAK ENTERPRISE: ERTS 722001
(fire, sheen). WALLA WALLA hits are the city, not the ferry.
Ecology also keeps ~137 narrative incident pages (e.g. Aleutian Isle, Kodiak Enterprise fire,
Dominion tug sinking): HTML only.

---

## 6. NOAA OR&R IncidentNews

| Field | Value (checked live 2026-09-25) |
|---|---|
| Download | https://incidentnews.noaa.gov/raw/incidents.csv (3.2 MB, 4,937 rows, 1957-03-29 → 2026-09-22). RSS/Atom feeds too |
| Licence (verbatim) | "The contents are in the public domain; there is no copyright restriction." |
| Scope | "selected oil spills off US coastal waters and other incidents where NOAA's Office of Response and Restoration (OR&R) provided scientific support" |
| Fields | id, open_date (date OR&R was notified), name, location, lat, lon ("may be approximate"), threat (Oil/Chemical/Other), tags (causes), commodity, response measures, **max_ptl_release_gallons**, posts, description |
| Vessel identity | **Name only, in the title**, e.g. "Tug MOLLUSK Sinking; Kingston Ferry Dock", "Fishing Vessel NEW ST. JOSEPH Sinking; Seattle". No IMO/MMSI |
| Salish | 332 rows mention WA or BC (they include non-vessel and inland events) |

Test lookups: EURODAM and BLACKFISH: none.

---

## 7. SkyTruth Cerulean (satellite slicks, AIS-attributed)

| Field | Value (checked live 2026-09-25) |
|---|---|
| API | OGC API (tipg) https://api.cerulean.skytruth.org/. Function collection `public.get_slicks_by_source(source_id text, source_rank int, collation_threshold float)`, where `source_id` = MMSI (signature from the open-source repo `SkyTruth/cerulean-cloud`, Apache-2.0 code). **Gotcha:** pass `collation_threshold` explicitly (omitting it gives `invalid input syntax … "NULL"`) |
| Restricted | `public.source_vessel` → "Access to public.source_vessel is restricted." |
| Data licence | [Terms of Service](https://skytruth.org/terms-of-service): **CC BY-SA 4.0**, attribution format "SkyTruth [Product Name], [Year]. CC BY-SA 4.0. …", **plus** services are only for "environmental conservation applications", and a slick-vessel association "does not constitute confirmation or evidence that a specific vessel … is responsible" |
| robots.txt | API host: `User-agent: * Disallow: /` (blocks all bots), even though SkyTruth promotes "programmatic free access". **Ask SkyTruth before any automated import** |
| Test | `source_id=368616000` → `[]`; `source_id=245206000` (EURODAM MMSI per TSB) → `[]` (rank ≤ 3) |

Fits Phase 4 (not authorized). Must be shown as "possible source (satellite + AIS proximity)",
never as a spill.

---

## 8. NTSB (CAROL)

The legacy CAROL page (data.ntsb.gov/carol-main-public) shows a banner: **"Legacy CAROL will be
retired on October 1, 2026"**; the replacement is https://carol.ntsb.gov/ (→ my.ntsb.gov, a
JS app). A POST to the legacy `api/Query/Main` returned "An unknown exception occured."
Per the NTSB CAROL guide (search result, **UNVERIFIED** in detail): non-aviation data runs
2010→present, and results download as CSV/JSON zip. Marine fields in the new API are
**UNVERIFIED**. NTSB investigates only major marine casualties, so volume is low. For the
Salish test cases, the WALLA WALLA grounding was investigated by WSF + USCG (WSF published
a "Report of Formal Investigation" PDF), not by NTSB.
**Recommendation:** revisit after 2026-10-01 once the new CAROL API settles; link out to
report PDFs rather than import.

---

## 9. Canada: other candidates

- **Transport Canada PSC detention list:** https://wwwapps.tc.gc.ca/Saf-Sec-Sur/4/PSCQ-SRPSC/eng/detentions/
  is a **POST** search form (Month, Year, IMONumber, VesselName, FlagState, VesselType).
  `wwwapps.tc.gc.ca/robots.txt` = `User-agent: * Disallow: /`. **Do not automate.** Not
  queried in this study. The annual report is TP 13595.
- **CCG / Transport Canada NASP pollution:** open.canada.ca has only ECCC **aggregate**
  indicators ("Marine oil spills", "Marine pollution spills … from aerial surveillance",
  2010–2017 volumes). **No per-vessel records found.**
- **Transport Canada AMPs (penalties):** no published per-vessel list found (only
  regulations and news).
- **BC spill incidents:** https://www2.gov.bc.ca/…/spill-incidents: HTML summaries
  (2020→), identified by place and substance, **not vessel**, © Government of BC. No dataset.

---

## 10. Global

- **IMO GISIS Marine Casualties and Incidents:** needs an IMO Web Account (free public
  registration). Holds investigation reports and casualty data. Reuse terms for bulk use are
  **UNVERIFIED**. A login is required, so it was not accessed.
- **EMSA EMCIP:** public users see investigation reports and **anonymized** casualty data
  (per EMSA). It is anonymized, so it is **not vessel-linkable** for the public.
- **Paris MoU (THETIS public search):** the disclaimer says "No part of the information … may be
  stored in a retrieval system … without prior authorisation in writing". **Cannot import.**
- **Tokyo MoU:** online detention list + APCIS inspection search (terms **UNVERIFIED**).
  OpenSanctions republishes the Tokyo MoU detention list weekly (5,547 vessels) under
  **CC BY-NC 4.0** (commercial use needs a paid licence). Possible later, non-commercial only.
- **USCG PSC detentions:** covered by PSIX operational controls + `IsInternationalMaritimeOrganizationReportable` (§2).
- **GFW events** (`docs/GFW_ACTIVITY_API.md`): encounters, loitering, fishing, port visits,
  AIS gaps. These are behaviour, not incidents. Out of scope here.

---

## 11. Ranked recommendation (Salish Sea first)

1. **USCG IIR + PSIX (same host, same MISLE vessel ID).** Covers every US-waters casualty and
   pollution investigation (closed cases), plus COTP orders and PSC deficiencies, with IMO or
   official number attached. Pull **per vessel**: registry import → MISLE VesselId →
   `getVesselCases` → for "Incident Investigation" IDs, IIR title/summary/vessels/water
   segments. Run it on a schedule, not live from the browser. Be polite: SOAP, serial calls.
2. **TSB MARSIS (BC + all Canada).** Monthly CSV, OGL-Canada, has IMO/MMSI/call sign/ON. It is the
   only source here that carries **MMSI**. Straightforward bulk import.
3. **NRC (US spills, INITIAL reports).** It adds spill material and quantity for events USCG
   never investigates. Name-only, so **candidate links only**, confirmed by name + date +
   (where present) a PSIX/IIR case on the same date.
4. **NOAA IncidentNews** (public domain, small): candidate links only, mainly for notable spills.
5. **WA Ecology spills to water:** rich WA quantities, but no vessel field and the licence
   **prohibits commercial use**. Hold until Josh decides.
6. **Cerulean** (Phase 4, after SkyTruth OKs automated access), then NTSB (link-out), Tokyo MoU via
   OpenSanctions (non-commercial). Paris MoU, TC detention list and GISIS: not now.

### Conservative matching (incidents are EVENTS tied to a vessel at a time)
- An incident is a **source_entity of kind "event"** with its own raw record; the link to a
  vessel is an **entity_link** (accepted/candidate), exactly as with identity sources. Incident
  data is never written onto the vessel as an attribute.
- **Accept automatically only on a registry-class identifier:** IIR/PSIX MISLE VesselId (joined
  via the PSIX registry import), IMO (checksum-valid, exactly one vessel), or USCG official number
  (exactly one vessel). TSB IMO / official number likewise.
- **MMSI (TSB, Cerulean) → candidate only**, and only if the MMSI's observed window on our vessel
  covers the event time (resolve against the identity valid **at the event time**, per CLAUDE.md).
- **Name-only (NRC, IncidentNews, Ecology) → candidate only**, never auto-accepted. The
  BLACKFISH hits in NRC 2026 (pleasure craft) and Ecology 2015 (fishing vessel) are both different
  boats from BLACKFISH VI (a 2024 passenger vessel).
- Cross-source dedupe (the same event in IIR + NRC + Ecology) is an **interpretation layer**:
  link events with `same_event` candidates (time window + distance + name), keeping every raw record.
- Time: store raw strings; IIR/PSIX offsets are wrong (UTC wall-clock with an Eastern offset);
  NRC and Ecology times are local, zone unstated → reject or flag rather than assume.

### Proposed minimal schema (additive; for discussion only, nothing created)
```
ships.incident_events              -- one row per source event (evidence, never edited)
  id uuid pk
  source_id            -> ships.sources           (licence/attribution live there)
  source_record_id     -> ships.source_records    (raw payload, SHA-256 versioned)
  source_event_key text        -- IIR ActivityId, PSIX ActivityId, TSB OccNo, NRC SEQNOS, ERTS_number…
  event_kind text              -- casualty | pollution | operational_control | psc_deficiency | inspection_finding | slick_attribution
  event_subtype_raw text       -- e.g. 'Aground', 'Pollution - Oil', 'COTP Order (Restriction of Operations)'
  event_subtype text           -- normalized: grounding|collision|allision|fire|sinking|flooding|loss_of_propulsion|spill|detention|…
  occurred tstzrange, period_kind text, time_raw text, time_quality text  -- e.g. 'utc_mislabelled_offset'
  geom geography(Point) null, location_text text, position_quality text
  severity_raw text            -- e.g. 'Significant Marine Casualty', TSB 'CLASS 3'
  deaths int null, injuries int null      -- counts only, no names
  material text null, quantity numeric null, quantity_unit text null, quantity_to_water numeric null
  narrative text null          -- only where the licence allows and after PII redaction
  source_url text              -- clickable inline provenance (prime directive)
  evidence_class text          -- 'official_investigation' | 'initial_report' | 'inferred' (Cerulean)
  unique (source_id, source_event_key)

ships.incident_vessel_refs         -- how the SOURCE names each involved vessel (evidence)
  incident_event_id, role_raw ('Involved in a Marine Casualty', 'Subject of Search and Rescue'…),
  name_raw, imo_raw, mmsi_raw, call_sign_raw, official_number_raw, source_vessel_key (MISLE id / TSB VesselID)

ships.entity_links (existing)      -- interpretation: incident_vessel_ref → vessel, accepted|candidate, method
  methods: MISLE_ID_EXACT, IMO_EXACT, ON_EXACT, MMSI_TEMPORAL (candidate), NAME_DATE (candidate)
```

---

## 12. Open questions for Josh

1. **Commercial status:** WA Ecology prohibits commercial use and Cerulean restricts use to
   "environmental conservation applications". Is EarthAtlas non-commercial conservation use? That
   decides whether #5 and Cerulean can go in at all.
2. **Injury and fatality cases:** EURODAM has 11 passenger/crew injury investigations. Should the card
   show them (as counts, no narrative), or only casualties/pollution/detentions?
3. **Narratives:** show the IIR "brief" and TSB "Summary" text on cards (they are useful but may
   name people), or only type + date + place + link out?
4. **Name-only candidates** (NRC, IncidentNews, Ecology): show them on the card as "possible
   match (unconfirmed)", or keep them hidden until reviewed?
5. **IIR bulk export:** OK to submit the CGMIX XLSX export form (Northwest District, date range) once
   to capture the columns, or stay with per-vessel SOAP pulls?
6. **Cerulean:** should we email SkyTruth about automated API access (their robots.txt disallows all
   bots) before Phase 4?
7. **Detentions:** USCG op-controls include COTP orders and letters of deviation. Show all of them,
   or only IMO-reportable ones as "detention"?

---

### Sources checked (2026-09-25)
cgmix.uscg.mil/IIR, /xml/IIRData.asmx, /PSIX, /xml/PSIXData.asmx (live SOAP calls);
dco.uscg.mil investigations pages (browser); homeport.uscg.mil (expired cert);
nrc.uscg.mil + FOIAFiles/DataDictionary.xlsx + CY26.xlsx; incidentnews.noaa.gov/raw/index +
incidents.csv; gis.ecology.wa.gov SPPR/Spills_map_series/MapServer/130 (live queries);
ecology.wa.gov copyright page; open.canada.ca CKAN API; tsb.gc.ca MARSIS CSVs + dictionary;
wwwapps.tc.gc.ca PSC detention page (GET only); api.cerulean.skytruth.org (collections +
get_slicks_by_source); skytruth.org FAQ + terms; github.com/SkyTruth/cerulean-cloud;
data.ntsb.gov / carol.ntsb.gov; parismou.org/inspection-search; opensanctions.org
tokyo_mou_detention; EMSA/IMO pages via web search.

---

## 13. Import (built 2026-09-26, DEV database only)

Decisions (Josh, 2026-09-25/26): EarthAtlas is non-commercial conservation use (WA Ecology usable;
Cerulean not automated until SkyTruth answers). Injuries: counts only. Narratives: stored as raw
evidence, never displayed (card = neutral summary + official report link). Name-only matches:
hidden, kept as candidates for review.

**Schema** (`lib/ships/migrations/006_incidents.sql`, additive): `incident_events` (one row per
version of a source event; same content re-imported only touches `last_*`, changed content inserts a
new version and marks the old one `superseded`; never deleted), `incident_vessel_refs` (the source's
own identifiers per vessel, verbatim, with role), `incident_links` (interpretation: `accepted` |
`candidate`, method, evidence; accepted links are never moved). Raw payloads are ordinary
`source_records` (source entity kinds `iir_activity`, `psix_opcontrol`, `psix_deficiencies`,
`ecology_erts`, `nrc_report`, `incidentnews_incident`).

**Matching** (`lib/ships/incidents.js`, `incidents:v1`). Accepted automatically only on:
`USCG_VESSEL_ID` (MISLE id → the vessel our PSIX import linked), `IMO_EXACT` (checksum-valid,
registry-held, exactly one vessel; when the source does not say whether the number is an IMO or an
official number, as in IIR, the name must agree too), `IMO_AIS_NAME` (AIS-only IMO + name),
`OFFICIAL_NUMBER_NAME` (same scheme + name), `MMSI_NAME` (MMSI held at the event time per our
observed windows, name agrees, only vessel then). Candidates only: `IMO_AMBIGUOUS`,
`OFFICIAL_NUMBER` (name differs), `MMSI_TEMPORAL` (outside our window / name differs / several),
`CALLSIGN_NAME`, `NAME_DATE_PLACE` (≤ 3 vessels share the name). Identifiers pointing at two
vessels → unresolved, both kept as candidates. Name-only sources (Ecology, NRC, IncidentNews) never
accept. Nothing here creates, merges or edits vessels.

**Time.** IIR: the `-04:00/-05:00` offset is ignored, wall clock read as UTC (§1; re-confirmed on
KODIAK ENTERPRISE: fire ~0300 local = `10:00-04:00`). PSIX op controls / exam starts: read the same
way, flagged `cgmix_offset_read_as_utc_unverified_for_psix`. Ecology: `Date_incident` is local wall
clock encoded as UTC epoch (ALEUTIAN ISLE 13:55, KODIAK ENTERPRISE 03:06) → day precision. NRC,
IncidentNews: local dates, no zone → day precision. The raw value is always in `time_raw`.
**Note:** the existing PSIX registry import stored `uscg_activity` start times WITH the offset applied
(4–5 h late if the IIR quirk holds for PSIX too); not changed here.

**Privacy on read** (`lib/ships/incidentsPublic.js`): `getVessel().incidents` returns whitelisted
fields only (no narrative, no source title/case name, whitelisted `detail` keys); `getRecord` /
`getIncidentRecord` return raw payloads with the IIR brief, PSIX deficiency descriptions, NRC
caller description, IncidentNews description and Ecology `CaseName` replaced by a placeholder. NRC
responsible-party columns are dropped before storage (original row hash kept). Recreational boats
get no extracted name. `getIIRInvolvedParties` is never requested.

**Code:** `lib/ships/incidents.js` (store + matching), `incidentsCgmix.js`, `incidentsEcology.js`,
`incidentsNames.js`, `incidentsPublic.js`; `scripts/ships/cgmixClient.js`,
`import-incidents-cgmix.mjs`, `import-incidents-ecology.mjs`, `import-incidents-names.mjs`
(`npm run ships:import-incidents-{cgmix,ecology,names}`); tests `lib/ships/test/incidents.test.js`,
`incidents-db.test.js`. Logs: `scripts/ships/bake-ais/build/incidents/` (gitignored).

**TSB MARSIS: BLOCKED.** `www.tsb.gc.ca` answers our descriptive User-Agent with HTTP 403 (Azure
Application Gateway) for every CSV and the dictionary (checked 2026-09-26). That is an access control;
we do not spoof a browser. Not imported. Options: ask TSB, or Josh downloads the CSVs by hand and we
write a local-file importer (columns then verifiable; not written blind).

**Dev import results (2026-09-26, `earthatlas-ships-dev`).** Stopped early: the dev Neon project
hit its **512 MB Free-plan size limit** during the PSC-deficiency pass (≈ 200 of 5,426 exams done).
Every DB write, including the throwaway-schema tests, now fails until space or plan changes.

| Source | Fetched | Active events | Vessel refs | Accepted | Candidate-only | No link |
|---|---:|---:|---:|---:|---:|---:|
| USCG IIR | 3,246 activities (+ 8 replayed) | 3,249 | 4,084 | 3,314 (USCG_VESSEL_ID 3,259 · OFFICIAL_NUMBER_NAME 55) | 79 | 691 |
| PSIX op controls | 2,312 activities (95 empty) | 2,217 | 2,217 | 2,217 | 0 | 0 |
| PSIX deficiencies | ~200 exams (partial) | 102 | 102 | 102 | 0 | 0 |
| WA Ecology | 1,347 rows → 1,278 ERTS | 1,278 | 279 | 0 | 109 | 170 |
| NRC CY23–26 (WA) | 1,277 reports | 1,277 | 530 | 0 | 170 | 360 |
| IncidentNews | 188 of 4,937 rows | 188 | 98 | 0 | 13 | 85 |

1,554 vessels have ≥ 1 accepted incident (1,528 of the 14,760 with Salish MarineCadastre AIS);
332 have candidate links only. WALLA WALLA, ALEUTIAN ISLE and KODIAK ENTERPRISE are not among our
vessels, so their IIR / Ecology / NRC events are stored but unresolved.
