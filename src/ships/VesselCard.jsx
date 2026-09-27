/**
 * The ship card that hangs under the Ships pill: identity over time,
 * ownership, characteristics and unmerged possible matches. Every value
 * carries its evidence class (AIS / Registry / Model) and a link to the exact
 * raw source record (EarthAtlas inline-provenance rule).
 */
import { useEffect, useMemo, useState } from 'react'
import styles from './ShipsApp.module.css'
import pick from './ShipPicker.module.css'
import Chevron from './Chevron.jsx'

// How each evidence class is labelled, so "AIS reported this" never reads as "a registry confirms this".
export const EVIDENCE = {
  ais_self_reported: { label: 'Ship-reported', cls: 'evAis', title: 'What the ship itself broadcast over AIS (self-reported, unverified)' },
  ais_published: { label: 'Ship-reported', cls: 'evAis', title: 'What the ship broadcast over AIS, as published by NOAA MarineCadastre. The Coast Guard corrects some missing or clearly wrong values, and NOAA doesn\'t mark which' },
  registry: { label: 'Registry', cls: 'evReg', title: 'A vessel registry record, as processed by Global Fishing Watch' },
  inferred: { label: 'Estimate', cls: 'evInf', title: 'Estimated by Global Fishing Watch with a computer model (mostly from how the vessel moves). Not reported by the ship or a registry' },
  derived_identity: { label: 'Matched', cls: 'evInf', title: 'Identity match made by a third party' },
  community_curated: { label: 'Wikidata', cls: 'evCom', title: 'Wikidata: an openly edited, community-curated database (not an official registry)' },
  unverified: { label: 'Unverified', cls: 'evInf', title: 'Unverified third-party information' },
}

const IDENTITY_ROWS = [
  ['name', 'Name'], ['imo', 'IMO number'], ['mmsi', 'MMSI'], ['callsign', 'Call sign'], ['flag', 'Flag'],
]
const ROLE_ROWS = [
  ['registry_owner', 'Owner (as listed by a registry)'], ['owner', 'Owner'], ['registered_owner', 'Registered owner'],
  ['beneficial_owner', 'Beneficial owner'], ['operator', 'Operator'], ['ship_manager', 'Ship manager'],
  ['technical_manager', 'Technical manager'], ['commercial_manager', 'Commercial manager'],
  ['ism_manager', 'ISM manager'], ['bareboat_charterer', 'Bareboat charterer'],
]
const CHAR_ROWS = [['vessel_type', 'What each source calls it'], ['vessel_class', 'Ship class'], ['length_m', 'Length'], ['width_m', 'Width'],
  ['draft_m', 'Draft'], ['tonnage_gt', 'Gross tonnage'], ['max_capacity', 'Capacity (people)'], ['builder', 'Builder'],
  ['service_entry', 'Entered service'], ['service_retirement', 'Retired'], ['port_of_registry', 'Port of registry'],
  ['gear_type', 'Fishing gear'], ['transceiver', 'AIS transponder'], ['authorization', 'Public authorizations']]
// GFW's documented fishing-gear vocabulary (docs/GFW_VESSELS_API.md reference data).
// For non-fishing ships GFW's gear field just repeats the ship class ("cargo"), so the
// Overview shows gear only when it is a real gear; History keeps every raw value.
const FISHING_GEARS = new Set(['TUNA_PURSE_SEINES', 'DRIFTNETS', 'TROLLERS', 'SET_LONGLINES', 'PURSE_SEINES', 'POTS_AND_TRAPS',
  'OTHER_FISHING', 'DREDGE_FISHING', 'SET_GILLNETS', 'FIXED_GEAR', 'TRAWLERS', 'FISHING', 'SEINERS', 'OTHER_PURSE_SEINES',
  'OTHER_SEINES', 'SQUID_JIGGER', 'POLE_AND_LINE', 'DRIFTING_LONGLINES'])
// Short name for each source's inline link.
const SRC_LABEL = { 'gfw-vessel-identity': 'GFW', 'marinecadastre-ais': 'NOAA', wikidata: 'Wikidata' }
// How a Wikidata item was tied to this ship (lib/ships/resolve.js v1.3). Name-only is the weakest.
const LINK_NOTE = {
  IMO_AIS_NAME: { text: 'matched by name', title: 'Wikidata entry tied to this ship by its IMO number (as broadcast over AIS) plus a matching name only. A weaker match than a registry IMO, MMSI or call sign.' },
  IMO_AIS_CALLSIGN: { text: null, title: 'Tied by IMO number (as broadcast over AIS) and call sign' },
  IMO_AIS_MMSI: { text: null, title: 'Tied by IMO number (as broadcast over AIS) and MMSI' },
  IMO_EXACT: { text: null, title: 'Tied by an IMO number that a vessel registry confirms' },
}

const day = (iso) => (iso ? String(iso).slice(0, 10) : null)
function fmtValue(attr, v) {
  if (attr === 'length_m' || attr === 'width_m' || attr === 'draft_m') return String(v).endsWith(' m') ? v : `${v} m`
  if (attr === 'transceiver') return v === 'A' ? 'Class A (commercial ships)' : v === 'B' ? 'Class B (small craft)' : v
  if (attr === 'tonnage_gt') return `${Number(v).toLocaleString()} GT`
  if (attr === 'max_capacity') return Number(v).toLocaleString()
  // Wikidata values carry their item id, e.g. "Holland America Line (Q1624735)": show the name.
  v = String(v).replace(/ \(Q\d+\)$/, '')
  // MarineCadastre types arrive as "37 · Pleasure craft / sailing": show the group, keep the code.
  const coded = attr === 'vessel_type' && /^(\d+) · (.+)$/.exec(String(v))
  if (coded) return `${coded[2]} (AIS code ${coded[1]})`
  if (attr === 'vessel_type' || attr === 'gear_type') return v.replaceAll('_', ' ').toLowerCase()
  return v
}
function fmtPeriod(a) {
  if (a.period_kind === 'unknown') return 'dates unknown'
  // Year-granular sources (GFW classifications) are shown as years, never as invented days.
  if (a.detail?.granularity === 'year') {
    const f = a.from && String(a.from).slice(0, 4), t = a.to && String(a.to).slice(0, 4)
    return f === t ? `in ${f}` : `${f || '?'}–${t || '?'}`
  }
  const f = day(a.from), t = day(a.to)
  const verb = a.period_kind === 'observed' ? 'seen ' : ''
  if (f && t) return f === t ? `${verb}${f}` : `${verb}${f} → ${t}`
  if (f) return `${a.period_kind === 'observed' ? 'seen from' : 'from'} ${f}`
  return `until ${t}`
}
function sourceTitle(a, sourcesById) {
  const src = sourcesById[a.source_id]
  const regs = a.detail?.registries?.length ? ` · registries: ${a.detail.registries.join(', ')}` : ''
  const basis = a.detail?.period_basis ? ` · dates = ${a.detail.period_basis}` : ''
  return `${src?.name || a.source_id}${regs}${basis} · ${src?.license || ''} — click for the raw source record`
}

/** Collapse identical claims (same value, evidence and dates) that several sub-records repeat. */
function rowsFor(assertions, attr) {
  const seen = new Map()
  for (const a of assertions.filter((x) => x.attribute === attr)) {
    const k = [a.value_norm, a.evidence_class, day(a.from), day(a.to), a.period_kind].join('|')
    if (!seen.has(k)) seen.set(k, a)
  }
  return [...seen.values()].sort((x, y) => String(x.from || '').localeCompare(String(y.from || '')))
}

/**
 * One row per VALUE, not per source: claims that say the same thing (same displayed value)
 * in overlapping or nearby periods merge into one row listing every source that says it.
 * The same value in separate eras (a name dropped and later reused) stays separate.
 */
const MERGE_GAP_MS = 60 * 864e5
const dispKey = (attr, a) => String(fmtValue(attr, a.value_raw)).toLowerCase().replace(/\.0( m)?$/, '$1')
function mergedRows(assertions, attr, keep = () => true) {
  const byVal = new Map()
  for (const a of rowsFor(assertions, attr)) {
    if (!keep(a)) continue
    const k = dispKey(attr, a)
    if (!byVal.has(k)) byVal.set(k, [])
    byVal.get(k).push(a)
  }
  const t = (v) => (v ? Date.parse(v) : null)
  const out = []
  for (const list of byVal.values()) {
    const dated = list.filter((a) => a.period_kind !== 'unknown').sort((x, y) => String(x.from || '').localeCompare(String(y.from || '')))
    const undated = list.filter((a) => a.period_kind === 'unknown')
    const clusters = []
    for (const a of dated) {
      const c = clusters[clusters.length - 1]
      const aFrom = t(a.from), cTo = c && c.to ? t(c.to) : null
      if (c && (aFrom == null || cTo == null || aFrom <= cTo + MERGE_GAP_MS)) {
        c.members.push(a)
        if (a.from && (!c.from || a.from < c.from)) c.from = a.from
        if (!a.to || !c.to) c.to = a.to && c.to ? c.to : (c.to && a.to ? c.to : c.to || a.to)
        else if (a.to > c.to) c.to = a.to
      } else clusters.push({ members: [a], from: a.from, to: a.to })
    }
    // Undated claims of the same value join the first era (they can't be placed in time).
    if (undated.length) { if (clusters.length) clusters[0].members.push(...undated); else clusters.push({ members: undated, from: null, to: null }) }
    for (const c of clusters) {
      const d = c.members.filter((a) => a.period_kind !== 'unknown')
      c.period = !d.length ? { period_kind: 'unknown' } : {
        period_kind: d.some((a) => a.period_kind === 'observed') ? 'observed' : 'validity', from: c.from, to: c.to,
        detail: d.every((a) => a.detail?.granularity === 'year') ? { granularity: 'year' } : {},
      }
      c.value = c.members[0]
      // one badge + link per source/evidence pair
      const seen = new Map()
      for (const a of c.members) { const k = `${a.evidence_class}|${a.source_id}`; if (!seen.has(k) || String(a.to || '9999') > String(seen.get(k).to || '9999')) seen.set(k, a) }
      c.sources = [...seen.values()]
      out.push(c)
    }
  }
  return out.sort((x, y) => String(x.from || '').localeCompare(String(y.from || '')))
}

export function Ev({ c }) {
  const e = EVIDENCE[c] || EVIDENCE.unverified
  return <span className={`${styles.ev} ${styles[e.cls]}`} title={e.title}>{e.label}</span>
}

// Tab and fold are controlled by the page when it passes them (so the URL can carry them).
export default function VesselCard({ vesselId, onClose, onSelectVessel, onLoaded, tab: tabProp, onTab, folded: foldedProp, onFold }) {
  const [vessel, setVessel] = useState(null)
  const [foldedOwn, setFoldedOwn] = useState(false) // header only, so the map underneath shows
  const [tabOwn, setTabOwn] = useState('overview')  // overview (what the ship is) · history (identity over time) · matches
  const folded = foldedProp ?? foldedOwn
  const setFolded = (f) => { const v = typeof f === 'function' ? f(folded) : f; onFold ? onFold(v) : setFoldedOwn(v) }
  const tabWanted = tabProp ?? tabOwn
  const setTab = (t) => (onTab ? onTab(t) : setTabOwn(t))
  const [error, setError] = useState(null)

  useEffect(() => {
    const ctl = new AbortController()
    setVessel(null); setError(null)
    fetch(`/api/ships?op=vessel&id=${encodeURIComponent(vesselId)}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'Vessel not found' : `Load failed (${r.status})`))))
      .then((v) => { setVessel(v); onLoaded?.(v) })
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message) })
    return () => ctl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vesselId])

  const sourcesById = useMemo(() => Object.fromEntries((vessel?.sources || []).map((s) => [s.id, s])), [vessel])
  // Wikimedia Commons photos (Wikidata P18), licence-checked at import; the preferred one first.
  const images = useMemo(() => {
    const seen = new Set()
    return (vessel?.assertions || []).filter((a) => a.attribute === 'image' && a.detail?.thumb_url)
      .filter((a) => !seen.has(a.value_norm) && seen.add(a.value_norm))
      .sort((x, y) => (y.detail.rank === 'preferred') - (x.detail.rank === 'preferred'))
  }, [vessel])
  const current = useMemo(() => currentIdentity(vessel), [vessel])

  // Both directions: another vessel's record may match this one, or this one's record may match another.
  // (`tab` falls back to Overview when this ship has no Matches tab.)
  const candidates = vessel
    ? [...vessel.links.filter((l) => l.status === 'candidate'), ...vessel.outgoing]
        .filter((c) => c.other_vessel && c.other_vessel !== vessel.vessel.id)
        .filter((c, i, all) => all.findIndex((x) => x.other_vessel === c.other_vessel && x.method === c.method) === i)
    : []
  const tab = tabWanted === 'matches' && !candidates.length ? 'overview' : tabWanted

  const Src = ({ a }) => {
    const note = a.source_id === 'wikidata' ? LINK_NOTE[a.link_method] : null
    return (<>
      <a className={`${styles.sourceLink} ${styles.srcLink}`} href={`/api/ships?op=record&id=${a.last_source_record_id}`} target="_blank" rel="noopener noreferrer"
        title={`${sourceTitle(a, sourcesById)}${note ? ` · ${note.title}` : ''}`}>{SRC_LABEL[a.source_id] || 'source'}</a>
      {note?.text && <span className={styles.weakMatch} title={note.title}>{note.text}</span>}
    </>)
  }

  // Overview: the latest value each source gives, one line per source (no timelines).
  const latestPerSource = (attr) => {
    const byEv = new Map()
    for (const a of rowsFor(vessel.assertions, attr)) {
      if (attr === 'gear_type' && !FISHING_GEARS.has(String(a.value_norm).toUpperCase())) continue
      const k = `${a.evidence_class}|${a.source_id}`
      const cur = byEv.get(k)
      if (!cur || String(a.to || '9999') > String(cur.to || '9999')) byEv.set(k, a)
    }
    const order = ['ais_published', 'ais_self_reported', 'registry', 'community_curated', 'inferred', 'derived_identity', 'unverified']
    return [...byEv.values()].sort((x, y) => order.indexOf(x.evidence_class) - order.indexOf(y.evidence_class))
  }
  // Each evidence type once, then every source that says it: "AIS  GFW, NOAA".
  const Sources = ({ list, withDates }) => {
    const order = ['ais_published', 'ais_self_reported', 'registry', 'community_curated', 'inferred', 'derived_identity', 'unverified']
    const byEv = new Map()
    for (const a of list) {
      const k = EVIDENCE[a.evidence_class]?.label || a.evidence_class
      if (!byEv.has(k)) byEv.set(k, [])
      if (!byEv.get(k).some((x) => x.source_id === a.source_id)) byEv.get(k).push(a)
    }
    const groups = [...byEv.values()].sort((x, y) => order.indexOf(x[0].evidence_class) - order.indexOf(y[0].evidence_class))
    return (
      <span className={styles.srcList}>
        {groups.map((g) => (
          // Badge and source say the same word (Wikidata): the badge itself is the link.
          g.length === 1 && EVIDENCE[g[0].evidence_class]?.label === SRC_LABEL[g[0].source_id]
            ? <a key={g[0].id} className={styles.srcPair} href={`/api/ships?op=record&id=${g[0].last_source_record_id}`} target="_blank" rel="noopener noreferrer"
                title={sourceTitle(g[0], sourcesById)}><Ev c={g[0].evidence_class} />{LINK_NOTE[g[0].link_method]?.text && <span className={styles.weakMatch} title={LINK_NOTE[g[0].link_method].title}>{LINK_NOTE[g[0].link_method].text}</span>}</a>
            : <span key={g[0].id} className={styles.srcPair}>
            <Ev c={g[0].evidence_class} />
            <span>{g.map((a, i) => <span key={a.id} title={withDates ? `${SRC_LABEL[a.source_id] || a.source_id}: ${fmtPeriod(a)}` : undefined}>{i > 0 && ', '}<Src a={a} /></span>)}</span>
          </span>
        ))}
      </span>
    )
  }
  // Overview: sources giving the same value share one line.
  const sameValue = (attr, list) => {
    const m = new Map()
    for (const a of list) { const k = dispKey(attr, a); if (!m.has(k)) m.set(k, []); m.get(k).push(a) }
    return [...m.values()]
  }
  const renderOverview = (rows, title) => {
    const present = rows.filter(([attr]) => latestPerSource(attr).length)
    if (!present.length) return null
    return (
      <div className={styles.section}>
        {title && <div className={styles.sectionHead}>{title}</div>}
        {present.map(([attr, label]) => (
          <div key={attr} className={styles.attrBlock}>
            <div className={styles.attrLabel}>{label}</div>
            {sameValue(attr, latestPerSource(attr)).map((g) => (
              <div key={g[0].id} className={styles.valRowShort}>
                <span className={styles.val}>{fmtValue(attr, g[0].value_raw)}</span>
                <Sources list={g} />
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  }

  const renderSection = (rows, title) => {
    const present = rows.filter(([attr]) => mergedRows(vessel.assertions, attr, (a) => attr !== 'gear_type' || FISHING_GEARS.has(String(a.value_norm).toUpperCase())).length)
    if (!present.length) return null
    return (
      <div className={styles.section}>
        <div className={styles.sectionHead}>{title}</div>
        {present.map(([attr, label]) => (
          <div key={attr} className={styles.attrBlock}>
            <div className={styles.attrLabel}>{label}</div>
            {mergedRows(vessel.assertions, attr, (a) => attr !== 'gear_type' || FISHING_GEARS.has(String(a.value_norm).toUpperCase())).map((g) => (
              <div key={g.value.id} className={styles.histRow}>
                <div className={styles.val}>{fmtValue(attr, g.value.value_raw)}{attr === 'imo' && g.value.detail?.checksum_ok === false ? <span className={styles.warn} title="Fails the IMO check digit — likely a typo in the source"> ⚠︎</span> : null}</div>
                <div className={styles.histMeta}>
                  <span className={styles.period}>{fmtPeriod(g.period)}</span>
                  <Sources list={g.sources} withDates />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={`${pick.card} ${folded ? pick.cardFolded : ''}`} role="dialog" aria-label="Ship card">
      <button type="button" className={pick.fold} onClick={() => setFolded((f) => !f)}
        aria-label={folded ? 'Unfold ship card' : 'Fold ship card'} title={folded ? 'Show the whole card' : 'Fold the card to its name'}><Chevron up={!folded} size={16} /></button>
      <button type="button" className={pick.close} onClick={onClose} aria-label="Close ship card">×</button>
      {error && <div className={styles.errorNote}>{error}</div>}
      {!vessel && !error && <div className={styles.loadingNote}>Loading ship…</div>}
      {vessel && (
        <>
          <div className={styles.vesselHead}>
            <div className={styles.vesselName}>{current.name?.value_raw || 'Unnamed vessel'}</div>
            <div className={styles.vesselSub}>
              {current.imo && <>IMO {current.imo.value_raw} · </>}{current.flag && <>{current.flag.value_raw} · </>}
              {current.mmsi && <>MMSI {current.mmsi.value_raw}</>}
            </div>
            {vessel.vessel.needs_review && (
              <div className={styles.review} title="EarthAtlas found evidence that conflicts with this identity. It did not merge anything automatically.">
                Identity needs review: see the Matches tab.
              </div>
            )}
            <div className={styles.idNote} title="EarthAtlas's own id for this vessel. IMO and MMSI can change or be wrong; this id doesn't.">
              EarthAtlas vessel {vessel.vessel.id.slice(0, 8)}
            </div>
          </div>

          {!folded && <>
          <div className={pick.tabs} role="tablist">
            {[['overview', 'Overview'], ['history', 'History'], ...(candidates.length ? [['matches', `Matches · ${candidates.length}`]] : [])].map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id}
                className={`${pick.tab} ${tab === id ? pick.tabOn : ''}`} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>

          {tab === 'overview' && <>
            <Photos images={images} />
            <TypeLine c={vessel.classification} typeClaims={latestPerSource('vessel_type')} Src={Src} />
            {renderOverview(CHAR_ROWS, null)}
            {renderOverview(ROLE_ROWS.filter(([a]) => a !== 'registry_owner'), null)}
            {renderOverview([['registry_owner', 'Owner (latest registry listing)']], null)}
            {!CHAR_ROWS.concat(ROLE_ROWS).some(([attr]) => vessel.assertions.some((a) => a.attribute === attr)) && (
              <div className={styles.legendNoteText}>No characteristics published for this ship yet.</div>
            )}
          </>}

          {tab === 'history' && <>
            {renderSection(IDENTITY_ROWS, 'Identity over time')}
            {renderSection(ROLE_ROWS, 'Ownership & management')}
            {renderSection(CHAR_ROWS, 'Characteristics over time')}
          </>}

          {tab === 'matches' && candidates.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionHead}>Possible matches, not merged</div>
              {candidates.map((c, i) => (
                <div key={i} className={styles.candRow}>
                  {c.method === 'MMSI_TEMPORAL' ? `Shares MMSI ${c.evidence?.mmsi} during overlapping dates`
                    : c.source_id === 'wikidata' ? `A Wikidata entry (IMO ${c.evidence?.imo ?? '?'}, not confirmed by a second identifier) may also match`
                    : `Shares IMO ${c.evidence?.imo} (${c.evidence?.basis === 'registry' ? 'registry' : 'AIS-reported'})`}
                  {' '}with <button className={styles.inlineLink} onClick={() => onSelectVessel(c.other_vessel)}>another vessel ({c.other_vessel.slice(0, 8)})</button>
                </div>
              ))}
              <div className={styles.legendNoteText}>EarthAtlas keeps these separate until the evidence is strong enough. MMSIs get reused and mistyped, so a shared MMSI alone never merges two ships.</div>
            </div>
          )}
          {/* Every source this card draws on, with its licence (from ships.sources). */}
          <div className={styles.attribution}>
            {vessel.sources.map((src, i) => (
              <span key={src.id}>{i > 0 && ' · '}
                <a className={styles.sourceLink} href={src.attribution_url || src.homepage_url} target="_blank" rel="noopener noreferrer">{src.attribution_text}</a>{' '}
                <a className={styles.sourceLink} href={src.license_url} target="_blank" rel="noopener noreferrer">{src.license}</a>
              </span>
            ))}
          </div>
          </>}
        </>
      )}
    </div>
  )
}

/** Photo from Wikimedia Commons with its credit and licence (each file's own licence, stored at import). */
function Photos({ images }) {
  const [i, setI] = useState(0)
  if (!images.length) return null
  const img = images[i % images.length], d = img.detail
  return (
    <figure className={styles.photo}>
      <a href={d.file_page_url} target="_blank" rel="noopener noreferrer" title="Open the photo on Wikimedia Commons">
        <img src={d.thumb_url} alt={`Photo: ${String(img.value_raw).replace(/\.[a-z]+$/i, '')}`} loading="lazy"
          width={d.thumb_width || undefined} height={d.thumb_height || undefined} />
      </a>
      <figcaption>
        Photo: <a className={styles.sourceLink} href={d.file_page_url} target="_blank" rel="noopener noreferrer">{d.artist || 'unknown author'}</a>
        {' · '}<a className={styles.sourceLink} href={d.license_url} target="_blank" rel="noopener noreferrer">{d.license_short_name}</a>
        {' · via Wikimedia Commons'}
        {images.length > 1 && <button type="button" className={styles.inlineLink} onClick={() => setI((n) => n + 1)}
          title="Next photo">{` · ${(i % images.length) + 1}/${images.length} ›`}</button>}
      </figcaption>
    </figure>
  )
}

/**
 * EarthAtlas's reading of what kind of ship this is (docs/SHIP_CLASSIFICATION.md): group ·
 * sub-group from the sources' own claims, which are listed right under it with their links.
 * GFW's model ranks lower: when it disagrees it's shown as a lower-ranked view, not a conflict.
 */
function TypeLine({ c, typeClaims, Src }) {
  if (!c) return null
  const known = c.class && !String(c.class).endsWith('_unspecified')
  const label = c.conflict && !c.group ? 'Sources disagree on the kind of ship'
    : c.group === 'unknown' ? 'Kind of ship not known'
    : known ? `${c.groupLabel} · ${c.classLabel}` : `${c.groupLabel} · type not known`
  const aisHaz = typeClaims.find((a) => a.source_id === 'marinecadastre-ais')
  return (
    <div className={styles.typeLine}>
      <div className={styles.attrLabel}>Kind of ship</div>
      <div className={styles.typeHead} title="EarthAtlas's reading of the sources below (AIS, registries and Wikidata decide; Global Fishing Watch's model counts only when they're silent)">{label}</div>
      {c.conflict && c.group && <div className={styles.typeNote}>Sources name different sub-groups: {c.classes.join(', ').replaceAll('_', ' ')}.</div>}
      {c.refinedBy?.length > 0 && <div className={styles.typeNote}>Sub-type from the registry record below.</div>}
      {c.dissent?.length > 0 && <div className={styles.typeNote}>
        Global Fishing Watch's model says {[...new Set(c.dissent.map((d) => (d.class || d.group).replaceAll('_', ' ')))].join(' / ')} (ranked lower than what the ship and registries report).
      </div>}
      {c.hazardous_cargo?.length > 0 && <div className={styles.hazard}>
        ⚠︎ Carries hazardous cargo (self-declared, category {c.hazardous_cargo.join(', ')}) {aisHaz && <Src a={aisHaz} />}
      </div>}
    </div>
  )
}

/** Latest name/flag/MMSI and the registry IMO, for headers and the pill. */
export function currentIdentity(vessel) {
  if (!vessel) return {}
  // Registry first (same rule as the search summaries in lib/ships/queries.js), then the latest from any source.
  const latest = (attr) => rowsFor(vessel.assertions, attr).sort((x, y) =>
    (y.evidence_class === 'registry') - (x.evidence_class === 'registry') || String(y.to || '9999').localeCompare(String(x.to || '9999')))[0]
  return { name: latest('name'), flag: latest('flag'), mmsi: latest('mmsi'),
    imo: rowsFor(vessel.assertions, 'imo').find((a) => a.evidence_class === 'registry') || latest('imo') }
}
