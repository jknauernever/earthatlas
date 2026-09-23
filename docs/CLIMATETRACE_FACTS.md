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
