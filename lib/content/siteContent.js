/**
 * Site content an admin edits on a map page's left panel (docs/SITE_CONTENT_ADMIN.md): the order, names, info text,
 * colors, icons and zooms of its categories / datasets / legend classes, removing and restoring them, and default
 * popup images per dataset. Tables: content.nav_node + content.media (lib/accounts/sql/004_site_content.sql).
 *
 * Reads are public (the panel needs them; nothing here is private). Writes need an unlocked admin
 * (lib/accounts/admin.js requireUnlocked) and land in the audit log. The page owns the tree (its code defaults);
 * this stores only what an admin changed, so a node id the page no longer has is simply ignored.
 */
import { put } from '@vercel/blob'
import { randomUUID } from 'node:crypto'
import { usersPool } from '../accounts/auth.js'
import { AdminError, requireUnlocked } from '../accounts/admin.js'
import { audit, requestIp } from '../accounts/audit.js'

const q = (sql, params = []) => usersPool().query(sql, params).then((r) => r.rows)

const SITE_RE = /^[a-z0-9-]{1,40}$/
const NODE_RE = /^[a-z0-9-]{1,40}(\/[a-z0-9-]{1,40}){0,2}$/
const COLOR_RE = /^#[0-9a-fA-F]{6}$/
const GLYPH_RE = /^[a-z][a-z0-9-]{0,29}$/
const STYLE_COLORS = ['color', 'line', 'fill', 'pinColor']

const bad = (msg) => new AdminError(400, msg, 'INVALID')
function site(v) { if (!SITE_RE.test(String(v || ''))) throw bad('Unknown site.'); return v }
function node(v) { if (!NODE_RE.test(String(v || ''))) throw bad('Unknown item.'); return v }
function text(v, max, label) {
  if (v == null) return null
  const s = String(v).replace(/\s+/g, (m) => (m.includes('\n') ? '\n' : ' ')).trim()
  if (s.length > max) throw bad(`${label} is too long (${max} characters max).`)
  return s || null
}
function cleanStyle(style) {
  const out = {}
  for (const [k, v] of Object.entries(style || {})) {
    if (v == null || v === '') continue
    if (STYLE_COLORS.includes(k)) { if (!COLOR_RE.test(v)) throw bad('Colors must look like #1a2b3c.'); out[k] = v.toLowerCase() }
    else if (k === 'glyph') { if (!GLYPH_RE.test(v)) throw bad('Unknown icon.'); out[k] = v }
    else if (k === 'autoPhotos') out[k] = !!v
    else throw bad(`Unknown style setting "${k}".`)
  }
  return out
}
function zoom(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 22) throw bad('Zoom must be between 0 and 22.')
  return Math.round(n * 10) / 10
}
function httpsUrl(v) {
  if (v == null || v === '') return null
  let u
  try { u = new URL(String(v)) } catch { throw bad('The credit link must be a full web address.') }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw bad('The credit link must be a web address.')
  return u.toString().slice(0, 500)
}

/** Public: everything stored for a site. Removed media is left out; removed nodes come back flagged. */
export async function siteContent(siteId) {
  site(siteId)
  const [nodes, media] = await Promise.all([
    q(`SELECT node_id AS id, position, name, info, style, min_zoom AS "minZoom", removed_at AS "removedAt", updated_at AS "updatedAt"
       FROM content.nav_node WHERE site = $1`, [siteId]),
    q(`SELECT id, node_id AS "nodeId", record_id AS "recordId", url, width, height, caption, credit, credit_href AS "creditHref", position
       FROM content.media WHERE site = $1 AND removed_at IS NULL ORDER BY node_id, record_id NULLS FIRST, position, id`, [siteId]),
  ])
  return { site: siteId, nodes, media }
}

/** Admin: removed media too (the "Removed images" lists). */
async function removedMedia(siteId) {
  return q(`SELECT id, node_id AS "nodeId", record_id AS "recordId", url, caption, credit, credit_href AS "creditHref", removed_at AS "removedAt"
            FROM content.media WHERE site = $1 AND removed_at IS NOT NULL ORDER BY removed_at DESC LIMIT 200`, [siteId])
}

async function upsertNode(siteId, nodeId, cols, actor) {
  const keys = Object.keys(cols)
  const sets = keys.map((k, i) => `${k} = $${i + 4}`).join(', ')
  await q(`INSERT INTO content.nav_node (site, node_id, updated_by, ${keys.join(', ')}) VALUES ($1, $2, $3, ${keys.map((_, i) => `$${i + 4}`).join(', ')})
           ON CONFLICT (site, node_id) DO UPDATE SET ${sets}, updated_at = now(), updated_by = $3`,
  [siteId, nodeId, actor, ...keys.map((k) => (k === 'style' ? JSON.stringify(cols[k]) : cols[k]))])
}

/**
 * Admin writes. body.site always; then per action:
 *   edit     { node, name?, info?, style?, minZoom? }   (a key left out is unchanged; null clears it back to default)
 *   reset    { node }                                   (back to code defaults; keeps its place and removed state)
 *   order    { ids: [...] }                             (siblings in their new order)
 *   remove   { node } · restore { node }
 *   mediaEdit { id, caption, credit, creditHref } · mediaOrder { ids } · mediaRemove { id } · mediaRestore { id }
 */
export async function contentAction(headers, action, body = {}) {
  const s = await requireUnlocked(headers)
  const actor = s.user.id, ip = requestIp(headers), siteId = site(body.site)
  const log = (details) => audit({ actorId: actor, action: `content.${action}`, targetId: `${siteId}:${details.node ?? details.media ?? ''}`, ip, details: { site: siteId, ...details } })

  if (action === 'edit') {
    const id = node(body.node), cols = {}
    if ('name' in body) cols.name = text(body.name, 80, 'The name')
    if ('info' in body) cols.info = text(body.info, 2000, 'The text')
    if ('minZoom' in body) cols.min_zoom = zoom(body.minZoom)
    if ('style' in body) {
      const [cur] = await q('SELECT style FROM content.nav_node WHERE site = $1 AND node_id = $2', [siteId, id])
      const merged = { ...(cur?.style || {}) }
      for (const [k, v] of Object.entries(body.style || {})) { if (v == null || v === '') delete merged[k]; else merged[k] = v }
      cols.style = cleanStyle(merged)
    }
    if (!Object.keys(cols).length) throw bad('Nothing to change.')
    await upsertNode(siteId, id, cols, actor)
    await log({ node: id, changed: Object.keys(cols), ...cols })
  } else if (action === 'reset') {
    const id = node(body.node)
    await q(`UPDATE content.nav_node SET name = NULL, info = NULL, style = '{}'::jsonb, min_zoom = NULL, updated_at = now(), updated_by = $3
             WHERE site = $1 AND node_id = $2`, [siteId, id, actor])
    await log({ node: id })
  } else if (action === 'order') {
    const ids = Array.isArray(body.ids) ? body.ids.map(node) : []
    if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length) throw bad('Bad order.')
    const client = await usersPool().connect()
    try {
      await client.query('BEGIN')
      for (const [i, id] of ids.entries()) {
        await client.query(`INSERT INTO content.nav_node (site, node_id, position, updated_by) VALUES ($1, $2, $3, $4)
                            ON CONFLICT (site, node_id) DO UPDATE SET position = $3, updated_at = now(), updated_by = $4`, [siteId, id, i, actor])
      }
      await client.query('COMMIT')
    } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
    await log({ node: ids.join(','), order: ids })
  } else if (action === 'remove' || action === 'restore') {
    const id = node(body.node)
    if (action === 'remove') await upsertNode(siteId, id, { removed_at: new Date(), removed_by: actor }, actor)
    else await q('UPDATE content.nav_node SET removed_at = NULL, removed_by = NULL, updated_at = now(), updated_by = $3 WHERE site = $1 AND node_id = $2', [siteId, id, actor])
    await log({ node: id })
  } else if (action === 'mediaEdit') {
    const id = Number(body.id)
    const caption = text(body.caption, 300, 'The caption'), credit = text(body.credit, 200, 'The credit')
    if (!caption || !credit) throw bad('Every image needs a caption and a credit.')
    const n = await q('UPDATE content.media SET caption = $3, credit = $4, credit_href = $5 WHERE site = $1 AND id = $2 RETURNING id', [siteId, id, caption, credit, httpsUrl(body.creditHref)])
    if (!n.length) throw bad('No such image.')
    await log({ media: id, caption, credit })
  } else if (action === 'mediaOrder') {
    const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isInteger) : []
    if (!ids.length || ids.length > 50) throw bad('Bad order.')
    for (const [i, id] of ids.entries()) await q('UPDATE content.media SET position = $3 WHERE site = $1 AND id = $2', [siteId, id, i])
    await log({ media: ids.join(','), order: ids })
  } else if (action === 'mediaRemove' || action === 'mediaRestore') {
    const id = Number(body.id)
    const n = action === 'mediaRemove'
      ? await q('UPDATE content.media SET removed_at = now(), removed_by = $3 WHERE site = $1 AND id = $2 RETURNING id', [siteId, id, actor])
      : await q('UPDATE content.media SET removed_at = NULL, removed_by = NULL WHERE site = $1 AND id = $2 RETURNING id', [siteId, id])
    if (!n.length) throw bad('No such image.')
    await log({ media: id })
  } else {
    throw bad('Unknown action.')
  }
  return { ...(await siteContent(siteId)), removedMedia: await removedMedia(siteId) }
}

/** Admin read: what the public sees plus removed images. */
export async function adminSiteContent(headers, siteId) {
  await requireUnlocked(headers)
  return { ...(await siteContent(siteId)), removedMedia: await removedMedia(site(siteId)) }
}

// WebP / JPEG / PNG by their first bytes (the browser resizes to WebP before upload; the others are accepted too)
function imageType(buf) {
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return ['webp', 'image/webp']
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ['jpg', 'image/jpeg']
  if (buf.toString('hex', 0, 8) === '89504e470d0a1a0a') return ['png', 'image/png']
  return null
}

/**
 * Admin: add a popup image. The body is the image bytes (≤ 4 MB, already resized in the browser); the rest comes
 * in the query: site, node, recordId (optional), caption, credit, creditHref, width, height.
 */
export async function uploadMedia(headers, params, buf) {
  const s = await requireUnlocked(headers)
  const siteId = site(params.get('site')), nodeId = node(params.get('node'))
  const recordId = text(params.get('recordId'), 120, 'The record id')
  const caption = text(params.get('caption'), 300, 'The caption'), credit = text(params.get('credit'), 200, 'The credit')
  if (!caption || !credit) throw bad('Every image needs a caption and a credit.')
  const creditHref = httpsUrl(params.get('creditHref'))
  if (!buf?.length || buf.length > 4 * 1024 * 1024) throw bad('Images must be under 4 MB.')
  const type = imageType(buf)
  if (!type) throw bad('Use a JPEG, PNG or WebP image.')
  const dim = (k) => { const n = Number(params.get(k)); return Number.isInteger(n) && n > 0 && n < 20000 ? n : null }
  const blob = await put(`site-content/${siteId}/${nodeId.replace(/\//g, '_')}/${randomUUID()}.${type[0]}`, buf,
    { access: 'public', addRandomSuffix: false, contentType: type[1], cacheControlMaxAge: 31536000 })
  const [{ next }] = await q(`SELECT coalesce(max(position) + 1, 0) AS next FROM content.media WHERE site = $1 AND node_id = $2 AND record_id IS NOT DISTINCT FROM $3`, [siteId, nodeId, recordId])
  const [row] = await q(`INSERT INTO content.media (site, node_id, record_id, url, width, height, caption, credit, credit_href, position, created_by)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
  [siteId, nodeId, recordId, blob.url, dim('width'), dim('height'), caption, credit, creditHref, next, s.user.id])
  await audit({ actorId: s.user.id, action: 'content.mediaAdd', targetId: `${siteId}:${row.id}`, ip: requestIp(headers), details: { site: siteId, node: nodeId, recordId, url: blob.url, caption, credit } })
  return { ...(await siteContent(siteId)), removedMedia: await removedMedia(siteId) }
}
