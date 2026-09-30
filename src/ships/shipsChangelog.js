/**
 * Public changelog for /ships (earthatlas.org/ships/changelog). Public-facing: plain language, no internal
 * details (environments, bake versions, vendors, costs, unreleased work). Add entries newest first when a
 * change goes live; update COUNTS (with its date) only from verified production numbers.
 */

const S = {
  marinecadastre: { name: 'MarineCadastre AIS', href: 'https://hub.marinecadastre.gov/pages/vesseltraffic' },
  gfw: { name: 'Global Fishing Watch', href: 'https://globalfishingwatch.org' },
  gisis: { name: 'IMO GISIS', href: 'https://gisis.imo.org/Public/' },
  ct: { name: 'Climate TRACE', href: 'https://climatetrace.org' },
  wpi: { name: 'World Port Index', href: 'https://msi.nga.mil/Publications/WPI' },
  bcports: { name: 'BC Ports and Terminals', href: 'https://catalogue.data.gov.bc.ca/dataset/bc-ports-and-terminals' },
  osm: { name: 'OpenStreetMap', href: 'https://www.openstreetmap.org/copyright' },
  gem: { name: 'Global Energy Monitor', href: 'https://globalenergymonitor.org' },
  mep: { name: 'MEP Alliance', href: 'https://www.mepalliance.org/list-of-scrubber-fitted-ships' },
}

export const COUNTS_AS_OF = '2026-09-30'

// { label, value, sources: [S.x | plain string] }
export const COUNTS = [
  { label: 'Ships', value: '24,232', sources: [S.gfw, 'US Coast Guard', 'Transport Canada', 'FCC', S.marinecadastre, 'Wikidata', 'Wikimedia Commons'] },
  { label: 'Ports on the map', value: '9,159', detail: 'World Port Index 2,951 · Climate TRACE 6,006 · GFW 168 · DFO harbours 34', sources: [S.wpi, S.ct, S.gfw, 'Fisheries and Oceans Canada'] },
  { label: 'Terminals', value: '59', detail: '81 berths', sources: [S.bcports, 'US Army Corps of Engineers', 'WA Dept. of Ecology', S.osm, S.gem] },
  { label: 'Terminal visits', value: '37,554', detail: 'at 52 terminals, Jul 2025 – Jun 2026, counted by EarthAtlas from AIS', sources: [S.marinecadastre] },
  { label: 'Port visits', value: '96,465', sources: [S.gfw] },
  { label: 'Ship-port emission estimates', value: '17,907', sources: [S.ct] },
  { label: 'Incidents', value: '9,233', sources: ['US Coast Guard', 'NOAA IncidentNews', 'WA Dept. of Ecology'] },
  { label: 'Ships with scrubber notifications', value: '6,506', detail: '572 matched to EarthAtlas ships', sources: [S.gisis] },
  { label: 'Ships on MEP Alliance scrubber lists', value: '3,845', detail: '3,536 by IMO number + 309 named in voyage reports; 365 matched to EarthAtlas ships', sources: [S.mep] },
  { label: 'Official anchorages', value: '810', sources: [S.marinecadastre, 'eCFR', 'Fisheries and Oceans Canada'] },
  { label: 'Anchorage stays', value: '15,448', detail: 'by 3,338 vessels at 108 Salish Sea anchorages, Jul 2025 – Jun 2026, counted by EarthAtlas from AIS', sources: [S.marinecadastre] },
  { label: 'IMO port facilities', value: '465', detail: 'Canada and US', sources: [S.gisis] },
]

export const COVERAGE_NOTE = 'Detailed ship tracks cover the Salish Sea for Jul 2025 – Jun 2026; US-wide tracks cover 2015 onward.'

// Newest first. { date, area, text }
export const ENTRIES = [
  { date: '2026-09-30', area: 'Sharing', text: 'A link to a particular /ships map view now previews with a picture of that view (where the map is, and which layers are on). Links to earthatlas.org/ships itself now preview with their own picture, “The open record of every ship”, instead of the general EarthAtlas card, and the page’s title and description now read “Ships — the open record of every ship”: where it’s sailed, what it’s burned, and the impact it may leave behind.' },
  // Numbers below verified against production 2026-09-30 (read-only counts after the anchorage and MEP imports):
  // 15,448 stays / 3,338 vessels / 108 anchorages; Vendovi South 87 stays by 51 ships; MEP 334 by IMO, 31 + 32 by name;
  // scrubber filter 594 ships (IMO 460, MEP 365, both 231).
  { date: '2026-09-30', area: 'Ship cards', text: 'Clearer ship cards. A ship’s scrubber (exhaust gas cleaning system) now has its own highlighted block near the top of the Overview, with the official IMO filing and the MEP Alliance reports each on their own line and linked to their source. The owner and operator now sit right under the ship’s name. When no source has emissions for a ship, the Emissions tab now says so in one line. The History tab is now the last tab.' },
  { date: '2026-09-30', area: 'Ship cards · Ship tracks', text: 'Ship cards now also show when a ship is on the MEP Alliance scrubber lists, beside (never merged with) the scrubber filings flag states make to IMO: the list, the date reported, and the owner and charterer the list names, each linked to its source. These are reported facts from an advocacy group, not registry records, and are labelled that way. MEP Alliance lists 3,536 scrubber-fitted (or pending) bulk carriers, tankers, container ships and cruise ships by IMO number, 334 of them ships we hold, and 492 reported voyages of 309 named ships. That voyage list gives no IMO number, so EarthAtlas matched 63 of those ships by name: 31 confirmed by a second fact, and 32 marked “matched by name (inferred)” because they are the only large ship of that name seen in the Salish Sea. New “Scrubber-fitted” filter under Ship tracks shows only the tracks of the 594 ships with a scrubber filed with IMO (460) or on the MEP Alliance lists (365; 231 are on both).' },
  { date: '2026-09-30', area: 'Anchorages', text: 'Official anchorage areas are now on the map (inside Ports & terminals, from zoom 8): 33 CFR anchorages in US waters, Fisheries and Oceans Canada’s active commercial anchorages in BC, and the Puget Sound anchorages the Coast Guard’s traffic service uses without a legal designation (clearly marked). Click an anchorage’s name for who anchors there: EarthAtlas counted every stay from AIS (a ship stopped, under 0.5 knots, inside the area for an hour or more) with the number of ships, ship-hours, the kinds of ship and the ships that spent the most days there, each linked to the count’s record. 15,448 stays by 3,338 vessels at 108 Salish Sea anchorages, Jul 2025 – Jun 2026. Vendovi South (off Vendovi Island): 87 stays by 51 ships, 36 of them tankers (SILVER LONDON 14 days, ALTHEA 13, HIGH SEAS 11). Pleasure boats and other small craft are counted too and shown apart by kind. Anchorages now also show other names they go by, each with its source: Vendovi South is “Vendovi Island South (VIS)” to the Coast Guard’s Puget Sound traffic service (its user’s manual) and Vendovi East is “Vendovi Island East (VIE)”; Global Fishing Watch files Vendovi South under “Anacortes”, so port visits there read Anacortes. Anchorages outside the area our AIS covers say so instead of showing zero.' },
  // DRAFT, not live (GFW hourly lines, scripts/ships/bake-gfw/). Uncomment in the push that publishes the first GFW
  // months to production, with the real month range and counts from the published index (never estimates):
  // { date: 'YYYY-MM-DD', area: 'Ship tracks', text: 'Ship tracks now reach British Columbia and all of Alaska, and the Salish Sea
  //   no longer stops at NOAA’s latest month. Where NOAA has no per-minute AIS, the lines come from hourly ship positions
  //   (Powered by Global Fishing Watch), so they are straighter than NOAA’s; where a straight line between two hours would
  //   cross land, EarthAtlas estimates the path along the water from official coastlines (OpenStreetMap, Alaska DNR,
  //   Natural Resources Canada) and draws it dashed. When NOAA publishes a month, its tracks replace the hourly ones there.
  //   <N> ships, <MONTHS>.' },
  { date: '2026-09-29', area: 'Ship cards', text: 'The Emissions tab now shows a ship’s verified EU MRV emissions reports above Climate TRACE’s modelled estimates, as two separate blocks labelled “verified” and “estimate”; the two are never added together. 1,767 of our ships have at least one report (2018–2025), 1,652 of them seen in the Salish Sea. The newest year shows CO₂ (from 2024 also methane, nitrous oxide and CO₂-equivalent), CO₂ at berth, fuel burned, hours at sea, CO₂ per nautical mile, the ship’s design efficiency rating and who verified the report; earlier years get one line each. Every figure links to the European Maritime Safety Agency’s page for that ship and year. These reports cover only voyages to, from and between EU/EEA ports and time at berth there, so for ships trading mostly in the Pacific they are far below the ship’s whole-year emissions (EURODAM: 298 t CO₂ in 2024).' },
  // Numbers below verified against production 2026-09-29 (tc4 import + readTerminalCard on the prod DB):
  // 37,554 visits at 52 terminals; BP Cherry Point 1,122; HF Sinclair 1,039.
  { date: '2026-09-29', area: 'Terminals', text: 'Official berth facts on terminal cards (About tab), each linked to its document: berth names, lengths and depths from the Pacific Pilotage Authority’s berth list (November 2025) and the Port of Vancouver’s berth soundings sheets, for Vancouver Wharves (Berths 1, 2/3, 4 and 5), Richardson International (one berth) and Pacific Terminal (Pacific Elevator 4). Where BC’s terminal list disagrees (it gives Richardson 108 m; the pilotage list 183 m, the port sheet 164 m), both are shown. The newer document now sets how close a stopped ship must be to count: Vancouver Wharves Berth 1 (231 m) within 166 m instead of 150 m; Pacific Terminal’s berth (270 m between mooring dolphins, not 305 m) within 185 m instead of 203 m. Ships counted at these three terminals are unchanged; 20 more other vessels are listed at Vancouver Wharves and 18 fewer at Pacific Terminal. 37,554 terminal visits in all, Jul 2025 – Jun 2026.' },
  { date: '2026-09-29', area: 'Terminal visits', text: 'Chemical tankers now count as visits at refinery docks and crude and fuel-product terminals, the same rule the Climate TRACE port stays already use (many product tankers, which load refined fuel at these docks, are listed as chemical tankers). 7 more visits, Jul 2025 – Jun 2026: BP Cherry Point 1,122 (was 1,120), HF Sinclair Puget Sound 1,039 (was 1,034); other oil docks unchanged.' },
  { date: '2026-09-29', area: 'Terminals', text: 'Terminal cards’ Emissions tab now shows Climate TRACE’s estimate for ships while they are stopped at the terminal’s own berths (port stays): 7,262 stays by 2,092 ships of the kinds each terminal serves, at 46 of the 59 terminals, 2024–2025, about 262,000 t CO₂e. Chemical tankers count at refinery and oil docks. Stays by other kinds of ship at the same spot are listed apart, not added in; stays that could belong to two neighbouring terminals are left out.' },
  { date: '2026-09-29', area: 'Ship cards', text: 'The Emissions tab now says who tracked the ship for Climate TRACE: OceanMind (large ships) or Global Fishing Watch (smaller ships), and shows the ship’s deadweight and Climate TRACE’s modelled CO₂ per nautical mile for the 4,379 ships OceanMind tracks. Voyage and port-stay figures updated to Climate TRACE’s latest release and extended north to Vancouver harbour, Roberts Bank, Howe Sound and Nanaimo: 15,817 Climate TRACE ship entries with trips or stays that began in 2024–2025.' },
  { date: '2026-09-28', area: 'Terminals', text: 'Berths estimated from where ships actually stop, for Richardson and Vancouver Wharves (North Vancouver), whose one listed point missed the berths ships use. Each estimate is labelled as such on the terminal card, with how many ships and stops it rests on. Richardson now shows 42 visits by 24 bulk carriers (it showed none), plus 180 visits by cargo ships whose exact kind isn’t stated; Vancouver Wharves 64 visits by 53 ships, up from 25.' },
  { date: '2026-09-28', area: 'Terminals', text: 'Real berth positions for 8 multi-berth terminals (Westshore, Neptune, Westridge, Alliance Grain, Cargill, BP Cherry Point, Crofton, Pacific Coast Terminals), so ships at every berth are counted. Westshore now shows 62 visits by 52 bulk carriers.' },
  { date: '2026-09-28', area: 'Terminals', text: '59 Salish Sea terminals on the map (crude and fuel, refinery docks, bunkering, LNG/LPG, chemical, coal, grain, cement and aggregate, forest products), each with a card: ships that called, emissions, and every source.' },
  { date: '2026-09-28', area: 'Terminal visits', text: '35,942 terminal visits (Jul 2025 – Jun 2026) counted from AIS: a ship stopped within 150–300 m of a berth for 15+ minutes. Tugs at oil and fuel docks are labelled “likely moving a barge”.' },
  { date: '2026-09-28', area: 'Ship tracks', text: 'Detailed Salish Sea tracks now reach 49.6° N and 126.2° W: Vancouver harbour, Burrard Inlet and Indian Arm, the Fraser River, Nanaimo and the Juan de Fuca approach. A new coastline keeps inlets and rivers open to ships.' },
  { date: '2026-09-28', area: 'Ships', text: '1,944 ships added from the larger area, including harbour tugs that never leave Vancouver.' },
  { date: '2026-09-28', area: 'Ship cards', text: 'Scrubber (exhaust gas cleaning) notifications from the IMO’s GISIS database on ship cards.' },
  { date: '2026-09-28', area: 'Terminals', text: '465 IMO-declared port facilities (Canada and US) linked to their terminals. Intalco / Ferndale LPG operator now sourced from Whatcom County (ALA Energy / AltaGas).' },
  { date: '2026-09-28', area: 'Ports', text: 'Official port lists added: Transport Canada, DFO small craft harbours and US Army Corps port areas, with official names on port cards.' },
  { date: '2026-09-28', area: 'Ports', text: '6,006 ports that only Climate TRACE lists are now on the map, with their ship-emission estimates.' },
  { date: '2026-09-28', area: 'Map', text: 'Ship tracks open on Tankers; a picked kind of ship drills down to exact kinds (e.g. oil/chemical tanker, LPG carrier). Larger terminal labels; a tidier left panel.' },
  { date: '2026-09-27', area: 'Ports', text: 'Port card redesign: headline numbers plus Traffic, Ships, Emissions and Trade tabs. Climate TRACE refineries and oil & gas sites added to the Ports layer.' },
]
