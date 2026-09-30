/**
 * Ship card → Emissions tab → "Verified (EU MRV)" (Phase 4, Josh 2026-09-29). The ship's own EU MRV reports as EMSA publishes
 * them (lib/ships/euMrv.js; facts docs/SHIP_POLLUTION_SOURCES.md §1): per reporting year, CO₂ (and from 2024 CO₂eq, CH₄, N₂O),
 * fuel burned, hours at sea and CO₂ per nautical mile, each with its inline link to the EMSA page for that ship and year. Every
 * number is the published one; nothing is added up across rows. A partial-year row (a change of company) is shown as its own
 * line, never added to the full-year figure. Scope label always visible: EU/EEA-related voyages only.
 * Kept apart from Climate TRACE's MODELLED figures (ShipEmissions.jsx): separate block, own badge, no shared totals.
 */
import { tonnesText, smallShareYears } from '../../lib/ships/euMrvFormat.js'
import styles from './ShipsApp.module.css'

const SOURCE = 'emsa-thetis-mrv'
const nf = (n, d = 0) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d })
const dm = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const TE_WORDS = {
  EEDI: 'design efficiency (EEDI)', EEXI: 'design efficiency of an existing ship (EEXI)', EIV: 'estimated efficiency index (EIV)',
}

/** The 'emissions_report' claims of this ship, newest year first; within a year the full-year row first. */
export function mrvReports(assertions) {
  const rows = (assertions || []).filter((a) => a.source_id === SOURCE && a.attribute === 'emissions_report' && a.detail?.period)
  return rows.sort((a, b) => b.detail.period.year - a.detail.period.year
    || (a.detail.report === 'full' ? -1 : 1) - (b.detail.report === 'full' ? -1 : 1)
    || String(a.detail.period.from).localeCompare(String(b.detail.period.from)))
}

function Src({ a, what }) {
  const d = a.detail
  const f = d.file
  return (
    <a className={`${styles.sourceLink} ${styles.srcLink}`} href={d.page_url} target="_blank" rel="noopener noreferrer"
      title={`${what}: EU MRV report for IMO ${d.imo}, ${d.period.raw}${d.report === 'partial' ? ' (part of the year)' : ''}, as published by EMSA THETIS-MRV`
        + `${f ? ` (${f.year} publication, version ${f.version}${f.generated ? `, generated ${f.generated}` : ''})` : ''}. Opens EMSA's page for this ship and year.`}>
      EU MRV</a>
  )
}

function Row({ a, label, hint, value, what }) {
  if (value == null) return null
  return (
    <div className={styles.pcGasRow} title={hint}>
      <span>{label}</span>
      <span>{value} <Src a={a} what={what || label} /></span>
    </div>
  )
}

function Report({ a, withFull }) {
  const d = a.detail
  const p = d.period
  const who = d.company?.name
  const te = d.technical_efficiency
  const v = d.verifier || {}
  return (
    <div style={{ marginBottom: 8 }}>
      <div className={styles.portSummary}>
        <strong>{p.year}</strong>
        <span className={styles.pcMuted}>
          {p.partial ? ` · ${dm(p.from)} – ${dm(p.to)} only (part of the year${withFull ? '; shown separately, not added to the whole-year figure' : ''})` : ' · whole year'}
          {who ? ` · reported by ${who}` : ''}
        </span>{' '}
        <a className={`${styles.sourceLink} ${styles.srcLink}`} href={`/ships/source/${a.last_source_record_id}`} target="_blank" rel="noopener noreferrer"
          title="The published row exactly as EarthAtlas stored it, with the file version it came from">record</a>
      </div>
      <div className={styles.pcGasList}>
        <Row a={a} label="CO₂" value={tonnesText(d.co2_t)} what="Total CO₂ emissions, metric tonnes"
          hint="Carbon dioxide from all fuel burned on voyages to, from and between EU/EEA ports and at berth in them, in metric tonnes" />
        <Row a={a} label="All three greenhouse gases, as CO₂-equivalent" value={d.co2eq_t != null ? tonnesText(d.co2eq_t) : null} what="Total CO₂eq emissions, metric tonnes"
          hint="CO₂, methane and nitrous oxide together, weighted by their warming effect (CO₂eq), metric tonnes. Reported from 2024" />
        <Row a={a} label="Methane (CH₄)" value={d.ch4_t != null ? tonnesText(d.ch4_t) : null} what="Total CH₄ emissions" hint="Methane, as reported (from 2024)" />
        <Row a={a} label="Nitrous oxide (N₂O)" value={d.n2o_t != null ? tonnesText(d.n2o_t) : null} what="Total N₂O emissions" hint="Nitrous oxide, as reported (from 2024)" />
        <Row a={a} label="Of the CO₂: while at berth in EU/EEA ports" value={d.co2_at_berth_ms_t != null ? tonnesText(d.co2_at_berth_ms_t) : null}
          what="CO₂ emissions within EU/EEA ports at berth" hint="CO₂ emitted while moored in EU/EEA ports (engines and boilers), metric tonnes" />
        <Row a={a} label="Of the CO₂: in the EU Emissions Trading System’s scope" value={d.co2_ets_t != null ? tonnesText(d.co2_ets_t) : null}
          what="CO₂ emissions to be reported under Directive 2003/87/EC"
          hint="The part of this CO₂ that falls within the EU Emissions Trading System (Directive 2003/87/EC): all of it on voyages between EU/EEA ports and at berth, half of it on voyages into or out of the EU/EEA. For 2024 and 2025 only CO₂ is in the system’s scope (EMSA)" />
        <Row a={a} label="Fuel burned" value={tonnesText(d.fuel_t)} what="Total fuel consumption, metric tonnes" hint="All fuel burned on these voyages and at berth, metric tonnes (all fuel types together; the publication does not split it by type)" />
        <Row a={a} label="Time at sea" value={d.time_at_sea_h != null ? `${nf(d.time_at_sea_h)} hours` : null} what="Time spent at sea, hours"
          hint="Hours under way on these voyages (the publication gives no total distance)" />
        <Row a={a} label="CO₂ per nautical mile sailed" value={d.co2_per_nm_kg != null ? `${nf(d.co2_per_nm_kg)} kg` : null} what="Annual average CO₂ emissions per distance, kg CO₂ per nautical mile"
          hint="Average kilograms of CO₂ for every nautical mile sailed on these voyages: a measure of how efficiently the ship ran (lower is better)" />
        {te?.value != null && te.kind && (
          <Row a={a} label={`Designed efficiency: ${TE_WORDS[te.kind] || te.kind}`} value={`${nf(te.value, 2)} g CO₂ per tonne-mile`} what={`Technical efficiency (${te.raw})`}
            hint="The ship's design rating: grams of CO₂ to carry one tonne of cargo one nautical mile at its reference speed and load (lower is better). A calculation from the design, not a measurement" />
        )}
      </div>
      {v.name && (
        <div className={styles.legendNoteText} style={{ marginTop: 2 }}
          title={[v.accreditation && `accreditation ${v.accreditation}`, v.nab].filter(Boolean).join(' · ') || undefined}>
          Checked by {v.name}{v.country ? ` (${v.country})` : ''}, an accredited verifier.
        </div>
      )}
    </div>
  )
}

/** One earlier report on one line: year (and part of it), CO₂, fuel, hours at sea, CO₂ per nautical mile, with its source. */
function Earlier({ a }) {
  const d = a.detail, p = d.period
  const bits = [tonnesText(d.co2_t) && `${tonnesText(d.co2_t)} CO₂`, tonnesText(d.fuel_t) && `${tonnesText(d.fuel_t)} fuel`,
    d.time_at_sea_h != null && `${nf(d.time_at_sea_h)} h`, d.co2_per_nm_kg != null && `${nf(d.co2_per_nm_kg)} kg/nm`].filter(Boolean)
  return (
    <div className={styles.pcGasRow} title={`${p.partial ? 'Report for part of the year (a change of company); shown separately, not added to the whole-year figure. ' : ''}`
      + `Checked by ${d.verifier?.name || 'a verifier (not named)'}${d.company?.name ? `; reported by ${d.company.name}` : ''}`}>
      <span style={{ flexShrink: 0 }}>{p.year}{p.partial ? <span className={styles.pcMuted}><br />{dm(p.from)} – {dm(p.to)} only</span> : null}</span>
      <span style={{ whiteSpace: 'normal', textAlign: 'right' }}>{bits.join(' · ')} <Src a={a} what={`EU MRV report ${p.raw}`} /></span>
    </div>
  )
}

const yearsWords = (desc) => { const ys = [...desc].reverse(); return ys.length === 1 ? `In ${ys[0]}` : `In ${ys.slice(0, -1).join(', ')} and ${ys.at(-1)}` }

/**
 * modelledCo2ByYear: Climate TRACE's modelled CO₂ per calendar year for this ship (ShipEmissions), or null while it loads / when
 * there is none. Used ONLY to decide whether to say the EU figures are a small part of the ship's year (euMrvFormat.smallEuShare);
 * never added to or shown inside the verified figures.
 */
export default function ShipMrv({ vessel, modelledCo2ByYear = null }) {
  const reports = mrvReports(vessel.assertions)
  // Newest reporting year in full; earlier years one line each (the card must stay readable with 8 years of reports).
  const small = smallShareYears(reports, modelledCo2ByYear)
  const latest = reports.filter((a) => a.detail.period.year === reports[0]?.detail.period.year)
  const earlier = reports.filter((a) => !latest.includes(a))
  const hasImo = vessel.assertions.some((a) => a.attribute === 'imo')
  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        Verified: EU MRV reports{' '}
        <span className={`${styles.ev} ${styles.evReg}`} title="Reported by the ship’s company under EU law, checked by an accredited verifier, published by the European Maritime Safety Agency">verified</span>
      </div>
      {reports.length ? <>
        <div className={styles.legendNoteText} style={{ marginTop: 0, marginBottom: 6 }}>
          Only voyages to, from and between EU/EEA ports, and time at berth in them: not the ship’s whole year at sea.
        </div>
        {small.length > 0 && (
          <div className={styles.portSummary} style={{ margin: '0 0 8px', padding: '6px 8px', borderLeft: '3px solid #fbbf24', background: 'rgba(251, 191, 36, 0.08)' }}
            title="Shown when the EU report’s CO₂ is under a quarter of Climate TRACE’s modelled CO₂ for this ship’s Salish Sea trips alone in the same year. The two figures measure different voyages and are never added together">
            {yearsWords(small)}, these EU figures cover only this ship’s EU/EEA voyages, a small part of its year. Its trips here are
            counted separately in the modelled estimate below.
          </div>
        )}
        {latest.map((a) => <Report key={a.id} a={a} withFull={a.detail.report === 'partial' && latest.some((b) => b.detail.report === 'full')} />)}
        {earlier.length > 0 && <>
          <div className={styles.legendNoteText} style={{ marginTop: 4, marginBottom: 2 }}>Earlier years (CO₂ · fuel burned · hours at sea · CO₂ per nautical mile):</div>
          <div className={styles.pcGasList}>
            {earlier.map((a) => <Earlier key={a.id} a={a} />)}
          </div>
        </>}
      </> : (
        <div className={styles.legendNoteText} style={{ marginTop: 0 }}>
          {hasImo
            ? 'No EU MRV report for this ship. Reports cover ships over 5,000 GT that call at EU/EEA ports (2018 onward).'
            : 'No IMO number, so no EU MRV report can be looked up.'}
        </div>
      )}
    </div>
  )
}
