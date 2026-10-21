// The card that hangs under the /species-of-concern pill: one listed species (statuses, caveat, its records) or one
// agency item (a critical habitat designation or a WDFW PHS entry). Frame = /ships' card (ShipPicker.module.css).
import { useState } from 'react'
import p from '../ships/ShipPicker.module.css'
import s from './SpeciesOfConcernApp.module.css'
import { colorOf, REG_COLORS, shortStatus, SOURCE_NAMES, fmtDate, fmtKm, speciesPage } from './socShared.js'

const PHS_MAP_URL = 'https://geodataservices.wdfw.wa.gov/hp/phs/'
import { FRIENDS_LOGO, FRIENDS_PAGE } from '../permits/habitat.js'

// What the species is: iNaturalist's photo (credited and licensed beside it), Wikipedia's first lines, and a link to
// the EarthAtlas species page.
function AboutSpecies({ info, sci, inatId }) {
  const page = speciesPage(inatId, sci)
  if (!info && !page) return null
  return (
    <div className={s.about}>
      {info?.photo && (
        <a href={info.inat_url} {...ext} className={s.aboutPhoto} title={info.photo.attribution || ''}>
          <img src={info.photo.medium} alt={info.common_name || info.name} loading="lazy" />
        </a>
      )}
      <div className={s.aboutText}>
        {info?.summary && <div className={s.aboutSummary}>{info.summary} {info.wikipedia_url && <a className={s.src} href={info.wikipedia_url} {...ext}>Wikipedia ↗</a>}</div>}
        {info && info.name !== sci && <div className={s.dim}>Photo and description are for {info.common_name ? `${info.common_name} (${info.name})` : info.name}.</div>}
        {page && <a className={s.learnMore} href={page} target="_blank" rel="noopener">Learn more about this species →</a>}
        {info?.photo?.attribution && <div className={s.photoCredit}>Photo: {info.photo.attribution}, via <a className={s.src} href={info.inat_url} {...ext}>iNaturalist</a></div>}
      </div>
    </div>
  )
}
const ext = { target: '_blank', rel: 'noopener noreferrer' }

export function SpeciesCard({ r, unit, onClose }) {
  const [showAll, setShowAll] = useState(false)
  const recs = showAll ? r.records : r.records.slice(0, 25)
  return (
    <div className={p.card}>
      <button type="button" className={p.close} onClick={onClose} aria-label="Close">×</button>
      <div className={s.cardTitle}><span className={s.swatch} style={{ background: colorOf(r.group) }} />{r.common_name || r.scientific_name}</div>
      {r.common_name && <i className={s.sci}>{r.scientific_name}</i>}
      <AboutSpecies info={r.info} sci={r.scientific_name} inatId={r.inat_id} />
      <div className={s.badges}>
        {r.statuses.map((x) => (
          <a key={x.list} href={x.source_url} {...ext} title={`${x.list_label}: ${x.status}${x.note ? `. ${x.note}` : ''}`}
            className={`${s.badge} ${x.confirmed ? '' : s.badgeUnconfirmed}`} style={{ '--c': colorOf(x.status) }}>
            {shortStatus(x)}{x.confirmed ? '' : ' (not confirmed)'} ↗
          </a>
        ))}
      </div>
      <div className={s.rowMeta}>
        {r.records_count} record{r.records_count === 1 ? '' : 's'} · latest {fmtDate(r.latest_date)}
        {r.nearest_km != null && <> · nearest {fmtKm(r.nearest_km, unit)}</>}
        {r.locations.blurred > 0 && (r.locations.exact > 0 ? <> · {r.locations.blurred} with location blurred</> : <> · <span className={s.blurredOnly}>location blurred on every record (could be up to ~28 km away)</span></>)}
      </div>
      <div className={s.rowSources}>{Object.entries(r.sources).map(([k, n]) => `${SOURCE_NAMES[k] || k} ${n}`).join(' · ')}</div>
      {r.ecotypes && <div className={s.rowMeta}>{r.population_basis || 'Populations'}: {Object.entries(r.ecotypes).map(([k, n]) => `${k} ${n}`).join(' · ')}</div>}
      {r.unconfirmed?.length > 0 && r.caveat && <div className={s.caveat}>{r.caveat.text} {r.caveat.notes.join(' ')}</div>}
      <div className={s.records}>
        {recs.map((x, i) => (
          <div key={i} className={s.record}>
            <div>
              <b>{fmtDate(x.date)}</b>{x.ecotype && (x.ecotype.url ? <a className={s.eco} href={x.ecotype.url} {...ext} title={x.ecotype.evidence}>{x.ecotype.name} ↗</a> : <span className={s.eco} title={x.ecotype.evidence || ''}>{x.ecotype.name}{x.ecotype.tentative ? '?' : ''}</span>)}
              {' · '}{x.location === 'exact' ? `${fmtKm(x.distance_km, unit)} away` : 'location blurred (could be up to ~28 km)'}
              {' · '}<a className={s.src} href={x.url} {...ext}>{SOURCE_NAMES[x.source] || x.source} ↗</a>
            </div>
            <div className={s.dim}>{[x.reported_as, x.observer, x.location_name, x.dataset, x.quality?.replace('_', ' ')].filter(Boolean).join(' · ')}</div>
            {x.remarks && <div className={s.remarks}>{x.remarks}</div>}
          </div>
        ))}
        {!showAll && r.records.length > 25 && <button type="button" className={s.more} onClick={() => setShowAll(true)}>Show all {r.records.length} records</button>}
      </div>
    </div>
  )
}

function where(it, radius, unit) {
  if (it.resolution && it.resolution !== 'as mapped') {
    const area = it.resolution.replace('shown only to the ', '')
    return it.contains_point ? `Recorded in the ${area} that includes this spot.` : `Recorded within ${radius} ${unit}; WDFW shows it only to the ${area}.`
  }
  return it.contains_point ? 'This spot is inside it.' : `Within ${radius} ${unit} of this spot.`
}
const badgeWords = (x) => (x.list === 'wa-sgcn' ? 'WA Greatest Conservation Need' : x.list === 'wa-phs' ? 'WA priority species' : `${x.list_label}: ${x.status.toLowerCase()}`)

export function AgencyCard({ it, radius, unit, onClose }) {
  const isCH = it.id.startsWith('ch')
  const color = isCH ? REG_COLORS['critical-habitat'] : REG_COLORS[it.kind === 'species' ? 'phs-species' : 'phs-habitat']
  return (
    <div className={p.card}>
      <button type="button" className={p.close} onClick={onClose} aria-label="Close">×</button>
      <div className={s.cardTitle}><span className={s.swatchSq} style={{ background: color }} />{it.name}</div>
      <div className={s.rowMeta}>{isCH ? `Federal critical habitat${it.designation === 'Proposed' ? ' (proposed)' : ''}` : `WDFW priority ${it.kind === 'species' ? 'species' : 'habitat'}`}{it.listing_status ? ` · ${it.listing_status.toLowerCase()}` : ''}</div>
      {it.inat_id && <AboutSpecies info={it.info} sci={it.scientific_name} inatId={it.inat_id} />}
      {it.listed?.length > 0 && <div className={s.badges}>{it.listed.map((x) => <a key={x.list} className={s.badge} style={{ '--c': colorOf(x.status) }} href={x.source_url} {...ext}>{badgeWords(x)} ↗</a>)}</div>}
      <div className={it.contains_point ? s.regInside : s.rowMeta}>{where(it, radius, unit)}</div>
      {isCH ? (
        <>
          {it.unit && <div className={s.rowMeta}>Unit: {it.unit}</div>}
          {it.habitat && <div className={s.rowMeta}>Habitat: {it.habitat}</div>}
          <div className={s.rowSources} style={{ marginTop: 6 }}>
            {it.agency}{it.effective ? `, effective ${it.effective}` : ''}
            {it.rule_url && <> · <a className={s.src} href={it.rule_url} {...ext}>{it.rule || 'Federal Register rule'} ↗</a></>}
            {it.ecfr_url && <> · <a className={s.src} href={it.ecfr_url} {...ext}>50 CFR ↗</a></>}
            {it.metadata_url && <> · <a className={s.src} href={it.metadata_url} {...ext}>map data ↗</a></>}
          </div>
          {it.data_as_of && (
            <div className={s.photoCredit}>
              Map data downloaded {fmtDate(it.data_as_of.downloaded)}; {it.agency === 'NOAA Fisheries' ? 'NOAA' : 'USFWS'} last edited it {fmtDate(it.data_as_of.agency_edited?.[it.agency === 'NOAA Fisheries' ? 'noaa' : 'usfws'])}. Refreshed monthly.
            </div>
          )}
        </>
      ) : (
        <>
          {it.priority_area && <div className={s.rowMeta}>{it.priority_area}{it.count > 1 ? ` · ${it.count} mapped ${it.kind === 'species' ? 'sites' : 'areas'}` : ''}</div>}
          {it.sites?.length > 0 && <div className={s.rowMeta}>Sites: {it.sites.join(', ')}</div>}
          {it.latest_source_date && <div className={s.rowMeta}>Latest survey on record: {fmtDate(it.latest_source_date)}</div>}
          {it.source_dataset && (
            <div className={s.rowMeta}>Source: {it.source_dataset.url ? <a className={s.src} href={it.source_dataset.url} {...ext}>{it.source_dataset.label} ↗</a> : it.source_dataset.label}, in WDFW’s Priority Habitats and Species layer</div>
          )}
          {it.surveyed_by?.length > 0 && <div className={s.rowMeta}>Surveyed by: {it.surveyed_by.join(', ')}</div>}
          {it.surveyed_by?.includes('Friends of the San Juans') && (
            <a className={s.friends} href={FRIENDS_PAGE} {...ext}><img src={FRIENDS_LOGO} alt="" />Survey data from Friends of the San Juans</a>
          )}
          <div className={s.rowSources} style={{ marginTop: 6 }}>
            Washington Department of Fish and Wildlife · <a className={s.src} href={PHS_MAP_URL} {...ext}>PHS on the Web ↗</a>
            {it.more_info_url && <> · <a className={s.src} href={it.more_info_url} {...ext}>more ↗</a></>}
          </div>
          {it.sensitive && <div className={s.absence}>{`WDFW shows this ${it.priority_area ? `${it.priority_area.toLowerCase()}${/breeding/i.test(it.priority_area) ? ' (nest or breeding site)' : ''}` : 'record'} only to the ${(it.resolution || '').replace('shown only to the ', '') || 'section or township'}, to keep people from disturbing the site; the exact location is not public. The species itself is not secret.`}</div>}
        </>
      )}
    </div>
  )
}
