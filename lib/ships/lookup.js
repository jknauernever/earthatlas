/**
 * Click-time ship lookup (Josh, 2026-09-26): name + kind of ship for MMSIs seen on the map.
 * 1. Our own database first (vessels_for_mmsi_at + summarize: registry values outrank broadcasts).
 * 2. MMSIs we don't hold → one GFW Vessels search (`ssvid = … OR …`, ≤10 per request, as
 *    scripts/ships/import-gfw.mjs does). Of GFW's identities for an MMSI, the one whose
 *    transmission window contains the track's time wins; MMSIs get reused, so a window that
 *    doesn't cover the time is only a fallback, and two covering identities with different names
 *    are reported as ambiguous rather than guessed.
 * Display only; saving what GFW returned is saveMmsi() (the normal GFW ingest + resolver).
 * No network I/O except through the `gfw` client passed in, so tests can replay responses.
 */
import { vesselsForMmsiAt, summarize } from './queries.js'
import { classifyClaims } from './taxonomy.js'
import { ingestGfwEntry, ensureGfwSource } from './ingestGfw.js'

const clean = (s) => (s ? String(s).trim() : null)
// GFW enum → words: CONTAINER_REEFER → "Container reefer".
export const typeLabel = (t) => (t ? String(t).toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : null)
const within = (at, from, to) => (!from || Date.parse(from) <= at) && (!to || at <= Date.parse(to) + 864e5)

/** GFW search entries → the identity for one MMSI at one instant (pure; unit-testable). */
export function pickGfwIdentity(entries, mmsi, atMs) {
  const cands = []
  for (const e of entries || []) {
    for (const s of e.selfReportedInfo || []) {
      if (String(s.ssvid) !== String(mmsi)) continue
      const reg = (e.registryInfo || []).find((r) => String(r.ssvid || '') === String(mmsi)) || (e.registryInfo || [])[0] || null
      const types = (e.combinedSourcesInfo || []).flatMap((c) => c.shiptypes || [])
      const regType = reg?.geartypes?.[0] || null
      cands.push({
        name: clean(s.shipname) || clean(reg?.shipname), flag: clean(s.flag) || clean(reg?.flag),
        imo: clean(s.imo) || clean(reg?.imo), callsign: clean(s.callsign) || clean(reg?.callsign),
        type: typeLabel(regType || types.sort((a, b) => (b.yearTo || 0) - (a.yearTo || 0))[0]?.name),
        typeFrom: regType ? 'registry' : types.length ? 'gfw' : null,
        gfwId: s.id, from: s.transmissionDateFrom || null, to: s.transmissionDateTo || null,
        covers: within(atMs, s.transmissionDateFrom, s.transmissionDateTo),
      })
    }
  }
  if (!cands.length) return { status: 'unknown' }
  const covering = cands.filter((c) => c.covers && c.name)
  const names = new Set(covering.map((c) => c.name.toUpperCase()))
  if (names.size > 1) return { status: 'ambiguous', names: [...names] }
  const pick = covering[0] || cands.filter((c) => c.name).sort((a, b) => Date.parse(b.to || 0) - Date.parse(a.to || 0))[0]
  if (!pick) return { status: 'unknown' }
  return { status: 'gfw', exact: !!covering[0], ...pick }
}

/** items: [{ mmsi, at (ISO) }] → [{ mmsi, status: 'db'|'gfw'|'ambiguous'|'unknown', ... }] */
export async function lookupShips(q, S, items, gfw) {
  const out = new Map()
  const resolved = new Map()
  const ambiguous = new Map() // MMSI → our vessels sharing it at that time; GFW's time window may settle it
  await Promise.all(items.map(async ({ mmsi, at }) => {
    const r = await vesselsForMmsiAt(q, S, String(mmsi), at)
    if (r.status === 'resolved') resolved.set(mmsi, r.vesselIds[0])
    else if (r.status === 'ambiguous') ambiguous.set(mmsi, r.vesselIds)
  }))
  if (resolved.size) {
    const vids = [...new Set(resolved.values())]
    const sums = await summarize(q, S, vids)
    // Kind of ship = the card's own reading (taxonomy.classifyClaims), not a raw source string.
    const claims = await q(
      `SELECT vessel_id, attribute, value_norm, lower(period) AS "from", upper(period) AS "to", period_kind,
              evidence_class, detail, source_id
         FROM ${S}.vessel_assertions WHERE vessel_id = ANY($1) AND attribute = 'vessel_type'`, [vids])
    const now = new Date().toISOString()
    for (const [mmsi, id] of resolved) {
      const l = sums[id]?.latest || {}
      const c = classifyClaims(claims.filter((a) => a.vessel_id === id), { from: now, to: now, keepObserved: true })
      const known = c.class && !String(c.class).endsWith('_unspecified')
      const type = c.group && c.group !== 'unknown' ? (known ? c.classLabel : c.groupLabel) : null
      out.set(mmsi, { mmsi, status: 'db', vesselId: id, name: l.name?.value || null, flag: l.flag?.value || null, type })
    }
  }
  const missing = items.filter((i) => !out.has(i.mmsi))
  if (missing.length && gfw) {
    const entries = []
    for (let i = 0; i < missing.length; i += 10) {
      const where = missing.slice(i, i + 10).map((m) => `ssvid = '${String(m.mmsi).replace(/\D/g, '')}'`).join(' OR ')
      const { body } = await gfw.search({ where })
      entries.push(...(body.entries || []))
    }
    for (const m of missing) {
      const pick = pickGfwIdentity(entries, m.mmsi, Date.parse(m.at))
      const shared = ambiguous.get(m.mmsi)
      if (shared && pick.status === 'gfw' && pick.exact && pick.gfwId) {
        // Our database holds several ships with this MMSI (GFW entries kept apart by the
        // conservative resolver). GFW's identity for this exact time names one of them:
        // the vessel carrying that GFW identity id wins, if it's one of the candidates.
        const rows = await q(`SELECT DISTINCT vessel_id FROM ${S}.vessel_assertions
                               WHERE source_id = 'gfw-vessel-identity' AND sub_record_ref = $1 AND vessel_id = ANY($2)`, [pick.gfwId, shared])
        if (rows.length === 1) { out.set(m.mmsi, { mmsi: m.mmsi, ...pick, status: 'db', vesselId: rows[0].vessel_id, settledBy: 'gfw_time_window' }); continue }
      }
      out.set(m.mmsi, shared && pick.status !== 'gfw' ? { mmsi: m.mmsi, status: 'ambiguous', count: shared.length } : { mmsi: m.mmsi, ...pick })
    }
  }
  return items.map((i) => out.get(i.mmsi) || { mmsi: i.mmsi, status: 'unknown' })
}

/**
 * Save what GFW knows about up to 10 MMSIs through the normal ingest: raw payload kept as
 * evidence, claims as assertions, the conservative resolver links or creates each vessel.
 * Idempotent (a repeat changes nothing). One search + one detail request.
 */
export async function saveMmsis(pool, S, mmsis, gfw) {
  const want = [...new Set(mmsis.map((m) => String(m).replace(/\D/g, '')))].filter((m) => m.length === 9).slice(0, 10)
  if (!want.length) return { saved: 0, results: [] }
  await ensureGfwSource(pool, S)
  const { body } = await gfw.search({ where: want.map((m) => `ssvid = '${m}'`).join(' OR ') })
  const ids = new Set()
  for (const e of body.entries || []) {
    const id = (e.selfReportedInfo || []).filter((x) => want.includes(String(x.ssvid))).map((x) => x.id).filter(Boolean).sort()[0]
    if (id) ids.add(id)
  }
  if (!ids.size) return { saved: 0, results: [] }
  const { url, body: detail } = await gfw.byIds([...ids].slice(0, 20))
  const results = []
  for (const e of detail.entries || []) {
    const r = await ingestGfwEntry(pool, S, e, { retrievalUrl: url })
    results.push({ action: r.resolution.action, method: r.resolution.method, vesselId: r.resolution.vesselId })
  }
  return { saved: results.length, results }
}
