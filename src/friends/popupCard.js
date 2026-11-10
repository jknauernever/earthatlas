/**
 * The popup card for Friends of the San Juans layers (/shoreline, /permits), in EarthAtlas's own popup frame (the white
 * card in src/index.css, Mapbox's own ×). It replaces Salish Sea Explorer's cream `.ssx` frame (Josh 2026-11-02,
 * docs/SHORELINE_PORT_PLAN.md decision 4) and keeps every one of its slots, so the content is SSE's unchanged:
 *
 *   photo album (‹ › when more than one) · layer eyebrow (swatch in the layer's map color) · title · subtitle · chips ·
 *   key numbers · lead (custom HTML) · "why it matters" (Friends' words, cited) · "what you can do" (with its button) ·
 *   body (related Friends articles) · all-details table · footer: source credit, Friends logo, buttons
 *
 * Styles: ./popupCard.css (global, because popup HTML is a string). Markup only; installPopupCardHandlers() wires the
 * album, the details toggle and image fallbacks through one document-level listener.
 */
import './popupCard.css'

export const FRIENDS_LOGO_SRC = '/hpa/friends-logo.png'
export const FRIENDS_SITE = 'https://sanjuans.org/our-work/shoreline-science-and-mapping/'

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
// Escape text, then turn bare URLs into links that open in a new tab
export function linkifyText(value) {
  return escapeHtml(value).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
}

/** A small swatch: 'line' | 'fill' | 'point' (a dot), in the layer's color; or `icon` (an image URL) for a pin layer. */
export function swatchHtml(kind, accent, fill, icon) {
  if (icon) return `<img class="fp-sw-icon" src="${escapeHtml(icon)}" alt="">`
  if (kind === 'fill') return `<span class="fp-sw fp-sw-fill" style="background:${escapeHtml(fill ?? accent)};box-shadow:inset 0 0 0 1.5px ${escapeHtml(accent)}"></span>`
  if (kind === 'point') return `<span class="fp-sw fp-sw-pt" style="background:${escapeHtml(accent)}"></span>`
  return `<span class="fp-sw fp-sw-line" style="background:${escapeHtml(accent)}"></span>`
}

function photoHtml(photos) {
  const slides = photos.map((p, i) => {
    const cap = p.caption || p.credit
      ? `<div class="fp-cap">${p.caption ? escapeHtml(p.caption) : ''}${p.caption && p.credit ? ' · ' : ''}${p.credit ? `<i>${p.creditHref ? `<a href="${escapeHtml(p.creditHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.credit)}</a>` : escapeHtml(p.credit)}</i>` : ''}</div>` : ''
    return `<div class="fp-slide"${i === 0 ? '' : ' hidden'}><img src="${escapeHtml(p.url)}" alt=""${i < 2 ? '' : ' loading="lazy"'} data-fp-onerror="${i === 0 ? 'hide-photo' : 'remove-slide'}">${cap}</div>`
  }).join('')
  const album = photos.length > 1
    ? `<button type="button" class="fp-arrow fp-prev" data-fp-album="prev" aria-label="Previous photo">&#8249;</button>
       <button type="button" class="fp-arrow fp-next" data-fp-album="next" aria-label="Next photo">&#8250;</button>
       <span class="fp-count"><b>1</b> / ${photos.length}</span>` : ''
  return `<div class="fp-photo" data-popup-photo>${slides}${album}</div>`
}

function blockHtml(cls, b) {
  const btn = b.button ? `<a class="fp-btn" href="${escapeHtml(b.button.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(b.button.label)}</a>` : ''
  const cite = b.source ? `<div class="fp-cite">&mdash; <a href="${escapeHtml(b.source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(b.source.credit)}</a></div>` : ''
  return `<div class="fp-block ${cls}"><div class="fp-k">${escapeHtml(b.kicker)}</div><div class="fp-text">${b.html}</div>${cite}${btn}</div>`
}

/**
 * o: { accent, layerName, swatch ('line'|'fill'|'point'), swatchColor, swatchIcon, title, subtitle,
 *      photos [{url, caption, credit}], stats [{value, unit, label}], chips [{label, tone: 'warn'|'teal'|'on'}], lead (trusted),
 *      story / action {kicker, html (trusted), button {label, href}, source {credit, url}}, body (trusted),
 *      fields [{label, value}], detailsOpen, detailsExpanded (keep the "All details" toggle but start it open), source {credit, url}, friends (bool: show the Friends logo), footerButtons }
 */
export function buildPopupCard(o) {
  const photos = o.photos?.filter((p) => !!p?.url) ?? []
  const stats = o.stats?.filter((s) => s.value) ?? []
  const chips = o.chips ?? []
  const fields = o.fields ?? []
  const toggle = !o.detailsOpen && fields.length > 6
  const expanded = toggle && !!o.detailsExpanded
  const statsHtml = stats.length
    ? `<div class="fp-stats">${stats.map((s) => `<div class="fp-stat"><div class="fp-v${s.value.length > 7 ? ' fp-v-text' : ''}">${escapeHtml(s.value)}${s.unit ? `<small>${escapeHtml(s.unit)}</small>` : ''}</div><div class="fp-l">${escapeHtml(s.label)}</div></div>`).join('')}</div>` : ''
  const chipsHtml = chips.length
    ? `<div class="fp-chips">${chips.map((c) => `<span class="fp-chip${c.tone && c.tone !== 'default' ? ` fp-chip-${c.tone}` : ''}">${escapeHtml(c.label)}</span>`).join('')}</div>` : ''
  const table = fields.length
    ? `<table class="fp-table"${toggle && !expanded ? ' hidden' : ''}>${fields.map((f) => `<tr><td>${escapeHtml(f.label)}</td><td>${linkifyText(f.value)}</td></tr>`).join('')}</table>` : ''
  const details = fields.length
    ? `<div class="fp-details">${toggle ? `<button type="button" class="fp-tg${expanded ? ' open' : ''}" data-fp-details aria-expanded="${expanded}"><span>All details</span><span>${fields.length} fields <i class="fp-caret"></i></span></button>` : '<div class="fp-k">Details</div>'}${table}</div>` : ''
  const src = o.source?.credit || o.source?.url
    ? `<div class="fp-src">Source: ${o.source.url ? `<a href="${escapeHtml(o.source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(o.source.credit || 'View the dataset')} &#8599;</a>` : escapeHtml(o.source.credit)}</div>` : '<div class="fp-src"></div>'
  // Friends data always carries the Friends logo
  const logo = o.friends ? `<a class="fp-friends" href="${FRIENDS_SITE}" target="_blank" rel="noopener noreferrer"><img src="${FRIENDS_LOGO_SRC}" alt="Friends of the San Juans"></a>` : ''
  const btns = o.footerButtons?.length
    ? `<div class="fp-foot-btns">${o.footerButtons.map((b) => `<a class="fp-btn fp-btn-quiet" href="${escapeHtml(b.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(b.label)}</a>`).join('')}</div>` : ''
  return `<div class="fp" style="--accent:${escapeHtml(o.accent || '#0e7490')}">
    ${photos.length ? photoHtml(photos) : ''}
    <div class="fp-body">
      <div class="fp-layer">${swatchHtml(o.swatch, o.accent, o.swatchColor, o.swatchIcon)}<span>${escapeHtml(o.layerName)}</span></div>
      <div class="fp-title">${escapeHtml(o.title)}</div>
      ${o.subtitle ? `<div class="fp-sub">${escapeHtml(o.subtitle)}</div>` : ''}
      ${chipsHtml}${statsHtml}
      ${o.lead ? `<div class="fp-lead">${o.lead}</div>` : ''}
      ${o.story ? blockHtml('fp-story', o.story) : ''}
      ${o.action ? blockHtml('fp-act', o.action) : ''}
      ${o.body ?? ''}
      ${details}
      <div class="fp-foot">${src}${logo}</div>
      ${btns}
    </div>
  </div>`
}

/**
 * "What's here": several things under one click. rows: [{ swatch (trusted HTML), layerName, title, titleHtml? }];
 * each row is a button with data-fp-pick="<index>" (the host opens rows[index]).
 */
export function buildChooserCard(rows) {
  const body = `<div class="fp-picks">${rows.map((r, i) => `
    <button type="button" class="fp-pick" data-fp-pick="${i}">
      <span class="fp-pick-sw">${r.swatch}</span>
      <span class="fp-pick-body"><span class="fp-pick-layer">${escapeHtml(r.layerName)}</span><span class="fp-pick-title">${r.titleHtml ?? escapeHtml(r.title)}</span></span>
      <span class="fp-pick-go">&#8250;</span>
    </button>`).join('')}</div>`
  return `<div class="fp fp-chooser"><div class="fp-body">
    <div class="fp-layer"><span>What’s here</span></div>
    <div class="fp-title">${rows.length} things at this spot</div>
    <div class="fp-sub">Choose one to open</div>
    ${body}
  </div></div>`
}

let installed = false
/** One delegated listener for every card on the page: album arrows, the details toggle, image fallbacks. Idempotent. */
export function installPopupCardHandlers() {
  if (installed || typeof document === 'undefined') return
  installed = true
  document.addEventListener('click', (e) => {
    const t = e.target
    if (!t?.closest) return
    const arrow = t.closest('[data-fp-album]')
    if (arrow) {
      e.preventDefault(); e.stopPropagation()
      const photo = arrow.closest('.fp-photo')
      const slides = Array.from(photo?.querySelectorAll('.fp-slide') || [])
      if (!slides.length) return
      const cur = slides.findIndex((s) => !s.hidden), next = (cur + (arrow.dataset.fpAlbum === 'next' ? 1 : -1) + slides.length) % slides.length
      slides.forEach((s, i) => { s.hidden = i !== next })
      const n = photo.querySelector('.fp-count b')
      if (n) n.textContent = String(next + 1)
      return
    }
    const tg = t.closest('[data-fp-details]')
    if (tg) {
      e.preventDefault()
      const table = tg.parentElement?.querySelector('.fp-table')
      if (!table) return
      table.hidden = !table.hidden
      tg.setAttribute('aria-expanded', String(!table.hidden))
      tg.classList.toggle('open', !table.hidden)
    }
  })
  // `error` doesn't bubble: capture phase
  document.addEventListener('error', (e) => {
    const img = e.target
    if (!(img instanceof HTMLImageElement)) return
    const mode = img.getAttribute('data-fp-onerror')
    if (mode === 'hide-photo') img.closest('.fp-photo')?.setAttribute('hidden', '')
    else if (mode === 'remove-slide') img.closest('.fp-slide')?.remove()
    else if (mode === 'remove') img.remove()
  }, true)
}
