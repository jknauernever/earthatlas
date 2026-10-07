# WA DNR aquatic land leases at our terminals (study + build, 2026-10-07)

Facts only. Two parts: (1) the two lease agreements Lovel Pratt (Friends of the San Juans) shared privately, which stay **out of
the public site and the database**; (2) DNR's public map service, which is what /ships shows. Code: `lib/ships/dnrLeases.js`,
`lib/ships/countyShoreline.js`, `scripts/ships/import-wa-leases.mjs` (`npm run ships:import-wa-leases`); hand-checked data
`lib/ships/data/wa-leases-sites.json`; migration 030.

## 1. The two leases Lovel sent (PRIVATE: not on the site, not in the database)

Files (gitignored cache): `scripts/ships/facilities/cache/dnr-leases/20-A09122 BP Lease w Exhibits.pdf` (50 pages, scanned with
OCR, 1.9 MB) and `…/20-A12165 DNR Tesoro Lease.pdf` (34 pages, scanned with OCR, 12 MB). Read in full with `pdftotext -layout`;
the survey exhibits were read from page images. "p." = PDF page.

### Lease 20-A09122 (BP Cherry Point)

| | What the document says | Where |
|---|---|---|
| Parties | State of Washington (DNR) and **ARCO Products Company**, an operating unit of Atlantic Richfield Company (signed for ARCO by Glenn C. Butler, Refinery Manager; for the State by Jennifer M. Belcher, Commissioner of Public Lands) | p.4, p.21 |
| Current lessee in DNR's public data | BP West Coast Products LLC (the lease kept its number through the change of company) | DNR map service, §2 |
| Premises | "a portion of the Strait of Georgia", second-class tidelands and bedlands in Whatcom County; Exhibits A, A-1, A-2. Survey (Exhibit A): tidelands and bed of the Strait of Georgia in front of Government Lot 5, Section 13, T39N R1W W.M. (Sections 13 and 24); "This survey calculates **81.4 acres** for the proposed DNR lease area" (DNR's GIS: 81.53 acres) | p.4, p.24 |
| Term | **Thirty years, 1 April 1999 to 31 March 2029** ("ending on the 31st day of March, 2029 (the 'Termination Date')"). Lovel's date is confirmed by the document. | p.5, §3.1 |
| Renewal | The table of contents lists "3.2 Renewal of the Lease", but the body has **no renewal clause**: §3.2 is "Delay in Delivery of Possession". Hold-over after 31 March 2029 is month-to-month on 30 days' notice (§3.4). | p.1, p.5–6 |
| Permitted use | "construction, operation, and maintenance of a petroleum and petroleum products transfer dock and outfall for discharging of effluent, treated in compliance with the NPDES permits … and for no other purpose"; water-dependent use | p.5, §2.1 |
| Rent | $18,530.00 a year to start; inflation-adjusted yearly and revalued every four years (RCW 79.90.450–.902), capped at +50 % a year | p.6, §4.1, §4.4 |
| Financial security | Bond $92,559.00 | p.14, §10.2 |
| Insurance | General liability $1 M / $2 M aggregate until 4 May 1999, then **$5 M each occurrence / $20 M aggregate**; employers' liability $5 M; property insurance at replacement value; DNR named additional insured | p.15–16, §10.3 |
| Existing improvements | Trestle and "wing B" (south wing) of the dock: approach trestle on 55 bents, loading platform with 8 Chiksan arms, breasting dolphins 1–4, mooring dolphins 1–4; 382 pilings | p.8 §7.1, p.30 Exh. C |
| Proposed improvements | New **north wing**: 175 × 90 ft loading platform on 74 steel caissons, 3 loading arms, dock office, **marine vapor recovery** skid | p.31 Exh. C-1 |
| Operations (Exhibit B) | "loading and unloading of crude oil and petroleum products from marine vessels and barges"; ARCO "intends to operate the terminal through the 30-year lease period" | p.27 |
| Spills | Annual pipeline pressure tests (250 psig), oil spill prevention plan revised yearly, drills: weekly/quarterly call-outs, annual tabletop, triennial full plan drill (WAC 173-181, 33 CFR 154, 40 CFR 112); leak detection on dock lines (8 % of max flow within 15 minutes, installed 1997) | p.27–29, p.43 |
| Exhibit D (terms for the north wing and coke loading, rev. 17 March 1999) | DNR authorises the north wing and loading **calcined coke** onto ships only if Cherry Point herring thresholds are met in spring 1999 or a (screening or regional) ecological risk assessment finds no unacceptable risk, reviewed for "take" of ESA-listed salmon by NMFS. ARCO funds herring studies up to **$250,000** | p.32–37 |
| **Vessel traffic** | **No limit on vessel numbers, sizes or calls.** The only vessel-traffic term: Phase 2 study list includes "Participate in and assist regulatory agencies with funding of a **North Puget Sound vessel traffic safety study**" ($2,000,000 study cost, 1 year) | p.37, Exh. D §C.2 |
| Ballast / bilge | Dirty ballast pumped ashore; segregated ballast discharged only after inspection, sampling and USCG certificate; Interim Segregated Ballast Discharge Policy for ARCO-owned tankers (exchange before "Buoy J", by 31 Dec 2001); **no bilge water discharge at the pier** | p.40–41, p.47–48 |
| Herring thresholds | 5,000 tons of spawners (25 % of unfished biomass) or doubling of 1996–97 spawning shoreline; recruitment ≥ 75 % of long-term average (mean 2,200 tons); adult survival > 50 % | p.46 |
| Adaptive management | ARCO must change operations "as required by the DNR … for the protection of the herring" under a future Herring Recovery Plan and if the regional risk assessment finds harmful discharged chemicals; outfall may be shared (Praxair named) | p.44–46 |
| Other | Moorage, anchoring, berth numbers: none beyond the structures above. Recordation required in Whatcom County (§18.11). | p.21 |

### Lease 20-A12165 (Tesoro / now Marathon Anacortes)

| | What the document says | Where |
|---|---|---|
| Parties | State of Washington (DNR, Doug Sutherland, Commissioner) and **Tesoro Refining and Marketing Company**, a Delaware corporation (signed by Bruce A. Smith, Chairman, President and CEO) | p.4, p.26 |
| Premises | "the aquatic lands commonly known as Fidalgo Bay, which are bedlands located in Skagit County"; Exhibit A survey: lease area **21.8 acres** "more or less, as computed from the line of extreme low water" (DNR's GIS: 21.52 acres); also a DNR easement application 51-078087 for the outfall; survey recorded with Skagit County 21 July 2004 | p.4, p.29 |
| Term | **Thirty years, 1 September 2004 to 31 August 2034** | p.5, §3.1 |
| Renewal | Option to renew for "Zero (0) additional terms of Zero (0) years each"; initial term plus renewals not to exceed 30 years | p.5, §3.2 |
| Permitted use | "maintaining a transportation causeway, wharf, and related facilities for loading and unloading petroleum"; water-dependent | p.5, §2.1 |
| Rent | $11,293.83 a year to start; same adjustment rules as above | p.6, §4.1 |
| Financial security | Bond $30,000 | p.17, §10.2 |
| Insurance | General liability **$1 M each occurrence / $2 M aggregate**; employers' liability $1 M | p.18–19, §10.3 |
| Existing improvements | "Docks and wharf structure supported by pilings" | p.9, §7.1 |
| Operations (Exhibit B, June 2004) | Wharf built 1955; refinery ~115,000 bbl/day; **~50 million barrels a year** transferred; **"Over 100 tank ships and 400 tank barges call at the wharf annually"**; two assist tugs; crude ships "in the 75–125 DWT class" (thousand tonnes) about every 10 days, discharging 25,000–30,000 bbl/hour; 3 chartered double-hull product tankers | p.30–31 |
| **Vessel traffic** | **No limit.** The vessel figures above are a description in the operating plan, not a cap. USCG exclusion zone (300 ft) around wharf and causeway | p.30–31 |
| Spills | Wharf Operations Manual (33 CFR 154/156, WAC 173-180B), Facility Response Plan (approved by Ecology and USCG), SPCC plan, annual drills; pipelines tested per API 570 | p.30–33 |
| Dredging / piles | Maintenance dredging allowed with permits (DMMO); pile replacement ≤ 18 piles a year under the Corps nationwide permit | p.31 |
| Other | NPDES permit WA-000076-1 (May 1999). Recordation required in Skagit County (§18.11). | p.33, p.25 |

**On Lovel's note** ("newer leases are identifying vessel traffic limits"): neither of these two leases sets a vessel-traffic
limit. BP's (1999) commits ARCO to help fund a North Puget Sound vessel traffic safety study; Tesoro's (2004) only describes
traffic. Newer leases were not checked (none was available).

### Are these documents public?

- **Their key facts are public.** DNR's public map service (§2) lists both by number with lessee, type, status, start date and
  mapped acres: 20-A09122 (BP West Coast Products LLC, active since 1999-04-01, 81.53 acres) and 20-A12165 (Tesoro Refining and
  Marketing Co, active since 2004-09-01, 21.52 acres).
- **The end dates, rent, terms and exhibits are not published online** that I could find: the service's end-date field
  (CONTRACT_END_DT) is empty for every one of its 6,168 active records; web searches for both lease numbers found nothing; DNR's
  layer "Active aquatic leases expiring 2020–2029" (WRAP_LandUse/11) has 19 rows and neither lease.
- They are public records in law (each lease requires recording in the county, §18.11; DNR records are disclosable under RCW
  42.56), so DNR or the county auditor would supply them on request. EarthAtlas has not asked (no contact).
- **So /ships shows only the public fields.** The 31 March 2029 end date, rent, insurance and Exhibit D terms stay in this doc
  until Josh decides (e.g. a records request to DNR, or Friends publishing the lease).

## 2. The public source: DNR AQ_ENC_Public_Prod map service (catalogue, read 2026-10-07)

`https://gis.dnr.wa.gov/site3/rest/services/Aquatics/AQ_ENC_Public_Prod/MapServer` (also a FeatureServer). ArcGIS 11.5,
capabilities Query/Map/Data, max 2,000 records a query. Copyright text "WADNR AQR GIS". The `Aquatics` folder has 59 services;
the others checked (AQ_LandUse, WRAP_LandUse, AQ_Programatic, Washington_State_Aquatic_Lands_and_Boundaries) hold reserves,
parks, ownership and the 19-row expiring-lease subset, not leases. A `gis-dev` copy (AQ_ENC_Public) exists; not used.

| Layer | Name | Geometry | Rows |
|---|---|---|---|
| 1 | Active Uses Points ("agreements in the current term … actively managed by DNR") | point | 6,168 |
| 2 | Application Phase (no footprint until signed) | point | 1,699 |
| 3 | Extended/ Holdover | point | 483 |
| 4 | Historic/ Not Active Use Authorizations | point | 9,050 |
| 25 | Port Management Agreement (PMA) Areas | polygon | 122 |
| 104 | PMA Boundaries (same 122 features) | polygon | 122 |
| 100 | Engineered Log Jams | point | – |
| 58–61 | Dredged material disposal sites / target areas / zones / boundaries (DMMP) | point / polygon | – |

Fields on layers 1–4 (alias): OBJECTID; CONTRACT_NO (NaturE contract #, e.g. C2000A09122); LEASE_JKT_NO (lease jacket #,
e.g. 20-A09122); CONTRACT_TYPE_NM (coded: 20 Aquatic Land Lease, 21 Aquatic Unauthorized U&O, 22 Harbor Area, 23 R/Entry & Moor
Buoy, 31 Aquatic Material Sale, 50 R/W Granted Land, 51 R/W Aquatic Land, 92 Management Agreement); APPLICATION_NO; SITE_ID;
CONTRACT_ACTIVE_CD (Y active, EX extended holdover, AP application, N inactive/historic, UK unknown); LOCATION_BASIS (33 codes,
e.g. 11 contract footprint, 26 plate, 28 section centre); YLATITUDE, XLONGITUDE; EDIT_DT; GIS_ACRES (footprint acres; filled
on 1,040 of 6,168 active rows); EDIT_ISSUE_FLG; COUNTY_CD (39 counties); EDIT_COMNT; EDIT_NM (DNR staff; dropped before
storage); CONTRACT_EFFECTIVE_DT (filled 6,147/6,168); **CONTRACT_END_DT (filled 0/6,168)**; DISTRICT_UNIT_NM, INDUSTRY_NM,
PERSON_RESPONSIBLE (all empty); BUSINESS_PARTNER_NM (lessee, 6,144); BUSINESS_PARTNER_ADDRESS. Active rows by type: 20 → 875,
22 → 254, 23 → 2,380, 51 → 2,592, 92 → 31, 31 → 28, 21 → 3. The PMA polygons carry the agreement numbers (the 0800xx series)
and site names but no port name; the port's name comes from the agreement's points in layer 1. **No lease footprint polygons
are public**; matching is by point distance plus the lessee's name, or by a berth inside a PMA polygon.

## 3. Matches to our 59 WA terminals (dev, 2026-10-07)

Rule (in `wa-leases-sites.json` "about"): a lease only when DNR's lessee name carries the operator's words AND a point is within
1 km of a berth; a PMA only when a berth is inside the polygon, or within a few tens of metres where the terminal is that
port's own or the area is named for it. Nothing by distance alone. Result: **13 leases on 12 terminals, 25 terminals on
port-managed land, 22 with nothing linked** (each with its reason in the data file).

Leases: BP Cherry Point 20-A09122; Phillips 66 Ferndale 20-B11714; Marathon Anacortes 20-A12165 (lessee still "Tesoro"); HF
Sinclair 20-A12561; Petrogas/ALA Ferndale wharf 20-A08488; NuStar Tacoma 22-002572 (holdover; renewal application 22-A02572);
SeaPort Seattle 22-A90037; Point Wells 20-013465 (holdover); Covich-Williams 20-012551 (holdover); Maxum Pier 15 22-081453 and
22-A02527 (lessee Rainier Petroleum: Seattle Fire's marine refueling permit list names Rainier Petroleum at Terminal 15);
Kalama Export 22-A02586; Weyerhaeuser Longview 20-095644.

Port-managed (PMA): Port of Seattle 22-080031 (T5, T18, T30, T46, T86, T91, Pier 66), Port of Tacoma 20-080007 (TEMCO,
Husky), Port of Bellingham 20-080025 (Fairhaven fuel dock, shipping terminal), Port of Anacortes 20-080024, Port of Everett
20-080027, Port of Port Angeles 22-080013, Port of Olympia 20-080006, Port of Vancouver 20-080008 (5 terminals + United Grain),
Port of Kalama 20-080002 (TEMCO), Port of Grays Harbor 22-080015 (T1, T2, T4).

None linked (reasons in the file): Marathon Port Angeles, U.S. Oil, SeaPort Sound, Phillips 66 Tacoma, Puget LNG, Kinder Morgan
Harbor Island, Shell Seattle, both Navy fuel piers, Radius (Schnitzer), Amrize (Lafarge), Ash Grove, Port of Tacoma
PCT/WUT/West Sitcum/TOTE/T7/Blair, LANXESS Kalama, Port of Longview berths 1–3 and 5–7, EGT. Many Tacoma and Duwamish docks
sit on land that is not state-owned (private or port-owned tidelands), so no DNR lease is expected there; the map service
cannot show ownership by itself (WRAP_LandUse/21 "Aquatic Land Ownership Type" could, not used yet).

Shown on the terminal card's Permits tab: lease number and type, DNR's lessee, "in force since <date>" (or holdover), mapped
acres, "end date not published by DNR", a link to DNR's own record (`…/MapServer/<layer>/query?where=LEASE_JKT_NO='…'&f=html`),
and the stored record. Requests: 29 to gis.dnr.wa.gov (catalogue, counts, 12 full-layer pages incl. layer 4, PMA polygons, one
city/UGA lookup, one link check).
