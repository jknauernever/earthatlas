/**
 * Copy a site's admin panel edits (content.nav_node + content.media, docs/SITE_CONTENT_ADMIN.md) from the DEV users
 * database to PRODUCTION. One-time / occasional; dry run unless --apply.
 *
 *   PROD_USERS_DATABASE_URL='<prod connection string>' node --env-file=.env.local scripts/content/copy-to-prod.mjs --site shoreline
 *   PROD_USERS_DATABASE_URL='<prod connection string>' node --env-file=.env.local scripts/content/copy-to-prod.mjs --site shoreline --apply
 *
 * Reads dev from USERS_DATABASE_URL (.env.local = earthatlas-users-dev). Prod needs the content tables first:
 *   USERS_DATABASE_URL='<prod connection string>' node --env-file=.env.local scripts/accounts/migrate.mjs --apply
 *
 * - Panel nodes: each dev row replaces the prod row for the same node (dev wins), removed ones included.
 * - Images: added when prod has no image with the same URL (the files are already on the shared Blob store, so
 *   nothing is re-uploaded); an image already in prod gets dev's caption, credit, order and removed state.
 * - Who changed it: matched by email to the same person's prod account (blank if they have none there).
 * - Writes one audit-log row in prod (content.copyFromDev). Running it twice changes nothing the second time.
 */
import pg from 'pg'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const site = args[args.indexOf('--site') + 1]
if (!/^[a-z0-9-]{1,40}$/.test(site || '')) { console.error('Pass --site <name>, e.g. --site shoreline'); process.exit(1) }
const devUrl = process.env.USERS_DATABASE_URL, prodUrl = process.env.PROD_USERS_DATABASE_URL
if (!devUrl || !prodUrl) { console.error('Need USERS_DATABASE_URL (dev, from .env.local) and PROD_USERS_DATABASE_URL (prod).'); process.exit(1) }
const host = (u) => new URL(u).hostname.split('.')[0]
// Testing only: --same-db-test --to-site <scratch> copies into another site name on the same (dev) database
const sameDbTest = args.includes('--same-db-test')
const toSite = sameDbTest && args.includes('--to-site') ? args[args.indexOf('--to-site') + 1] : site
if (host(devUrl) === host(prodUrl) && !sameDbTest) { console.error(`Dev and prod are the same database (${host(devUrl)}). Stopping.`); process.exit(1) }
if (!/^[a-z0-9-]{1,40}$/.test(toSite || '')) { console.error('Bad --to-site'); process.exit(1) }

const dev = new pg.Pool({ connectionString: devUrl, max: 2 })
const prod = new pg.Pool({ connectionString: prodUrl, max: 2 })
const q = (pool, sql, p = []) => pool.query(sql, p).then((r) => r.rows)

try {
  const [{ t }] = await q(prod, `SELECT to_regclass('content.nav_node') AS t`)
  if (!t) throw new Error(`Prod (${host(prodUrl)}) has no content tables yet. Run scripts/accounts/migrate.mjs --apply against prod first.`)

  const nodes = await q(dev, 'SELECT * FROM content.nav_node WHERE site = $1 ORDER BY node_id', [site])
  const media = await q(dev, 'SELECT * FROM content.media WHERE site = $1 ORDER BY node_id, position, id', [site])
  const prodMedia = new Map((await q(prod, 'SELECT id, url FROM content.media WHERE site = $1', [toSite])).map((m) => [m.url, m.id]))

  // Dev account ids → prod account ids, by email
  const devIds = [...new Set([...nodes.flatMap((n) => [n.updated_by, n.removed_by]), ...media.flatMap((m) => [m.created_by, m.removed_by])].filter(Boolean))]
  const emails = devIds.length ? await q(dev, 'SELECT id, email FROM auth."user" WHERE id = ANY($1)', [devIds]) : []
  const prodUsers = emails.length ? await q(prod, 'SELECT id, email FROM auth."user" WHERE email = ANY($1)', [emails.map((e) => e.email)]) : []
  const idMap = new Map(emails.map((e) => [e.id, prodUsers.find((p) => p.email === e.email)?.id || null]))
  const who = (id) => (id ? idMap.get(id) ?? null : null)
  const actor = prodUsers.find((p) => p.email === 'jknauer@gmail.com')?.id || prodUsers[0]?.id || null

  console.log(`[${site}${toSite !== site ? ` → ${toSite}` : ''}] dev ${host(devUrl)} → prod ${host(prodUrl)}${apply ? '' : '   (dry run)'}`)
  console.log(`\nPanel edits (${nodes.length}):`)
  for (const n of nodes) {
    const what = [n.position != null && `position ${n.position}`, n.name && `name "${n.name}"`, n.info && 'text', Object.keys(n.style || {}).length && `style ${JSON.stringify(n.style)}`,
      n.min_zoom != null && `zoom ${n.min_zoom}`, n.removed_at && 'REMOVED'].filter(Boolean).join(', ')
    console.log(`  ${n.node_id}: ${what || '(back to defaults)'}`)
  }
  const fresh = media.filter((m) => !prodMedia.has(m.url))
  console.log(`\nImages (${media.length}; ${fresh.length} new to prod, ${media.length - fresh.length} already there):`)
  for (const m of media) console.log(`  ${prodMedia.has(m.url) ? 'update' : 'add   '} ${m.node_id}${m.record_id ? `#${m.record_id}` : ''} #${m.position} "${m.caption}" — ${m.credit}${m.removed_at ? ' (removed)' : ''}`)

  if (!apply) { console.log('\nDry run: nothing written. Add --apply to copy.'); process.exit(0) }

  const c = await prod.connect()
  try {
    await c.query('BEGIN')
    for (const n of nodes) {
      await c.query(`INSERT INTO content.nav_node (site, node_id, position, name, info, style, min_zoom, removed_at, removed_by, updated_at, updated_by)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                     ON CONFLICT (site, node_id) DO UPDATE SET position = $3, name = $4, info = $5, style = $6, min_zoom = $7,
                       removed_at = $8, removed_by = $9, updated_at = $10, updated_by = $11`,
      [toSite, n.node_id, n.position, n.name, n.info, JSON.stringify(n.style || {}), n.min_zoom, n.removed_at, who(n.removed_by), n.updated_at, who(n.updated_by)])
    }
    for (const m of media) {
      if (prodMedia.has(m.url)) {
        await c.query(`UPDATE content.media SET node_id = $2, record_id = $3, caption = $4, credit = $5, credit_href = $6, position = $7, removed_at = $8, removed_by = $9, width = $10, height = $11
                       WHERE id = $1`, [prodMedia.get(m.url), m.node_id, m.record_id, m.caption, m.credit, m.credit_href, m.position, m.removed_at, who(m.removed_by), m.width, m.height])
      } else {
        await c.query(`INSERT INTO content.media (site, node_id, record_id, url, width, height, caption, credit, credit_href, position, created_at, created_by, removed_at, removed_by)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [toSite, m.node_id, m.record_id, m.url, m.width, m.height, m.caption, m.credit, m.credit_href, m.position, m.created_at, who(m.created_by), m.removed_at, who(m.removed_by)])
      }
    }
    await c.query(`INSERT INTO auth.audit_log (actor_id, action, target_id, details) VALUES ($1, 'content.copyFromDev', $2, $3)`,
      [actor, `${toSite}:`, JSON.stringify({ site: toSite, from: host(devUrl), nodes: nodes.length, imagesAdded: fresh.length, imagesUpdated: media.length - fresh.length })])
    await c.query('COMMIT')
  } catch (e) { await c.query('ROLLBACK'); throw e } finally { c.release() }
  console.log(`\nCopied: ${nodes.length} panel edits, ${fresh.length} images added, ${media.length - fresh.length} updated. Visitors see it within about a minute once the code is live.`)
} catch (e) {
  console.error(`\n${e.message}`)
  process.exitCode = 1
} finally {
  await dev.end(); await prod.end()
}
