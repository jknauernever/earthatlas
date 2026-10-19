/**
 * /api/ships?op=intake* — the web intake page's API (earthatlas.org/ships/intake). Every op needs the site's admin session
 * (lib/auth.js: the /admin login cookie, or the ADMIN_SECRET bearer). On localhost (not on Vercel) the check is skipped:
 * the dev server only reaches the dev database.
 *
 *   GET  op=intakeAuth                              → { authenticated, dev }
 *   GET  op=intakeJobs                              → { jobs: [...] }  the last 50 page reads
 *   GET  op=intakeJob&id=N                          → the job: intake (boats + decisions), review, notes, result
 *   POST op=intakeRead     { url, text?, strong? }  → read + extract + review → { id }   (text = pasted page text; strong = Opus)
 *   POST op=intakeSave     { id, boats, operator?, kind? } → save the reviewer's decisions / edits (kind = page-wide kind of ship)
 *   POST op=intakeRereview { id }                   → rerun the matching (after edits)
 *   POST op=intakeDig      { id, boat }             → Claude's read of one boat's candidates (advice only)
 *   POST op=intakeApply    { id }                   → write it (one transaction) → { result }
 *   POST op=intakeUnlink   { id, boat }             → take one boat's link back (history kept)
 *   POST op=intakeDiscard  { id }
 *   POST op=intakePhoto    raw JPEG / PNG / WebP body (≤ 4 MB; the page shrinks it first) → { url }: a photo Josh uploads
 *        for a boat, kept on our Vercel Blob store under its content hash (ships/intake-photos/<sha1>.<ext>), public.
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { put } from '@vercel/blob'
import { authorizeRequest } from '../auth.js'
import { shipsPool, withTx } from './db.js'
import { normName } from './normalize.js'
import { intakeProblems } from './operatorSite.js'
import { reviewIntake, fccFromTable } from './intakeMatch.js'
import { applyIntake, matchProblems, unlinkBoat } from './intakeApply.js'
import { readAndExtract, createJob, readJob, listJobs, saveDecisions, digDeeper, READ_MODEL, STRONG_MODEL } from './intakeWeb.js'
import { psixClient } from '../../scripts/ships/psixClient.js'

const onVercel = () => !!process.env.VERCEL
function authed(req) {
  if (!onVercel()) return true
  return authorizeRequest({ headers: { get: (k) => req.headers[String(k).toLowerCase()] ?? null } })
}
async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  for await (const c of req) chunks.push(c)
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}') } catch { return {} }
}
const json = (res, status, b) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(b))
}

async function review(q, S, intake) {
  const fcc = await fccFromTable(q, S, new Set(intake.boats.map((b) => normName(b.name))))
  return reviewIntake(q, S, intake, { fcc, psix: psixClient({ pauseMs: 300, log: () => {} }) })
}

export default async function intakeApi(req, res, { op, p, q, S }) {
  // Localhost: the dev server passes only the ships DB settings through, so read the Anthropic key from .env.local here.
  // On Vercel the key is in the environment.
  if (!onVercel() && !process.env.ANTHROPIC_API_KEY) {
    try {
      for (const k of ['ANTHROPIC_API_KEY', 'BLOB_READ_WRITE_TOKEN']) {
        const line = readFileSync('.env.local', 'utf8').split('\n').find((l) => l.startsWith(`${k}=`))
        if (line && !process.env[k]) process.env[k] = line.slice(k.length + 1).trim().replace(/^["']|["']$/g, '')
      }
    } catch { /* no file: the read fails with a clear error */ }
  }
  if (op === 'intakeAuth') return json(res, 200, { authenticated: authed(req), dev: !onVercel(), ai: !!process.env.ANTHROPIC_API_KEY })
  if (!authed(req)) return json(res, 401, { error: 'sign in first' })
  const POST = req.method === 'POST'
  if (['intakeRead', 'intakeSave', 'intakeRereview', 'intakeDig', 'intakeApply', 'intakeUnlink', 'intakeDiscard', 'intakePhoto'].includes(op) && !POST) return json(res, 405, { error: 'POST only' })
  if (op === 'intakePhoto') {
    const chunks = []; let n = 0
    for await (const ch of req) { n += ch.length; if (n > 4_000_000) return json(res, 413, { error: 'photo too large (4 MB max)' }); chunks.push(ch) }
    const buf = Buffer.concat(chunks)
    const ext = buf[0] === 0xff && buf[1] === 0xd8 ? 'jpg' : buf.slice(0, 4).toString('hex') === '89504e47' ? 'png'
      : buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP' ? 'webp' : null
    if (!ext || buf.length < 1000) return json(res, 400, { error: 'not a JPEG, PNG or WebP photo' })
    const sha = createHash('sha1').update(buf).digest('hex')
    const r = await put(`ships/intake-photos/${sha}.${ext}`, buf, { access: 'public', addRandomSuffix: false, allowOverwrite: true,
      contentType: ext === 'jpg' ? 'image/jpeg' : `image/${ext}`, cacheControlMaxAge: 31536000 })
    return json(res, 200, { url: r.url })
  }
  try {
    if (op === 'intakeJobs') return json(res, 200, { jobs: await listJobs(q, S) })
    if (op === 'intakeJob') {
      const j = await readJob(q, S, Number(p.get('id')))
      return j ? json(res, 200, j) : json(res, 404, { error: 'no such job' })
    }
    const b = await body(req)
    if (op === 'intakeRead') {
      let url
      try { url = new URL(String(b.url || '').trim()); if (!/^https?:$/.test(url.protocol)) throw new Error() } catch { return json(res, 400, { error: 'give a web address (https://…)' }) }
      if (/(^|\.)earthatlas\.org$|^localhost$|^127\.|^10\.|^192\.168\./.test(url.hostname)) return json(res, 400, { error: 'that address can\'t be read' })
      const r = await readAndExtract(url.href, { pasted: b.text ? String(b.text) : null, model: b.strong ? STRONG_MODEL : READ_MODEL })
      if (!r.intake.boats.length) return json(res, 422, { error: r.notFleet || 'no boats found on that page', warnings: r.warnings })
      const rv = await review(q, S, r.intake)
      // Pre-select the reviewer's starting point (never saved as a decision until they save).
      const id = await createJob(q, S, { intake: r.intake, review: rv, model: r.model, usage: r.usage,
        warnings: [...r.warnings, ...(rv.fcc_missing ? ['FCC licence lookup is empty: run the fcc-lookup load'] : [])] })
      return json(res, 200, { id, pages: r.pages, model: r.model })
    }
    const id = Number(b.id)
    const job = await readJob(q, S, id)
    if (!job) return json(res, 404, { error: 'no such job' })
    if (op === 'intakeSave') {
      const r = await saveDecisions(q, S, id, Array.isArray(b.boats) ? b.boats : job.intake.boats, b.operator || null, b.kind)
      return json(res, r.error ? 400 : 200, r)
    }
    if (op === 'intakeRereview') {
      const rv = await review(q, S, job.intake)
      await q(`UPDATE ${S}.intake_jobs SET review = $2, updated_at = now() WHERE id = $1`, [id, rv])
      return json(res, 200, { ok: true })
    }
    if (op === 'intakeDig') {
      const ans = await digDeeper(q, S, job, String(b.boat || ''))
      // jsonb_set won't create a missing parent key, so make sure notes.dig exists first.
      if (!ans.error) await q(`UPDATE ${S}.intake_jobs SET notes = jsonb_set(notes || jsonb_build_object('dig', coalesce(notes->'dig', '{}'::jsonb)),
                                 ARRAY['dig', $2::text], $3::jsonb, true), updated_at = now() WHERE id = $1`,
        [id, String(b.boat), JSON.stringify(ans)])
      return json(res, ans.error ? 502 : 200, ans)
    }
    if (op === 'intakeDiscard') {
      await q(`UPDATE ${S}.intake_jobs SET status = 'discarded', updated_at = now() WHERE id = $1 AND status = 'draft'`, [id])
      return json(res, 200, { ok: true })
    }
    const pool = shipsPool()
    try {
      if (op === 'intakeApply') {
        const errs = [...intakeProblems(job.intake, { forApply: true }), ...(await matchProblems(q, S, job.intake))]
        if (errs.length) return json(res, 400, { error: errs.join('; ') })
        const result = await withTx(pool, async (c) => {
          const r = await applyIntake(c, S, job.intake)
          await c.query(`UPDATE ${S}.intake_jobs SET status = 'applied', applied_at = now(), applied_by = $2, result = $3, updated_at = now() WHERE id = $1`,
            [id, onVercel() ? 'admin' : 'localhost', r])
          return r
        })
        return json(res, 200, { result })
      }
      if (op === 'intakeUnlink') {
        const n = await withTx(pool, (c) => unlinkBoat(c, S, job.intake, String(b.boat || '')))
        return json(res, 200, { unlinked: n })
      }
    } finally { await pool.end() }
    return json(res, 400, { error: 'unknown intake op' })
  } catch (e) {
    console.error('intake', op, e)
    return json(res, 502, { error: String(e.message || e).slice(0, 300) })
  }
}
