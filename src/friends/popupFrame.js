/**
 * The Salish Sea Explorer popup frame (`.ssx-*`), ported verbatim from salish-sea-propmapper
 * src/components/Map/popupFrame.ts so Friends of the San Juans layers look the same on EarthAtlas as on SSE.
 *
 * Slots, top to bottom: photo (album with ‹ › arrows when there is more than one), header (layer eyebrow in the
 * layer's map color, title, subtitle), chips, key numbers, "why it matters" story block, "what you can do" action
 * block, an optional custom body, the all-details table, and a footer with source credit and quiet actions.
 *
 * Styling is in ./ssx.css. This module only builds markup (no DOM needed, so it also runs in node) and wires the few
 * interactions through one document-level handler, because popup content is plain HTML re-created on every open.
 */

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Escape text, then turn bare URLs into links that open in a new tab
export function linkifyText(value) {
  const escaped = escapeHtml(value)
  return escaped.replace(
    /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>',
  )
}

function swatchHtml(kind, accent, fill) {
  if (kind === 'fill') {
    return `<span class="ssx-sw ssx-sw-fill" style="background:${escapeHtml(fill ?? accent)};border-color:${escapeHtml(accent)}"></span>`
  }
  if (kind === 'point') return `<span class="ssx-sw ssx-sw-pt"></span>`
  return `<span class="ssx-sw"></span>`
}

function photoHtml(photos) {
  const slides = photos
    .map((p, i) => {
      const cap = p.caption || p.credit
        ? `<div class="ssx-cap">${p.caption ? escapeHtml(p.caption) : ''}${p.caption && p.credit ? ' · ' : ''}${p.credit ? `<i>${escapeHtml(p.credit)}</i>` : ''}</div>`
        : ''
      return `<div class="ssx-slide"${i === 0 ? '' : ' hidden'}>
        <img src="${escapeHtml(p.url)}" alt=""${i < 2 ? '' : ' loading="lazy"'} data-ssx-onerror="${i === 0 ? 'hide-photo' : 'remove-slide'}">
        ${cap}
      </div>`
    })
    .join('')
  const album = photos.length > 1
    ? `<button type="button" class="ssx-arrow ssx-prev" data-ssx-album="prev" aria-label="Previous photo">&#8249;</button>
       <button type="button" class="ssx-arrow ssx-next" data-ssx-album="next" aria-label="Next photo">&#8250;</button>
       <span class="ssx-count"><b>1</b> / ${photos.length}</span>`
    : ''
  return `<div class="ssx-photo">${slides}${album}</div>`
}

function blockHtml(cls, b) {
  const btn = b.button
    ? `<div class="ssx-btn-row"><a class="ssx-btn-sun" href="${escapeHtml(b.button.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(b.button.label)}</a></div>`
    : ''
  const cite = b.source
    ? `<div class="ssx-cite">&mdash; <a href="${escapeHtml(b.source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(b.source.credit)}</a></div>`
    : ''
  return `<div class="ssx-block ${cls}"><div class="ssx-k">${escapeHtml(b.kicker)}</div>${b.html}${cite}${btn}</div>`
}

/**
 * o: { id, accent, layerName, swatch ('line'|'fill'|'point'), swatchColor, title, titleId, subtitle,
 *      photos [{url, caption, credit}], stats [{value, unit, label}], chips [{label, tone}], chipsId, lead,
 *      story / action {kicker, html (trusted), button {label, href}, source {credit, url}}, body (trusted HTML),
 *      fields [{label, value}], detailsOpen, source {credit, url}, footerButtons [{label, href, action}], width }
 */
export function buildPopupFrame(o) {
  const photos = o.photos?.filter((p) => !!p.url) ?? []
  const stats = o.stats?.filter((s) => s.value) ?? []
  const chips = o.chips ?? []
  const fields = o.fields ?? []
  const showToggle = !o.detailsOpen && fields.length > 6

  const statsHtml = stats.length
    ? `<div class="ssx-stats">${stats
        .map((s) => `<div class="ssx-stat"><div class="ssx-v${s.value.length > 7 ? ' ssx-v-text' : ''}">${escapeHtml(s.value)}${s.unit ? `<small>${escapeHtml(s.unit)}</small>` : ''}</div><div class="ssx-l">${escapeHtml(s.label)}</div></div>`)
        .join('')}</div>`
    : ''

  const chipsHtml = chips.length || o.chipsId
    ? `<div class="ssx-chips"${o.chipsId ? ` id="${escapeHtml(o.chipsId)}"` : ''}${!chips.length ? ' hidden' : ''}>${chips
        .map((c) => `<span class="ssx-chip${c.tone && c.tone !== 'default' ? ` ssx-chip-${c.tone}` : ''}">${escapeHtml(c.label)}</span>`)
        .join('')}</div>`
    : ''

  const table = fields.length
    ? `<table class="ssx-table"${showToggle ? ' hidden' : ''}>${fields
        .map((f) => `<tr><td>${escapeHtml(f.label)}</td><td>${linkifyText(f.value)}</td></tr>`)
        .join('')}</table>`
    : ''
  const detailsHtml = fields.length
    ? `<div class="ssx-details">${showToggle
        ? `<button type="button" class="ssx-tg" data-ssx-details aria-expanded="false"><span>All details</span><span>${fields.length} fields <i class="ssx-caret">&#9662;</i></span></button>`
        : ''}${table}</div>`
    : ''

  const src = o.source && (o.source.credit || o.source.url)
    ? `<div class="ssx-src">Source: ${o.source.url
        ? `<a href="${escapeHtml(o.source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(o.source.credit || 'View the dataset')} &#8599;</a>`
        : escapeHtml(o.source.credit)}</div>`
    : '<div class="ssx-src"></div>'
  const btns = o.footerButtons?.length
    ? `<div class="ssx-btns">${o.footerButtons
        .map((b) => b.href
          ? `<a class="ssx-btn" href="${escapeHtml(b.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(b.label)}</a>`
          : `<button type="button" class="ssx-btn"${b.action ? ` data-ssx-action="${escapeHtml(b.action)}"` : ''}>${escapeHtml(b.label)}</button>`)
        .join('')}</div>`
    : ''

  return `<div class="ssx" id="${escapeHtml(o.id)}" style="--accent:${escapeHtml(o.accent)};${o.width ? `width:${o.width}px;` : ''}">
    <div class="ssx-edge"></div>
    <div class="ssx-xwrap"><button type="button" class="ssx-x" data-ssx-close aria-label="Close">&times;</button></div>
    ${photos.length ? photoHtml(photos) : ''}
    <div class="ssx-head">
      <div class="ssx-layer">${swatchHtml(o.swatch, o.accent, o.swatchColor)}${escapeHtml(o.layerName)}</div>
      <div class="ssx-ttl"${o.titleId ? ` id="${escapeHtml(o.titleId)}"` : ''}>${escapeHtml(o.title)}</div>
      ${o.subtitle ? `<div class="ssx-sub">${escapeHtml(o.subtitle)}</div>` : ''}
    </div>
    ${chipsHtml}
    ${statsHtml}
    ${o.lead ? `<div style="margin:0 18px 12px;">${o.lead}</div>` : ''}
    ${o.story ? blockHtml('ssx-story', o.story) : ''}
    ${o.action ? blockHtml('ssx-act', o.action) : ''}
    ${o.body ?? ''}
    ${detailsHtml}
    <div class="ssx-foot">${src}${btns}</div>
  </div>`
}

// Fired on `window` when the frame's own close button is pressed; the host closes its Mapbox popup on it.
export const POPUP_CLOSE_EVENT = 'ssx-popup-close'

// SSE loads Montserrat in its index.html. A <link> injected once from here (rather than an @import in ssx.css)
// keeps working whatever order Vite concatenates the CSS bundles in — an @import after other rules is ignored.
const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap'
function loadFont() {
  if (document.querySelector(`link[href="${FONT_HREF}"]`)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = FONT_HREF
  document.head.appendChild(link)
}

let handlersInstalled = false

/**
 * One delegated click handler for every frame on the page (album arrows, the details toggle, the close button),
 * plus SSE's image-fallback listener (it lives in SSE's FeaturePopup.tsx; folded in here so the module stands
 * alone). Safe to call more than once.
 */
export function installPopupFrameHandlers() {
  if (handlersInstalled || typeof document === 'undefined') return
  handlersInstalled = true
  loadFont()

  document.addEventListener('click', (e) => {
    const target = e.target
    if (!target?.closest) return

    const arrow = target.closest('[data-ssx-album]')
    if (arrow) {
      e.preventDefault()
      e.stopPropagation()
      const photo = arrow.closest('.ssx-photo')
      if (!photo) return
      const slides = Array.from(photo.querySelectorAll('.ssx-slide'))
      const current = slides.findIndex((s) => !s.hidden)
      const dir = arrow.dataset.ssxAlbum === 'next' ? 1 : -1
      const next = (current + dir + slides.length) % slides.length
      slides.forEach((s, i) => { s.hidden = i !== next })
      const count = photo.querySelector('.ssx-count b')
      if (count) count.textContent = String(next + 1)
      return
    }

    const toggle = target.closest('[data-ssx-details]')
    if (toggle) {
      e.preventDefault()
      const table = toggle.parentElement?.querySelector('.ssx-table')
      if (!table) return
      table.hidden = !table.hidden
      toggle.setAttribute('aria-expanded', String(!table.hidden))
      toggle.classList.toggle('open', !table.hidden)
      return
    }

    if (target.closest('[data-ssx-close]')) {
      e.preventDefault()
      e.stopPropagation()
      window.dispatchEvent(new Event(POPUP_CLOSE_EVENT))
    }
  })

  // `error` doesn't bubble, so listen in the capture phase. No inline onerror (SSE's CSP forbids them).
  document.addEventListener('error', (e) => {
    const img = e.target
    if (!(img instanceof HTMLImageElement)) return
    const mode = img.getAttribute('data-ssx-onerror')
    if (mode === 'hide-photo') img.closest('.ssx-photo')?.setAttribute('hidden', '')
    else if (mode === 'remove-slide') img.closest('.ssx-slide')?.remove()
    else if (mode === 'remove') img.remove()
  }, true)
}
