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
}

export const COUNTS_AS_OF = '2026-09-29'

// { label, value, sources: [S.x | plain string] }
export const COUNTS = [
  { label: 'Ships', value: '24,182', sources: [S.gfw, 'US Coast Guard', 'Transport Canada', 'FCC', S.marinecadastre, 'Wikidata', 'Wikimedia Commons'] },
  { label: 'Ports on the map', value: '9,159', detail: 'World Port Index 2,951 · Climate TRACE 6,006 · GFW 168 · DFO harbours 34', sources: [S.wpi, S.ct, S.gfw, 'Fisheries and Oceans Canada'] },
  { label: 'Terminals', value: '59', detail: '81 berths', sources: [S.bcports, 'US Army Corps of Engineers', 'WA Dept. of Ecology', S.osm, S.gem] },
  { label: 'Terminal visits', value: '37,554', detail: 'at 52 terminals, Jul 2025 – Jun 2026, counted by EarthAtlas from AIS', sources: [S.marinecadastre] },
  { label: 'Port visits', value: '96,465', sources: [S.gfw] },
  { label: 'Ship-port emission estimates', value: '17,907', sources: [S.ct] },
  { label: 'Incidents', value: '9,233', sources: ['US Coast Guard', 'NOAA IncidentNews', 'WA Dept. of Ecology'] },
  { label: 'Ships with scrubber notifications', value: '6,498', detail: '571 matched to EarthAtlas ships', sources: [S.gisis] },
  { label: 'Official anchorages', value: '810', sources: [S.marinecadastre, 'eCFR', 'Fisheries and Oceans Canada'] },
  { label: 'IMO port facilities', value: '465', detail: 'Canada and US', sources: [S.gisis] },
]

export const COVERAGE_NOTE = 'Detailed ship tracks cover the Salish Sea for Jul 2025 – Jun 2026; US-wide tracks cover 2015 onward.'

// Newest first. { date, area, text }
export const ENTRIES = [
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
