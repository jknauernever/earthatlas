/**
 * EU MRV figures in plain words, for the ship card (src/ships/ShipMrv.jsx). Browser-safe: no Node imports (lib/ships/euMrv.js,
 * which re-exports this, pulls in the database code). Tested in lib/ships/test/euMrv.test.js.
 */

/** Metric tonnes → plain words: '298 t', '94.8 t', '19,477 t', under 1 t as kg ('4.7 kg', '17 kg'), 0 → '0 t', null → null. */
export function tonnesText(t) {
  if (t == null || !Number.isFinite(t)) return null
  if (t === 0) return '0 t'
  if (Math.abs(t) < 1) { const kg = t * 1000; return `${kg >= 10 ? Math.round(kg).toLocaleString('en-US') : Number(kg.toPrecision(2))} kg` }
  if (Math.abs(t) < 100) return `${Number(t.toFixed(1)).toLocaleString('en-US')} t`
  return `${Math.round(t).toLocaleString('en-US')} t`
}

/**
 * "Small EU share" rule (Josh, 2026-09-29): a year's verified EU MRV CO₂ is called a small part of the ship's year when it is
 * under SMALL_EU_SHARE (25%) of Climate TRACE's modelled CO₂ for the same ship and calendar year. Climate TRACE's figure here is
 * only the trips and port stays in our Salish Sea set, so it UNDER-states the ship's whole year: if the EU figure is under a
 * quarter of even that, the EU voyages are clearly a small part of the year. Only whole-year (Full) reports are compared; no
 * comparison (false) without a positive modelled figure. The two numbers are compared, never added. Pure.
 */
export const SMALL_EU_SHARE = 0.25
export function smallEuShare(euCo2, modelledCo2, threshold = SMALL_EU_SHARE) {
  if (euCo2 == null || modelledCo2 == null || !Number.isFinite(euCo2) || !Number.isFinite(modelledCo2) || modelledCo2 <= 0) return false
  return euCo2 < threshold * modelledCo2
}

/**
 * The years whose whole-year EU MRV report is a small part of the ship's year (smallEuShare), newest first.
 * reports: 'emissions_report' claims (ShipMrv mrvReports); modelledByYear: { '2024': t CO₂, … } from Climate TRACE. Pure.
 */
export function smallShareYears(reports, modelledByYear) {
  if (!modelledByYear) return []
  const ys = new Set()
  for (const a of reports || []) {
    const d = a.detail
    if (d?.report !== 'full' || !d.period) continue
    if (smallEuShare(d.co2_t, modelledByYear[String(d.period.year)])) ys.add(d.period.year)
  }
  return [...ys].sort((a, b) => b - a)
}
