/**
 * Anchorage card (Josh 2026-10-07): the dark side card terminals and ports have, replacing the white map popup. Data: api/ships
 * op=anchorage&key=<source_id|source_key> (lib/ships/anchorageCard.js): the area, its other names, stays counted from NOAA AIS
 * (lib/ships/anchorageStays.js), and for months NOAA hasn't published, stays estimated from Global Fishing Watch hourly positions
 * (lib/ships/activityEstimates.js). Every figure links to its source.
 */
import { useEffect, useState } from 'react'
import styles from './ShipsApp.module.css'
import pick from './ShipPicker.module.css'
import Chevron from './Chevron.jsx'
import { Loading } from '../components/panel'
import { MonthBars, About, PORT_HUE } from './PortCard.jsx'
import { DayBars } from './EstimatedVisits.jsx'
import { statusWords, areaWhat, aliasTitle, SRC_SHORT, ALIAS_SHORT } from './anchoragePopup.js'

const fmtN = (n) => Number(n).toLocaleString('en-US')
const plural = (n, w, ws = `${w}s`) => `${fmtN(n)} ${n === 1 ? w : ws}`
const monthName = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const dayName = (d) => (d ? new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '')
const rec = (id) => `/ships/source/${id}`
const span = (ms) => (ms.length === 1 ? monthName(ms[0]) : `${monthName(ms[0])} – ${monthName(ms[ms.length - 1])}`)
const EST_HUE = '#a5b4fc'

function Link({ href, title, children }) {
  return href ? <a className={`${styles.sourceLink} ${styles.srcLink}`} href={href} target="_blank" rel="noopener noreferrer" title={title}>{children}</a> : null
}

/** One ship's stays here. */
function StayShip({ s, onSelectVessel, est, srcHref }) {
  const name = s.aisName || s.name || (s.mmsi ? `MMSI ${s.mmsi}` : 'Unnamed ship')
  const meta = [s.mmsi && `MMSI ${s.mmsi}`, s.kind, `${est ? '≈ ' : ''}${plural(s.days, 'day')}`, `${fmtN(Math.round(s.hours))} h`, s.stays > 1 && plural(s.stays, 'stay')].filter(Boolean).join(' · ')
  return (
    <div className={styles.incident}>
      <div className={styles.incidentHead}>
        <span className={styles.incidentTitle}>
          {s.vesselId
            ? <button type="button" className={styles.pcShipLink} onClick={() => onSelectVessel(s.vesselId)} title="Open this ship’s card">{name}</button>
            : <span title={s.ambiguousVessels ? 'Several EarthAtlas ships held this MMSI then, so none is picked' : 'Not in EarthAtlas’s ship records yet; the name is as the ship broadcast it'}>{name}</span>}
        </span>
      </div>
      <div className={styles.incidentMeta}>{meta}{' '}
        <Link href={srcHref} title={est ? 'Estimated by EarthAtlas from Global Fishing Watch hourly positions — click for the month’s record' : 'Counted by EarthAtlas from MarineCadastre AIS — click for the count’s record'}>{est ? 'Global Fishing Watch' : 'MarineCadastre AIS'}</Link>
      </div>
    </div>
  )
}

/** One likely fueling: the ship fueled and the vessel(s) beside it (Josh 2026-10-18; lib/ships/bunkerEvents.js). */
function Fueling({ f, onSelectVessel, srcHref }) {
  const shipBtn = (v, fallback) => {
    const name = v.name || (v.mmsi ? `MMSI ${v.mmsi}` : fallback)
    return v.vesselId
      ? <button type="button" className={styles.pcShipLink} onClick={() => onSelectVessel(v.vesselId)} title="Open this ship’s card">{name}</button>
      : <span title="Not in EarthAtlas’s ship records yet; the name is as the ship broadcast it">{name}</span>
  }
  const when = new Date(f.t0).toLocaleString('en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles', timeZoneName: 'short' })
  return (
    <div className={styles.incident}>
      <div className={styles.incidentHead}>
        <span className={styles.incidentTitle}>{shipBtn(f.receiver, 'Unnamed ship')}</span>
      </div>
      <div className={styles.incidentMeta}>
        {[f.receiver.kind?.label, when, `${f.hours} h`].filter(Boolean).join(' · ')}
        <div>Alongside: {f.suppliers.map((v, i) => <span key={v.vesselId || v.mmsi}>{i > 0 && ', '}{shipBtn(v, 'unnamed vessel')}{v.kind?.label ? ` (${v.kind.label.toLowerCase()})` : ''}</span>)}
          {' '}<Link href={srcHref} title="Found by EarthAtlas in MarineCadastre AIS — click for the count’s record">MarineCadastre AIS</Link></div>
        {f.outside && <div title="The ship reported “at anchor” just outside the charted anchorage area; it is listed under the nearest anchorage">Anchored just outside the charted area</div>}
        {f.notified && <div>Notified to Ecology: <Link href={f.notified.recordIds?.[0] ? rec(f.notified.recordIds[0]) : null} title="Washington Ecology Advance Notice of Transfer, as released">notice {f.notified.antIds?.join(', ')}</Link></div>}
      </div>
    </div>
  )
}

const kindsLine = (kinds) => kinds.slice(0, 6).map((k) => `${k.label} ${fmtN(k.ships)}`).join(' · ') + (kinds.length > 6 ? ' · …' : '')

export default function AnchorageCard({ anchorageKey, months, onClose, onSelectVessel, onLocate, folded, onFold, tab = 'ships', onTab }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [slow, setSlow] = useState(false)
  const from = months[0], to = months[months.length - 1]
  const url = `/api/ships?op=anchorage&key=${encodeURIComponent(anchorageKey)}&from=${from}&to=${to}`
  useEffect(() => {
    const ctl = new AbortController()
    setErr(null); setSlow(false)
    const t = setTimeout(() => setSlow(true), 3000)
    fetch(url, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'Anchorage not found' : `Load failed (${r.status})`))))
      .then(setData)
      .catch((e) => { if (e.name !== 'AbortError') setErr(e.message) })
      .finally(() => clearTimeout(t))
    return () => { ctl.abort(); clearTimeout(t) }
  }, [url])
  const a = data?.anchorage
  const st = data?.stays
  const x = st?.summary
  const est = data?.estimated?.estimatedMonths?.length ? data.estimated : null
  const tooSmall = data?.estimated?.tooSmall
  const counted = st?.coverage === 'covered' && st.months.covered.length > 0
  const bakeHref = st?.bake ? rec(st.bake.recordId) : 'https://hub.marinecadastre.gov/pages/vesseltraffic'
  const estHref = est?.records?.length ? rec(est.records[est.records.length - 1].recordId) : 'https://globalfishingwatch.org'
  const rule = st?.rule || { sogKn: 0.5, minMinutes: 60, gapHours: 6 }
  const winMonths = data?.window?.months || months
  const kpi = (n) => (n == null ? '—' : fmtN(n))
  const kpiStays = counted ? kpi(x.stays) : est ? `≈${fmtN(est.stays)}` : '—'
  const kpiShips = counted ? kpi(x.ships) : est ? `≈${fmtN(est.ships)}` : '—'
  const kpiHours = counted ? kpi(x.hours) : est ? `≈${fmtN(est.hours)}` : '—'
  // Likely bunkering here (lib/ships/bunkerEvents.js): its own tab when the months are counted.
  const bk = data?.bunkering
  const bkCounted = bk?.coverage === 'covered' && bk.months.covered.length > 0
  const bkHref = bk?.bake ? rec(bk.bake.recordId) : 'https://hub.marinecadastre.gov/pages/vesseltraffic'
  const tabs = [['ships', 'Ships'], ...(bkCounted ? [['bunkering', `Bunkering${bk.summary.fuelings ? ` (${fmtN(bk.summary.fuelings)})` : ''}`]] : []), ['about', 'About']]
  const tabNow = tabs.some(([id]) => id === tab) ? tab : 'ships'

  return (
    <div className={`${pick.card} ${folded ? pick.cardFolded : ''}`} role="dialog" aria-label="Anchorage card">
      <button type="button" className={pick.fold} onClick={() => onFold(!folded)}
        aria-label={folded ? 'Unfold anchorage card' : 'Fold anchorage card'} title={folded ? 'Show the whole card' : 'Fold the card to its name'}><Chevron up={!folded} size={16} /></button>
      <button type="button" className={pick.close} onClick={onClose} aria-label="Close anchorage card">×</button>
      {err && <div className={styles.errorNote}>{err}</div>}
      {!data && !err && <Loading kind={slow ? 'slow' : 'quick'} className={styles.loadingNote} style={{ paddingRight: 56 }} />}
      {a && <>
        <div className={styles.vesselHead}>
          <div className={styles.pcKicker} style={{ paddingRight: 56 }}>{statusWords(a)}</div>
          <div className={styles.vesselName}>{a.name}{' '}
            <Link href={a.source_record_id ? rec(a.source_record_id) : null} title={`Area from ${areaWhat(a)} — click for the record as received`}>{SRC_SHORT[a.source_id] || a.source_id}</Link>
            {onLocate && <>{' '}<button type="button" className={styles.locateLink} onClick={() => onLocate()} title="Zoom the map to this anchorage">Show on map</button></>}
          </div>
          {a.location && <div className={styles.vesselSub}>{a.location}</div>}
          {data.aliases?.length > 0 && <div className={styles.idNote}>Also known as{' '}
            {data.aliases.map((al, i) => <span key={`${al.sourceId}:${al.alias}`}>{i > 0 && '; '}{al.alias}{' '}
              <Link href={al.recordId ? rec(al.recordId) : null} title={aliasTitle(al)}>{ALIAS_SHORT[al.sourceId] || al.sourceId}</Link></span>)}
          </div>}
          {a.alternate_name && <div className={styles.idNote}>DFO alternate name: {a.alternate_name}</div>}
        </div>

        <div className={styles.pcKpis}>
          <div className={styles.pcKpi} title={counted ? 'Stays counted from NOAA per-minute AIS' : 'Stays estimated from Global Fishing Watch hourly positions'}><span>Stays</span><strong>{kpiStays}</strong></div>
          <div className={styles.pcKpi} title="Different ships among those stays"><span>Ships</span><strong>{kpiShips}</strong></div>
          <div className={styles.pcKpi} title="Ship-hours stopped inside the area"><span>Ship-hours</span><strong>{kpiHours}</strong></div>
        </div>
        <div className={styles.pcWindow}>{span(winMonths)} · the months picked on the map
          {counted && <> · <Link href={bakeHref} title="Counted by EarthAtlas from MarineCadastre AIS (NOAA / BOEM / USCG, CC0) — click for the count’s record">MarineCadastre AIS</Link></>}
          {est && <> · <Link href={estHref} title="Estimated by EarthAtlas from Global Fishing Watch hourly positions — click for the month’s record">≈ Global Fishing Watch</Link></>}
        </div>

        {!folded && <>
          <div className={pick.tabs} role="tablist">
            {tabs.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tabNow === id}
                className={`${pick.tab} ${tabNow === id ? pick.tabOn : ''}`} onClick={() => onTab(id)}>{label}</button>
            ))}
          </div>

          {tabNow === 'ships' && (
            <div className={styles.section}>
              {st.coverage === 'no_anchoring' && <div className={styles.legendNoteText}>Anchoring is not allowed here, so no stays are counted.</div>}
              {st.coverage === 'no_boundary' && <div className={styles.legendNoteText}>No boundary is published for this area, so stays can’t be counted.</div>}
              {st.coverage === 'not_covered' && <div className={styles.legendNoteText}>Outside the area NOAA’s AIS covers, so stays aren’t counted from it here (not zero).</div>}

              {counted && <>
                {x.perDay ? <DayBars days={x.perDay} hue={PORT_HUE} say={(n) => plural(n, 'stay')} none="no AIS for this day yet" label="Stays per day (counted from AIS)" />
                  : <MonthBars months={x.perMonth} month={null} onMonth={() => {}} listed={false} say={(n) => plural(n, 'stay')} none="no AIS for this month yet" label="Stays per month (counted from AIS)" />}
                <div className={styles.portSummary}>
                  <strong>{plural(x.stays, 'stay')}</strong> by {plural(x.ships, 'ship')} · {fmtN(x.hours)} ship-hours{' '}
                  <Link href={bakeHref} title="Counted by EarthAtlas from MarineCadastre AIS — click for the count’s record">MarineCadastre AIS</Link>
                  {x.kinds?.length > 0 && <div className={styles.legendNoteText}>Ships by kind: {kindsLine(x.kinds)}</div>}
                  {st.months.missing.length > 0 && <div className={styles.legendNoteText}>NOAA’s per-minute AIS covers {monthName(st.aisFrom)} – {monthName(st.aisTo)}; {plural(st.months.missing.length, 'picked month')} {est ? 'estimated below' : 'not counted yet'}.</div>}
                </div>
                {(data.stays.top || []).map((s) => <StayShip key={s.key} s={s} onSelectVessel={onSelectVessel} srcHref={bakeHref} />)}
              </>}
              {st.coverage === 'covered' && !counted && !est && !tooSmall && <div className={styles.legendNoteText}>NOAA’s per-minute AIS covers {monthName(st.aisFrom)} – {monthName(st.aisTo)}; these months aren’t counted or estimated yet (not zero).</div>}
              {st.coverage === 'covered' && !counted && (est || tooSmall) && <div className={styles.legendNoteText}>NOAA’s per-minute AIS covers {monthName(st.aisFrom)} – {monthName(st.aisTo)}; these months are estimated below.</div>}

              {tooSmall && <>
                <div className={styles.legendNoteText} style={{ marginTop: 8 }}><strong>Estimated from hourly positions</strong> · {span(data.estimated.months)}</div>
                <div className={styles.legendNoteText}>Too small to estimate from hourly positions: they sit on a grid about 1 km across, and this area falls between its points. Not counted, not zero.</div>
              </>}
              {est && <>
                <div className={styles.legendNoteText} style={{ marginTop: 8 }}><strong>Estimated from hourly positions</strong> · {span(est.months)}{est.through ? `, data through ${dayName(est.through)}` : ''}</div>
                {est.perDay ? <DayBars days={est.perDay} say={(n, d) => `≈ ${plural(n, 'stay')}${d?.day?.endsWith('-01') ? ' (includes ships already here when the month began)' : ''}`} label="Estimated stays per day (by the day each stay began)" />
                  : <MonthBars months={est.perMonth} month={null} onMonth={() => {}} listed={false} hue={EST_HUE} say={(n) => `≈ ${plural(n, 'stay')}`} none="not estimated yet" label="Estimated stays per month" />}
                <div className={styles.portSummary}>
                  <strong>≈ {plural(est.stays, 'stay')}</strong> by {plural(est.ships, 'ship')} · ≈ {fmtN(est.hours)} ship-hours{' '}
                  <Link href={estHref} title="Estimated by EarthAtlas from Global Fishing Watch hourly positions — click for the month’s record">Global Fishing Watch</Link>
                  {est.kinds?.length > 0 && <div className={styles.legendNoteText}>Ships by kind: {kindsLine(est.kinds)}</div>}
                  {est.missing.length > 0 && <div className={styles.legendNoteText}>Not estimated yet: {est.missing.map(monthName).join(', ')} (left out, not zero).</div>}
                </div>
                {est.top.map((s, i) => <StayShip key={`${s.vesselId || s.mmsi || i}`} s={s} est onSelectVessel={onSelectVessel} srcHref={estHref} />)}
              </>}
            </div>
          )}

          {tabNow === 'bunkering' && bkCounted && (
            <div className={styles.section}>
              <MonthBars months={bk.summary.perMonth} month={null} onMonth={() => {}} listed={false} say={(n) => plural(n, 'likely fueling')} none="not counted for this month yet" label="Likely fuelings per month (found in AIS)" />
              <div className={styles.portSummary}>
                <strong>{plural(bk.summary.fuelings, 'likely fueling')}</strong> of {plural(bk.summary.ships, 'ship')} · {fmtN(bk.summary.hours)} hours alongside{' '}
                <Link href={bkHref} title="Found by EarthAtlas in MarineCadastre AIS — click for the count’s record">MarineCadastre AIS</Link>
                {bk.months.missing.length > 0 && <div className={styles.legendNoteText}>Counted for {span(bk.months.covered)} so far; the other picked months aren’t counted yet (not zero).</div>}
                {bk.fuelings.some((f) => f.notified) && <div className={styles.legendNoteText}>{plural(bk.fuelings.filter((f) => f.notified).length, 'of them was', 'of them were')} notified to Washington Ecology.{' '}
                  <a className={styles.sourceLink} href={`/ships/reports/bunkering${bk.reportPlace ? `?p=${encodeURIComponent(bk.reportPlace.replace(/^Anchor - /, '').toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Atb|Lng|Lpg|Usa)\b/g, (m) => m.toUpperCase()))}&list=1` : ''}`} target="_blank" rel="noopener noreferrer">See the bunkering report →</a></div>}
                {bk.suppliers.length > 0 && <div className={styles.legendNoteText}>Alongside: {bk.suppliers.slice(0, 8).map((v, i) => <span key={v.vesselId || v.mmsi}>{i > 0 && ' · '}{v.vesselId
                  ? <button type="button" className={styles.pcShipLink} onClick={() => onSelectVessel(v.vesselId)} title="Open this vessel’s card">{v.name || `MMSI ${v.mmsi}`}</button> : (v.name || `MMSI ${v.mmsi}`)} {fmtN(v.fuelings)}</span>)}
                  {bk.suppliers.length > 8 && ' · …'}</div>}
              </div>
              {bk.fuelings.map((f) => <Fueling key={`${f.receiver.mmsi}-${f.t0}`} f={f} onSelectVessel={onSelectVessel} srcHref={bkHref} />)}
              <About>
                Likely bunkering: a bunker barge carries no AIS of its own, so a fueling shows as its tug lying beside a ship anchored here, both nearly still,
                for an hour or more; tugs that overlap on one ship count as one fueling. A fueling counts when Washington Ecology was notified of it, or when the
                tug alongside is one seen in at least two notified fuelings and stayed two hours or more; other tugs alongside (harbor assists, escorts) are left
                out, as are launches, U.S. Navy harbor tugs and ferries. From <Link href={bkHref} title="The count’s record">MarineCadastre AIS</Link> (NOAA / BOEM,
                U.S. Coast Guard receivers, CC0) and Washington Ecology Advance Notice of Transfer records.
              </About>
            </div>
          )}

          {tabNow === 'about' && (
            <div className={styles.section}>
              <div className={styles.legendNoteText}><strong>{statusWords(a)}</strong></div>
              <div className={styles.legendNoteText}>Area: {areaWhat(a)}{' '}
                <Link href={a.source_record_id ? rec(a.source_record_id) : null} title="The record as received">record</Link></div>
              {a.boundary_note && <div className={styles.legendNoteText}>{a.boundary_note}</div>}
              <About>
                Counted stays: a ship’s own AIS reports put it stopped (under {rule.sogKn} knots) inside this area for {rule.minMinutes} minutes or more;
                a gap of more than {rule.gapHours} hours starts a new stay. From <Link href={bakeHref} title="The count’s record">MarineCadastre AIS</Link> (NOAA / BOEM,
                U.S. Coast Guard receivers, CC0); a ship whose AIS was off, or out of range of US receivers, isn’t seen.
                {' '}Estimated stays (months NOAA hasn’t published): one position per ship per hour from Global Fishing Watch, on a grid about 1 km across;
                a stay is estimated when a ship’s positions stay within about two grid cells from one hour to the next inside the area for two hours or more.
                Checked against NOAA for June 2026: 62% of NOAA’s stays found, 64% of estimated stays confirmed. Areas smaller than the grid can’t be estimated.
                {' '}<Link href="https://globalfishingwatch.org" title="Global Fishing Watch">Powered by Global Fishing Watch</Link>
              </About>
            </div>
          )}
        </>}
      </>}
    </div>
  )
}
