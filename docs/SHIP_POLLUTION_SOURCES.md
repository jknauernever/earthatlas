# /ships Phase 4 — ship pollution sources (study)

Written 2026-09-27 as a study. Since then: Climate TRACE voyages / port stays and IMO scrubbers are live; **EU MRV authorized
2026-09-29 and built on dev** (§1 "Verified and extended 2026-09-29" and "Built (dev)"). Cerulean still waits on SkyTruth.

Conventions: "live 2026-09-27" = checked against a primary page or a live response today.
**UNVERIFIED** = from secondary sources, memory notes, or inference; confirm before relying on it.
EarthAtlas is non-commercial conservation use, so NC / conservation-only licences are acceptable
with attribution (Josh, 2026-09-25).

Related house docs (read first, not repeated here):
- `docs/CLIMATETRACE_API.md`, `docs/CLIMATETRACE_FACTS.md` — Climate TRACE packages, API, licence, method caveats.
- `docs/SHIP_INCIDENT_SOURCES.md` §7 — Cerulean API facts checked 2026-09-25 (ToS, restricted collections, test calls).
- `docs/GFW_VESSELS_API.md` — identity; the IMO/MMSI join keys used below.

---

## Summary

| # | Source | What | Ship identifier | Access | Licence | Verdict |
|---|---|---|---|---|---|---|
| 1 | **EU MRV (EMSA THETIS-MRV)** | Verified annual fuel, CO₂, CH₄, N₂O, CO₂eq per ship, **EU/EEA-related voyages only** | IMO | Unauthenticated JSON + one XLSX per year (2018–2025) | EMSA: "Reproduction is authorised, provided the source is acknowledged" | **Usable now.** Best official per-ship number; label its EU scope clearly |
| 2 | **Climate TRACE voyages** | Modelled per-voyage and per-port-stay emissions (9 gases + CO₂e) | `gfw-mmsi-N`, `gfw-imo-N`, `om-imo-N` | BigQuery `shipping_voyages` only (not in downloads; "On request" per schema) | CC BY 4.0 (house doc); ship-level table treated as CC BY 4.0 (Josh, 2026-09-29) | **Usable**; Salish 2024–25 already pulled locally |
| 3 | **SkyTruth Cerulean** | Satellite (Sentinel-1 SAR) oil-slick detections + ranked possible sources (AIS vessels, infrastructure, dark vessels) | MMSI (vessel sources) | Web map + OGC API; API `robots.txt` blocks all bots; some collections need a secret key | CC BY-SA 4.0 + conservation-use-only + "not evidence of responsibility" | **Blocked on SkyTruth permission.** Draft email below |
| 4a | IMO DCS | Fuel per ship (global) | — | Anonymised aggregates only | — | Not usable per ship |
| 4b | UK MRV | UK-related voyages | IMO | No public per-ship release found | — | Not usable (UNVERIFIED) |
| 4c | EU ETS Union Registry | Company-level compliance | company | Registry | — | Not per ship |
| 4d | NOAA NESDIS MPSR | Analyst-drawn suspected-oil polygons, US waters | none | Public since 2018-03 | US federal (PD, UNVERIFIED) | Later: slick layer without vessel links |
| 4e | Puget Sound Maritime Air Emissions Inventory 2021 | Regional inventory by vessel class | none | PDF report (published 2024-06-06) | Not stated | Context only |
| 4f | EPA VGP/VIDA eNOI | Which vessels discharge scrubber washwater in US waters | vessel | Submission system; public search UNVERIFIED | US federal | Worth a check for the scrubber question |
| 4g | WA Ecology spills | Spills to water | name only | ArcGIS | Commercial use prohibited | Already in `SHIP_INCIDENT_SOURCES.md` |

---

## 1. EU MRV — EMSA THETIS-MRV (live 2026-09-27)

**Legal basis:** Regulation (EU) 2015/757 (MRV). Ships over 5,000 GT carrying cargo or passengers
for commercial purposes on voyages to, from, or between EU/EEA ports, and at berth in them. Since
the 2024 reporting period the file also carries CH₄, N₂O and CO₂eq plus the ETS-relevant share
(consistent with the maritime extension of the EU ETS from 2024-01-01). Coverage of offshore ships
(e.g. "Other ship types (Offshore)" shows 6 ships in 2024) is new.

### Access — public, no auth, no CAPTCHA on the bulk file
The site is an ExtJS single-page app (`https://mrv.emsa.europa.eu/#public/emission-report`). The page
loads Google reCAPTCHA, but the endpoints below answered plain requests with a generic browser
User-Agent. No `robots.txt` (404). Public endpoints found in the app bundle (`app.js`):

| Endpoint (`https://mrv.emsa.europa.eu/api/public-emission-report/…`) | Result 2026-09-27 |
|---|---|
| `reporting-periods` | `[2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018]` |
| `downloadable-files` | One file per year with `version` + `generationDate`. 2024 = **v244, generated 26-09-2026**; 2025 = v58 (15-09-2026); 2023 = v91; 2018 = v275 |
| `reporting-period-document/binary/{year}/{version}` | The XLSX. 2024 v244 = 9,466,339 bytes, `Content-Disposition: …EU MRV Publication of information.xlsx` |
| `reporting-period-document/binary/{year}/{version}/{date}` | Historical version (not tried) |
| `reporting-period-history/{year}[/{version}]` | 400 "Please insert pagination sort column" (needs sort params; not explored) |
| `configuration` | Search form on IMO/name/period/type/coverage; grid columns IMO, NAME, SHIP_TYPE, COMPANY, REPORTING_PERIOD, TOTAL_CO2, TOTAL_CO2_EQ; `dataGridExport:false`, `downloadableFiles:true`, `disclaimer:false` |
| `ship-types` | Code list (BULK, CHEM, CONT, GAS, LNG, OIL, PAX/CRUISE, OTHER/OFFSHORE, …) |
| `details/{erId}`, `smart-search/ship-name`, `supporting-materials/…` | Not tried |
| `stats`, `flags` | 400 "not enabled" |

**Update cadence:** files are regenerated continually (version numbers climb; several regenerated
within the last week), because late or corrected reports keep arriving. Each year's file is final
only in practice after ~mid of the following year. A bake should key on `(year, version)` and
re-pull when `downloadable-files` shows a new version — one tiny JSON request per check.

### File structure (2024 v244, parsed 2026-09-27)
- Two sheets: **"2024 Full ERs"** (14,170 ships, one row each) and **"2024 Partial ERs"** (1,008 rows —
  ships that changed company mid-year; `Reporting Period` looks like `2024 (1/1 - 21/10)`).
- Row 1 group headers: Ship · Company · DoC · Verifier · Monitoring methods · Annual monitoring results
  (Fuel consumption · CO₂ · CH₄ · N₂O · CO₂eq · Distance and time · Average energy efficiency ·
  Additional voluntary reporting).
- 113 columns. Key ones:
  - Ship: `IMO Number`, `Name`, `Ship type`, `Reporting Period`, `Technical efficiency`
    (e.g. `EEXI (10.5 gCO₂/t·nm)` — EEDI or EEXI with value, as one string), `Port of Registry`, `Home Port`, `Ice Class`.
  - Company: **company IMO number** and name (e.g. Holland America Line N.V., 5375992).
  - DoC issue / expiry dates; Verifier name, address, accreditation number, NAB.
  - Monitoring methods `A`, `B`, `C`, `D`, `D` (Yes/blank). Per Reg. 2015/757 Annex I these are
    A = bunker delivery notes + tank stocktakes, B = on-board tank monitoring, C = flow meters,
    D = direct CO₂ measurement (the duplicated `D` header is as published; meaning of the second is UNVERIFIED).
  - Fuel: total, derogation share, laden, cargo heating, dynamic positioning [m tonnes].
  - For each of CO₂ / CH₄ / N₂O / CO₂eq: total; voyages between MS ports; departed from MS ports;
    to MS ports; at berth in MS ports; within MS ports; laden; passenger; freight; to be reported under
    the ETS Directive 2003/87/EC [m tonnes].
  - Distance through ice, time at sea [h], time at sea through ice.
  - Efficiency indicators: fuel and CO₂ / CO₂eq per distance, per transport work (mass, volume, dwt,
    pax, freight), per time at sea — each also "on laden voyages".
  - `N/A` is used for not-applicable; blank cells occur. Empty cells are **omitted** from the sheet
    XML, so parse by cell reference, never by position (a positional parse shifted columns).

### What "Total CO₂" means — the key caveat
It is **only the emissions on EU/EEA-scope voyages and at EU/EEA berths**, not the ship's annual
global emissions. Example (live file): EURODAM, IMO 9378448 (Holland America, Salish/Alaska cruise
ship) — 2024 MRV total CO₂ **298 t** (27 h at sea, EU legs only). Climate TRACE's voyages touching the
Salish Sea for the same ship in 2024 sum to **52,122 t CO₂** (118 records, our local pull). The ship
card must say "on voyages to/from EU & EEA ports" next to any MRV number.

### Coverage of Salish Sea / US ships (measured 2026-09-27)
Proxy: the 2,778 IMO-identified ships in our local Climate TRACE Salish voyage pull with 2024 records.
**803 (29%) appear in the 2024 MRV file** (either sheet). By Climate TRACE type:
LNG carriers 41/59, vehicle carriers 114/190, general cargo 51/96, oil tankers 70/153, chemical tankers
109/240, bulk carriers 295/907, container 59/215, passenger 10/112; tugs 0/197, fishing ~0.
So MRV covers a large share of the ocean-going fleet that trades globally, and almost none of the
local/coastal fleet (tugs, ferries, fishing, pleasure craft — e.g. LINNEA ROSE has no IMO and is out of scope).

### Licence
MRV portal itself shows no terms (`disclaimer:false`). EMSA's site-wide disclaimer (live 2026-09-27,
https://www.emsa.europa.eu/disclaimer.html): "Reproduction is authorised, provided the source is
acknowledged, save where otherwise stated." No contrary statement found on the MRV publication.
Proposed attribution: "Source: EMSA THETIS-MRV, EU MRV publication {year} (v{version})" linking to the
portal. Commercial use: not restricted by that wording. Record in `ships.sources` with this text.

### Identifier join
IMO (ship) — checksum-valid, registry-class under our resolver rules, so `IMO_EXACT` applies. The
company IMO number is a separate identifier (an owner/ISM-company number), useful later as a
`ism_manager` / company assertion — **do not** confuse it with the ship IMO (both columns are headed `IMO Number`).

### Verified and extended 2026-09-29 (live checks; files in gitignored `scripts/ships/mrv/raw/`)

**robots / terms.** `mrv.emsa.europa.eu/robots.txt` → 404 (none). `www.emsa.europa.eu/robots.txt` is a stock Joomla file
(`User-agent: *`, disallows only `/administrator/`, `/cache/`, `/components/` … — nothing on the MRV host). No rate limit is
published or signalled in response headers; the app's own config has `USE_RECAPTCHA:false`. We keep to a handful of requests
with ≥1 s between file downloads and a generic browser User-Agent.

**Licence (exact wording, EMSA disclaimer page, "Copyright" section, re-read 2026-09-29):** "Reproduction is authorised, provided
the source is acknowledged, save where otherwise stated. Where prior permission must be obtained for the reproduction or use of
textual and multimedia information (sound, images, software, etc.), such permission shall cancel the above mentioned general
permission and indicate clearly any restrictions on use." The MRV portal states nothing otherwise (`configuration.disclaimer:false`).
Attribution used: "Source: EMSA THETIS-MRV, EU MRV publication of information", linked per value to EMSA's page for that ship
and year. Recorded in `ships.sources` (`emsa-thetis-mrv`, commercial_use = true since the wording doesn't restrict it).

**The portal's own public text (GHG Emission Report tab, 2026-09-29):** publication under Art. 21 of Reg. (EU) 2015/757;
"2021 is the first reporting period reflecting the impact of the United Kingdom's withdrawal from the EU"; "2024 is the first
reporting period following the MRV amendments for the inclusion of new GHGs in addition to CO2 (methane and nitrous oxide). For
the reporting periods 2024 and 2025, only CO2 emissions will be covered under EU ETS scope. Starting 2024, the downloadable
spreadsheet include, in a dedicated sheet, the information reported through the submission of partial emissions reports as
required by Article 11(2)". (So the CO₂eq "to be reported under Directive 2003/87/EC" column is shown on the card only as CO₂.)

**Every public endpoint** (from `app.js`, all under `https://mrv.emsa.europa.eu/api/public-emission-report`):

| Endpoint | Result 2026-09-29 |
|---|---|
| `reporting-periods` | 2018–2025 |
| `downloadable-files` | newest file per year: 2025 v58 (15-09-2026), 2024 **v245** (29-09-2026), 2023 v92 (29-09-2026), 2022 v241 (06-02-2026), 2021 v219 (25-09-2026), 2020 v210 (25-09-2026), 2019 v228 (13-08-2026), 2018 v275 (29-03-2026) |
| `reporting-period-document/binary/{year}/{version}` | the XLSX (sizes: 3.9–4.3 MB for 2018–2023, 9.5 MB 2024, 11.7 MB 2025; 45 MB total) |
| `reporting-period-history/{year}?page=1&limit=N&orderByCol=version&orderByType=DESC` | **every** earlier version is listed (2024: 245 versions since the first; 2018: v1 = 30-06-2019) |
| `reporting-period-document/binary/{year}/{version}/{date}` | a historical version (not fetched) |
| `?imoNumbers=…&reportingPeriod=…&page=1&limit=10&orderByCol=reportingPeriod&orderByType=DESC` | the search grid (JSON: emissionReportId, imo, name, shipType, company, reportingPeriod, totalCo2Emissions, totalCo2EqEmissions, …). Without `orderByCol` → 400 "Please insert pagination sort column" |
| `details/{emissionReportId}` | one report as the portal shows it (fuel, emissions per gas and per voyage category, time at sea, efficiency with units, DoC dates, monitoring methods with names, verifier with address + accreditation, company). **Fuel by type is not public** (`consumptions: null`, `showConsumptions: false/null`) |
| `smart-search/ship-name?query=` | `[]` for EURODAM (needs other params; not explored) |
| `active` | `{"value":true}` |
| `configuration`, `ship-types` | as on 2026-09-27 |
| `stats`, `flags` | 400 "not enabled" |
| `supporting-materials/binary/{erId}/{id}` | not tried |

**Deep link per ship and year** (route in `app.js`: `public/emission-report/ship/:imoNumber/rp/:reportingPeriod`):
`https://mrv.emsa.europa.eu/#public/emission-report/ship/9285615/rp/2024` opens the search pre-filled with that IMO and year
(checked in Chrome 2026-09-29; it shows the "Full Reporting Period" coverage by default). This is each value's inline source link.

**Rows per file (all ships, all IMOs checksum-valid, no duplicate IMO in a Full sheet):**
2018 12,260 · 2019 12,420 · 2020 12,118 · 2021 12,485 · 2022 13,474 · 2023 12,829 · 2024 14,170 full + 1,027 partial rows
(1,008 ships) · 2025 17,177 full + 1,520 partial rows (1,482 ships). 26,053 distinct ships across all years.
Published CO₂ totals (Full sheets): 145.4 Mt (2018), 147.3, 129.7, 126.8, 137.5, 128.6, 147.2, 151.0 Mt (2025).

**Two layouts** (parse by header text, never position; `lib/ships/euMrv.js` `mrvLayout`):
- **2018–2023, 62 columns, one sheet named by the year.** Ship: IMO Number, Name, Ship type, Reporting Period (e.g. `2021.0`),
  Technical efficiency, Port of Registry, Home Port, Ice Class · DoC issue / expiry (DD/MM/YYYY) · Verifier Number, Name, NAB,
  Address, City, Accreditation number, Country · Monitoring methods A, B, C, D, D · Totals: total fuel [m tonnes], fuel on laden,
  total CO₂, CO₂ between / departed from / to MS ports / at berth in MS ports, CO₂ to passenger / freight transport / on laden
  [m tonnes], annual time at sea [hours] (2018–19 "Annual Total time…", 2020–23 "Annual Time…") · Average energy efficiency:
  fuel and CO₂ per distance [kg / n mile] and per transport work (mass [g / m tonnes · n miles], volume [g / m³ · n miles],
  dwt [g / dwt carried · n miles], pax [g / pax · n miles], freight [g / m tonnes · n miles]) · Voluntary: through ice [n miles],
  time at sea, time through ice [hours], the same efficiency set on laden voyages, additional information, average cargo density
  [m tonnes / m³]. **No company columns; no CH₄ / N₂O / CO₂eq; no total distance.**
- **2024 onward, 113 columns, two sheets "YYYY Full ERs" and "YYYY Partial ERs".** Adds Company IMO Number + Name; drops Verifier
  Number; fuel: total, fuel benefitting from a derogation (Annex II Part C 1.2, voluntary), on laden, cargo heating, dynamic
  positioning [m tonnes]; for **each of CO₂, CH₄, N₂O and CO₂eq**: total, between / departed / to MS ports, at berth, "within ports
  under a MS jurisdiction", on laden, passenger, freight, and "to be reported under Directive 2003/87/EC" (the ETS share; the CO₂
  header is written "CO2" in ASCII) [m tonnes]; CO₂eq benefitting from a derogation; Distance through ice [n miles], Time spent
  at sea [hours], time through ice; efficiency per distance and per transport work for fuel, CO₂ **and CO₂eq**, each with an
  "on laden voyages" twin, plus fuel / CO₂ / CO₂eq **per time at sea** [m tonnes / hour] (the CO₂eq-per-time header's unit is
  printed "[m tonnes CO₂eq / m tonnes · n miles]", an EMSA typo). Still **no total distance and no fuel by type**.
- Units: "m tonnes" = metric tonnes. `N/A` = not applicable; blank cells are omitted from the XML (parse by cell reference).
- Technical efficiency strings: `EIV|EEDI|EEXI (N gCO₂/t·nm)`, `Not Applicable`, `Not Applicable (N gCO₂/t·nm)`,
  bare `N gCO₂/t·nm`, bare `EEDI`/`EIV`, or blank. EEXI appears from 2022 and dominates from 2023.
- Monitoring method letters map to the portal's names (details API): A = "BDN and period stock takes of fuel tanks",
  C = "Flow meters for applicable combustion processes" (B = on-board tank monitoring, D = direct CO₂ measurement per Annex I).

**Revisions and duplicates.**
- Each year's file is regenerated as reports are submitted or corrected; the version number climbs (2024 went v244 → v245
  between 26 and 29 Sept 2026). All versions stay downloadable. Importer rule: a ship-year's evidence is hash-versioned, so a
  new version stores a new record only where that ship's cells changed; claims the new version no longer makes are superseded
  (kept); a ship-year gone from its year's file has its claims superseded, never deleted.
- One ship appears once per year in the Full sheet. **Partial ERs** (2024+) are per-company parts of a year after a change of
  company (`2024 (1/1 - 24/10)`, day/month); a ship can have several. 726 of 1,008 partial-report ships in 2024 (1,006 of 1,482
  in 2025) also have a Full row; the Full row was **never smaller** than the sum of that ship's partial rows (equal for 199 in
  2024, 360 in 2025), i.e. the Full row covers the whole year. So partial rows are never added to the Full figure; the card shows
  them on their own line.
- Across years there is no linkage other than IMO; company names change (EURODAM: "Holland America Line N.V." 2024 vs "Holland
  America Line Limited" 2025, same company IMO 5375992).

**Cross-check.** For EURODAM 2024 the file row equals the portal's `details/267085` response on every compared figure (CO₂ 298.0592,
CH₄ 0.00474, N₂O 0.01706, CO₂eq 302.71282, fuel 94.8 t, 27.03 h, 1,052.47 kg CO₂/n mile, verifier DNV). The ETS column checks
against the rule: 8.34 at berth + ½ × (166.21 + 123.51) = 153.2 t CO₂.

### Match against EarthAtlas ships (read-only, 2026-09-29)
Rule = the resolver's: the MRV IMO held as a checksum-valid **registry-class** IMO by exactly one vessel (no IMO in our databases
is on two vessels). "Salish-seen" = the vessel has an accepted MarineCadastre AIS identity from our Salish Sea tracks (Jul 2025 – Jun 2026).
Production ran inside `READ ONLY` transactions, SELECT only.

| Year | MRV ships | Prod matched | Prod Salish-seen | Dev matched | Dev Salish-seen |
|---|---|---|---|---|---|
| 2018 | 12,260 | 766 | 705 | 724 | 704 |
| 2019 | 12,420 | 783 | 725 | 746 | 723 |
| 2020 | 12,118 | 784 | 724 | 745 | 723 |
| 2021 | 12,485 | 833 | 771 | 794 | 770 |
| 2022 | 13,474 | 932 | 865 | 892 | 864 |
| 2023 | 12,829 | 890 | 833 | 855 | 832 |
| 2024 | 14,452 | 956 | 893 | 917 | 892 |
| 2025 | 17,653 | 1,048 | 984 | 1,008 | 983 |
| any year | 26,053 | **1,767** | **1,652** | 1,693 | 1,650 |

Prod holds 3,362 vessels with a registry IMO (2,959 Salish-seen). A further **172** prod IMOs (141 dev) that appear in MRV are held
only from AIS: under the resolver rule they stay unresolved (stored as evidence by `--known`, not shown) until a registry source
confirms the IMO.

### Built (dev) 2026-09-29
- Migration `019_eu_mrv.sql` (additive): evidence class **`verified_report`**, attribute **`emissions_report`**.
- `lib/ships/euMrv.js` (layout by header text, mapping with units, ship-year grouping, claims, persistence), `lib/ships/euMrvFormat.js`,
  resolver **v1.8** (`decideMrvImo`: registry IMO held by exactly one vessel; never by name; no candidates).
- `scripts/ships/import-eu-mrv.mjs` (`--imo` / `--known` / `--all`, `--years`, `--download`, `--dry-run`). Evidence: one
  `eu_mrv_file` record per file version (its header rows) + one `eu_mrv_ship_year` record per ship-year (its cells by column letter).
  Claims: one per published row, period = the row's reporting period (validity), value = total CO₂ [t], detail = every mapped figure.
- Dev import: 6 ships only (EURODAM 9378448, AEGEAN DREAM 9645425, ELENA VE 9453066, EXTREMADURA KNUTSEN 9918157, MORNING CALM
  9285615 incl. its 2024 partial row, ANTHEM OF THE SEAS 9656101): 30 ship-years, 31 claims, all attached by IMO_EXACT.
- Ship card: Emissions tab → "Verified: EU MRV reports" block (newest year in full, earlier years one line each) above the
  "Modelled: Climate TRACE estimates" block; per-value "EU MRV" links to the portal's ship-year page.
- "Small EU share" note (Josh 2026-09-29): when a year's whole-year EU MRV CO₂ is **under 25%** of Climate TRACE's modelled CO₂
  (the CO₂ gas) for the same ship and calendar year, the verified block says, in a highlighted line, that the EU figures cover
  only the ship's EU/EEA voyages, a small part of its year. Climate TRACE's figure is only our Salish Sea trips and stays, so it
  under-states the ship's year: the test is conservative. Partial-year rows are not compared; no modelled figure → only the normal
  scope note. The two numbers are compared, never added or shown together (`lib/ships/euMrvFormat.js` `smallEuShare`,
  `smallShareYears`). EURODAM: 298 t (2024) and 853 t (2025) EU vs 54,500 / 56,500 t CO₂e modelled → note shown for both years.
- Size estimate for prod `--known`: ≈7.4k ship-years ≈ 1.5 kB evidence + ≈1.5 kB claim detail each ≈ 20–25 MB (prod DB is 1.2 GB).
  `--all` (≈115k ship-years) would be ≈300 MB and is not proposed.

---

## 2. Climate TRACE — ship / voyage emissions

House facts: `docs/CLIMATETRACE_API.md`, `docs/CLIMATETRACE_FACTS.md`, memory `project_climatetrace`.

### Granularity that is public
- **Downloads / REST API: port-level only.** `transportation.zip` (v5.10.0, checked locally) contains
  `domestic-shipping` and `international-shipping` sources = ports (17,901 port sources, monthly).
  Port emissions = voyage emissions split half to each end port.
- **Per-ship:** `detailed_data_schema_v5_10_0.csv` lists `domestic-shipping-ship` and
  `international-shipping-ship` (source type `ship`, source name "Vessel Name") with access
  **"On request"**. Climate TRACE's reply to Josh (2026-09-23): the voyage data is on **BigQuery**
  (`trace-data-383422.climate_trace.shipping_voyages`, 272M rows, 132 GB, partitioned by start_date).
- **Correction:** memory `project_ships_app` says voyage records are "in the bulk download packages".
  They are not — they come from BigQuery. (Memory note should be fixed; not touched by this study.)

### What we already hold (local, gitignored)
`scripts/bake-shiptraffic/cache/climatetrace/voyages-2024-2025.csv` — 587,421 records (2024-01 → 2025-12),
13,041 ships, pulled 2026-09-23 with Josh's go (25.3 GB billed, free tier). Columns:
`start_date, end_date, asset_identifier, asset_name, type, iso3_country, wkt (2-point LINESTRING),
capacity (gross tonnage), capacity_factor, activity (nmi), CO2/CH4/N2O/SOX/NOX/VOCS/PM2_5/PM10/CO
_emissions, total_CO2e_100yrGWP, total_CO2e_20yrGWP, other1..other12, original_inventory_sector, model_number`.
Decoded (memory): other1 duration, other2/3 from/to port name, other4/5 countries, other6/7 port ids,
other8 true=trip / false=port stay, other9/10 EEZ. Schema also defines "CO₂ EF from RF model (kg/nm)"
and "ship dead weight".

### Identifiers
`gfw-mmsi-N` (8,839 ships), `gfw-imo-N` / `om-imo-N` (4,202). The `gfw-`/`om-` prefixes are not
defined by Climate TRACE (UNVERIFIED meaning; asked, no answer). Join: IMO → `IMO_EXACT`; MMSI →
**candidate only**, resolved against the MMSI's observed window at the voyage time (resolver rule 4).
LINNEA ROSE (MMSI 368330140): **0 records** in the pull.

### Licence
CC BY 4.0 for Climate TRACE data (house doc). Whether the "On request" ship-level tables carry the
same licence was never stated by Climate TRACE; **treated as CC BY 4.0** (Josh, 2026-09-29: the same terms
as the rest of their data; not pursued further). Contact is now Lekha (Ishan has left WattTime). Citation: *Climate TRACE (2026), Climate TRACE Emissions Inventory v5.10.0*.

### Known caveats (from earlier analysis)
Modelled, not measured. Pollutants are ratio-based (see facts file). Records are not monthly; some span
>60 days. The ">500 GT" scope is contradicted by thousands of small `gfw-mmsi` "passenger" craft (mostly
moored stays) — open question with Climate TRACE. CT "passenger" swallows pleasure craft: keep AIS class
for small craft.

### Cost
BigQuery: all-years Salish pull dry-ran at 83 GB (inside the free 1 TiB/month). Each future release is
a new pull; always run with `maximum_bytes_billed`. No runtime BigQuery.

---

## 3. SkyTruth Cerulean — satellite oil slicks

Facts from `SHIP_INCIDENT_SOURCES.md` §7 (2026-09-25) plus today's checks. **No automated calls were
made.** Today: one manual read of `/robots.txt` and one of `/collections` on the API host (the latter
sent in the same batch before the full robots file was read; not repeated). `skytruth.org`'s own
robots.txt disallows `ClaudeBot`, `anthropic-ai`, `Claude-Web`, so its pages were not fetched today.

| Item | Fact |
|---|---|
| Product | Sentinel-1 SAR scenes → ML slick detection → ranked possible sources (AIS vessels, infrastructure, dark vessels, natural seeps). Web map `cerulean.skytruth.org`; OGC API (tipg) `api.cerulean.skytruth.org` |
| API robots.txt (live 2026-09-27) | Lists ~25 named bots **and** `User-agent: *` / `Disallow: /` → all automated clients disallowed. `cerulean.skytruth.org/robots.txt` is also `Disallow: /` |
| Collections | 58 listed (live). Some gated: code (`cloud_run_tipg/handler.py`, Apache-2.0 repo `SkyTruth/cerulean-cloud`) returns 403 `Access to {table} is restricted` unless header `X-API-Key` equals a server secret. Known restricted: `public.source_vessel`, `public.slick_to_source`, `public.source`, `public.model` (GitHub issue #203, 2026-09-15, unanswered). `public.slick_plus` is public |
| Vessel lookup | `public.get_slicks_by_source(source_id=MMSI, source_rank, collation_threshold)`; pass `collation_threshold` explicitly. Two test MMSIs returned `[]` (2026-09-25) |
| Per-source extras in their own UI | AIS-off events, detentions, HITL (human) verification, profile image (from the SQL inventory in their repo) |
| Licence | skytruth.org Terms of Service (2026-09-25): **CC BY-SA 4.0**, attribution "SkyTruth [Product Name], [Year]. CC BY-SA 4.0."; services only for "environmental conservation applications"; a slick–vessel association "does not constitute confirmation or evidence" that the vessel is responsible |
| Implication of BY-SA | Anything we derive from Cerulean data (e.g. a baked slick layer) must be shared under CC BY-SA too. That is compatible with EarthAtlas but should be stated on the layer |

**What we need from SkyTruth:** (1) permission for a low-rate, cached, automated client despite the
robots.txt, with a named User-Agent; (2) whether the gated vessel-association collections can be
opened to us (key) or what the approved route is; (3) their preferred attribution and wording for
"possible source"; (4) whether HITL-verified associations can be distinguished.

### DRAFT email to SkyTruth (Josh to send himself; not sent)

> **To:** SkyTruth Cerulean team (address to confirm on skytruth.org/cerulean — UNVERIFIED)
> **Subject:** Permission request: EarthAtlas (non-commercial conservation) use of Cerulean data with attribution
>
> Hello SkyTruth team,
>
> I run EarthAtlas (earthatlas.org), a non-commercial conservation site that maps environmental data
> for the public. We are building a ship page for the Salish Sea and beyond (/ships), where each vessel
> shows its identity history, its AIS tracks and, with clear provenance next to every value, its
> environmental record.
>
> We would like to show Cerulean slick detections on that page, and on a map layer, with attribution in
> your requested form ("SkyTruth Cerulean, [Year]. CC BY-SA 4.0."), a link back to Cerulean, and your
> caveat that an association between a slick and a vessel is not evidence that the vessel is responsible.
> We would label vessel links "possible source (satellite detection + AIS proximity)" and never call a
> detection a spill.
>
> Before we build anything we want your permission, because the API's robots.txt disallows automated
> clients:
>
> 1. May we run a small, automated, cached client against api.cerulean.skytruth.org? We expect about
>    one request per ship page on first view (cached for days) plus a daily refresh of slicks in our focus
>    regions, well under a few hundred requests per day, with a User-Agent that identifies EarthAtlas and
>    a contact address. We are happy to follow any rate limit or schedule you prefer, or to use a bulk
>    export instead if you have one.
> 2. Some collections (for example source_vessel and slick_to_source) are restricted. Could EarthAtlas get
>    access to the vessel-association data, or is get_slicks_by_source the route you would like us to use?
> 3. Is there anything you would like us to show or avoid, for example only human-verified associations,
>    a minimum confidence or rank, or specific wording?
>
> We would of course share our derived layer under CC BY-SA 4.0 and are glad to send you a preview on
> localhost before anything goes public.
>
> Thank you for Cerulean. It is exactly the kind of open evidence our visitors need.
>
> Josh Knauer
> EarthAtlas

---

## 4. Other open or relevant sources (short list)

| Source | What / granularity | Licence / access | Notes |
|---|---|---|---|
| **IMO DCS** (MARPOL Annex VI reg. 22A) | Annual fuel per ship ≥5,000 GT, global | Per-ship data only in GISIS for the Secretariat and flag states; public = **anonymised annual report** to MEPC | Not usable per ship. Latest public report covers 2023 (secondary sources) |
| **UK MRV** | UK-related voyages, IMO | No public per-ship publication found (data submission was suspended until a system existed; UNVERIFIED as of 2026) | Re-check later |
| **EU ETS Union Registry / EUTL** | Shipping-company accounts and compliance (from 2025) | Registry; company-level | Not per ship. UNVERIFIED whether ship lists are exposed |
| **FuelEU Maritime** (from 2025) | GHG intensity per ship | THETIS-MRV app has FuelEU disclaimer keys; public per-ship publication UNVERIFIED | Watch the 2025 MRV file columns |
| **NOAA NESDIS MPSR** | Analyst-drawn suspected-oil polygons from optical + SAR imagery, US waters, since 2018-03 public; JPEG/KML/GIS package per report | US federal (public domain UNVERIFIED); InPort item 52380 | A US slick layer without vessel attribution; no permission problem |
| **Puget Sound Maritime Air Emissions Inventory 2021** | Regional totals by vessel class (DPM −82%, GHG −10% vs 2005), published 2024-06-06 | PDF, licence not stated | Context text for the Salish region only |
| **Port of Seattle Scope 3 maritime inventory data** | Port-level | Port site | Context only |
| **EPA NPDES VGP / VIDA eNOI** | Which vessels declared scrubber-washwater discharge in US waters | US federal; public search/export UNVERIFIED | Only open lead found for the "does this ship have a scrubber" question |
| **WA Ecology reported spills to water** | WA spills since 2015-07-01, name only | Commercial use prohibited | Covered in `SHIP_INCIDENT_SOURCES.md` |
| **EMSA CleanSeaNet** | EU satellite slick service | Member states only | Not available |

---

## 5. PROPOSED Phase 4 plan — awaiting Josh's authorization

Not authorized. Order chosen by: open licence first, official before modelled, no permission blockers.

**4a. EU MRV on the ship card (first — open, official, IMO-exact).**
- Bake: one script checks `downloadable-files` (1 request), downloads changed years only (8 files,
  ~10 MB each ≈ 80 MB once; then ~1–3 files a week as versions change), keeps the raw XLSX as
  `source_records` evidence (hash-versioned), and writes a compact per-IMO JSON pack to Blob.
- Storage: ~15k ships × 8 years ≈ 115k rows. Keep a curated ~25 fields per row → roughly 20–40 MB in
  Postgres if stored as assertions, or ~5–10 MB gzipped JSON on Blob. Recommend Blob (Neon free tier is
  0.5 GB) and only a `source_entities` row + link per IMO in Postgres. Raw XLSX archive: ~80 MB on Blob.
- Card: "Emissions" tab — per year: CO₂ (and CO₂eq from 2024) on EU/EEA voyages, at-berth share,
  fuel, time at sea, CO₂ per nautical mile, EEDI/EEXI, verifier. Inline source link per value to the MRV
  portal + file version. Scope label always visible.
- API calls at runtime: zero to EMSA (served from Blob).

**4b. Climate TRACE voyages (second — modelled, already pulled for Salish 2024–25).**
- Per-ship yearly and monthly sums (CO₂, CO₂e, NOx, SOx, PM2.5) and top routes from the local CSV;
  label "estimate (modelled)". Map: when a ship is picked, its voyage legs as 2-point arcs coloured by CO₂.
- Storage: per-ship aggregates ≈ 13k ships → a few MB on Blob; raw 299 MB CSV stays local/archived.
- Cost: none now; later years = one capped BigQuery pull per release (free tier).
- Before publishing: confirm ship-level licence with Climate TRACE.

**4c. Cerulean slicks (third — only after SkyTruth says yes).**
- Ship card: "Possible slick associations" list (date, area, rank, link to Cerulean), candidate-only
  by MMSI-at-time. Map: slick polygons in the focus regions.
- Calls: per-ship on first view, cached ≥1 day; plus one daily regional refresh — tens to low hundreds of
  requests/day, whatever SkyTruth sets. Storage: tiny (JSON per MMSI + regional GeoJSON on Blob).
- Optional parallel: NOAA MPSR US slick polygons (no permission needed, no vessel link).

**Not proposed:** IMO DCS, UK MRV, EU ETS registry (no per-ship data); scrubber flags until the EPA
eNOI lead is checked.

## Open questions for Josh
1. Authorize 4a (EU MRV) first? Store as Blob pack (recommended) or as assertions in Postgres?
2. OK to send the SkyTruth email (edit freely)? Which address — use the contact on skytruth.org.
3. Ask Climate TRACE (Ishan) to confirm the licence for ship-level voyage data and the `gfw-`/`om-` prefixes?
4. MRV scope wording: is "CO₂ on voyages to/from EU & EEA ports" clear enough, or hide MRV numbers for ships
   whose EU share is tiny (like EURODAM's 298 t)?
5. Should a quick check of EPA eNOI (scrubbers) be added to the Phase 4 study?
