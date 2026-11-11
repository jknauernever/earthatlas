/**
 * Inline credit for stop counts made from EarthAtlas's recorded live AIS (lib/ships/recordedStops.js): months NOAA hasn't
 * published, counted with the same rule from aisstream.io, Open Waters AIS (ODbL, incl. AISHub contributors) and Washington State
 * Ferries, plus Open Waters' track archive before 2026-10-18. The link opens the bake record; the feeds link to their sources.
 */
import { AISSTREAM_URL, OPENWATERS_LICENSE_URL, AISHUB_URL } from './liveSources.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const shortMonth = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`
export const monthSpan = (ms) => (ms.length ? (ms.length === 1 ? shortMonth(ms[0]) : `${shortMonth(ms[0])} – ${shortMonth(ms[ms.length - 1])}`) : '')

/** "recorded live AIS (Sep – Oct 2026)" linked to the bake record; feeds credited in the title and the short credit after it. */
export function RecordedAisLink({ months, recordHref, className, withFeeds = false }) {
  if (!months?.length) return null
  const sorted = [...months].sort()
  return <>
    <a className={className} href={recordHref || OPENWATERS_LICENSE_URL} target="_blank" rel="noopener noreferrer"
      title={`${monthSpan(sorted)}: counted by EarthAtlas with the same rule from its recording of live AIS (aisstream.io; Open Waters AIS, ODbL, incl. AISHub contributors; Washington State Ferries), because NOAA hasn’t published these months yet. NOAA’s counts replace them when it does. Click for the bake record.`}>
      recorded live AIS</a> ({monthSpan(sorted)}){withFeeds && <> from <RecordedFeeds className={className} /></>}
  </>
}

/** "aisstream.io and Open Waters AIS (ODbL, incl. AISHub contributors)", each linked. */
export function RecordedFeeds({ className }) {
  return <>
    <a className={className} href={AISSTREAM_URL} target="_blank" rel="noopener noreferrer">aisstream.io</a> and{' '}
    <a className={className} href={OPENWATERS_LICENSE_URL} target="_blank" rel="noopener noreferrer">Open Waters AIS</a> (ODbL, incl.{' '}
    <a className={className} href={AISHUB_URL} target="_blank" rel="noopener noreferrer">AISHub contributors</a>)
  </>
}
