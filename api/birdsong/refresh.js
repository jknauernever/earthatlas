/**
 * Weekly snapshot refresh for the /birdsong tool.
 *
 * The station registry (public/birdsong-stations.json) is regenerated at build
 * time by scripts/generate-birdsong-stations.js. To refresh it WITHOUT a manual
 * deploy, a Vercel Cron (see vercel.json) hits this endpoint weekly, and it
 * pings a Vercel Deploy Hook to trigger a fresh production build — which re-runs
 * the generator and republishes the snapshot.
 *
 * Setup (one time, in the Vercel dashboard):
 *   1. Project → Settings → Git → Deploy Hooks → create one (e.g. "birdsong-weekly").
 *   2. Add its URL as the env var BIRDSONG_DEPLOY_HOOK_URL.
 * Until that's set, this endpoint is a safe no-op — snapshots still refresh on
 * every normal deploy. Optionally set CRON_SECRET to lock the endpoint to Vercel.
 */

export const config = { runtime: 'edge' }

export default async function handler(req) {
  // If CRON_SECRET is configured, require Vercel's cron Authorization header.
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } })
    }
  }

  const hook = process.env.BIRDSONG_DEPLOY_HOOK_URL
  if (!hook) {
    return new Response(
      JSON.stringify({ ok: true, triggered: false, note: 'BIRDSONG_DEPLOY_HOOK_URL not set; snapshot refreshes on normal deploys only.' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }

  try {
    const r = await fetch(hook, { method: 'POST' })
    return new Response(
      JSON.stringify({ ok: r.ok, triggered: r.ok, status: r.status }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, triggered: false, error: String(err) }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }
}
