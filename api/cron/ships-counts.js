/**
 * Daily refresh of the /ships changelog's "Data on the site" numbers (Josh 2026-10-08: run after the daily updates).
 * Started by .github/workflows/ships-counts.yml when the daily GFW chain (ships-gfw-identities) or the weekly NOAA month
 * finishes. Computes lib/ships/changelogCounts.js (the cards' own read code, read only) and writes the result to Blob at
 * ships/changelog-counts.json, which src/ships/ChangelogPage.jsx reads (its built-in numbers are the fallback).
 *
 *   POST (CRON_SECRET bearer) → { ok, counts } ; ?dry=1 computes without writing (localhost checks)
 *   POST ?part=report → the /ships general report (lib/ships/generalReport.js) to Blob at ships/general-report.json, which
 *   src/ships/GeneralReport.jsx reads. A second step of the same workflow, so a slow report never holds up the counts.
 *
 * SAFETY: a result with any missing or zero headline number is NOT written, so a failed read never blanks the page.
 * Node runtime (NOT edge): @vercel/blob's `put` needs node:stream.
 */
import { put } from '@vercel/blob'
import { shipsHttp, DEFAULT_SCHEMA as S } from '../../lib/ships/db.js'
import { changelogCounts } from '../../lib/ships/changelogCounts.js'
import { generalReport, nodeFetchJson, REPORT_PATH } from '../../lib/ships/generalReport.js'
import trackSource from '../../src/ships/trackSource.json' with { type: 'json' }

export const maxDuration = 300
export const COUNTS_PATH = 'ships/changelog-counts.json'

const HEADLINE = (c) => [c.ships, c.scrubberShips, c.terminals, c.ports, c.anchorages, c.portVisits, c.incidents,
  c.terminalVisits?.counted, c.anchorageStays?.counted, c.terminalEmissions?.co2eTonnes, c.shipTracks?.total]

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers['authorization'] || req.headers['Authorization']
  if (!secret || auth !== `Bearer ${secret}`) { res.statusCode = 401; return res.end('Unauthorized') }
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('POST only') }
  const send = (code, body) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)) }
  try {
    const sql = shipsHttp()
    const q = (t, p) => sql.query(t, p)
    const t0 = Date.now()
    const sp = new URL(req.url, 'http://x').searchParams
    if (sp.get('part') === 'report') {
      const report = await generalReport(q, S, { trackSource, fetchJson: nodeFetchJson })
      // Same safety rule: a missing headline number, or a missing database part, leaves the last good report in place.
      const bad = HEADLINE(report.counts).filter((v) => !(Number(v) > 0)).length
      const missing = ['fleet', 'ports', 'incidents'].filter((k) => !report[k])
      if (bad || missing.length || !report.terminals.top.length) {
        return send(500, { ok: false, error: `not written: ${bad} headline numbers missing, parts missing: ${missing.join(', ') || 'none'}`, failed: report.failed })
      }
      if (sp.get('dry') !== '1') {
        await put(REPORT_PATH, JSON.stringify(report), { access: 'public', addRandomSuffix: false, allowOverwrite: true,
          contentType: 'application/json', cacheControlMaxAge: 3600 })
      }
      return send(200, { ok: true, written: sp.get('dry') !== '1', seconds: Math.round((Date.now() - t0) / 1000), failed: report.failed })
    }
    const counts = await changelogCounts(q, S, { trackSource, fetchJson: async (u) => (await fetch(u)).json() })
    const bad = HEADLINE(counts).filter((v) => !(Number(v) > 0)).length
    if (bad) return send(500, { ok: false, error: `${bad} headline numbers missing or zero; not written`, counts })
    const dry = sp.get('dry') === '1'
    if (!dry) {
      await put(COUNTS_PATH, JSON.stringify(counts), { access: 'public', addRandomSuffix: false, allowOverwrite: true,
        contentType: 'application/json', cacheControlMaxAge: 3600 })
    }
    return send(200, { ok: true, written: !dry, seconds: Math.round((Date.now() - t0) / 1000), counts })
  } catch (e) {
    console.error('ships-counts', e)
    return send(500, { ok: false, error: String(e?.message || e) })
  }
}
