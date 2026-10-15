/**
 * Oil slick card (Josh 2026-10-14, replaces the slick map popup). The dark side card ports, terminals and anchorages have,
 * ordered by the questions people ask: what and when and where → who most likely did it → which other ships were near
 * → see the radar image / go deeper. Data (loaded by ShipsApp, which also drives the map's "slick focus"):
 *   near   /api/cerulean?op=near    candidate ships, each with its closest approach in the 6 h before the image + track
 *   detail /api/cerulean?op=slick   SkyTruth's review label (public API; may be missing, the card works without it)
 *   ships  /api/ships?op=slickShips who held each likely MMSI then (our records, else Global Fishing Watch)
 *   place  /api/geo/reverse         nearest named place
 * Facts and limits: lib/ships/cerulean.js. Every value links to SkyTruth Cerulean.
 */
import { useEffect, useState } from 'react'
import styles from './ShipsApp.module.css'
import pick from './ShipPicker.module.css'
import s from './SlickCard.module.css'
import Chevron from './Chevron.jsx'
import { Loading } from '../components/panel'
import { CERULEAN_APP, SOURCE_KIND, matchWords, slickUrl, sourceUrl } from '../../lib/ships/cerulean.js'

export const NEAR_HOURS = 6
export const NEAR_DISTS = [250, 500, 1000, 2000, 5000]
export const NEAR_DEFAULT = 1000
export const NEAR_COLOR = '#22d3ee'

export const distWords = (m) => (m < 1000 ? `${Math.round(m)} m` : m >= 10000 || Math.round(m) % 1000 === 0 ? `${Math.round(m / 1000)} km` : `${(m / 1000).toFixed(1)} km`)
export const beforeWords = (closest, at) => {
  const min = Math.max(0, Math.round((Date.parse(at) - Date.parse(closest)) / 6e4))
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'}`
  const h = Math.floor(min / 60), m = min % 60
  return `${h} hour${h === 1 ? '' : 's'}${m ? ` ${m} min` : ''}`
}
const titleCase = (n) => String(n).toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase())
const typeWords = (t) => (t ? String(t).toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : null)

/** SkyTruth's most likely ship among the near list: best rank with a positive score. */
/** SkyTruth's ranked candidate sources for the slick, from the per-source records op=near read (ships and the rest). */
export function rankedSources(near) {
  return [...(near?.ships || []).map((x) => ({ ...x, kind: 'VESSEL' })), ...(near?.others || [])].filter((x) => x.rank != null)
    .map((x) => ({ source_type: x.kind, mmsi_or_structure_id: x.extId, source_collated_score: x.score, source_rank: x.rank }))
    .sort((a, b) => a.source_rank - b.source_rank)
}
export function topShip(near) {
  const ranked = rankedSources(near).filter((x) => Number(x.source_collated_score) > 0)
  const top = ranked[0]
  if (top?.source_type === 'VESSEL') return (near?.ships || []).find((x) => x.mmsi === String(top.mmsi_or_structure_id)) || null
  return null
}

// Waters our offshore registers cover (EMODnet: EU/EEA/UK seas; BOEM + USWTDB: US), where "no registered facility nearby"
// means something. British Columbia counts too: its offshore has no oil or gas platforms (federal moratorium).
const REGISTER_EEZ = /United States|United Kingdom|Norw|Netherlands|Dutch|Denmark|Danish|German|Belgi|France|French|Ireland|Irish|Ital|Spain|Spanish|Portug|Poland|Polish|Swed|Finland|Finnish|Estonia|Latvia|Lithuania|Greece|Greek|Croatia|Romania|Bulgaria|Malta|Cyprus|Iceland|Faroe/i
const coveredWaters = (sl) => {
  const eez = (sl.waters || []).filter((w) => w.type === 1).map((w) => w.name)
  if (eez.some((n) => REGISTER_EEZ.test(n))) return 'registers'
  if (eez.some((n) => /Canad/i.test(n)) && sl.lnglat?.[0] < -120) return 'bc'
  return null
}
const OFFSHORE_SRC = {
  'emodnet-platforms': { short: 'EMODnet', name: 'EMODnet Human Activities, Oil and Gas, Offshore Installations (CC BY 4.0)', href: 'https://emodnet.ec.europa.eu/en/human-activities' },
  'emodnet-windfarms': { short: 'EMODnet', name: 'EMODnet Human Activities, Energy, Wind Farms (CC BY 4.0)', href: 'https://emodnet.ec.europa.eu/en/human-activities' },
  uswtdb: { short: 'USWTDB', name: 'U.S. Wind Turbine Database (public domain)', href: 'https://energy.usgs.gov/uswtdb' },
  boem: { short: 'BOEM', name: 'BOEM / BSEE platform structures (public domain)', href: 'https://www.data.boem.gov/' },
}
const isWind = (f) => f?.k === 'turbine' || f?.k === 'windfarm'
const FAC_WORDS = { platform: 'oil and gas platform', windfarm: 'wind farm', turbine: 'wind turbine' }
const FAC_STATUS = { operating: 'operating', construction: 'under construction', planned: 'planned', removed: 'removed or decommissioned' }

const STRENGTH = [['Weak', (v) => v <= 0], ['Possible', (v) => v > 0 && v < 0.5], ['Good', (v) => v >= 0.5 && v < 1], ['Strong', (v) => v >= 1]]
function Strength({ score }) {
  const i = STRENGTH.findIndex(([, f]) => f(Number(score)))
  return (
    <div className={s.strength} title={`SkyTruth’s match score ${Number(score).toFixed(2)} on a scale of −5 to +5. SkyTruth treats scores above 0 as likely; it’s a model score, not a probability.`}>
      {STRENGTH.map(([w], k) => <span key={w} className={k <= i && i > 0 ? s.segOn : s.seg} />)}
      <span className={s.strengthWord}>{matchWords(score)}</span>
    </div>
  )
}

function useLocalTime(at, lnglat) {
  const [txt, setTxt] = useState(null)
  useEffect(() => {
    if (!at) return
    let live = true
    import('@photostructure/tz-lookup').then((m) => {
      const lookup = m.default || m
      let tz = 'UTC'
      try { tz = lookup(lnglat[1], lnglat[0]) } catch { /* UTC */ }
      if (live) setTxt(new Date(at).toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }))
    }).catch(() => {})
    return () => { live = false }
  }, [at, lnglat])
  return txt
}

/** Every candidate ship as a dot: how long before the image (x) and how close it came (y). Click → that ship's track. */
function NearChart({ near, dist, shown, onShow, names }) {
  const W = 340, H = 128, L = 34, R = 10, T = 10, B = 22
  const list = (near.ships || []).filter((x) => x.dist != null && x.dist <= dist && x.closest)
  const xOf = (x) => L + (1 - Math.min(NEAR_HOURS, (Date.parse(near.slick.at) - Date.parse(x.closest)) / 36e5) / NEAR_HOURS) * (W - L - R)
  const yOf = (x) => T + (x.dist / dist) * (H - T - B)
  // Labels: the shown ship's always; others only where they don't collide with one already placed (the dot's tooltip
  // and aria-label still name it).
  const placed = [], showLabel = new Set()
  for (const x of [...list].sort((a, b) => (b.mmsi === shown) - (a.mmsi === shown) || (a.rank || 99) - (b.rank || 99))) {
    const cx = xOf(x), cy = yOf(x), w = names(x).length * 6 + 4, left = cx > W - 90 ? cx - 9 - w : cx + 9
    const box = [left, cy - 7, left + w, cy + 6]
    if (x.mmsi === shown || !placed.some((p) => !(box[2] < p[0] || box[0] > p[2] || box[3] < p[1] || box[1] > p[3]))) { placed.push(box); showLabel.add(x.mmsi) }
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={s.chart} role="group" aria-label="Ships near the slick: time before the image and closest distance">
      <line x1={L} y1={T} x2={L} y2={H - B} className={s.axis} />
      <line x1={L} y1={H - B} x2={W - R} y2={H - B} className={s.axis} />
      <text x={L - 4} y={T + 4} className={s.tick} textAnchor="end">0</text>
      <text x={L - 4} y={H - B} className={s.tick} textAnchor="end">{distWords(dist)}</text>
      <text x={L} y={H - 6} className={s.tick}>{NEAR_HOURS} h before</text>
      <text x={W - R} y={H - 6} className={s.tick} textAnchor="end">image</text>
      {list.map((x) => {
        const on = x.mmsi === shown, cx = xOf(x), cy = yOf(x)
        const label = names(x)
        return (
          <g key={x.mmsi} role="button" tabIndex={0} className={s.dot} onClick={() => onShow(x.mmsi)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onShow(x.mmsi) } }}
            aria-pressed={on} aria-label={`${label}: ${distWords(x.dist)}, ${beforeWords(x.closest, near.slick.at)} before the image`}>
            <title>{`${label} · came within ${distWords(x.dist)}, ${beforeWords(x.closest, near.slick.at)} before the image${x.rank ? ` · SkyTruth’s #${x.rank} candidate` : ''}`}</title>
            <circle cx={cx} cy={cy} r={on ? 6.5 : 4.5} fill={on ? NEAR_COLOR : 'rgba(203,213,225,0.75)'} stroke="#0a0e17" strokeWidth="1.5" />
            {showLabel.has(x.mmsi) && <text x={cx + (cx > W - 90 ? -9 : 9)} y={cy + 4} textAnchor={cx > W - 90 ? 'end' : 'start'} className={on ? s.labelOn : s.label}>{label}</text>}
          </g>
        )
      })}
    </svg>
  )
}

export default function SlickCard({ id, data, error, dist, onDist, shown, onShow, onOpenShip, radarOn, onRadar, onLocate, folded, onFold, onClose }) {
  const { near, detail, ships, place } = data || {}
  const sl = near?.slick
  const local = useLocalTime(sl?.at, sl?.lnglat)
  const [howOpen, setHowOpen] = useState(false)
  const nameOf = (x) => {
    const own = ships?.[x.mmsi]
    const n = (own && (own.status === 'db' || own.status === 'gfw') && own.name) || x.name
    return n ? titleCase(n) : `MMSI ${x.mmsi}`
  }
  const sources = rankedSources(near)
  const likely = sources.filter((x) => Number(x.source_collated_score) > 0)
  const top = likely[0] || null
  const topNear = topShip(near)
  const ageH = sl ? (Date.now() - Date.parse(sl.at)) / 36e5 : 0
  // Whose waters (EEZ), then protected areas: one name plus how many more (Wadden Sea slicks touch 8 overlapping listings).
  const eez = [...new Set((sl?.waters || []).filter((w) => w.type === 1).map((w) => w.name))]
  const mpas = [...new Set((sl?.waters || []).filter((w) => w.type === 3).map((w) => w.name))]
  const watersLine = [eez.join(' · ') || (sl?.waters || [])[0]?.name,
    mpas.length ? `in ${mpas.length === 1 ? 'a protected area' : `${mpas.length} protected area listings`} (${mpas[0]}${mpas.length > 1 ? ', …' : ''})` : null].filter(Boolean).join(' · ')
  const reviewed = detail?.slick?.hitl_cls_name
  const others = (near?.ships || []).filter((x) => x.dist != null && x.dist <= dist)
  const shownShip = (near?.ships || []).find((x) => x.mmsi === shown)

  return (
    <div className={`${pick.card} ${folded ? pick.cardFolded : ''}`} role="dialog" aria-label="Oil slick card">
      <button type="button" className={pick.fold} onClick={() => onFold(!folded)} aria-label={folded ? 'Unfold oil slick card' : 'Fold oil slick card'}><Chevron up={!folded} size={16} /></button>
      <button type="button" className={pick.close} onClick={onClose} aria-label="Close oil slick card (Esc)" title="Close (Esc)">×</button>

      <div className={styles.vesselHead}>
        <span className={s.kicker}>Oil slick</span>
        {!sl && !error && <Loading kind="quick" className={styles.loadingNote} style={{ paddingRight: 56 }} />}
        {error && <div className={styles.errorNote}>Couldn’t load this slick from SkyTruth right now. <a className={styles.sourceLink} href={slickUrl(id)} target="_blank" rel="noopener noreferrer">Open it on Cerulean</a></div>}
        {sl && <>
          <div className={styles.vesselName} style={{ paddingRight: 56 }}>{local || `${sl.at.slice(0, 16).replace('T', ' ')} UTC`}</div>
          <div className={styles.vesselSub}>
            {[place, watersLine].filter(Boolean).join(' · ')}
            {onLocate && <>{' '}<button type="button" className={styles.locateLink} onClick={onLocate}>Show on map</button></>}
          </div>
          <div className={styles.vesselSub}>
            {[sl.length && `About ${distWords(sl.length)} long`, sl.area != null && `${(sl.area / 1e6).toFixed(sl.area >= 1e7 ? 0 : 1)} km²`].filter(Boolean).join(' · ')}
            {' · '}seen by satellite radar{' '}
            <a className={`${styles.sourceLink} ${styles.srcLink}`} href={slickUrl(id)} target="_blank" rel="noopener noreferrer" title={`SkyTruth Cerulean, slick ${id}`}>Cerulean</a>
          </div>
          {reviewed && <div className={s.reviewed}>Reviewed by SkyTruth: {reviewed}</div>}
        </>}
      </div>

      {sl && !folded && <>
        {/* Who most likely did it */}
        <div className={s.verdict}>
          <div className={s.verdictKicker}>{top?.source_type === 'INFRA' && ((reg) => (reg?.facility === null && coveredWaters(sl)) || isWind(reg?.facility))(
            (near?.others || []).find((x) => x.extId === String(top.mmsi_or_structure_id))?.registered)
            ? 'SkyTruth’s top candidate' : 'Most likely source'}</div>
          {top?.source_type === 'VESSEL' && <>
            <div className={s.verdictName}>{topNear ? nameOf(topNear) : `MMSI ${top.mmsi_or_structure_id}`}</div>
            <div className={s.verdictSub}>
              {[typeWords(ships?.[String(top.mmsi_or_structure_id)]?.type || topNear?.type),
                ((f) => (f && String(f).length > 3 ? titleCase(f) : f))(ships?.[String(top.mmsi_or_structure_id)]?.flag || topNear?.flag),
                `MMSI ${top.mmsi_or_structure_id}`].filter(Boolean).join(' · ')}
            </div>
            {topNear?.dist != null && (
              <div className={s.verdictLine}>
                {topNear.dist === 0 ? 'Crossed the slick' : <>Passed <strong>{distWords(topNear.dist)}</strong> from the slick</>},{' '}
                <strong>{beforeWords(topNear.closest, sl.at)}</strong> before the satellite image{topNear.estimated ? ' (estimated position)' : ''}.
              </div>
            )}
            <Strength score={top.source_collated_score} />
            <div className={s.actions}>
              <button type="button" className={s.btn} onClick={() => onOpenShip(String(top.mmsi_or_structure_id))}>Open ship card</button>
              <a className={s.btnGhost} href={sourceUrl(top.mmsi_or_structure_id)} target="_blank" rel="noopener noreferrer">Its slicks on Cerulean ↗</a>
            </div>
          </>}
          {top && top.source_type !== 'VESSEL' && (() => {
            const o = (near?.others || []).find((x) => x.extId === String(top.mmsi_or_structure_id))
            const reg = o?.registered
            const f = reg?.facility
            const cover = coveredWaters(sl)
            return <>
              <div className={s.verdictName}>{f?.name || SOURCE_KIND[top.source_type] || top.source_type}</div>
              <div className={s.verdictSub}>
                {top.source_type === 'INFRA' ? `Structure ${top.mmsi_or_structure_id}, found in satellite radar images` : top.source_type === 'DARK' ? 'Seen in the radar image but not broadcasting AIS' : null}
              </div>
              {f && <div className={s.verdictLine}>
                On the official register {reg.km < 0.05 ? 'at this spot' : `${distWords(reg.km * 1000)} away`}: {FAC_WORDS[f.k] || 'facility'}
                {f.operator ? `, operated by ${f.operator}` : ''}{FAC_STATUS[f.status] ? `, ${FAC_STATUS[f.status]}` : ''}{f.since ? ` (since ${f.since})` : ''}.{' '}
                <a className={`${styles.sourceLink} ${styles.srcLink}`} href={OFFSHORE_SRC[f.src]?.href} target="_blank" rel="noopener noreferrer" title={OFFSHORE_SRC[f.src]?.name}>{OFFSHORE_SRC[f.src]?.short || f.src}</a>
              </div>}
              {isWind(f) && <div className={s.warn}>
                {f.k === 'turbine' ? 'This is a wind turbine' : `This is in a wind farm${f.status === 'construction' ? ' under construction' : ''}`}. The turbines
                themselves hold little oil, but the “structure” may be a vessel working on the farm:{' '}
                {f.status === 'construction' || f.status === 'planned'
                  ? 'installation jack-ups stand still for days and look like fixed structures on radar, and supply, cable and crew ships come and go.'
                  : 'maintenance tenders (crew transfer boats) visit operating farms almost daily, and jack-ups and supply ships come for repairs.'}
                {' '}Check the ships near it below.
              </div>}
              {top.source_type === 'INFRA' && reg && !f && cover && <div className={s.warn}>
                {cover === 'bc'
                  ? 'British Columbia’s offshore has no oil or gas platforms (a federal moratorium), and no facility is on record within 5 km, so this match is probably a false detection.'
                  : 'No oil or gas platform or wind farm on the official registers lies within 5 km. What SkyTruth found may be another kind of structure (a navigation beacon, a pier) or a radar artifact, so this match is unlikely.'}
              </div>}
              {top.source_type === 'INFRA' && reg && !f && !cover && <div className={s.verdictLine}>Our official registers (Europe, US) don’t cover these waters yet, so this structure can’t be checked.</div>}
              <Strength score={top.source_collated_score} />
              <div className={s.actions}><a className={s.btnGhost} href={sourceUrl(top.mmsi_or_structure_id)} target="_blank" rel="noopener noreferrer">On Cerulean ↗</a></div>
            </>
          })()}
          {!top && (ageH < 72
            ? <div className={s.verdictLine}>Too new to match: SkyTruth matches ships about 3 days after the image, once their AIS arrives. Its shape looks like a ship’s slick.</div>
            : <div className={s.verdictLine}>SkyTruth’s model didn’t match any source strongly.{topNear || others[0] ? ' The ships that passed closest are below.' : ''}</div>)}
        </div>

        {/* Which ships were near */}
        <div className={styles.section}>
          <div className={s.sectionRow}>
            <span>Ships near it in the {NEAR_HOURS} hours before</span>
            <label className={s.distPick}>within{' '}
              <select value={dist} onChange={(e) => onDist(Number(e.target.value))} aria-label="Distance from the slick">
                {NEAR_DISTS.map((m) => <option key={m} value={m}>{distWords(m)}</option>)}
              </select>
            </label>
          </div>
          {!near && <Loading kind="quick" className={styles.loadingNote} />}
          {near && (others.length
            ? <>
              <NearChart near={near} dist={dist} shown={shown} onShow={onShow} names={nameOf} />
              <div className={styles.legendNoteText}>
                {shownShip ? <>On the map: <span style={{ color: NEAR_COLOR }}>{nameOf(shownShip)}</span>’s track, the {NEAR_HOURS} hours before the image (dashed = estimated). </> : null}
                Click a dot to show that ship’s track instead.
              </div>
            </>
            : <div className={styles.legendNoteText}>{near.ships.length ? <>None of SkyTruth’s {near.ships.length} candidate ships came within {distWords(dist)}. Try a larger distance.</> : 'SkyTruth listed no candidate ships for this slick.'}</div>)}
        </div>

        {/* See it */}
        <div className={s.seeRow}>
          {sl.radar && <button type="button" className={radarOn ? s.toggleOn : s.toggle} aria-pressed={radarOn} onClick={() => onRadar(!radarOn)}>
            <span className={s.toggleKnob} />{radarOn ? 'Radar image on' : 'Show the radar image'}
          </button>}
          <a className={styles.sourceLink} href={slickUrl(id)} target="_blank" rel="noopener noreferrer">Open on SkyTruth Cerulean ↗</a>
        </div>

        {/* Fine print */}
        <button type="button" className={styles.recordToggle} onClick={() => setHowOpen((o) => !o)} aria-expanded={howOpen}>
          How SkyTruth decides · every candidate · sources <Chevron up={howOpen} size={13} />
        </button>
        {howOpen && <div className={s.how}>
          <p>SkyTruth’s Cerulean finds oil in Sentinel-1 radar images with a computer model, then ranks the ships, offshore structures and
            unidentified vessels near it by how well their position and timing fit the slick (a score from −5 to +5; above 0 is likely).
            A model’s match is a lead, not proof of who spilled. Ship tracks are the AIS positions SkyTruth used; distances are to the
            slick’s outline as seen in the image, and oil drifts after it’s spilled.</p>
          <table className={s.table}>
            <thead><tr><th>#</th><th>Candidate</th><th>Match</th></tr></thead>
            <tbody>{sources.map((x) => {
              const n = (near?.ships || []).find((y) => y.mmsi === String(x.mmsi_or_structure_id))
              return (
                <tr key={`${x.source_type}-${x.mmsi_or_structure_id}`}>
                  <td>{x.source_rank}</td>
                  <td><a className={styles.sourceLink} href={sourceUrl(x.mmsi_or_structure_id)} target="_blank" rel="noopener noreferrer">
                    {x.source_type === 'VESSEL' ? (n ? nameOf(n) : `MMSI ${x.mmsi_or_structure_id}`) : `${SOURCE_KIND[x.source_type] || x.source_type} ${x.mmsi_or_structure_id}`}</a>
                    {n?.dist != null && <span className={styles.pcMuted}> · {distWords(n.dist)}</span>}</td>
                  <td>{matchWords(x.source_collated_score)} <span className={styles.pcMuted}>{Number(x.source_collated_score).toFixed(2)}</span></td>
                </tr>
              )
            })}</tbody>
          </table>
          <p className={styles.pcMuted}>Data: <a className={styles.sourceLink} href={CERULEAN_APP} target="_blank" rel="noopener noreferrer">SkyTruth Cerulean</a> (slick {id}{sl.scene ? `, image ${sl.scene}` : ''});
            contains modified Copernicus Sentinel data. Ship identities from Global Fishing Watch and EarthAtlas’s ship records; place name © Mapbox.</p>
        </div>}
      </>}
    </div>
  )
}
