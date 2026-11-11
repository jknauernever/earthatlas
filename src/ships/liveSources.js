/**
 * Who a live ship position came from, for its inline credit. The recorder (scripts/ships/aisstream/recorder.mjs) tags
 * each position with `src`: 'aisstream', 'wsf', or 'openwaters/<upstream>' (Open Waters AIS names where it heard it:
 * aishub, station = a volunteer receiver, aisstream, digitraffic…). Open Waters' aggregate is ODbL; AISHub asks for
 * "AISHub contributors" with a link (https://openwaters.io/ais/#license).
 */
export const AISSTREAM_URL = 'https://aisstream.io'
export const OPENWATERS_URL = 'https://openwaters.io/ais/'
export const OPENWATERS_LICENSE_URL = 'https://openwaters.io/ais/#license'
export const AISHUB_URL = 'https://www.aishub.net'
export const WSF_URL = 'https://wsdot.wa.gov/travel/washington-state-ferries'

const SOURCES = {
  aisstream: { name: 'aisstream.io live AIS', short: 'aisstream.io', url: AISSTREAM_URL },
  wsf: { name: 'Washington State Ferries (WSDOT) vessel positions', short: 'WSF', url: WSF_URL },
  'openwaters/aishub': { name: 'AISHub contributors, via Open Waters AIS (ODbL)', short: 'AISHub via Open Waters', url: AISHUB_URL },
  'openwaters/station': { name: 'Open Waters AIS volunteer receivers (ODbL)', short: 'Open Waters', url: OPENWATERS_URL },
  'openwaters/aisstream': { name: 'aisstream.io, via Open Waters AIS (ODbL)', short: 'aisstream.io via Open Waters', url: AISSTREAM_URL },
}

/** { name, short, url } for a position's src; positions recorded before sources were tagged are aisstream.io. */
export function liveSource(src) {
  if (!src) return SOURCES.aisstream
  if (SOURCES[src]) return SOURCES[src]
  if (src.startsWith('openwaters/')) return { name: `Open Waters AIS (${src.slice(11)}; ODbL)`, short: 'Open Waters', url: OPENWATERS_LICENSE_URL }
  return { name: src, short: src, url: OPENWATERS_LICENSE_URL }
}

/** One-line credit for all live AIS together (map attribution, panel lines). */
export const LIVE_AIS_CREDIT_HTML = `<a href="${AISSTREAM_URL}" target="_blank" rel="noopener">aisstream.io</a> and `
  + `<a href="${OPENWATERS_LICENSE_URL}" target="_blank" rel="noopener">Open Waters AIS</a> (ODbL, incl. `
  + `<a href="${AISHUB_URL}" target="_blank" rel="noopener">AISHub contributors</a>)`

/** Sources-rollup entry for Open Waters (same shape as the other entries in shipsSources.js / page source lists). */
export const OPENWATERS_SOURCE_ENTRY = {
  name: 'Open Waters AIS live feed', href: OPENWATERS_URL, publisher: 'Open Water Software, LLC',
  licence: 'ODbL 1.0 (aggregate); AISHub contributors credited per AISHub membership', licenceHref: OPENWATERS_LICENSE_URL,
  method: 'Since November 11, 2026, a second live AIS feed alongside aisstream.io: Open Waters merges AISHub, volunteer receivers and other open feeds. EarthAtlas records it the same way (at most one position per ship per minute) and credits each position to where Open Waters heard it. AISHub positions run about a minute behind.',
}
