// Status order for the species-of-concern lookup, shared by the server (lists.js, lookup.js) and the page
// (src/speciesOfConcern), which must not import the list data itself.

// Most to least protective; a species is grouped under its highest confirmed status on any list.
export const STATUS_ORDER = [
  'Endangered', 'Threatened', 'Proposed Endangered', 'Proposed Threatened', 'Sensitive', 'Candidate',
  'Experimental Population, Non-Essential', 'Under Review', 'Possibly extirpated', 'Species of Concern',
  'Species of Greatest Conservation Need', 'Priority species',
]

// Rows where no list's status is confirmed by the records (only the species of a listed
// subspecies/population was recorded) go in their own group, after every status.
export const NOT_CONFIRMED = 'Related species recorded (listed taxon not confirmed)'

// Listed species whose only records have blurred locations (iNaturalist hides sensitive species in a 0.2° square):
// they may be inside the circle or up to ~28 km away, so they are kept out of the main list.
export const BLURRED_ONLY = 'Possibly nearby (location blurred)'

export const statusRank = (s) => { const i = STATUS_ORDER.indexOf(s); return i < 0 ? STATUS_ORDER.length : i }
export const groupRank = (g) => (g === BLURRED_ONLY ? STATUS_ORDER.length + 1 : g === NOT_CONFIRMED ? STATUS_ORDER.length + 2 : statusRank(g))
