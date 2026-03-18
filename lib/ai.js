/**
 * AI article rewriting via Anthropic Claude API.
 *
 * Ported from EnviroLink AI Aggregator, adapted for wildlife/species content.
 */

const MODEL = 'claude-sonnet-4-20250514'
const MAX_TOKENS = 1024

/**
 * Rewrite an article using Claude. Returns { title, summary, imageKeywords } or null.
 */
export async function rewriteArticle({ title, content, speciesName }) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')

  const prompt = buildPrompt(title, content, speciesName)

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(60_000),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`Claude API error ${res.status}: ${err.slice(0, 200)}`)
  }

  const data = await res.json()
  const text = data.content?.[0]?.text
  if (!text) return null

  return parseResponse(text)
}

/**
 * Classify a general news article against species categories.
 * Returns an array of matching species slugs, e.g. ['sharks', 'whales'], or [].
 *
 * @param {Object} opts
 * @param {string} opts.title - Article title
 * @param {string} opts.content - Article content (truncated)
 * @param {string[]} opts.speciesList - Valid species slugs
 * @param {Object} [opts.keywordMap] - { speciesSlug: ['keyword1', 'keyword2', ...] }
 */
export async function classifyArticle({ title, content, speciesList, keywordMap = {} }) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')

  // Build category descriptions with keyword hints
  const categoryLines = speciesList.map(slug => {
    const keywords = keywordMap[slug]
    if (keywords && keywords.length > 0) {
      return `- ${slug} (related terms: ${keywords.join(', ')})`
    }
    return `- ${slug}`
  }).join('\n')

  const prompt = `You are a classifier for EarthAtlas.org, a wildlife and biodiversity news site. Given a news article, determine which of the following species categories it is relevant to. An article may match multiple categories, or none at all.

Categories:
${categoryLines}

Article Title: ${title}

Article Content:
${content}

IMPORTANT: The keywords listed for each category are contextual hints, NOT literal pattern matches. You must evaluate whether the article is genuinely about wildlife, biodiversity, or the natural world in the context of that species category. Many keywords have multiple meanings in everyday language — for example, "pod" could refer to a dolphin pod OR a tech product, "bark" could be a tree or a dog sound, "mercury" could be the planet or the element. Always consider the full article context before matching.

Only match a category if the article substantively discusses the actual animals, their habitats, conservation, ecology, or related wildlife topics. Do NOT match based on incidental or metaphorical mentions.

Return ONLY a comma-separated list of matching category slugs from the list above. If the article is not relevant to ANY of the categories, return exactly: NONE

Examples:
- An article about ocean conservation affecting shark and whale habitats → sharks, whales
- An article about a new butterfly migration study → butterflies
- An article about a political scandal → NONE
- An article about Apple releasing a new iPod that mentions "pod" → NONE
- An article about dolphin pods being spotted off the coast → dolphins

CATEGORIES:`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 128,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`Claude API error ${res.status}: ${err.slice(0, 200)}`)
  }

  const data = await res.json()
  const text = (data.content?.[0]?.text || '').trim()

  if (!text || text.toUpperCase() === 'NONE') return []

  // Parse and validate against the allowed list
  const validSet = new Set(speciesList)
  return text.split(',')
    .map(s => s.trim().toLowerCase())
    .filter(s => validSet.has(s))
}

/**
 * Suggest keywords for a species category.
 * Returns an array of keyword strings, excluding any already in existingKeywords.
 */
export async function suggestKeywords({ speciesSlug, existingKeywords = [] }) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')

  const existingNote = existingKeywords.length > 0
    ? `\n\nAlready mapped keywords (do NOT repeat these): ${existingKeywords.join(', ')}`
    : ''

  const prompt = `You are helping build a keyword mapping for EarthAtlas.org, a wildlife and biodiversity news aggregator. The site tracks articles about specific species categories and uses keywords to classify general news articles into the correct category.

Species category: ${speciesSlug}${existingNote}

Suggest 15-20 additional keywords and related terms that would help identify news articles about this species category. Include:
- Common names (singular and plural)
- Scientific/taxonomic names
- Subspecies and closely related species
- Habitat and ecosystem terms specific to this group
- Conservation terms specific to this group
- Behavioral terms (migration, spawning, nesting, etc.)
- Body parts or features commonly mentioned in news (fins, tusks, antlers, etc.)

IMPORTANT: Only suggest terms that are strongly and unambiguously associated with this species in a wildlife/biodiversity context. AVOID words that have common non-wildlife meanings that would cause false matches in general news. For example:
- "pod" is too ambiguous (tech products, podcasts, etc.) — use "dolphin pod" instead
- "bark" is too ambiguous (dogs, trees) — use specific terms instead
- "mercury" is too ambiguous (planet, element, car brand)
If a term is commonly used outside of wildlife contexts, either skip it or pair it with a species qualifier to make it specific.

Return ONLY a comma-separated list of lowercase keywords, nothing else. No numbering, no explanations.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`Claude API error ${res.status}: ${err.slice(0, 200)}`)
  }

  const data = await res.json()
  const text = (data.content?.[0]?.text || '').trim()
  if (!text) return []

  const existingSet = new Set(existingKeywords.map(k => k.toLowerCase().trim()))
  return text.split(',')
    .map(s => s.trim().toLowerCase())
    .filter(s => s && !existingSet.has(s))
}

function buildPrompt(title, content, speciesName) {
  const speciesContext = speciesName
    ? ` The article is related to ${speciesName} or their habitat/ecosystem.`
    : ''

  return `You are a news editor for EarthAtlas.org, a wildlife and biodiversity news site.${speciesContext} Your task is to rewrite the following article in a clear, engaging style while maintaining factual accuracy.

Original Title: ${title}

Original Content:
${content}

Please provide:
1. A new, compelling headline (no length limit - use whatever length needed for clarity)
2. A rewritten article summary (2-4 paragraphs, around 200-300 words)
3. Two to three image search keywords for finding a relevant stock photo

Image keyword rules:
- Focus on the WILDLIFE, ENVIRONMENTAL, or PHYSICAL subject (e.g., "great white shark ocean", "coral reef bleaching", "monarch butterfly migration")
- NEVER use names of people, politicians, or political parties
- NEVER use organization names or acronyms (EPA, UN, WHO, etc.)
- Prefer concrete, visual nouns: wildlife, landscapes, ecosystems, habitats
- Keep to 2-3 words that would find a good nature/wildlife stock photo

Headline capitalization rules (use Title Case):
- Capitalize EVERY word EXCEPT: articles (a, an, the), conjunctions (and, but, or, nor, yet, so), and short prepositions (in, on, at, to, for, of, by, with, from)
- ALWAYS capitalize proper nouns, species names, and place names
- ALWAYS capitalize the first and last word of the headline

Keep the core facts and maintain journalistic integrity. Make it informative and accessible to a general audience interested in wildlife and biodiversity.

IMPORTANT: Do NOT include any attribution, source credit, or byline statements in the content. The article should read as original editorial content with no reference to its source.

Format your response as:
TITLE: [new headline]
CONTENT: [rewritten content]
IMAGE_KEYWORDS: [2-3 visual search terms]`
}

function parseResponse(text) {
  const titleMatch = text.match(/TITLE:\s*(.+?)(?:\n|$)/s)
  const contentMatch = text.match(/CONTENT:\s*(.+?)(?:\nIMAGE_KEYWORDS:|\s*$)/s)
  const keywordsMatch = text.match(/IMAGE_KEYWORDS:\s*(.+?)(?:\n|$)/s)

  if (!titleMatch || !contentMatch) return null

  const title = titleMatch[1].trim()
  let summary = contentMatch[1].trim()

  // Convert any H1 tags to H2
  summary = summary.replace(/<h1(\s|>)/gi, '<h2$1')
  summary = summary.replace(/<\/h1>/gi, '</h2>')

  const imageKeywords = keywordsMatch ? keywordsMatch[1].trim() : null

  return { title, summary, imageKeywords }
}
