/**
 * Ship-type groups for the oil-transfer report's filters (Josh 2026-11-08: "we need subtypes for the filters for the ship type").
 * Ecology's Advance Notices of Transfer name one flat vessel type per ship (31 of them); EarthAtlas groups them here, by hand,
 * keeping Ecology's own type as the subtype. Ecology's "PASSENGER SHIP" does not separate cruise ships, so it is split in two:
 * a notified ship is a cruise ship when its name is in CRUISE_SHIPS, each entry with the public source that calls it a cruise ship
 * (Wikidata "instance of: cruise ship", or Wikimedia Commons filing its IMO category under cruise ships), matched by IMO and length
 * to the EarthAtlas ship record of that name. Pure.
 *
 * Passenger ships not listed (checked 2026-11-08 against the 97 passenger ships the notices name): ferries, day-tour, whale-watching
 * and charter boats, and small overnight ships no public source above calls a cruise ship (for example National Geographic Sea Lion,
 * Wilderness Legacy, American Constitution, which Wikidata lists only as "ship"). They stay "Passenger ship, other".
 */
export const SHIP_TYPE_GROUPS_VERSION = 'sg1'

export const SHIP_TYPE_GROUPS = [
  ['Tankers', ['TANK SHIP', 'LNG/LPG/LG VESSEL']],
  ['Barges', ['TANK BARGE', 'ATB BARGE', 'DECK BARGE', 'CONSTRUCTION BARGE', 'CARGO BARGE']],
  ['Tugs', ['TUGBOAT', 'ATB TUG']],
  ['Cargo ships', ['CONTAINER SHIP', 'BULK CARRIER', 'GENERAL CARGO SHIP', 'ROLL-ON/ROLL-OFF VESSEL']],
  ['Passenger ships and ferries', ['PASSENGER SHIP', 'FERRY VESSEL']],
  ['Fishing', ['FISHING VESSEL', 'FISH PROCESSOR']],
  ['Government and research', ['MILITARY/LAW ENFORCEMENT', 'RESEARCH VESSEL', 'OCEANOGRAPHIC RESEARCH - INSPECTED', 'ICEBREAKER']],
  ['Work and service', ['WORK BOAT', 'OFFSHORE SUPPLY VESSEL', 'SPILL RESPONSE VESSEL', 'HOPPER/DREDGE', 'CABLE LAYER/REPAIR SHIP']],
  ['Recreational and other', ['RECREATIONAL VESSEL', 'UN-REGULATED VESSEL', 'VESSEL', 'Z- UNKNOWN']],
]
export const OTHER_GROUP = 'Recreational and other'
const GROUP_OF = new Map(SHIP_TYPE_GROUPS.flatMap(([g, ts]) => ts.map((t) => [t, g])))

const wd = (id) => ({ name: 'Wikidata', url: `https://www.wikidata.org/wiki/${id}` })
const cm = (imo) => ({ name: 'Wikimedia Commons', url: `https://commons.wikimedia.org/wiki/Category:IMO_${imo}` })

/** Notified ship name (as Ecology writes it) → the public source calling it a cruise ship. */
export const CRUISE_SHIPS = {
  'ANTHEM OF THE SEAS': wd('Q18213370'), 'AMERICAN CONSTELLATION': wd('Q104382186'), 'AMERICAN SPIRIT': wd('Q4745147'),
  'ASUKA II': wd('Q752399'), 'BRILLIANT LADY': cm(9870654), 'CARNIVAL LUMINOSA': wd('Q1136365'), 'CARNIVAL MIRACLE': wd('Q1044080'),
  'CARNIVAL SPIRIT': wd('Q1044093'), 'CELEBRITY EDGE': wd('Q28494961'), 'DISCOVERY PRINCESS': wd('Q97179447'), 'EURODAM': wd('Q548546'),
  'GRAND PRINCESS': wd('Q747465'), 'MSC POESIA': wd('Q1881875'), 'NATIONAL GEOGRAPHIC QUEST': wd('Q84257883'),
  'NATIONAL GEOGRAPHIC VENTURE': wd('Q104378149'), 'NOORDAM': wd('Q1996454'), 'NORWEGIAN BLISS': wd('Q23578843'),
  'NORWEGIAN ENCORE': wd('Q48816581'), 'NORWEGIAN JADE': wd('Q1759038'), 'NORWEGIAN JOY': wd('Q16983037'), 'NORWEGIAN SUN': wd('Q1458212'),
  'QUANTUM OF THE SEAS': wd('Q18128240'), 'QUEEN ELIZABETH': wd('Q606002'), 'RIVIERA': wd('Q3841550'), 'ROYAL PRINCESS': wd('Q3014295'),
  'SAFARI ENDEAVOUR': cm(8963698), 'SAFARI EXPLORER': cm(8964654), 'SILVER NOVA': wd('Q122171101'), 'STAR PRINCESS': cm(9863120),
  'THE WORLD': wd('Q1495908'), 'VOLENDAM': wd('Q929326'), 'VOYAGER OF THE SEAS': wd('Q1752985'), 'WESTERDAM': wd('Q2420946'),
  'WILDERNESS ADVENTURER': wd('Q126932300'),
}
export const CRUISE = 'Passenger ship, cruise'
export const PASSENGER_OTHER = 'Passenger ship, other'

/** Group of an Ecology vessel type (unknown or missing → "Recreational and other"). */
export const shipGroupOf = (type) => GROUP_OF.get(String(type || '').trim().toUpperCase()) || OTHER_GROUP

/** The cruise-ship source for a notified passenger ship, or null. */
export function cruiseSourceOf(type, ship) {
  if (String(type || '').trim().toUpperCase() !== 'PASSENGER SHIP') return null
  return CRUISE_SHIPS[String(ship || '').trim().toUpperCase().replace(/\s+/g, ' ')] || null
}
