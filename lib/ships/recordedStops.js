/**
 * Stop counts from recorded live AIS (Josh 2026-11-11; migration 044). For the months NOAA MarineCadastre hasn't published yet,
 * terminal calls and anchorage stays are counted with the SAME rules (terminalCalls.js, anchorageStays.js) from:
 *   - the live recorder's days (scripts/ships/aisstream: aisstream.io, Open Waters AIS, Washington State Ferries), from 2026-10-18;
 *   - Open Waters AIS's track archive (scripts/ships/aisstream/owarchive.mjs), from 2026-08-20, one ship at a time.
 * Both arrive as NOAA-layout day files. Recorded months sit in the same tables and bake version as NOAA's, flagged in the
 * bake row (recorded_months) and on every row (source_id), so each count names its own source. A NOAA month import replaces
 * the recorded rows of that month and drops it from recorded_months. Pure helpers here; stores in terminalCalls.js /
 * anchorageStays.js.
 */
import { coveredMonths } from './terminalCalls.js'

export const RECORDED_INPUT_NOTE = 'Input: EarthAtlas\'s recording of live AIS for the box W -126.2 S 47 E -122.05 N 49.6 (at most one '
  + 'position per ship per minute): aisstream.io (no published license), Open Waters AIS (aggregate ODbL 1.0, including AISHub '
  + 'contributors and volunteer receivers) and Washington State Ferries vessel positions (WSDOT), from 2026-10-18; before that '
  + 'Open Waters AIS\'s track archive (from 2026-08-20; at most one position per minute, one every 30 minutes while a ship sits '
  + 'still). Receivers differ from NOAA\'s, so counts can differ from a NOAA month; when NOAA publishes a month, its counts '
  + 'replace these. Terminals and anchorages outside the box are not covered.'

const RECORDED_COMMON = {
  publisher: 'EarthAtlas, from its recording of live AIS (aisstream.io, Open Waters AIS incl. AISHub contributors, Washington State Ferries)',
  homepage_url: 'https://openwaters.io/ais/',
  license: 'ODbL 1.0 (derived from Open Waters AIS); aisstream.io publishes no license',
  license_url: 'https://openwaters.io/ais/#license',
  commercial_use: false,
  attribution_url: 'https://openwaters.io/ais/#license',
}

export const RECORDED_TERMINAL_CALLS_SOURCE = {
  id: 'earthatlas-terminal-calls-recorded',
  name: 'EarthAtlas terminal calls (derived from recorded live AIS)',
  ...RECORDED_COMMON,
  attribution_text: 'Recorded live AIS (aisstream.io; Open Waters AIS, ODbL, incl. AISHub contributors; WSF), calls derived by EarthAtlas',
  notes: 'Derived dataset, evidence class inferred: the terminal-call rule of earthatlas-terminal-calls (SOG < 0.5 kn within the '
    + 'berth radius, gap > 6 h starts a new call, >= 15 min kept, nearest berth wins), applied to recorded live AIS. ' + RECORDED_INPUT_NOTE,
}

export const RECORDED_ANCHORAGE_STAYS_SOURCE = {
  id: 'earthatlas-anchorage-stays-recorded',
  name: 'EarthAtlas anchorage stays (derived from recorded live AIS)',
  ...RECORDED_COMMON,
  attribution_text: 'Recorded live AIS (aisstream.io; Open Waters AIS, ODbL, incl. AISHub contributors; WSF), anchorage stays derived by EarthAtlas',
  notes: 'Derived dataset, evidence class inferred: the anchorage-stay rule of earthatlas-anchorage-stays (SOG < 0.5 kn inside the '
    + 'anchorage polygon >= 60 min, gap > 6 h starts a new stay), applied to recorded live AIS. ' + RECORDED_INPUT_NOTE,
}

/** Months of `months` NOAA already covers (in the bake, not recorded): a recorded import must never overwrite them. Pure. */
export function noaaMonthsIn(bake, months) {
  const noaa = new Set((bake?.months || []).filter((m) => !(bake.recorded_months || []).includes(m)))
  return months.filter((m) => noaa.has(m))
}

/**
 * Covered months for ONE place: the bake's months, minus recorded months where the recorder's box doesn't reach that place
 * (recorded_not_covered). → { covered, missing }. Pure.
 */
export function placeCoveredMonths(winMonths, bake, key) {
  const off = key && (bake?.recorded_not_covered || []).includes(key) ? new Set(bake.recorded_months || []) : null
  const months = off ? (bake?.months || []).filter((m) => !off.has(m)) : bake?.months
  return coveredMonths(winMonths, months)
}

/** Which of these covered months were counted from recorded live AIS (the rest are NOAA's). Pure. */
export const recordedOf = (covered, bake) => covered.filter((m) => (bake?.recorded_months || []).includes(m))
