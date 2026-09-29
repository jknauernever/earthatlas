/**
 * gh-dispatch — Vercel Cron starts the frequent GitHub Actions bakes.
 *
 * GitHub's own `schedule:` trigger is best-effort and drops most runs of a
 * frequent cron: over 2026-09-24→29 the every-10-min radar bake actually ran with a
 * median gap of 4.0 h, the every-20-min GSMaP bake 4.4 h, the hourly GMGSI bake
 * 4.8 h — every run succeeding in under 1.5 min, so nothing was queued, it
 * was simply never started. "Live" radar and satellite rain were hours old
 * and hours apart. A workflow_dispatch starts within seconds, and Vercel's
 * crons fire on time (warm-explore/birdcast run hourly without a miss).
 *
 * The workflows keep their `schedule:` as a fallback (a lapsed token must
 * not stop the bakes); each has a concurrency group, so an occasional
 * double start runs one after the other.
 *
 * GET /api/cron/gh-dispatch?wf=mrms|gsmap|gmgsi — CRON_SECRET-guarded.
 * Needs GH_DISPATCH_TOKEN: a fine-grained PAT scoped to this repo only,
 * Actions: read & write, nothing else.
 */

const REPO = 'jknauernever/earthatlas'
// Allowlist: the cron can only ever start these, whatever ?wf= says.
const WORKFLOWS = {
  mrms: 'mrms-bake.yml',
  gsmap: 'gsmap-bake.yml',
  gmgsi: 'gmgsi-bake.yml',
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers['authorization'] || req.headers['Authorization']
  if (!secret || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  const file = WORKFLOWS[req.query?.wf]
  if (!file) return res.status(400).json({ error: `unknown wf; one of ${Object.keys(WORKFLOWS).join(', ')}` })
  const token = process.env.GH_DISPATCH_TOKEN
  if (!token) return res.status(500).json({ error: 'GH_DISPATCH_TOKEN not set' })

  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${file}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'earthatlas-cron',
    },
    body: JSON.stringify({ ref: 'main' }),
  })
  // 204 = queued. Anything else: surface GitHub's reason, never the token.
  if (r.status === 204) return res.status(200).json({ ok: true, workflow: file })
  const detail = (await r.text()).slice(0, 300)
  return res.status(502).json({ ok: false, workflow: file, status: r.status, detail })
}
