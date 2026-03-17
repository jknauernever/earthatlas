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
