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
  // Ports of call come from GFW's port-visit events, so only ships with a GFW identity get the tab.
  const hasGfw = !!vessel?.assertions.some((a) => a.source_id === 'gfw-vessel-identity' && a.evidence_class === 'ais_self_reported')
  const tab = (tabWanted === 'matches' && !candidates.length) || (tabWanted === 'ports' && !hasGfw) ? 'overview' : tabWanted

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
            {[['overview', 'Overview'], ['history', 'History'],
              ...(hasGfw ? [['ports', 'Ports']] : []),
              ...(vessel.incidents?.length ? [['incidents', `Incidents · ${vessel.incidents.length}`]] : []),
              ...(candidates.length ? [['matches', `Matches · ${candidates.length}`]] : [])].map(([id, label]) => (
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

          {tab === 'ports' && <PortsOfCall vesselId={vessel.vessel.id} />}

          {tab === 'incidents' && <Incidents list={vessel.incidents || []} />}

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

// ─── Incidents tab (Josh, 2026-09-26) ─────────────────────────────────────────
// Official records linked to this ship (lib/ships/incidents*.js). Privacy rules from the import:
// injuries/deaths as counts only; narratives and people's names are never returned.
const INCIDENT_SOURCE = {
  'uscg-cgmix-iir': 'USCG investigation',
  'uscg-psix': 'USCG port-state inspection',
  'wa-ecology-spills': 'WA Ecology spill report',
  'uscg-nrc': 'National Response Center report',
  'noaa-incidentnews': 'NOAA IncidentNews',
}
const INCIDENT_TYPE = {
  injury_or_death: 'Injury or death', person_overboard: 'Person overboard', spill: 'Spill', fire: 'Fire',
  explosion: 'Explosion', collision: 'Collision', allision: 'Allision (hit a fixed object)', grounding: 'Grounding',
  capsize: 'Capsize', flooding: 'Flooding', sinking: 'Sinking', loss_of_propulsion: 'Loss of propulsion',
  loss_of_power: 'Loss of power', loss_of_steering: 'Loss of steering', equipment_failure: 'Equipment failure',
  disabled: 'Disabled vessel', psc_deficiency: 'Inspection deficiencies', cotp_order: 'Coast Guard order',
  detention: 'Detention', letter_of_deviation: 'Letter of deviation',
}
const incidentTitle = (e) => (e.event_types?.length ? e.event_types.map((t) => INCIDENT_TYPE[t] || t.replaceAll('_', ' ')).join(' · ') : (e.event_type_raw || 'Other record'))
const plural = (n, w) => `${n} ${n === 1 ? w : /[^aeiou]y$/.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`}`

// Human labels for the structured detail the import keeps (lib/ships/incidentsPublic.js INCIDENT_DETAIL_KEYS).
const DETAIL_LABEL = {
  classification: 'Classification', involves: 'Involves', subtypes: 'Incident type', level_of_investigation: 'Investigation',
  vessel_damage_status: 'Vessel damage', imo_incident_type: 'IMO incident type', serious_marine_incident: 'Serious marine incident',
  marine_board: 'Marine board of investigation', people_at_risk: 'People at risk', port_state_control_exam: 'Port-state control exam',
  detention_action_code: 'Detention action', source_category: 'Source category', cause: 'Cause', activity: 'Activity', impact: 'Impact',
  regulated: 'Regulated', products: 'Products', quantity_note: 'Quantity', initial_report: 'Initial report', materials: 'Materials',
  max_potential_release_gallons: 'Maximum potential release (gallons)', caveat: 'Caveat',
}
const fmtVal = (v) => (Array.isArray(v) ? v.join(', ') : v === true ? 'Yes' : v === false ? 'No' : String(v))
// Source times keep their raw offset; show them as written (see time_note), date and hh:mm only.
const fmtRawTime = (t) => (t ? String(t).replace('T', ' ').slice(0, 16) : null)

/**
 * The official record itself, opened in the card (Josh, 2026-09-26): CGMIX and PSIX have no
 * per-report web address, so we show what the Coast Guard's public web service returned
 * (structured fields; narratives withheld because they can name people), with the raw reply.
 */
function IncidentRecord({ e }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    if (!open || data) return
    fetch(`/api/ships?op=incident&id=${e.id}`).then((r) => (r.ok ? r.json() : Promise.reject())).then(setData).catch(() => setErr(true))
  }, [open, data, e.id])
  const d = data?.incident?.detail || e.detail || {}
  const rows = Object.entries(DETAIL_LABEL).filter(([k]) => d[k] != null && d[k] !== '' && !(Array.isArray(d[k]) && !d[k].length))
  return (
    <div>
      <button type="button" className={styles.recordToggle} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? 'Hide the record' : 'Show the record'} <Chevron up={open} size={13} />
      </button>
      {open && (
        <div className={styles.record}>
          {err && <div className={styles.incidentMeta}>Couldn’t load this record right now.</div>}
          {rows.map(([k, label]) => (
            <div key={k} className={styles.recordRow}><span className={styles.recordK}>{label}</span><span>{fmtVal(d[k])}</span></div>
          ))}
          {Array.isArray(d.deficiencies) && d.deficiencies.length > 0 && (<>
            <div className={styles.recordSub}>Deficiencies</div>
            {d.deficiencies.map((x, i) => (
              <div key={i} className={styles.recordItem}>
                <div>{x.system}{x.component ? ` · ${x.component}` : ''}</div>
                <div className={styles.incidentMeta}>{[x.cause, x.action, x.resolved ? 'Resolved' : 'Not resolved'].filter(Boolean).join(' · ')}</div>
              </div>
            ))}
          </>)}
          {Array.isArray(d.controls) && d.controls.length > 0 && (<>
            <div className={styles.recordSub}>Coast Guard controls</div>
            {d.controls.map((x, i) => (
              <div key={i} className={styles.recordItem}>
                <div>{x.type}</div>
                <div className={styles.incidentMeta}>{[x.reason, x.category, x.unit, x.imposed_raw && `imposed ${fmtRawTime(x.imposed_raw)}`,
                  x.removed_raw ? `removed ${fmtRawTime(x.removed_raw)}` : 'not yet removed'].filter(Boolean).join(' · ')}</div>
              </div>
            ))}
          </>)}
          {data?.source && (
            <div className={styles.incidentMeta} style={{ marginTop: 6 }}>
              As received from the {data.source.name}{data.source.publisher ? ` (${data.source.publisher})` : ''} public web service
              {data.record?.first_retrieved_at ? ` on ${String(data.record.first_retrieved_at).slice(0, 10)}` : ''}.
              Free-text narratives are withheld here because they can name people.{' '}
              {data.record && <a className={styles.sourceLink} href={`/api/ships?op=record&id=${data.record.id}`} target="_blank" rel="noopener noreferrer">Raw record</a>}
              {e.report_url && <>{' · '}<a className={styles.sourceLink} href={e.report_url} target="_blank" rel="noopener noreferrer">{INCIDENT_SOURCE[e.source_id] || 'source'} website</a></>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Incidents({ list }) {
  if (!list.length) return null
  // Summary line: what kinds of records, most common first.
  const counts = new Map()
  for (const e of list) for (const t of (e.event_types?.length ? e.event_types : ['other'])) counts.set(t, (counts.get(t) || 0) + 1)
  const summary = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([t, n]) => `${n} ${(INCIDENT_TYPE[t] || (t === 'other' ? 'other' : t.replaceAll('_', ' '))).toLowerCase()}`).join(', ')
  return (
    <div className={styles.section}>
      <div className={styles.legendNoteText}>{plural(list.length, 'official record')}: {summary}.</div>
      {list.map((e) => {
        const people = [e.deaths && plural(e.deaths, 'death'), e.injuries && plural(e.injuries, 'injury'),
          e.missing && `${e.missing} missing`].filter(Boolean).join(', ')
        const spill = e.material ? `${e.material}${e.quantity != null ? `, ${e.quantity} ${e.quantity_unit || ''}`.trimEnd() : ''}` : null
        const defs = e.detail?.count ? `${plural(e.detail.count, 'deficiency')}${e.detail.unresolved ? ` (${e.detail.unresolved} unresolved)` : ''}` : null
        return (
          <div key={e.id} className={styles.incident}>
            <div className={styles.incidentHead}>
              <span className={styles.incidentTitle}>{incidentTitle(e)}</span>
              <span className={styles.period}>{e.from ? String(e.from).slice(0, 10) : 'date unknown'}</span>
            </div>
            {e.event_types?.length > 0 && e.event_type_raw && <div className={styles.incidentMeta}>{e.event_type_raw}</div>}
            {[people, spill, defs, e.severity_raw].filter(Boolean).length > 0 && (
              <div className={styles.incidentMeta}>{[people, spill, defs, e.severity_raw].filter(Boolean).join(' · ')}</div>
            )}
            {e.location_text && <div className={styles.incidentMeta}>{e.location_text}</div>}
            <div className={styles.incidentMeta}>
              <span className={`${styles.ev} ${styles.evReg}`} title="An official government record">Official record</span>{' '}
              <span>{INCIDENT_SOURCE[e.source_id] || e.source_id}</span>
              {e.report_ref && <span className={styles.period}> · {e.report_ref}</span>}
            </div>
            <IncidentRecord e={e} />
          </div>
        )
      })}
      <div className={styles.legendNoteText}>Records are linked to this ship by official number, IMO or an MMSI it held at the time; name-only matches aren’t shown. Injuries appear as counts only.</div>
    </div>
  )
}

// ─── Ports of call tab (Josh, 2026-09-26; Phase 3 step 1) ─────────────────────
// Global Fishing Watch port-visit events for this ship's own AIS identity (lib/ships/portVisits.js).
// The first look asks GFW through our server (token never in the browser); visits are saved to our
// database and later opens read them from there. Port names (step 2, lib/ships/ports.js): World Port
// Index first, then GFW's anchorage names (Josh, 2026-09-26); each name links to the record it came from.
// Country names: GeoNames. Every row links to the GFW event exactly as received.
const PAGE = 100
const utcDay = (t) => (t ? new Date(t).toISOString().slice(0, 10) : null)
const utcTime = (t) => (t ? new Date(t).toISOString().replace('T', ' ').slice(0, 16) : null)
const monthYear = (t) => new Date(t).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const titleCase = (s) => String(s).toLowerCase().replace(/(^|[\s\-'/(])([a-z])/g, (_, p, c) => p + c.toUpperCase())
/** Length of stay in plain words: "45 minutes", "9 hours", "3.5 days". */
export function stayWords(h) {
  if (h == null || !Number.isFinite(Number(h))) return 'length unknown'
  const m = Math.round(Number(h) * 60)
  if (m < 60) return m <= 1 ? 'about a minute' : `${m} minutes`
  if (h < 36) { const r = Math.round(h); return r === 1 ? '1 hour' : `${r} hours` }
  const d = h / 24
  return `${d < 10 ? String(Math.round(d * 10) / 10) : Math.round(d).toLocaleString()} days`
}
const CONFIDENCE = {
  3: { text: 'medium confidence', title: 'GFW saw the ship arrive or leave, plus a stop, but not both ends of the visit (confidence 3 of 4). Recent visits often show this until the departure is processed.' },
  2: { text: 'low confidence', title: 'GFW saw only a stop or a gap in the signal near the port (confidence 2 of 4). May be a false visit caused by noisy AIS.' },
}
const NAME_SOURCE = { 'nga-wpi': 'WPI', 'gfw-anchorage-overrides': 'GFW anchorages', 'gfw-port-visits': 'GFW' }
const HARBOR = { L: 'large', M: 'medium', S: 'small', V: 'very small' }
/** Why this name: the matching method in plain words (lib/ships/ports.js matchLabel). */
function nameWhy(p) {
  const km = p.name_distance_km != null ? `${Number(p.name_distance_km).toFixed(1)} km` : null
  const lbl = p.port_label ? ` (GFW port ${p.port_label})` : ''
  switch (p.name_method) {
    case 'wpi_within_4km': return `World Port Index port${p.harbor_size ? ` (${HARBOR[p.harbor_size] || p.harbor_size} harbour)` : ''}, ${km} from the anchorage Global Fishing Watch places this port at${lbl}. NGA Pub 150, public domain — click for the WPI record`
    case 'wpi_nearest_clear': return `Nearest of several World Port Index ports within 4 km (${km}, less than half the next one's distance)${lbl}. NGA Pub 150, public domain — click for the WPI record`
    case 'gfw_override_label': case 'gfw_override_label_majority': return `No World Port Index port within 4 km. Name from Global Fishing Watch's reviewed anchorage-name list (pipe-anchorages, Apache-2.0) for this anchorage${lbl} — click for that row`
    case 'gfw_event_name': return `No World Port Index port within 4 km and no reviewed anchorage name. Name Global Fishing Watch gives this anchorage in its port-visit events${lbl} — click for an event carrying it`
    default: return null
  }
}
/**
 * Our port's name with its inline source (WPI / GFW anchorages / GFW), or GFW's internal label when no source
 * names it (never an invented name). WPI names are shown as WPI writes them; GFW's upper-case names in title case.
 */
function PortName({ p }) {
  if (!p.port_name) {
    return <span className={styles.unnamedPort} title={`No World Port Index port within 4 km and no Global Fishing Watch name for this port; this is GFW's internal label${p.gfw_name ? ` (GFW names it “${p.gfw_name}”, which is a code)` : ''}.`}>{p.port_label || 'unnamed port'}</span>
  }
  const shown = p.name_source_id === 'nga-wpi' ? p.port_name : titleCase(p.port_name)
  const tag = NAME_SOURCE[p.name_source_id] || p.name_source_id
  return (
    <>
      {shown}{' '}
      {p.name_source_record_id
        ? <a className={`${styles.sourceLink} ${styles.srcLink}`} href={`/api/ships?op=record&id=${p.name_source_record_id}`} target="_blank" rel="noopener noreferrer" title={nameWhy(p) || undefined}>{tag}</a>
        : <span className={styles.srcLink} title={nameWhy(p) || undefined}>{tag}</span>}
    </>
  )
}
/** Country of the port: GFW's ISO3, named by GeoNames (link = the GeoNames row). */
function PortCountry({ v }) {
  if (!v.iso3) return null
  if (!v.country_name) return <span className={styles.portCountry} title="Country of the port (ISO 3166 alpha-3), as Global Fishing Watch gives it">{v.iso3}</span>
  return (
    <a className={styles.portCountry} href={v.country_record_id ? `/api/ships?op=record&id=${v.country_record_id}` : 'https://www.geonames.org'} target="_blank" rel="noopener noreferrer"
      title={`Country of the port: Global Fishing Watch gives ${v.iso3}; the English name is from GeoNames (CC BY 4.0) — click for the GeoNames row`}>{v.country_name}</a>
  )
}

function PortsOfCall({ vesselId }) {
  const [data, setData] = useState(null)
  const [visits, setVisits] = useState([])
  const [err, setErr] = useState(null)
  const [more, setMore] = useState(false)
  useEffect(() => {
    const ctl = new AbortController()
    setData(null); setVisits([]); setErr(null)
    fetch(`/api/ships?op=ports&id=${encodeURIComponent(vesselId)}&limit=${PAGE}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Load failed (${r.status})`))))
      .then((d) => { setData(d); setVisits(d.visits || []) })
      .catch((e) => { if (e.name !== 'AbortError') setErr(e.message) })
    return () => ctl.abort()
  }, [vesselId])
  const loadMore = () => {
    setMore(true)
    const w = data.window
    fetch(`/api/ships?op=ports&id=${encodeURIComponent(vesselId)}&from=${w.from}&to=${w.to}&limit=${PAGE}&offset=${visits.length}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((d) => setVisits((v) => [...v, ...(d.visits || [])]))
      .catch(() => setErr('Couldn’t load older visits right now.'))
      .finally(() => setMore(false))
  }
  if (err && !data) return <div className={styles.errorNote}>{err}</div>
  if (!data) return <div className={styles.loadingNote}>Loading port visits… The first look asks Global Fishing Watch and can take a few seconds.</div>
  const src = data.source
  const since = data.since ? monthYear(data.since) : null
  const top = (data.topPorts || []).slice(0, 3)
  const skippedNames = [...new Set((data.skipped || []).map((x) => x.name).filter(Boolean))].slice(0, 3)
  const skippedMmsis = [...new Set((data.skipped || []).map((x) => x.mmsi).filter(Boolean))].sort()
  return (
    <div className={styles.section}>
      {data.total > 0 ? (
        <div className={styles.portSummary}>
          {data.total.toLocaleString()} port {data.total === 1 ? 'visit' : 'visits'}{since && ` since ${since}`}
          {top.length > 0 && <> · most often: {top.map((p, i) => (
            <span key={p.key || p.port_label || i}>{i > 0 && ', '}<PortName p={p} /> ({p.n.toLocaleString()})</span>
          ))}</>}
        </div>
      ) : (
        <div className={styles.legendNoteText}>
          {data.fetch?.status === 'failed' || data.fetch?.status === 'stale_no_gfw'
            ? 'Couldn’t reach Global Fishing Watch right now, and no port visits are stored for this ship yet.'
            : `Global Fishing Watch has no port visits for this ship between ${data.window.from} and ${utcDay(Date.parse(`${data.window.to}T00:00:00Z`) - 864e5)}.`}
        </div>
      )}
      {data.total > 0 && (data.fetch?.status === 'failed' || data.fetch?.status === 'stale_no_gfw') && (
        <div className={styles.capNote}>Couldn’t refresh from Global Fishing Watch right now; showing the visits saved {data.fetchedAt ? `on ${utcDay(data.fetchedAt)}` : 'earlier'}.</div>
      )}
      {visits.map((v) => {
        const conf = CONFIDENCE[v.confidence]
        const arrive = utcDay(v.start_at), leave = utcDay(v.end_at)
        return (
          <div key={v.id} className={styles.incident}>
            <div className={styles.incidentHead}>
              <span className={styles.incidentTitle}>
                <PortName p={v} />
                <PortCountry v={v} />
              </span>
              <span className={styles.period}>{stayWords(v.duration_hrs)}</span>
            </div>
            <div className={styles.incidentMeta}>
              <span className={styles.period} title={`Arrived ${utcTime(v.start_at)} UTC · left ${v.end_at ? `${utcTime(v.end_at)} UTC` : 'unknown'}`}>
                {arrive}{leave && leave !== arrive ? ` → ${leave}` : ''} UTC
              </span>
              {conf && <span className={styles.weakMatch} title={conf.title}>{conf.text}</span>}
              {' · '}
              <a className={`${styles.sourceLink} ${styles.srcLink}`} href={`/api/ships?op=record&id=${v.last_source_record_id}`} target="_blank" rel="noopener noreferrer"
                title={`Global Fishing Watch port-visit event ${v.event_id} (${v.dataset_version || 'public-global-port-visits-events'}), exactly as received · ${src?.license || 'CC BY-NC 4.0'} — click for the raw record`}>GFW</a>
            </div>
          </div>
        )
      })}
      {visits.length < data.total && (
        <button type="button" className={styles.recordToggle} onClick={loadMore} disabled={more}>
          {more ? 'Loading…' : `Show older visits (${(data.total - visits.length).toLocaleString()} more)`} <Chevron size={13} />
        </button>
      )}
      {err && data && <div className={styles.incidentMeta}>{err}</div>}
      <div className={styles.legendNoteText}>
        A port visit is Global Fishing Watch’s reading of the ship’s AIS signal: it came within 3 km of a known anchorage, stopped, and left beyond 4 km.
        Dates are UTC. Port names come from the World Port Index when one of its ports lies within 4 km of the anchorage, otherwise from Global Fishing Watch’s anchorage names; where neither names it, GFW’s internal label is shown.
        {skippedMmsis.length > 0 && <> Not counted: {plural(data.skipped.length, 'other AIS identity')} that Global Fishing Watch groups with this ship
          {skippedNames.length > 0 && <> (broadcasting as {skippedNames.join(', ')})</>} on MMSI {skippedMmsis.join(', ')}; these are usually its tenders or lifeboats.</>}
        {data.fetchedAt && <> Checked with Global Fishing Watch {utcTime(data.fetchedAt)} UTC.</>}
      </div>
      {src && (
        <div className={styles.legendNoteText}>
          Source: <a className={styles.sourceLink} href={src.homepage_url} target="_blank" rel="noopener noreferrer">Global Fishing Watch port-visit events</a>{' · '}
          <a className={styles.sourceLink} href={src.license_url} target="_blank" rel="noopener noreferrer">{src.license}</a>{' · '}
          <a className={styles.sourceLink} href={src.attribution_url} target="_blank" rel="noopener noreferrer">{src.attribution_text}</a>
        </div>
      )}
      {(data.nameSources || []).filter((x) => x.id !== 'gfw-port-visits').length > 0 && (
        <div className={styles.legendNoteText}>
          Names: {(data.nameSources || []).filter((x) => x.id !== 'gfw-port-visits').sort((a, b) => ['nga-wpi', 'gfw-anchorage-overrides', 'geonames-countries'].indexOf(a.id) - ['nga-wpi', 'gfw-anchorage-overrides', 'geonames-countries'].indexOf(b.id)).map((x, i) => (
            <span key={x.id}>{i > 0 && ' · '}<a className={styles.sourceLink} href={x.homepage_url} target="_blank" rel="noopener noreferrer" title={`${x.name} — ${x.license}`}>{x.attribution_text}</a></span>
          ))}
        </div>
      )}
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
