/**
 * Admin-edited panel content for a map page (docs/SITE_CONTENT_ADMIN.md; server: lib/content/siteContent.js).
 *
 * A page describes its left panel as a tree of nodes, each with code defaults:
 *   { id, name, info?, source?: [href, label], style?: { color, line, fill, pinColor, glyph }, minZoom?, dataset?,
 *     kind?: 'item' | 'class', children? }
 * resolveTree() lays the stored overrides over those defaults: names, text, colors, icon, zoom, order, removed.
 * Everything falls back to the defaults when the content can't be read, so the page never depends on it.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

const PUBLIC = '/api/auth/ea/content'
const ADMIN = '/api/auth/ea/admin'
const HINT = 'ea.admin'   // this browser has seen an admin signed in (only decides whether to ask; the server decides)

async function json(r) {
  const j = await r.json().catch(() => ({}))
  if (!r.ok) { const e = new Error(j.message || 'Something went wrong. Please try again.'); e.code = j.code; e.status = r.status; throw e }
  return j
}

export const fetchSiteContent = (site) => fetch(`${PUBLIC}?site=${encodeURIComponent(site)}`).then(json)

const post = (sub, body, headers = { 'content-type': 'application/json' }) =>
  fetch(`${ADMIN}/${sub}`, { method: 'POST', credentials: 'same-origin', headers, body: typeof body === 'string' || body instanceof Blob ? body : JSON.stringify(body) }).then(json)

function readHint() { try { return localStorage.getItem(HINT) === '1' } catch { return false } }
function writeHint(on) { try { on ? localStorage.setItem(HINT, '1') : localStorage.removeItem(HINT) } catch { /* private mode */ } }
/** The admin pages call this when they see an admin, so map pages know to offer editing. */
export const rememberAdmin = (on) => writeHint(on)

/**
 * A page's content plus, for admins, the editing tools.
 *   content       { nodes, media } as stored (null until loaded; {} if it could not load)
 *   ready         true once loaded, failed or timed out (pages wait for it before drawing, to avoid a flash)
 *   admin         { state } ('signed-out' | 'not-admin' | 'needs-2fa' | 'locked' | 'unlocked'), or null for visitors
 *   act(action, body), upload(file, fields), unlock(code), refresh()
 */
export function useSiteContent(site, { waitMs = 1500 } = {}) {
  const [content, setContent] = useState(null)
  const [ready, setReady] = useState(false)
  const [admin, setAdmin] = useState(null)
  const siteRef = useRef(site)

  useEffect(() => {
    let live = true
    const t = setTimeout(() => live && setReady(true), waitMs)
    fetchSiteContent(site).then((c) => { if (live) { setContent(c); setReady(true) } })
      .catch(() => { if (live) { setContent({ nodes: [], media: [] }); setReady(true) } })
    return () => { live = false; clearTimeout(t) }
  }, [site, waitMs])

  const loadAdmin = useCallback(async () => {
    const st = await fetch(`${ADMIN}/status`, { credentials: 'same-origin' }).then(json).catch(() => null)
    const isAdmin = st && ['locked', 'unlocked', 'needs-2fa'].includes(st.state)
    writeHint(!!isAdmin)
    setAdmin(isAdmin ? st : null)
    // Admins read fresh (no CDN copy), with removed images
    if (st?.state === 'unlocked') setContent(await fetch(`${ADMIN}/content?site=${encodeURIComponent(siteRef.current)}`, { credentials: 'same-origin' }).then(json))
  }, [])

  // Only browsers that have seen an admin (or ?edit in the URL) ask the server; visitors never do
  useEffect(() => {
    if (readHint() || new URLSearchParams(window.location.search).has('edit')) loadAdmin()
  }, [loadAdmin])

  const act = useCallback(async (action, body = {}) => {
    const c = await post('content-action', { site: siteRef.current, action, ...body })
    setContent(c)
    return c
  }, [])
  const upload = useCallback(async (file, fields) => {
    const img = await resizeImage(file)
    const qs = new URLSearchParams({ site: siteRef.current, ...fields, width: img.width, height: img.height })
    for (const [k, v] of [...qs]) if (v === '' || v == null || v === 'undefined') qs.delete(k)
    const c = await post(`content-upload?${qs}`, img.blob, { 'content-type': img.blob.type })
    setContent(c)
    return c
  }, [])
  const unlock = useCallback(async (code) => { await post('unlock', { code }); await loadAdmin() }, [loadAdmin])

  return { content, ready, admin, act, upload, unlock, refresh: loadAdmin }
}

/** Shrink an image in the browser to at most `max` px on its long side, as WebP (keeps uploads small and EXIF-free). */
export async function resizeImage(file, max = 1600) {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k)
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  c.getContext('2d').drawImage(bmp, 0, 0, w, h)
  bmp.close?.()
  const blob = await new Promise((res) => c.toBlob(res, 'image/webp', 0.85))
  if (!blob) throw new Error('This browser could not read that image.')
  return { blob, width: w, height: h }
}

/**
 * Lay stored overrides over a page's default tree. Returns
 *   { roots, byId, removed }  where each node is { ...defaults, name, info, style, minZoom, removed, parent, children,
 *   edited (bool), media [...] } and `roots` / `children` hold only the nodes still shown, in their order.
 *   removed lists every removed node (any level), newest first.
 */
export function resolveTree(defaults, content) {
  const stored = new Map((content?.nodes || []).map((n) => [n.id, n]))
  const media = content?.media || []
  const byId = {}
  const removed = []
  const build = (list, parent) => {
    const all = list.map((d, i) => {
      const s = stored.get(d.id) || {}
      const node = {
        ...d,
        parent,
        defaults: d,
        name: s.name || d.name,
        info: s.info ?? d.info,
        style: { ...(d.style || {}), ...(s.style || {}) },
        minZoom: s.minZoom ?? d.minZoom ?? parent?.minZoom ?? null,
        removed: !!s.removedAt,
        removedAt: s.removedAt || null,
        edited: !!(s.name || s.info || s.minZoom != null || Object.keys(s.style || {}).length),
        media: media.filter((m) => m.nodeId === d.id && !m.recordId),
        order: s.position ?? null,
        index: i,
      }
      byId[d.id] = node
      node.children = d.children ? build(d.children, node) : null
      node.allChildren = d.children ? node._all : null
      if (node.removed) removed.push(node)
      return node
    })
    all.sort((a, b) => (a.order ?? a.index) - (b.order ?? b.index) || a.index - b.index)
    if (parent) parent._all = all
    return all.filter((n) => !n.removed)
  }
  const roots = build(defaults, null)
  removed.sort((a, b) => String(b.removedAt).localeCompare(String(a.removedAt)))
  return { roots, byId, removed }
}

/** Every leaf (toggleable dataset id) under a node, removed ones included when `withRemoved`. */
export function leavesOf(node, withRemoved = false) {
  if (node.kind === 'class') return []
  const kids = (withRemoved ? node.allChildren : node.children)?.filter((c) => c.kind !== 'class')
  if (kids?.length) return kids.flatMap((c) => leavesOf(c, withRemoved))
  return node.leaf ? [node.leaf] : []
}
