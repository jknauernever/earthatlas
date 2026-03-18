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

  const prompt = `You are a strict classifier for EarthAtlas.org, a wildlife news site. Your job is to determine if a news article is SPECIFICALLY about one or more of the species categories below. Most articles will NOT match any category — that is expected and correct.

Categories:
${categoryLines}

Article Title: ${title}

Article Content:
${content}

STRICT MATCHING RULES:
1. The article must SPECIFICALLY NAME or be PRIMARILY ABOUT the actual species in a category (or closely related species). The species must be a central subject of the article, not a passing mention.
2. General biology, ecology, or environmental articles do NOT match unless they specifically discuss one of the listed species. For example:
   - An article about "marine ecosystems" does NOT match sharks, whales, or dolphins unless it specifically discusses those animals
   - An article about "insect populations" does NOT match butterflies unless it specifically discusses butterflies or moths
   - An article about "African wildlife" does NOT match unless it names specific listed species
   - An article about "forest ecology" does NOT match any category
   - An article about "ocean warming" does NOT match any category
3. Do NOT match based on: habitat overlap, food chain connections, general taxonomy, or the fact that an article is vaguely related to nature/wildlife
4. When in doubt, return NONE. It is far better to miss a match than to make a false match.

Return ONLY a comma-separated list of matching category slugs, or NONE.

Examples:
- "Monarch Butterfly Populations Decline 20% This Winter" → butterflies
- "Great White Shark Tracked Across Atlantic" → sharks
- "New Study Shows How Coral Reefs Support Marine Life" → NONE (no specific species named)
- "African Savanna Faces Drought" → NONE (too general)
- "Gorilla Conservation Efforts in Congo" → monkeys
- "Ocean Temperatures Hit Record High" → NONE
- "Wolves and Bears Compete for Salmon in Yellowstone" → wolves, bears
- "Scientists Discover New Deep-Sea Species" → NONE
- "Bird Flu Spreads to Wild Eagle Populations" → birds, condors

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
