/**
 * What EarthAtlas says while something loads (Josh, 2026-09-27: plain, friendly, a little fun; the same basic
 * message with variations "to keep it interesting"). <Loading kind="…"> picks one at random and moves to
 * another every few seconds while it waits. Keep every line TRUE for its kind: no promises about timing.
 *
 *   quick   a single thing (a ship, a port) that normally arrives in a moment
 *   slow    a big or first-time request that can take a while
 *   search  looking something up as you type
 *   more    loading the next page of a list (short: it sits in a button)
 *   report  building a report from many records (a few seconds)
 */
export const LOADING_MESSAGES = {
  quick: [
    'Loading…',
    'One moment…',
    'Fetching that for you…',
    'Coming right up…',
    'Just a sec…',
  ],
  slow: [
    'You’ve asked for a lot of data, and we’re preparing it now. Sit tight.',
    'Gathering a big batch of data. Grab a coffee, this can take a minute.',
    'The first look at this gathers data from several sources. Hang in there.',
    'Crunching the numbers. Worth the wait, we promise.',
    'Hauling in the data. Big catches take a little longer.',
    'Still working on it. Big requests take a moment the first time.',
  ],
  search: [
    'Searching…',
    'Looking…',
    'Scanning the fleet…',
    'Checking the records…',
  ],
  more: [
    'Loading more…',
    'Fetching more…',
  ],
  // a report that tallies a lot of records (the /ships scrubber report)
  report: [
    'Counting calls at every berth…',
    'Matching each call to its ship…',
    'Checking ships against the scrubber lists…',
    'Tallying ports, terminals and refineries…',
    'Adding up the months…',
    'Lining up the numbers…',
  ],
}

/** A random message of this kind, never the same as `not` when there is a choice. */
export function pickLoadingMessage(kind = 'quick', not = null) {
  const list = LOADING_MESSAGES[kind] || LOADING_MESSAGES.quick
  const pool = list.length > 1 ? list.filter((m) => m !== not) : list
  return pool[Math.floor(Math.random() * pool.length)]
}
