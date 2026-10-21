/**
 * Washington State Department of Ecology, Advance Notice of Transfer (ANT) records (Josh 2026-10-20): every over-water bulk oil
 * transfer of more than 100 gallons to a non-recreational vessel is notified to Ecology in advance (RCW 88.46.165, WAC 173-184).
 * The records come from a public records release (an Excel workbook, sheet "Vessel Oil Transfer (42)"); one row per product, so
 * one notice (AntID) can hold several rows. Rules: src/ships/CLAUDE.md.
 *
 *   evidence        each notice's rows exactly as released → one source_records row (entity kind 'ant_notice', key AntID)
 *   typed           ecology_ant_rows (migration 039): the same rows, times converted (Pacific local → UTC), numbers parsed
 *   interpretation  read time only: notices grouped into operations (groupAntOperations), matched to AIS (bunkerMatch.js)
 *
 * Contacts (ContactName, ContactPhone) are part of the public records release and are kept and shown (Josh 2026-10-20).
 */
import { upsertSource, findOrCreateEntity, upsertRecord } from './store.js'

export const ANT_SOURCE = {
  id: 'wa-ecology-ant',
  name: 'Washington State Department of Ecology, Advance Notice of Transfer (ANT) records',
  publisher: 'Washington State Department of Ecology, Spill Prevention, Preparedness, and Response Program',
  homepage_url: 'https://ecology.wa.gov/regulations-permits/reporting-requirements/advance-notice-of-oil-transfer',
  license: 'Public record (Washington Public Records Act, RCW 42.56)',
  license_url: 'https://app.leg.wa.gov/rcw/default.aspx?cite=42.56',
  commercial_use: true,
  attribution_text: 'Washington State Department of Ecology, Advance Notice of Transfer records (public records release)',
  attribution_url: 'https://ecology.wa.gov/regulations-permits/reporting-requirements/advance-notice-of-oil-transfer',
  notes: 'Advance notices of over-water bulk oil transfers (RCW 88.46.165, WAC 173-184), as released by Ecology under the Public '
    + 'Records Act: one row per product; StartDateTime and Duration are the planned start (Pacific local time) and planned hours '
    + 'as notified, not observed. Each notice (AntID) is kept as released.',
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0')

/** Excel serial (days since 1899-12-30, local wall time) → 'YYYY-MM-DDTHH:MM' (rounded to the minute). */
export function excelSerialToLocal(serial) {
  if (serial == null || String(serial).trim() === '') return null   // Number('') is 0, which would read as 1899-12-30
  const v = Number(serial)
  if (!Number.isFinite(v)) return null
  const ms = Math.round(v * 1440) * 60e3 + Date.UTC(1899, 11, 30)
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** Offset (minutes, local − UTC) of an IANA zone at an instant. */
function zoneOffsetMin(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - ms) / 60e3
}

/** 'YYYY-MM-DDTHH:MM' wall time in `tz` → ISO UTC. In the repeated autumn hour the earlier instant (daylight time) is taken. */
export function localToUtc(local, tz = 'America/Los_Angeles') {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local || '')
  if (!m) return null
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
  let t = wall - zoneOffsetMin(wall, tz) * 60e3
  t = wall - zoneOffsetMin(t, tz) * 60e3
  return new Date(t).toISOString()
}

const num = (v) => { if (v == null || v === '') return null; const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null }
const yn = (v) => (v == null || v === '' ? null : /^y/i.test(String(v).trim()))
const txt = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim())

/** One released row (ant_export.py) → typed row. Pure. */
export function parseAntRow(r) {
  const local = excelSerialToLocal(r.StartDateTime)
  return {
    rowNo: Number(r.row_no), antId: txt(r.AntID), company: txt(r.Company), startLocal: local, startAt: localToUtc(local),
    durationH: num(r.Duration), deliverer: txt(r.Deliverer), receiver: txt(r.Receiver), location: txt(r.Location),
    streetAddress: txt(r.StreetAddress), lat: num(r.LatNumber), lon: num(r.LongNumber), city: txt(r.City), region: txt(r.Region),
    product: txt(r.Product), gallons: num(r.TransferQtyInGallon), transferType: txt(r.TransferType), isPreboomed: yn(r.IsPreboomed),
    rateGt500: yn(r.IsTransferRateGT500), contactName: txt(r.ContactName), contactPhone: txt(r.ContactPhone),
    delivererType: txt(r.DelivererTypeDescription), receiverType: txt(r.ReceiverTypeDescription), remarks: txt(r.RemarksDescription),
  }
}

/** Receiver name as notified → the name a ship broadcasts: drops tug / ATB prefixes ("ATB TUG PRIDE" → "PRIDE"). Pure. */
export function antShipName(name) {
  return String(name || '').toUpperCase().replace(/^\s*(ATB\s+TUG|ATB|TUG|M\/?V|M\/?T|T\/?V)\s+/, '').replace(/\s+/g, ' ').trim()
}

/**
 * Notices → operations (pure): one notice per AntID (its product rows together), then notices for the same receiver at the
 * same location starting within `withinH` hours of each other are one operation (a second notice for the same fueling).
 * rows = typed rows (parseAntRow / DB rows in that shape, with recordId).
 */
export function groupAntOperations(rows, { withinH = 12 } = {}) {
  const byNotice = new Map()
  for (const r of rows) {
    const n = byNotice.get(r.antId) || { antId: r.antId, rows: [] }
    n.rows.push(r)
    byNotice.set(r.antId, n)
  }
  const notices = [...byNotice.values()].map((n) => {
    const f = n.rows[0]
    return { antIds: [n.antId], recordIds: [...new Set(n.rows.map((r) => r.recordId).filter(Boolean))], receiver: f.receiver,
      location: f.location, startAt: f.startAt, startLocal: f.startLocal, durationH: f.durationH, company: f.company,
      deliverers: [...new Set(n.rows.map((r) => r.deliverer).filter(Boolean))], transferTypes: [...new Set(n.rows.map((r) => r.transferType).filter(Boolean))],
      products: n.rows.map((r) => ({ product: r.product, gallons: r.gallons })), gallons: n.rows.reduce((g, r) => g + (r.gallons || 0), 0),
      isPreboomed: n.rows.some((r) => r.isPreboomed === true) ? true : n.rows.every((r) => r.isPreboomed === false) ? false : null,
      rateGt500: n.rows.some((r) => r.rateGt500 === true) ? true : n.rows.every((r) => r.rateGt500 === false) ? false : null,
      contacts: [...new Map(n.rows.filter((r) => r.contactName || r.contactPhone).map((r) => [`${r.contactName}|${r.contactPhone}`, { name: r.contactName, phone: r.contactPhone }])).values()],
      delivererType: f.delivererType, receiverType: f.receiverType, lat: f.lat, lon: f.lon, city: f.city, region: f.region,
      remarks: [...new Set(n.rows.map((r) => r.remarks).filter(Boolean))] }
  }).sort((a, b) => String(a.receiver).localeCompare(String(b.receiver)) || String(a.location).localeCompare(String(b.location)) || a.startAt.localeCompare(b.startAt))
  const ops = []
  for (const n of notices) {
    const last = ops[ops.length - 1]
    if (last && last.receiver === n.receiver && last.location === n.location && new Date(n.startAt) - new Date(last.startAt) <= withinH * 3600e3) {
      last.antIds.push(...n.antIds); last.recordIds.push(...n.recordIds)
      last.deliverers = [...new Set([...last.deliverers, ...n.deliverers])]
      last.transferTypes = [...new Set([...last.transferTypes, ...n.transferTypes])]
      last.products.push(...n.products); last.gallons += n.gallons
      last.contacts = [...new Map([...last.contacts, ...n.contacts].map((c) => [`${c.name}|${c.phone}`, c])).values()]
      last.remarks = [...new Set([...last.remarks, ...n.remarks])]
      if (n.durationH != null) last.durationH = Math.max(last.durationH ?? 0, n.durationH)
    } else ops.push({ ...n })
  }
  return ops.sort((a, b) => a.startAt.localeCompare(b.startAt))
}

// ── Store ────────────────────────────────────────────────────────────────────

/** Store one release: each notice as one source record (its rows as released), then the typed rows. Replaces the release. */
export async function storeAntRelease(c, S, { releaseId, meta, raw, runId = null }) {
  await upsertSource(c, S, ANT_SOURCE)
  const byNotice = new Map()
  for (const r of raw) (byNotice.get(r.AntID) || byNotice.set(r.AntID, []).get(r.AntID)).push(r)
  const recOf = new Map()
  for (const [antId, rs] of byNotice) {
    const ent = await findOrCreateEntity(c, S, { sourceId: ANT_SOURCE.id, kind: 'ant_notice', anchor: String(antId) })
    const payload = { release: { id: releaseId, file: meta.file, sheet: meta.sheet, sha256: meta.sha256 }, ant_id: antId, rows: rs }
    const rec = await upsertRecord(c, S, { sourceId: ANT_SOURCE.id, entityId: ent.id, payload, datasetVersion: releaseId, retrievalUrl: null, runId })
    recOf.set(String(antId), rec.id)
  }
  await c.query(`DELETE FROM ${S}.ecology_ant_rows WHERE release_id = $1`, [releaseId])
  const rows = raw.map(parseAntRow)
  const bad = rows.filter((r) => !r.antId || !r.startAt)
  if (bad.length) throw new Error(`${bad.length} rows without an AntID or a readable StartDateTime (first: row ${bad[0].rowNo})`)
  const cols = ['rowNo', 'antId', 'company', 'startLocal', 'startAt', 'durationH', 'deliverer', 'receiver', 'location', 'streetAddress', 'lat', 'lon',
    'city', 'region', 'product', 'gallons', 'transferType', 'isPreboomed', 'rateGt500', 'contactName', 'contactPhone', 'delivererType', 'receiverType', 'remarks']
  const types = ['int', 'text', 'text', 'text', 'timestamptz', 'real', 'text', 'text', 'text', 'text', 'float8', 'float8', 'text', 'text', 'text', 'float8',
    'text', 'boolean', 'boolean', 'text', 'text', 'text', 'text', 'text']
  for (let i = 0; i < rows.length; i += 1000) {
    const b = rows.slice(i, i + 1000)
    const params = [releaseId, ...cols.map((k) => b.map((r) => r[k] ?? null)), b.map((r) => recOf.get(r.antId))]
    await c.query(
      `INSERT INTO ${S}.ecology_ant_rows (release_id, row_no, ant_id, company, start_local, start_at, duration_h, deliverer, receiver, location,
              street_address, lat, lon, city, region, product, gallons, transfer_type, is_preboomed, rate_gt500, contact_name, contact_phone,
              deliverer_type, receiver_type, remarks, source_record_id)
       SELECT $1, ${cols.map((_, j) => `x.c${j}`).join(', ')}, x.rid
         FROM unnest(${cols.map((_, j) => `$${j + 2}::${types[j]}[]`).join(', ')}, $${cols.length + 2}::bigint[])
              AS x(${cols.map((_, j) => `c${j}`).join(', ')}, rid)`, params)
  }
  return { notices: byNotice.size, rows: rows.length }
}

// ── Read ─────────────────────────────────────────────────────────────────────

/** Anchorage notices (Location 'Anchor - …') starting in [fromIso, toIso), as typed rows with their record ids. */
export async function readAntAnchorageRows(q, S, { fromIso, toIso }) {
  const rows = await q(
    `SELECT ant_id, company, start_local, start_at, duration_h, deliverer, receiver, location, lat, lon, city, region, product, gallons, transfer_type,
            is_preboomed, rate_gt500, contact_name, contact_phone, deliverer_type, receiver_type, remarks, source_record_id
       FROM ${S}.ecology_ant_rows WHERE location LIKE 'Anchor - %' AND start_at >= $1 AND start_at < $2 ORDER BY start_at, ant_id, row_no`,
    [fromIso, toIso])
  return rows.map((r) => ({ antId: r.ant_id, company: r.company, startLocal: r.start_local, startAt: new Date(r.start_at).toISOString(),
    durationH: r.duration_h, deliverer: r.deliverer, receiver: r.receiver, location: r.location, lat: r.lat, lon: r.lon, city: r.city, region: r.region, product: r.product,
    gallons: r.gallons, transferType: r.transfer_type, isPreboomed: r.is_preboomed, rateGt500: r.rate_gt500, contactName: r.contact_name,
    contactPhone: r.contact_phone, delivererType: r.deliverer_type, receiverType: r.receiver_type, remarks: r.remarks, recordId: Number(r.source_record_id) }))
}
