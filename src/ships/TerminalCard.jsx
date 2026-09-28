/**
 * The terminal card (/ships; Josh 2026-09-28, UI "A"): opened from a terminal pin's popup ("Open card").
 * Built like the port card (Option A): header, headline strip for the months picked on the map, then Ships / Emissions /
 * About tabs. Shares PortCard's MonthBars / About and PortEmissions (refinery plant and ship-port estimates,
 * labelled apart). Every value links to where it came from. Data: api op=terminal (lib/ships/terminalCard.js).
 * Visits = our own AIS calls (lib/ships/terminalCalls.js, Josh 2026-09-28); GFW port visits are only a comparison (About).
 */
import { useEffect, useMemo, useState } from 'react'
import styles from './ShipsApp.module.css'
import pick from './ShipPicker.module.css'
import Chevron from './Chevron.jsx'
import { Loading } from '../components/panel'
import { MonthBars, About, PORT_HUE } from './PortCard.jsx'
import PortEmissions, { usePortEmissions, shortTonnes } from './PortEmissions.jsx'
import { GLYPH, kindFamily, kindWords, NOT_OPERATING, STATUS_WORDS, TERMINAL_MUTED_RING } from './terminalIcons.js'

const fmtN = (n) => Number(n).toLocaleString('en-US')
const plural = (n, w, ws = `${w}s`) => `${fmtN(n)} ${n === 1 ? w : ws}`
const monthName = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const dateWords = (d) => {
  if (!d) return null
  if (/^\d{4}-\d{2}$/.test(d)) return new Date(`${d}-01T00:00:00Z`).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}
const rec = (id) => `/ships/source/${id}`
const SRC_SHORT = {
  'usace-docks': 'USACE', 'wa-ecology-facilities': 'WA Ecology', 'bc-ports-terminals': 'BC Ports & Terminals', osm: 'OpenStreetMap',
  'gem-gctt': 'GEM', 'gem-ggit': 'GEM', 'imo-gisis-port-facilities': 'IMO GISIS', 'climate-trace': 'Climate TRACE',
  'earthatlas-terminals': 'EarthAtlas list', 'gfw-port-visits': 'GFW', 'earthatlas-terminal-calls': 'MarineCadastre AIS',
}
const ROLE_WORDS = {
  dock_record: 'Dock record', reference: 'Related record', osm_site: 'OpenStreetMap site', osm_berth_element: 'OpenStreetMap berth element',
  gem_coal_terminal: 'Global Coal Terminals Tracker', gem_lng_terminal: 'Global Gas Infrastructure Tracker (LNG)', ct_refinery: 'Climate TRACE refinery plant',
  ct_ship_port: 'Climate TRACE ship port', imo_port_facility: 'IMO ISPS port facility',
}
const BASIS_WORDS = {
  usace_dock: 'USACE dock point', ecology_dock: 'WA Ecology dock point', bc_ports_terminals: 'BC Ports and Terminals point',
  osm_seamark_berth: 'OpenStreetMap berth', osm_pier_centers: 'centre of OpenStreetMap piers', osm_site_center: 'OpenStreetMap site centre (low precision)',
  gisis_facility: 'IMO GISIS facility point',
}

function Glyph({ kind, muted, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={muted ? TERMINAL_MUTED_RING : PORT_HUE} strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: GLYPH[kindFamily(kind)] }} />
  )
}

/** A source chip that opens the stored record (/ships/source/<id>), or the source's page. */
function Src({ id, source, href, title }) {
  const url = id ? rec(id) : href
  if (!url) return null
  return <a className={`${styles.sourceLink} ${styles.srcLink}`} href={url} target="_blank" rel="noopener noreferrer" title={title}>{SRC_SHORT[source] || source}</a>
}

/** A folded list of ships ("Other vessels nearby" etc.). */
function Folded({ title, children, count }) {
  const [open, setOpen] = useState(false)
  if (!count) return null
  return (
    <div className={styles.pcAbout}>
      <button type="button" className={styles.recordToggle} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {title} <Chevron up={open} size={13} />
      </button>
      {open && <div>{children}</div>}
    </div>
  )
}

const kindText = (s) => (s.kind ? `${s.kind}${s.kindBasis === 'ais' ? ' (AIS reported type)' : ''}` : 'kind not stated')
const kindTitle = (s) => (s.kindBasis === 'earthatlas'
  ? `EarthAtlas’s kind of ship, from all its type records (${(s.kindSources || []).join(', ')}); open the ship’s card for each source`
  : `The ship-and-cargo type the ship itself broadcast over AIS during its calls (code ${s.aisType ?? 'none'}); self-reported, not a registry fact`)
const dayName = (d) => (d ? new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '')
const hoursWords = (h) => (h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${Math.round(h)} h` : `${(h / 24).toFixed(1)} days`)

/** One ship's calls at this terminal (AIS). The name is what the ship broadcast; its card opens when EarthAtlas knows it. */
function CallShip({ s, onSelectVessel, rule }) {
  const name = s.name ? s.name : `MMSI ${s.mmsi}`
  return (
    <div className={styles.incident}>
      <div className={styles.incidentHead}>
        <span className={styles.incidentTitle}>
          {s.vesselId
            ? <button type="button" className={styles.pcShipLink} onClick={() => onSelectVessel(s.vesselId)} title="Open this ship’s card (the EarthAtlas ship that held this MMSI at the call)">{name}</button>
            : <span title={s.ambiguousVessels ? 'Several EarthAtlas ships held this MMSI then, so none is picked' : 'Not in EarthAtlas’s ship database yet; the name is as the ship broadcast it'}>{name}</span>}
        </span>
        <span className={styles.period}>{plural(s.visits, 'call')}</span>
      </div>
      <div className={styles.incidentMeta}>
        {[s.name && `MMSI ${s.mmsi}`].filter(Boolean).join('')}{s.name && ' · '}
        <span title={kindTitle(s)}>{kindText(s)}</span>
        {' · '}last {dayName(s.lastAt)} UTC · {hoursWords(s.hours)} at the berth in all · closest {fmtN(s.nearestM)} m{' '}
        <a className={`${styles.sourceLink} ${styles.srcLink}`} href={rec(s.bakeRecordId)} target="_blank" rel="noopener noreferrer"
          title={`EarthAtlas counted these calls from MarineCadastre AIS positions (CC0): the ship reported under ${rule.sogKn} kn within the berth’s radius for ${rule.minMinutes}+ minutes; a gap of more than ${rule.gapHours} h starts a new call. Name, MMSI and type as the ship broadcast them — click for the bake record (rule, berths and radii, days read)`}>MarineCadastre AIS</a>
        {!s.vesselId && <span className={styles.pcMuted}> · {s.ambiguousVessels ? 'several EarthAtlas ships held this MMSI' : 'not in EarthAtlas yet'}</span>}
        {s.oneOf > 0 && <span title="Some of these stopped positions were also within another listed terminal’s berth radius; the nearest berth is counted, never both"> · {fmtN(s.oneOf)} also near {s.oneOfNames.join(' / ')}</span>}
      </div>
    </div>
  )
}

export default function TerminalCard({ terminalKey, months, month, onMonth, onClose, onSelectVessel, folded, onFold, tab: tabProp, onTab }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [slow, setSlow] = useState(false)
  const from = months[0], to = months[months.length - 1]
  const url = `/api/ships?op=terminal&key=${encodeURIComponent(terminalKey)}&from=${from}&to=${to}`
  useEffect(() => {
    const ctl = new AbortController()
    setErr(null); setSlow(false)
    const t = setTimeout(() => setSlow(true), 3000)
    fetch(url, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'Terminal not found' : `Load failed (${r.status})`))))
      .then(setData)
      .catch((e) => { if (e.name !== 'AbortError') setErr(e.message) })
      .finally(() => clearTimeout(t))
    return () => { ctl.abort(); clearTimeout(t) }
  }, [url])
  const winMonths = data?.window?.months || months
  const emShips = usePortEmissions(terminalKey, winMonths, `/api/ships?op=terminalEmissions&key=${encodeURIComponent(terminalKey)}&part=ships`)
  const emRef = usePortEmissions(terminalKey, winMonths, `/api/ships?op=terminalEmissions&key=${encodeURIComponent(terminalKey)}&part=refinery`)
  const src = useMemo(() => Object.fromEntries((data?.sources || []).map((x) => [x.id, x])), [data])
  const loading = !data || data.terminal?.key !== terminalKey
  const t = data?.terminal
  const tabs = [['ships', 'Ships'], ['emissions', 'Emissions'], ['about', 'About']]
  const tab = tabs.some(([id]) => id === tabProp) ? tabProp : 'ships'
  const muted = t && NOT_OPERATING.includes(t.status)
  const s = data?.summary
  const refinery = emRef.state === 'ok' && emRef.sources?.length
  const co2 = refinery ? emRef : emShips
  // The record a value was read from: a berth or link of that source + key.
  const recordOf = (source, key) => {
    if (!data || !source) return null
    const k = String(key || '').replace(/\s*\(.*\)$/, '')
    const l = data.links.find((x) => x.source_id === source && x.entity_key === k)
    return l?.source_record_id ?? null
  }
  const imo = (data?.links || []).filter((l) => l.role === 'imo_port_facility')
  const cov = data?.coverage && { missing: [], of: 0, ...data.coverage } // tolerate an older response shape
  const bakeRec = cov?.bake?.recordId
  const noAis = cov && (cov.notCovered || !cov.months.length)

  return (
    <div className={`${pick.card} ${folded ? pick.cardFolded : ''}`} role="dialog" aria-label="Terminal card">
      <button type="button" className={pick.fold} onClick={() => onFold(!folded)}
        aria-label={folded ? 'Unfold terminal card' : 'Fold terminal card'} title={folded ? 'Show the whole card' : 'Fold the card to its name'}><Chevron up={!folded} size={16} /></button>
      <button type="button" className={pick.close} onClick={onClose} aria-label="Close terminal card">×</button>
      {err && <div className={styles.errorNote}>{err}</div>}
      {loading && !err && <Loading kind={slow ? 'slow' : 'quick'} className={styles.loadingNote} style={{ paddingRight: 56 }} />}
      {!loading && t && <>
        <div className={styles.vesselHead}>
          <div className={styles.pcKicker}><Glyph kind={t.kind} muted={muted} size={14} />{kindWords(t.kind)}</div>
          <div className={styles.vesselName}>{t.name}{' '}
            <Src id={t.entryRecordId} source="earthatlas-terminals" title="EarthAtlas’s hand-checked terminal list entry — click for the record" />
          </div>
          <div className={styles.vesselSub}>
            {t.operator ? <>Run by <a className={styles.pcPlainLink} href={t.operatorSourceUrl} target="_blank" rel="noopener noreferrer"
              title={`Current operator, checked ${t.operatorChecked} on this page${t.operatorNote ? `. ${t.operatorNote}` : ''}`}>{t.operator}</a>
              <span className={styles.pcMuted}> · checked {t.operatorChecked}</span></> : 'Operator not confirmed'}
          </div>
          <div className={styles.idNote} style={muted ? { color: '#fca5a5' } : undefined}>
            {STATUS_WORDS[t.status] || t.status}{t.statusDate && t.status !== 'operating' ? ` since ${dateWords(t.statusDate)}` : ''}
            {t.statusNote && <span className={styles.pcMuted}> · {t.statusNote}</span>}{' '}
            {t.statusSourceUrl && <a className={`${styles.sourceLink} ${styles.srcLink}`} href={t.statusSourceUrl} target="_blank" rel="noopener noreferrer" title="The page that states this status">source</a>}
          </div>
          {imo.length > 0 && (
            <div className={styles.idNote}>
              IMO port facility {imo.map((l, i) => <span key={l.entity_key}>{i > 0 && ', '}{l.entity_key}{' '}
                <Src id={l.source_record_id} source="imo-gisis-port-facilities" title={`IMO GISIS ISPS declared port facility “${l.detail?.facility_name}”${l.detail?.name_evidence ? `. Same facility: ${l.detail.name_evidence}` : ''}${l.detail?.position_note ? `. ${l.detail.position_note}` : ''} — click for the record`} /></span>)}
            </div>
          )}
          {(t.commodities?.length > 0 || t.commoditiesHistory?.length > 0) && (
            <div className={styles.idNote}>
              {t.commodities?.length > 0 && <>Handles {t.commodities.join(', ')}{' '}
                <Src id={recordOf(t.commoditiesSource, t.commoditiesRef)} source={t.commoditiesSource} href={src[t.commoditiesSource]?.homepage_url}
                  title={`Read from ${t.commoditiesRef || 'the source'}`} /></>}
              {t.commoditiesHistory?.map((h) => (
                <span key={h.commodity} title={h.note}> · <s>{h.commodity}</s> <span className={styles.pcMuted}>(out of date)</span>{' '}
                  <Src id={recordOf(h.source, h.ref)} source={h.source} title={`${h.note} — click for the record`} /></span>
              ))}
            </div>
          )}
        </div>

        <div className={styles.pcKpis}>
          <div className={styles.pcKpi} title={`Calls by ships whose kind fits this terminal: the ship reported under ${data.rule.sogKn} kn within ${data.rule.radiusM} m of a berth (more for a long berth) for ${data.rule.minMinutes}+ minutes. EarthAtlas counted them from MarineCadastre AIS positions`}>
            <span>Visits</span><strong>{noAis ? '—' : fmtN(s.visits)}</strong></div>
          <div className={styles.pcKpi} title="Different ships among those calls"><span>Ships</span><strong>{noAis ? '—' : fmtN(s.ships)}</strong></div>
          <div className={styles.pcKpi} title={refinery ? 'Climate TRACE’s estimate for the refinery plant itself (tonnes CO₂e)' : 'Ships’ voyage emissions Climate TRACE attributes to this terminal’s port (tonnes CO₂e)'}>
            <span>{refinery ? 'Refinery CO₂e' : 'Ship CO₂e'}</span><strong>{co2.state === 'loading' ? '…' : co2.state === 'ok' && co2.reported ? shortTonnes(co2.total) : '—'}</strong></div>
        </div>
        <div className={styles.pcWindow}>{monthName(winMonths[0])} – {monthName(winMonths[winMonths.length - 1])} · the months picked on the map ·{' '}
          <a className={styles.sourceLink} href={bakeRec ? rec(bakeRec) : 'https://hub.marinecadastre.gov/pages/vesseltraffic'} target="_blank" rel="noopener noreferrer"
            title="Visits are counted from MarineCadastre AIS positions (NOAA / BOEM / USCG, CC0) — click for the bake record">MarineCadastre AIS</a>
          {co2.state === 'ok' && <> · <a className={styles.sourceLink} href="https://climatetrace.org" target="_blank" rel="noopener noreferrer">Climate TRACE</a></>}
        </div>

        {!folded && <>
          <div className={pick.tabs} role="tablist">
            {tabs.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id}
                className={`${pick.tab} ${tab === id ? pick.tabOn : ''}`} onClick={() => onTab(id)}>{label}</button>
            ))}
          </div>

          {tab === 'ships' && (
            <div className={styles.section}>
              <MonthBars months={s.months} month={month} onMonth={onMonth} listed={false} say={(n) => plural(n, 'call')} none="no AIS for this month yet"
                label="Calls per month by ships that fit this terminal" />
              {cov.notCovered && <div className={styles.capNote}>This terminal lies outside the area our AIS positions cover (MarineCadastre’s US receivers, up to 49.6° N), so its visits aren’t counted: not zero, just not seen.</div>}
              {!cov.notCovered && cov.missing.length > 0 && (
                <div className={styles.capNote}>No AIS for {cov.missing.length === cov.of ? 'these months' : `${fmtN(cov.missing.length)} of these ${fmtN(cov.of)} months`} yet: we have {monthName(cov.aisFrom)} – {monthName(cov.aisTo)}. {cov.missing.length < cov.of && 'Those months are left out, not counted as zero.'}</div>
              )}
              {!noAis && <div className={styles.portSummary}>
                <strong>{plural(s.visits, 'call')}</strong> by {plural(s.ships, 'ship')} whose kind fits
                {s.visits > 0 && <> ({[`${fmtN(s.hours)} h at the berth`, s.oneOf && `${fmtN(s.oneOf)} also near another terminal`, s.tugs && `${fmtN(s.tugs)} by tugs`].filter(Boolean).join(', ')})</>}
                {s.lastAt && <> · last {dayName(s.lastAt)}</>}{' '}
                <a className={`${styles.sourceLink} ${styles.srcLink}`} href={bakeRec ? rec(bakeRec) : 'https://hub.marinecadastre.gov/pages/vesseltraffic'} target="_blank" rel="noopener noreferrer"
                  title="Counted by EarthAtlas from MarineCadastre AIS positions (CC0) with the rule under “About this data”; each ship below links the same bake record">MarineCadastre AIS</a>
              </div>}
              {data.ships.map((x) => <CallShip key={x.key} s={x} rule={data.rule} onSelectVessel={onSelectVessel} />)}
              {!noAis && !data.ships.length && <div className={styles.legendNoteText}>No call by a ship of a fitting kind in these months.</div>}
              <Folded count={data.summary.maybe.visits} title={`Could be (${plural(data.summary.maybe.visits, 'call')}): ${data.rule.maybe.join(', ')} ships whose exact kind isn’t stated`}>
                {data.maybe.ships.map((x) => <CallShip key={x.key} s={x} rule={data.rule} onSelectVessel={onSelectVessel} />)}
              </Folded>
              <Folded count={data.summary.other.visits} title={`Other vessels at the berth (${plural(data.summary.other.visits, 'call')} by ${plural(data.summary.other.ships, 'ship')})`}>
                <div className={styles.legendNoteText}>{data.other.kinds.slice(0, 8).map((k) => `${fmtN(k.n)} ${k.label.toLowerCase()}`).join(', ')}{data.other.kinds.length > 8 ? ', …' : ''}</div>
                {data.other.ships.map((x) => <CallShip key={x.key} s={x} rule={data.rule} onSelectVessel={onSelectVessel} />)}
              </Folded>
              <Folded count={data.summary.unknown.visits} title={`Kind not known (${plural(data.summary.unknown.visits, 'call')})`}>
                {data.unknown.ships.map((x) => <CallShip key={x.key} s={x} rule={data.rule} onSelectVessel={onSelectVessel} />)}
              </Folded>
              <About>
                A call counts here when a ship’s own AIS reports put it <strong>stopped</strong> (under {data.rule.sogKn} knots) within
                {' '}{data.rule.radii.length ? data.rule.radii.map((r) => `${r.m} m`).join(' / ') : `${data.rule.radiusM} m`} of this terminal’s berth
                for at least {data.rule.minMinutes} minutes ({data.rule.radiusM} m, or half the berth length an official record states + {data.rule.halfLengthPadM} m,
                at most {data.rule.maxRadiusM} m). A gap of more than {data.rule.gapHours} hours starts a new call. Where two terminals’ berths are that close,
                the nearest berth gets the call, never both, and the other is named. It counts <strong>and</strong> only when the ship is a kind this terminal serves:
                {' '}{data.rule.fits.join(', ')}. The kind is EarthAtlas’s own classification when the ship is in our database (the ship that held the MMSI at
                the time of the call), otherwise the type the ship broadcast.
                {data.summary.tugs > 0 && ' A tank or bunker barge carries no AIS of its own, so its tug is counted, labelled “likely moving a barge”.'}
                {' '}Positions: <a className={styles.sourceLink} href="https://hub.marinecadastre.gov/pages/vesseltraffic" target="_blank" rel="noopener noreferrer">MarineCadastre AIS</a> (NOAA / BOEM,
                from U.S. Coast Guard receivers, CC0), {monthName(cov.aisFrom)} – {monthName(cov.aisTo)}, up to 49.6° N. A ship whose AIS was off, or out of range of
                US receivers, isn’t seen.{' '}
                {bakeRec && <a className={`${styles.sourceLink} ${styles.srcLink}`} href={rec(bakeRec)} target="_blank" rel="noopener noreferrer" title="The bake record: rule, every berth and its radius, the days read">bake record</a>}
                {data.gfw && <> For comparison, Global Fishing Watch lists {plural(data.gfw.visits, 'port visit')} by {plural(data.gfw.ships, 'ship')} (every kind) with a stop within
                  {' '}{data.gfw.matchKm} km of a berth in these months{data.gfw.labels.length > 0 ? ` (GFW port${data.gfw.labels.length > 1 ? 's' : ''} ${data.gfw.labels.join(', ')}; ${data.gfw.monthsChecked} of ${cov.of} months fetched)` : ''}.
                  GFW logs a visit against a whole port area, so it is not counted here.{' '}
                  <a className={styles.sourceLink} href="https://globalfishingwatch.org" target="_blank" rel="noopener noreferrer">Powered by Global Fishing Watch</a></>}
              </About>
            </div>
          )}

          {tab === 'emissions' && <>
            {(emRef.state !== 'none') && <PortEmissions em={emRef} months={winMonths} month={month} onMonth={onMonth} About={About} what="refinery" title="Refinery plant (Climate TRACE)" />}
            <PortEmissions em={emShips} months={winMonths} month={month} onMonth={onMonth} About={About} title="Ships’ voyages (Climate TRACE port)"
              noneText="Climate TRACE has no ship-port estimate linked to this terminal." />
            {emRef.state === 'none' && <div className={styles.legendNoteText}>No refinery plant: Climate TRACE has no facility estimate for this terminal’s own operations.</div>}
          </>}

          {tab === 'about' && (
            <div className={styles.section}>
              <div className={styles.sectionHead}>Berths (where calls are counted)</div>
              {data.berths.map((b) => (
                <div key={b.key} className={styles.legendNoteText}>
                  {b.name || b.key}: {BASIS_WORDS[b.basis] || b.basis}, {b.lat.toFixed(4)}, {b.lon.toFixed(4)}
                  {data.rule.radii.find((r) => r.berth === b.key) && <span className={styles.pcMuted}> · calls within {data.rule.radii.find((r) => r.berth === b.key).m} m</span>}{' '}
                  {b.source_record_ids.map((id) => <Src key={id} id={id} source={b.source_id} title={`${src[b.source_id]?.name || b.source_id} — click for the record`} />)}
                  {b.odbl && <span className={styles.pcMuted}> (ODbL)</span>}
                </div>
              ))}
              <div className={styles.sectionHead}>Records this terminal is linked to</div>
              {data.links.map((l) => (
                <div key={`${l.role}:${l.source_id}:${l.entity_key}`} className={styles.legendNoteText}>
                  {ROLE_WORDS[l.role] || l.role}: {l.detail?.name || l.detail?.facility_name || l.entity_key}{' '}
                  <Src id={l.source_record_id} source={l.source_id} href={src[l.source_id]?.homepage_url} title={`${src[l.source_id]?.name || l.source_id}: ${l.entity_key} — click for the record`} />
                </div>
              ))}
              {t.notes?.length > 0 && <>
                <div className={styles.sectionHead}>Notes and caveats</div>
                {t.notes.map((n) => <div key={n} className={styles.legendNoteText}>{n}</div>)}
              </>}
              <About>
                EarthAtlas keeps a hand-checked list of the Salish Sea’s terminals. Each berth point comes from an official record (USACE docks,
                Washington Ecology, BC Ports and Terminals, IMO GISIS) or, only where none exists, from OpenStreetMap. Operator names in those
                records are often decades old, so the current operator is checked by hand against the linked page. Climate TRACE refinery
                plants and ship ports are kept apart and never shown as one another.
              </About>
              <div className={styles.attribution}>
                {(data.sources || []).map((x, i) => (
                  <span key={x.id}>{i > 0 && ' · '}
                    <a className={styles.sourceLink} href={x.attribution_url || x.homepage_url || '#'} target="_blank" rel="noopener noreferrer" title={x.name}>{x.attribution_text}</a>
                    {x.license_url && <> <a className={styles.sourceLink} href={x.license_url} target="_blank" rel="noopener noreferrer">{String(x.license).split(' (')[0]}</a></>}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>}
      </>}
    </div>
  )
}
