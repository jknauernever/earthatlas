/**
 * Invite someone from the command line (until /admin/users exists).
 *
 *   node --env-file=.env.local scripts/accounts/invite.mjs <email> [--name "Full Name"] [--admin] [--origin http://localhost:5173]
 *
 * .env.local → the dev database; on localhost without RESEND_API_KEY the email is printed, not sent.
 */
import { inviteUser } from '../../lib/accounts/invite.js'
import { usersPool } from '../../lib/accounts/auth.js'

const args = process.argv.slice(2)
const email = args.find((a) => !a.startsWith('--') && a.includes('@'))
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }
if (!email) { console.error('usage: invite.mjs <email> [--name "Name"] [--admin] [--origin URL]'); process.exit(1) }
try {
  const r = await inviteUser({ email, name: opt('--name') || '', role: args.includes('--admin') ? 'admin' : 'user', origin: opt('--origin') || 'https://earthatlas.org' })
  console.log(`${r.created ? 'invited' : 're-invited'} ${r.user.email} (${r.user.role || 'user'}); link expires in 7 days`)
} catch (e) {
  console.error(`invite failed: ${e.message}`); process.exitCode = 1
} finally {
  await usersPool().end()
}
