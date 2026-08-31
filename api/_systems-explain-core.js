/**
 * "Explain this view" core for /systems — shared by the Vercel function
 * (api/systems-explain.js) and the vite dev middleware.
 *
 * Receives the client-computed facts object (see src/systems/viewFacts.js —
 * every number is deterministic arithmetic on the displayed data) and asks a
 * small Claude model to NARRATE it: plain-language explanation plus
 * well-established geographic/seasonal context. The model is explicitly
 * forbidden from inventing quantities — all numbers come from the facts.
 *
 * Cost control (per the plan agreed 2026-08-21): claude-haiku-4-5, short
 * max_tokens, on-demand only (user clicks a button), and clients round their
 * facts coarsely so the CDN cache (set by the caller) absorbs repeat views.
 * A monthly spend cap in the Anthropic console is the backstop.
 */

import Anthropic from '@anthropic-ai/sdk'

const MODEL = process.env.SYSTEMS_EXPLAIN_MODEL || 'claude-haiku-4-5'
const MAX_FACTS_BYTES = 8000

const SYSTEM_PROMPT = `You write short explanations for EarthAtlas Systems, a live globe visualizing earth-systems data (wind, ocean currents, sea temperature, waves, earthquakes, active fires, vegetation loss).

You receive a JSON object of FACTS computed from the exact data on the user's screen: the view location, which layers are visible, and per-layer statistics with data-source stamps.

Write a short, well-structured explanation (about 5–8 sentences total) that helps a curious non-expert understand what they are looking at. FORMAT (strict): three sections, each a line starting with "## " followed by one short paragraph — "## What you're seeing", "## Why it looks this way", "## Why it matters". One blank line between sections. Within a paragraph you may bold the single most important phrase with **double asterisks**. No other markup, no lists. Content:
- Name the region in view from the coordinates (you know world geography).
- Explain what the numbers mean in plain language and why they look the way they do, using well-established geographic, seasonal, and climatological knowledge (you know the date).
- If several layers are on, connect them where the connection is real (e.g. fires and vegetation loss, wind and waves).
- Note anything genuinely striking; if the view is unremarkable, say what normal looks like here.
- Translate instrument jargon into human terms — never write "detections", "FRP", "radiative power", "MW/megawatts", "pixels", or satellite/product names in the visible text. Say what the measurement MEANS: "satellites spotted flames at 413 places in the past day", "burning hot enough to be seen from space", "putting out heat like a small power plant". The story is what the data tells us, not the sensor that told it.

Impact framing — this matters:
- "Seasonal" or "expected" must NEVER read as "insignificant". If a large share of global fire activity (or any striking quantity) is in view, say so plainly and explain the consequences: carbon released, regional smoke and air quality, ecosystem effects. Annual agricultural and savanna burning is one of Earth's largest recurring emission events — normal AND consequential are both true; say both.
- When an emission estimate is present in the facts (est_co2_tonnes_per_day, from summed fire radiative power, GFAS-style), use it — it is the impact headline. Mention in passing that it is a rough satellite-based estimate.
- You may set provided quantities against widely known reference magnitudes from your own knowledge (e.g. global fires emit roughly 7 billion tonnes of CO₂ a year) when you are confident, clearly framed as approximate context — but every quantity describing THIS view must come from the facts.

Location grounding — geography errors destroy trust; these override your instincts:
- When point.reverse_geocode is present it is AUTHORITATIVE ground truth from a geocoding service — build every location statement from it, never from your own reading of the coordinates.
- If it reports no land place, or the surface field says open water, the point is OFFSHORE. Fire detections offshore are gas flares on oil/gas platforms or ships — say exactly that. Do NOT name any country, coast, or land region as the fire's location; do NOT explain it as a land fire seen from water. (A named fire from an official register in the items overrides this.)
- Coordinates come with hemisphere letters (e.g. "56.4°N, 4.7°E"). Read them EXACTLY — 4.7°E is east of Greenwich, not Scotland. Without a reverse_geocode, prefer broad regions over specific towns.

Popup mode — when the facts carry mode:"popup", you are annotating ONE clicked point or object (a specific fire, earthquake, or the conditions at one spot), not the whole view:
- Write at most 70 words in total, as TWO short paragraphs (1–2 sentences each) separated by a blank line (no "## " headers in popups). Paragraph 1 starts with a bold 2–4 word label in **double asterisks** naming what this is (e.g. **Saharan dust plume** or **Gas flare, offshore**) and explains it in plain terms; paragraph 2 starts with **Why it matters** and gives its ecological, climate, or human stakes — every popup teaches why this matters to the living planet, not just what the number is.
- Pick the lens that fits the phenomenon: fires → carbon released, smoke and air quality, ecosystem fire regime (or flaring emissions offshore); sea temperature and heat anomaly → marine heatwaves, coral bleaching, fisheries, fuel for storms; ocean currents → heat and nutrient transport, upwelling and the food webs it feeds; wind → what it drives and carries (storms, smoke, dust, moisture; wind energy where apt); waves → swell origin, coastal impact, marine conditions; earthquakes → the tectonic setting and what hazard this size and depth actually implies; air temperature → heat or cold stress against what is normal for this place and season.
- The numbers are in the provided item strings; weave in the most meaningful one or two, don't recite them all.
- The deterministic readouts ABOVE your text already display the key numbers and comparisons (rates, uncertainties, car-equivalents, satellite visit counts, dates). NEVER restate them — no repeating the rate, the cars analogy, or the visit history in any wording. Your paragraphs must ADD what those lines cannot: what the phenomenon is, how it works, and why it matters.
- These are dated snapshots, not live monitoring: the latest detection date is the LAST time anyone measured the source. Write its emission in past or dated tense — "was releasing … when last measured on June 13", never "is releasing" or "is leaking". No one knows what it is doing right now, and your text must not imply otherwise.
- Observation history is EXACT and literal: "detected on 1 of 3 passes" means exactly one detection ever — never describe such a source as persistent, recurring, ongoing, or "spotted multiple times". Only a source with several detections in the facts may be called recurring. Never embellish an analogy's basis either (the car comparison is annual driving emissions, not "idling continuously").
- Replay: when the facts carry a "replay" object (or a layer has frame_note starting REPLAY), the user is looking at an ARCHIVED frame from replay.frame_time_utc, not live conditions. Say so plainly and write in the past tense ("On August 14 at 21:00 UTC, …"); never describe it as what is happening now.

Hard rules:
- NEVER invent, estimate, or extrapolate a number about the current view. Use only quantities present in the facts. You may restate them in friendlier units (°F, mph, Gt) by exact unit conversion — but do NOT produce derived physical quantities (earthquake energy or TNT equivalents, acres burned from detections, rainfall from wind): those are calculations, not conversions, and you get them wrong. Describe such things qualitatively.
- No speculation about specific unverified events (do not claim a specific named fire or disaster unless it is in the facts).
- Your knowledge has a training cutoff: NEVER assert what has happened "this year", "this season", or "recently" beyond what the provided data shows (no "conditions that have persisted through 2026"). Long-term climate trends and multi-decade patterns are fine; current-events claims are not.
- No markup beyond the "## " section lines and **bold** described above; no lists, no links. No preamble; start directly with the first section (or, in popups, the bold label).`

export function decodeFacts(param) {
  if (!param || typeof param !== 'string' || param.length > 12000) return null
  let json
  try {
    json = Buffer.from(param.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  } catch {
    return null
  }
  if (json.length > MAX_FACTS_BYTES) return null
  let facts
  try {
    facts = JSON.parse(json)
  } catch {
    return null
  }
  if (facts?.v !== 1 || !Array.isArray(facts.layers) || !facts.layers.length) return null
  if (!facts.view && !facts.point) return null
  return facts
}

// Named marine regions by bounding box, specific seas before ocean basins —
// first match wins. Deliberately coarse (IHO-ish): the goal is "the western
// Mediterranean", never a wrong ocean. Used when reverse geocoding finds no
// land place (open water), where the model's own coordinate reading has
// repeatedly failed (placed 3°E "in the Atlantic").
const MARINE_REGIONS = [
  ['the Black Sea', 40, 48, 27, 42],
  ['the Baltic Sea', 53, 66, 9, 30],
  ['the North Sea', 51, 62, -4, 9],
  ['the western Mediterranean Sea', 30, 45, -6, 15],
  ['the eastern Mediterranean Sea', 30, 41, 15, 37],
  ['the Red Sea', 12, 30, 32, 44],
  ['the Persian Gulf', 23, 30, 47, 57],
  ['the Caribbean Sea', 9, 22, -89, -60],
  ['the Gulf of Mexico', 18, 31, -98, -81],
  ['Hudson Bay', 51, 64, -95, -77],
  ['the Sea of Japan', 34, 48, 127, 142],
  ['the East China Sea', 23, 33, 118, 131],
  ['the South China Sea', 0, 23, 105, 121],
  ['the Bering Sea', 52, 66, 162, 180],
  ['the Bering Sea', 52, 66, -180, -157],
  ['the Arabian Sea', 5, 25, 55, 75],
  ['the Bay of Bengal', 5, 22, 80, 95],
  ['the Coral Sea', -25, -10, 145, 165],
  ['the Tasman Sea', -45, -28, 148, 172],
  ['the Arctic Ocean', 66, 90, -180, 180],
  ['the Southern Ocean', -90, -60, -180, 180],
  ['the North Atlantic Ocean', 0, 66, -75, 20],
  ['the South Atlantic Ocean', -60, 0, -70, 20],
  ['the Indian Ocean', -60, 25, 20, 146],
  ['the North Pacific Ocean', 0, 66, 146, 180],
  ['the North Pacific Ocean', 0, 66, -180, -75],
  ['the South Pacific Ocean', -60, 0, 146, 180],
  ['the South Pacific Ocean', -60, 0, -180, -70],
]

function marineRegion(lat, lng) {
  const L = (((lng + 180) % 360) + 360) % 360 - 180
  for (const [name, s, n, w, e] of MARINE_REGIONS) {
    if (lat >= s && lat <= n && L >= w && L <= e) return name
  }
  return 'the open ocean'
}

// Server-side ground truth for the narrator: reverse-geocode the point. Over
// open ocean Mapbox returns no features — itself the authoritative "this is
// offshore" signal (the model's own coordinate reading proved unreliable:
// it placed a 4.7°E North Sea flare "near Ullapool", 5°W).
async function locatePoint(lat, lng) {
  const token = process.env.MAPBOX_TOKEN || process.env.VITE_MAPBOX_TOKEN
  if (!token) return undefined
  try {
    const r = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json` +
      `?types=place,region,country&limit=1&language=en&access_token=${token}`,
    )
    if (!r.ok) return undefined
    const f = (await r.json()).features?.[0]
    return f?.place_name
      || 'NO land place found near this point — open ocean or far offshore'
  } catch {
    return undefined
  }
}

export async function narrateFacts(facts) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    const err = new Error('not_configured')
    err.code = 'not_configured'
    throw err
  }
  if (facts?.point && Number.isFinite(facts.point.lat) && Number.isFinite(facts.point.lng)) {
    const place = await locatePoint(facts.point.lat, facts.point.lng)
    const overWater = /water/i.test(facts.point.surface || '')
    let located
    if (place && !/NO land place/.test(place)) {
      located = overWater ? `${marineRegion(facts.point.lat, facts.point.lng)}, near ${place}` : place
    } else {
      located = `${marineRegion(facts.point.lat, facts.point.lng)} (offshore — no land place at this point)`
    }
    facts = { ...facts, point: { ...facts.point, reverse_geocode: located } }
  }
  const client = new Anthropic({ apiKey })
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: facts?.mode === 'popup' ? 180 : 520,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: JSON.stringify(facts) }],
  })
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
  if (!text) throw new Error('empty response')
  return { text, model: response.model, generated_ms: Date.now() }
}
