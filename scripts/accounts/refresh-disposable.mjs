/**
 * Refresh the throwaway-email blocklist used at sign-up (lib/accounts/data/disposable-domains.txt,
 * read by lib/accounts/guard.js) from github.com/disposable-email-domains (CC0).
 *
 *   node scripts/accounts/refresh-disposable.mjs           # show what would change
 *   node scripts/accounts/refresh-disposable.mjs --write   # update the file (then commit it)
 *
 * One download. Refuses an update that would shrink the list by more than 20% (a broken download).
 * Domains we must never block (our own, common providers) are kept out whatever the list says.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = 'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf'
const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../lib/accounts/data/disposable-domains.txt')
const NEVER_BLOCK = new Set(['earthatlas.org', 'knauernever.com', 'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com'])

const parse = (t) => new Set(t.split('\n').map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith('#')))
const current = parse(readFileSync(FILE, 'utf8'))
const r = await fetch(SRC, { headers: { 'User-Agent': 'earthatlas-accounts' } })
if (!r.ok) { console.error(`download failed: ${r.status}`); process.exit(1) }
const next = parse(await r.text())
for (const d of NEVER_BLOCK) next.delete(d)
const added = [...next].filter((d) => !current.has(d)), removed = [...current].filter((d) => !next.has(d))
console.log(`now ${current.size} domains → ${next.size} (+${added.length} / −${removed.length})`)
if (added.length) console.log('added e.g.:', added.slice(0, 10).join(', '))
if (removed.length) console.log('removed e.g.:', removed.slice(0, 10).join(', '))
if (next.size < current.size * 0.8) { console.error('refusing: the new list is more than 20% smaller'); process.exit(1) }
if (process.argv.includes('--write')) {
  writeFileSync(FILE, [...next].sort().join('\n') + '\n')
  console.log(`wrote ${FILE}`)
}
