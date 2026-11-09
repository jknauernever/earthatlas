# Port of Seattle ship-emissions method: what is public (researched 2026-11-08)

Internal notes for the oil-transfer report's emissions follow-up (Lovel asked 2026-11-06 for "the Port of Seattle method").
Web research only; nobody contacted. Facts with sources; nothing here is shown on the site.

## Who does the calculation

- The Port of Seattle does not model vessel emissions itself. Its **Maritime Scope 3 GHG Inventory** takes ocean-going-vessel
  numbers from the **Puget Sound Maritime Air Emissions Inventory (PSEI)**, written by Starcrest Consulting for the ports.
  - 2024 edition: https://www.portseattle.org/sites/default/files/2026-05/2024%20MAR%20Scope%203_Web.pdf
  - 2025-02 v2: https://www.portseattle.org/sites/default/files/2025-02/Maritime%20Scope%203%20GHG%20Inventory_v2.pdf
  - 2005–2020: https://www.portseattle.org/sites/default/files/2021-10/MAR_Scope3_2005-2020_WebVersion_0.pdf
- The PSEI runs every 5 years; between editions the Port reuses the latest PSEI year. A footnote says 2022–2023 use 2021 PSEI
  results except ocean-going vessels, which "are based on 2022 data" (method not stated).
- The PSEI program page: https://www.portseattle.org/programs/puget-sound-maritime-air-emissions-inventory
- 2021 PSEI, Volume 1 (Starcrest, April 2024):
  https://s3.us-west-2.amazonaws.com/nwseaportalliance.com.if-us-west-2-or/2024-06/FINAL%202021%20PSEI%20Report%20Volume%201%20(3%20April%2024)scg.pdf

## The PSEI method: activity-based, not fuel-based (2021 PSEI Vol. 1, Appendix B, pp. B-1 to B-23)

- Emissions = energy (kWh) × emission factor (g/kWh) × fuel correction factor × control factor.
- Energy = engine rating × load factor × hours. Load factor = (actual speed ÷ max speed)³, capped at 1. Hours = distance ÷ AIS speed.
- Emission factors from EPA, "Methodologies for Estimating Port-Related and Goods Movement Mobile Source Emissions" (Sept 2020).
- Inputs: Marine Exchange of Puget Sound arrivals and departures; AIS from the Marine Exchange of Alaska (new in 2021); IHS ship data
  (engine power, age). Cruise auxiliary-engine loads come from vessel boarding data, averaged by passenger-capacity band (Tables B.9, B.12).
- Boundary (Vol. 1 §3.2, p. 33): Puget Sound and the Strait of Juan de Fuca to the JA buoy, U.S. waters only. Modes: transit,
  maneuvering, hoteling at berth or anchorage (p. 35). Vendovi Island anchorage / bunkering area is inside the boundary.
  The program page says the full Seattle–Alaska round trip is not covered.
- Shore power (Vol. 1 §3.5, pp. 38–42): auxiliary engines count as zero at berth while plugged in, with at least 1.5 h on auxiliaries
  for ships that did not report details; boilers still run on diesel-electric cruise ships (App. B, p. B-23). The Port shows Terminal 91
  shore-power kWh × Seattle City Light's grid factor on a separate line.
- CO2e uses IPCC AR6 100-year GWPs (CO2 1, CH4 29.8, N2O 273). Black carbon is reported separately, not in CO2e.

### Factors quoted (all at 0.1% sulfur fuel, the ECA assumption)

| Engine (fuel use per kWh) | NOx g/kWh | SO2 | PM2.5 | BC | CO2 | N2O | CH4 |
|---|---|---|---|---|---|---|---|
| Slow-speed propulsion (185 g/kWh MGO) | 17.0 (Tier 0) to 3.4 (Tier III) | 0.36 | 0.17 | 0.0051 | 593 | 0.03 | 0.01 |
| Medium-speed propulsion (205) | — | — | — | — | 657 | — | — |
| Auxiliary engines (217; Table B.7) | 13.8 to 2.6 | 0.42 | 0.17 | 0.0051 | 696 | 0.03 | 0.010 |
| Boilers (300; Table B.10) | 1.97 | 0.60 | 0.19 | 0.01 | 962 | 0.08 | — |

Fuel use per kWh on HFO (Table B.1): 195 / 215 / 227 / 305 g/kWh. Equations: CO2 EF = fuel use per kWh × carbon factor (Eq. 8);
SO2 = sulfur fraction × fuel use per kWh × 2 × 0.97753 (Eq. 7); PM10 = 0.1545 g/kWh (distillate) or 0.5761 (HFO) + sulfur × fuel use
per kWh × 0.02247 × 7 (Eq. 5); PM2.5 = PM10 × 0.92 (MGO) or × 0.8 (HFO).

## Fuel volume → emissions (what our ANT gallons would need)

- No Port, NWSA or PSEI document found estimates ship emissions from fuel sold, bunkered or delivered.
- Usable piece: the PSEI carbon factors, **3.206 g CO2 per g fuel for MGO / MDO, 3.114 for HFO**, turn fuel MASS into CO2.
- No fuel density is given in the PSEI or the Port tables; gallons → tonnes needs a density from another cited source.
- Gallon-based factors appear only for Port vehicles (EPA 2018: diesel 10.21 kg CO2/gal, gasoline 8.78) and locomotives (Vol. 1 Table 6.6).
- Older comparison of fuel-burn vs power-based methods (Puget Sound Clean Air Agency poster, EPA EI conference, about 2004):
  https://gaftp.epa.gov/Air/nei/ei_conference/EI13/poster/agyei.pdf

## Not found / not checked

- No standalone Port "cruise GHG inventory" document; a Port slide mentions a "2022 Cruise Emissions Inventory" not located.
- EPA's 2022 Ports Emissions Inventory Guidance (EPA-420-B-22-011, https://www.epa.gov/node/256253) not opened: may hold a
  fuel-based option or per-kg-fuel factors.
- Northwest Ports Clean Air Strategy and the 2005 / 2011 / 2016 PSEI reports not opened (linked from the program page).
