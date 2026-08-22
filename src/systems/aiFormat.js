/**
 * Render the narrator's lightly-marked text as safe HTML.
 *
 * The model is asked for a tiny, strict format: optional "## Header" lines,
 * blank-line paragraph breaks, and **bold** phrases — nothing else. Everything
 * is HTML-escaped first, so no model output can inject markup. Old cached
 * answers (one long paragraph, no markers) are split into readable paragraphs
 * at sentence boundaries so they don't look worse than new ones.
 *
 * Tolerant of partial input (the Explain card types the text out), so an
 * unclosed ** or a header mid-word renders sensibly until the rest arrives.
 */

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function inline(s) {
  let out = esc(s)
  // Paired **bold**; a dangling opener (still typing) is shown as-is.
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  return out
}

// Split one long paragraph into 2–3 readable ones (legacy/cached answers).
function autoParagraphs(text) {
  const sentences = text.match(/[^.!?]+[.!?]+(\s+|$)/g) || [text]
  if (sentences.length < 4) return [text]
  const per = Math.ceil(sentences.length / Math.min(3, Math.ceil(sentences.length / 2)))
  const paras = []
  for (let i = 0; i < sentences.length; i += per) paras.push(sentences.slice(i, i + per).join('').trim())
  return paras
}

/** @param {string} text  @param {{ headers?: boolean }} [opts] */
export function formatAiText(text, opts = {}) {
  if (!text) return ''
  const hasMarkers = /(^|\n)##\s|\n\s*\n/.test(text)
  const blocks = hasMarkers
    ? text.split(/\n\s*\n/)
    : autoParagraphs(text.trim())
  const html = []
  for (const raw of blocks) {
    const block = raw.trim()
    if (!block) continue
    const lines = block.split('\n')
    for (const line of lines) {
      const l = line.trim()
      if (!l) continue
      const h = /^##\s*(.*)$/.exec(l)
      if (h) {
        if (opts.headers !== false) html.push(`<h4 class="ai-h">${inline(h[1].replace(/\*\*/g, ''))}</h4>`)
        continue
      }
      html.push(`<p class="ai-p">${inline(l)}</p>`)
    }
  }
  return html.join('')
}
