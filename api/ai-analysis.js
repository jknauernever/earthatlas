/**
 * AI summary of a clicked forest-monitor point.
 *
 * POST /api/ai-analysis  with a JSON body of already-computed facts (see
 * the `FACT_FIELDS` whitelist below). Returns { text } — a short, plain-
 * language read that synthesizes the datasets and flags disagreements.
 *
 * Cost design (this is the whole point — keep it cheap):
 *   - Click-gated on the frontend (only runs when the user asks).
 *   - Claude Haiku (cheapest model) — this is summarization, not reasoning.
 *   - Tiny input: we send the facts we already computed, not raw data.
 *   - max_tokens capped at 220 (~4-5 sentences).
 *   - The static system instructions carry a cache_control breakpoint, so
 *     repeated calls re-read them at ~0.1x instead of paying full input.
 * Per call ≈ $0.001-0.002; ~1,000 summaries ≈ $1-2.
 *
 * Runs on Vercel Edge (raw fetch, no SDK) to match the other api/ functions
 * and stay under the Hobby plan's serverless-function ceiling. The Anthropic
 * key stays server-side (ANTHROPIC_API_KEY) — never shipped to the browser.
 */

export const config = { runtime: 'edge' }

const MODEL = 'claude-haiku-4-5'
const MAX_TOKENS = 220
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

// Static, frozen system prompt — identical every call so it prompt-caches.
// Keep ALL volatile content (the per-point facts) out of here.
const SYSTEM = `You explain what satellite datasets say about a single map location, for a general audience.

You'll get a short list of facts from independent Earth-observation datasets. Each one measures something different, at a different resolution, and on its own schedule. Write a clear, plain-language read of this spot in 3-5 short sentences.

Rules:
- Sixth-grade reading level, but never patronizing or cutesy. No emoji, no headings, no sign-off. Plain, confident, and respectful of the reader.
- Synthesize — tell the story across the datasets; don't just relist them.
- When two datasets seem to disagree, say so plainly and give the most likely reason. Disagreement almost always means they measure different things, not that one is wrong. Common reasons: different timing (one is annual and lags by a year or more; another is near-real-time), different definitions (partial thinning or a small patch vs. total clearing), different confidence (an alert marked "unconfirmed" or "no longer active" is weak), or a place's legal protection making a guessed cause unlikely (e.g. logging in a designated Wilderness).
- Only use the facts provided. Never invent numbers, dates, places, or causes. If the facts are thin, keep it short — don't pad.
- Lead with the most useful takeaway.`

// Whitelist of fact fields → human label. Anything else in the body is ignored.
const FACT_FIELDS = [
  ['location', 'Location'],
  ['protectedArea', 'Protected area'],
  ['landCover', 'Land cover'],
  ['opera', 'Near-real-time disturbance (NASA OPERA)'],
  ['causeGuess', 'Our cause guess (from patch shape)'],
  ['hansen', 'Annual forest loss (Hansen / UMD-GLAD)'],
  ['tmf', 'Tropical moist forest (JRC TMF)'],
  ['radd', 'Radar deforestation alert (RADD)'],
  ['commodity', 'Commodity crop (Forest Data Partnership)'],
  ['greenness', 'Greenery trend (Sentinel-2 NDVI)'],
]

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
  }
}

function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders(),
      ...(init.headers || {}),
    },
  })
}

// Build the compact, validated facts list. Only whitelisted keys with non-empty
// string values are included; each is clamped so a malformed caller can't blow
// up the prompt.
function buildFactsText(facts) {
  const lines = []
  for (const [key, label] of FACT_FIELDS) {
    const v = facts[key]
    if (typeof v === 'string' && v.trim()) {
      lines.push(`- ${label}: ${v.trim().slice(0, 300)}`)
    }
  }
  return lines.join('\n').slice(0, 2500)
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed', text: null }, { status: 405 })

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) {
    // Graceful: the feature is built but no key is configured yet.
    return json({ error: 'not_configured', text: null }, { status: 503 })
  }

  let body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad_json', text: null }, { status: 400 })
  }
  const facts = (body && typeof body === 'object') ? (body.facts || body) : null
  if (!facts || typeof facts !== 'object') {
    return json({ error: 'bad_request', text: null }, { status: 400 })
  }

  const factsText = buildFactsText(facts)
  if (!factsText) return json({ error: 'no_facts', text: null }, { status: 400 })

  try {
    const r = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: `Facts about this spot:\n${factsText}` }],
      }),
    })

    if (!r.ok) {
      const detail = await r.text().catch(() => '')
      console.error('[ai-analysis] anthropic error', r.status, detail.slice(0, 300))
      return json({ error: 'upstream_error', text: null }, { status: 502 })
    }

    const data = await r.json()
    const text = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
    return json({ text: text || null })
  } catch (e) {
    console.error('[ai-analysis] failed', e)
    return json({ error: 'request_failed', text: null }, { status: 500 })
  }
}
