/**
 * Fleets (migration 034): named groups of EarthAtlas vessels a subsite shows. First one: 'whalewatch' for /whalewatch
 * (Josh 2026-10-17; list and sources in docs/WHALE_WATCH_FLEET.md, starting file lib/ships/data/fleets/whalewatch.json).
 *
 * A membership is EarthAtlas's interpretation and carries its evidence (basis + source); it is never deleted, only
 * marked removed. Boats are stored by EarthAtlas vessel id; their tracks follow the vessel's own MMSI periods.
 */
import { normMmsi } from './normalize.js'

export const FLEET_BASES = ['fcc_licensee', 'tc_registered_owner', 'operator_website', 'manual']
const KEY_RE = /^[a-z][a-z0-9_-]{1,40}$/

/** Problems with one member entry from a fleet file or the command line (empty = fine). */
export function memberProblems(m) {
  const errs = []
  if (!m || typeof m !== 'object') return ['not an object']
  if (!m.vessel_id && !/^\d{9}$/.test(normMmsi(m.mmsi || '').value || '')) errs.push('needs mmsi (9 digits) or vessel_id')
  if (m.vessel_id && !/^[0-9a-f-]{36}$/i.test(m.vessel_id)) errs.push('vessel_id is not a uuid')
  if (m.at && Number.isNaN(Date.parse(m.at))) errs.push('at is not a timestamp')
  if (!String(m.company || '').trim()) errs.push('company missing')
  if (!FLEET_BASES.includes(m.basis)) errs.push(`basis must be one of ${FLEET_BASES.join(', ')}`)
  if (!String(m.source_label || '').trim()) errs.push('source_label missing')
  if (!/^https?:\/\//.test(m.source_url || '')) errs.push('source_url must be a link')
  if (m.basis === 'manual' && !String(m.note || '').trim()) errs.push('a manual membership needs a note saying why')
  if (m.country && !/^[A-Z]{2}$/.test(m.country)) errs.push('country must be a 2-letter code')
  return errs
}

export async function ensureFleet(q, S, { key, name, description }) {
  if (!KEY_RE.test(key || '')) throw new Error(`bad fleet key: ${key}`)
  await q(`INSERT INTO ${S}.fleets (key, name, description) VALUES ($1, $2, $3)
           ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description`, [key, name, description ?? null])
}

/** The one EarthAtlas vessel holding `mmsi` at `at` (null + reason when none or several do). */
export async function vesselForMember(q, S, m) {
  if (m.vessel_id) {
    const [v] = await q(`SELECT id, merged_into FROM ${S}.vessels WHERE id = $1`, [m.vessel_id])
    return v ? { id: v.merged_into || v.id } : { id: null, reason: 'no such vessel' }
  }
  const rows = await q(`SELECT DISTINCT vessel_id FROM ${S}.vessels_for_mmsi_at($1, $2)`, [normMmsi(m.mmsi).value, m.at || new Date().toISOString()])
  if (rows.length === 1) return { id: rows[0].vessel_id }
  return { id: null, reason: rows.length ? `MMSI ${m.mmsi} matches ${rows.length} vessels at ${m.at}` : `no vessel holds MMSI ${m.mmsi} at ${m.at}` }
}

/**
 * Add a membership, or refresh the evidence of the current one (same fleet + vessel). Returns
 * { action: 'added' | 'updated' | 'unchanged' | 'unresolved', vessel_id, reason? }.
 */
export async function upsertMember(q, S, fleetKey, m, addedBy) {
  const errs = memberProblems(m)
  if (errs.length) throw new Error(`${m?.name || m?.mmsi || 'member'}: ${errs.join('; ')}`)
  const v = await vesselForMember(q, S, m)
  if (!v.id) return { action: 'unresolved', vessel_id: null, reason: v.reason }
  const vals = [m.mmsi ? normMmsi(m.mmsi).value : null, m.company.trim(), m.company_place ?? null, m.country ?? null, m.basis,
    m.source_label.trim(), m.source_url, m.note ?? null]
  const [cur] = await q(`SELECT id, mmsi, company, company_place, country, basis, source_label, source_url, note
                           FROM ${S}.fleet_members WHERE fleet_key = $1 AND vessel_id = $2 AND removed_at IS NULL`, [fleetKey, v.id])
  if (!cur) {
    await q(`INSERT INTO ${S}.fleet_members (fleet_key, vessel_id, mmsi, company, company_place, country, basis, source_label, source_url, note, added_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [fleetKey, v.id, ...vals, addedBy])
    return { action: 'added', vessel_id: v.id }
  }
  const same = ['mmsi', 'company', 'company_place', 'country', 'basis', 'source_label', 'source_url', 'note'].every((k, i) => (cur[k] ?? null) === vals[i])
  if (same) return { action: 'unchanged', vessel_id: v.id }
  await q(`UPDATE ${S}.fleet_members SET mmsi = $2, company = $3, company_place = $4, country = $5, basis = $6, source_label = $7,
                  source_url = $8, note = $9 WHERE id = $1`, [cur.id, ...vals])
  return { action: 'updated', vessel_id: v.id }
}

/** Take a vessel out of a fleet, keeping the row as history. */
export async function removeMember(q, S, fleetKey, vesselId, reason) {
  if (!String(reason || '').trim()) throw new Error('a removal needs a reason')
  const rows = await q(`UPDATE ${S}.fleet_members SET removed_at = now(), removed_reason = $3
                         WHERE fleet_key = $1 AND vessel_id = $2 AND removed_at IS NULL RETURNING id`, [fleetKey, vesselId, reason.trim()])
  return rows.length
}

/**
 * A fleet for the page: its current members, each with the vessel's name (newest AIS-reported one) and the MMSI
 * periods tracks are matched against (same rule as the /ships card: MMSI claims with a known period, epoch seconds).
 */
export async function readFleet(q, S, key) {
  if (!KEY_RE.test(key || '')) return null
  const [fleet] = await q(`SELECT key, name, description FROM ${S}.fleets WHERE key = $1`, [key])
  if (!fleet) return null
  const members = await q(
    `SELECT COALESCE(v.merged_into, v.id) AS vessel_id, m.mmsi, m.company, m.company_place, m.country, m.basis,
            m.source_label, m.source_url, m.note, m.added_at
       FROM ${S}.fleet_members m JOIN ${S}.vessels v ON v.id = m.vessel_id
      WHERE m.fleet_key = $1 AND m.removed_at IS NULL
      ORDER BY m.company, m.id`, [key])
  const ids = [...new Set(members.map((m) => m.vessel_id))]
  const claims = ids.length ? await q(
    `SELECT vessel_id, attribute, value_raw, value_norm, lower(period) AS "from", upper(period) AS "to", period_kind, evidence_class
       FROM ${S}.vessel_assertions
      WHERE vessel_id = ANY($1::uuid[]) AND attribute IN ('mmsi', 'name')`, [ids]) : []
  const secs = (x) => (x ? Math.floor(new Date(x).getTime() / 1000) : null)
  const by = new Map(ids.map((id) => [id, { periods: [], name: null, nameAt: -Infinity }]))
  for (const c of claims) {
    const b = by.get(c.vessel_id)
    if (c.attribute === 'mmsi' && /^\d{9}$/.test(c.value_norm) && c.period_kind !== 'unknown') {
      b.periods.push({ mmsi: Number(c.value_norm), from: secs(c.from), to: secs(c.to) })
    } else if (c.attribute === 'name') {
      ;(b.spellings ||= []).push(c.value_raw)   // any source's spelling may be the readable one (registries: GOLD WING for AIS GOLDWING)
      if (c.evidence_class !== 'ais_published' && c.evidence_class !== 'ais_self_reported') continue
      const t = c.to ? new Date(c.to).getTime() : 0
      if (t > b.nameAt) { b.name = c.value_raw; b.nameAt = t }
    }
  }
  // The newest name, in its most readable spelling (spaces over hyphens or none: ISLAND EXPLORER 5, not ISLAND-EXPLORER 5),
  // as the /ships card picks among spellings that differ only by spaces or punctuation.
  const nameKey = (n) => String(n || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const spaces = (n) => (n.match(/ /g) || []).length
  for (const b of by.values()) {
    if (!b.name) continue
    const same = (b.spellings || []).filter((n) => nameKey(n) === nameKey(b.name))
    b.name = same.reduce((best, n) => (spaces(n) > spaces(best) || (spaces(n) === spaces(best) && n === n.toUpperCase() && best !== best.toUpperCase()) ? n : best), b.name)
  }
  return {
    ...fleet,
    members: members.map((m) => ({ ...m, name: by.get(m.vessel_id).name, mmsiPeriods: by.get(m.vessel_id).periods })),
  }
}
