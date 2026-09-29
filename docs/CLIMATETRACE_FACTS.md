# Climate TRACE — what they say about their own data

Read in full 2026-09-23 from https://climatetrace.org/faqs (every question and
answer) and the GWP post
https://climatetrace.org/news/feeling-the-heat-global-warming-potentials-and-20-vs-100.
Use this, not memory, for anything we tell users. Per-subsector definitions and
methodology summaries (their own words) are in `docs/climatetrace-subsectors.json`
(title, assetLabel, definition, methodology, methodologyAssetUrl, frequency,
source) — extracted from the same site, CC BY 4.0.

## Gases and units
- **CO2e** = carbon dioxide equivalent, offered as **100-year or 20-year**. CO₂ is the reference (GWP 1 on every horizon). Climate TRACE uses **IPCC AR6** GWPs (switched from AR5 in July 2022).
- GWPs they quote: **N₂O = 273** (100-yr); **methane "about 30"** (100-yr) and **"about 80"** (20-yr). (Their words are "about"; don't state more precision than that.)
- Why it matters (their framing): methane and N₂O are smaller in quantity than CO₂ but trap far more heat; CO2e keeps their impact from being minimized. The 20-yr view weights short-lived methane more (near-term priorities); it can de-prioritize long-lived CO₂. IPCC standard is 100-yr.
- Units on their site: **tCO2** = tonnes of CO₂; **MT / M Tonnes** = million metric tonnes; **BT / B Tonnes** = billion metric tonnes.
- Their map lets you pick greenhouse gases **CO₂, CH₄, N₂O** (plus CO2e 100/20). Every source card also shows **non-GHG air pollutants — SO₂, NOx, PM (PM2.5), CO** — "for many types of assets", and the **confidence** for every source.

## How the numbers are made
- **Greenhouse gases:** sector-by-sector methods by a "sector lead". Most common: computer-vision models (e.g. satellite imagery) trained on verified on-site measurements; also disaggregating national production to facilities, and IPCC inventory guidelines. Increasingly "ensemble" cross-verification. Mostly IPCC standard emission factors.
- **Air pollutants (SO₂, NOx, PM2.5, CO) are "Tier 1":** except power, shipping and road transport (own methods), pollutants come from **country-level CEDS / EDGAR / regional inventories**, turned into a pollutant-per-GHG ratio per **country × sector × fuel**, then applied to each facility's GHG/activity. → Within one country and sector, a facility's pollutant figure is essentially proportional to its GHG figure; it is **not an independent measurement of that facility's air pollution**. They plan better estimates.
- **Confidence:** reflects whether a source was verified against multiple high-quality methods (higher) or not yet (lower); per-component ratings; patterned on IPCC. Confidence is generally lower where no highly certain method exists yet.
- **Accuracy:** they don't claim a single accuracy number. Broad agreement with EDGAR / Global Carbon Project / Carbon Monitor on global totals; differences appear by sector, country, and **for gases other than CO₂**. A calibrated on-site sensor at a facility is usually more reliable than their estimate for that facility.

## Time
- Source level: **2021 → current year, monthly, ~2-month lag.** Country level: 2015 → current.
- The current year's months are either estimated by the sector lead **or projected forward** from the last month the sector lead produced (sector-dependent; see changelog). → Recent months can be projections, not new observations.
- Monthly releases (v5.9.0 July 2026 → data through May 2026; v5.10.0 August 2026 → through June 2026). `source_id`s can change between annual versions (they offer a crosswalk on request).

## What a "source" is — caveats that change the wording of popups
- ~2.7 million sources aggregated from ~745 million assets. Facilities are points; road transport, buildings, agriculture etc. are aggregated to county/district or city.
- **Oil & gas production locations are deliberately obscured** (data licence restrictions) — sources are basins/fields, not wells.
- **Ports:** a port is one approximate point standing for a whole port complex, and can **appear inland**. Shipping emissions are **voyage emissions assigned half to the departure port and half to the arrival port** — not emissions from port operations ("onsite emissions from port operations are not included").
- **Airports:** figures are **flight fuel combustion** (OAG flight data × ICAO method); **airport ground operations are not included**. (How flights are split between airports is not stated — don't claim a split.)
- **Cattle operations:** identified with satellite imagery + AI; herd size predicted from the operation's area; individual feedlots only in select countries.
- **Solid waste:** methane republished from self-reported facility data where available, otherwise modeled.
- Not yet source-level: heat plants, battery manufacture, rare-earth mining (republished high-level estimates).
- **Scope:** Scope 1 (direct) emissions; some Scope 2 for heavy industry in the `other` columns; no Scope 3. No emissions from individuals, ever.

## Ownership
Asset-level ownership exists (partially or fully) for: aluminum, bauxite mining, coal mining, copper mining, cement, domestic & international aviation, electricity generation, cattle operations, iron mining, iron & steel, oil & gas production / transport / refining, petrochemical steam cracking, pulp & paper. Often incomplete or not updated; many owners have no LEI.

## Their other tools (for reference, not ours)
- **Plumes / Air Pollution tool:** CMU CREATE Lab HYSPLIT dispersion of each facility's **monthly-average** PM2.5 over one day's weather (2024), for ~9,560 facilities in 2,572 urban areas; "prevailing" vs "worst" day; a model, not a measurement; minute-to-minute variation is weather, not the facility.
- **Emission reduction roadmap:** ≥1 solution per asset, ~120 mature solutions, a "difficulty" score; constraints (cost, supply, time, politics) not applied. (Matches the `ers_plan_global.zip` download.)

## Measured by us (release v5.10.0, sector packages)
- CO₂ / CH₄ / N₂O packages cover the **same facilities and months** as CO2e (verified on coal mining: 4,803 mines, 316,998 rows each). Coal mining 2025: CO₂ 445 Mt, CH₄ 65 Mt, N₂O 3,474 t.
- Pollutant packages (PM2.5, SO₂, NOx, CO) have 2025 values for power plants (~9.9k of 11.5k), all heavy-industry subsectors, ports and airports. Not yet profiled for mines, oil & gas, waste, cattle, reservoirs.

## Shipping voyages — answers from Climate TRACE (email from the Climate TRACE Coalition to Josh, 2026-09-29)
Replies to our questions about the BigQuery `shipping_voyages` table. Our contact is Lekha; Ishan has left WattTime, so the BigQuery guide's contact is out of date.
- **Ship ID prefixes:** `om-imo-` = **OceanMind**, Climate TRACE's shipping sector lead; `gfw-mmsi-` / `gfw-imo-` = Global Fishing Watch. OceanMind tracks the large, high-information vessels; GFW tracks the smaller or low-information vessels and non-broadcasting ones. The two are combined at port level.
- **`other11`** = CO₂ emissions factor from their RF model, in **kg [gas] per nautical mile**. **`other12`** = the ship's **deadweight**, in **tonnes**. (The schema file documents only `other1`–`other10`.)
  - **Measured by us (release v5_11_0, pulled 2026-09-29): the data reads the OTHER way round.** `other11` behaves as deadweight (oil tankers median 299,392 t; bulk carriers 63,475 t) and `other12` as CO₂ kg/NM (trip CO₂ ÷ nautical miles ÷ `other12` has a median of 0.89 across 3,346 ships). Both are set only for `om-imo-` (OceanMind) ships. We follow the data (`CT_SHIP_FIELDS` in lib/ships/ctVoyages.js, one place to flip); the question is open with Climate TRACE.
- **Vessel type "passenger":** comes from the classification in their input data sources; it is not a deliberate catch-all. In the Salish Sea it covers many small recreational boats and some fishing boats, so don't rely on it for small craft.
- **Port stays** are assigned by algorithm, from where a vessel stops for longer than a set time. For many ports, stays are allocated to terminals or other locations outside the port itself. That is why a big port such as Vancouver can show voyages but no stays. See their shipping methodology documentation.
