/**
 * Account emails, sent through Resend (https://resend.com/docs/api-reference/emails/send-email)
 * from accounts@earthatlas.org. earthatlas.org receives no mail (no MX), so every email says
 * replies aren't read.
 *
 * Without RESEND_API_KEY (localhost) nothing is sent: the email, including its link, is printed
 * to the server console instead. On Vercel a missing key is an error, never a silent skip.
 */

export const FROM = 'EarthAtlas <accounts@earthatlas.org>'
const SITE = 'https://earthatlas.org'

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function layout({ heading, paragraphs, button, footer }) {
  const p = paragraphs.map((t) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#1f2a24">${esc(t)}</p>`).join('')
  const b = button
    ? `<p style="margin:24px 0"><a href="${esc(button.url)}" style="display:inline-block;background:#1f6f4a;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:6px;font-size:16px">${esc(button.label)}</a></p>
       <p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#5b6660">If the button doesn't work, copy this link into your browser:<br><span style="word-break:break-all">${esc(button.url)}</span></p>`
    : ''
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f6f5">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f5;padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:8px;padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<tr><td>
<p style="margin:0 0 24px;font-size:20px;font-weight:700;color:#1f6f4a">EarthAtlas</p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#1f2a24">${esc(heading)}</h1>
${p}${b}
<p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#5b6660">${esc(footer || "If you didn't expect this email, you can ignore it.")} This mailbox doesn't receive replies.</p>
<p style="margin:8px 0 0;font-size:13px;color:#5b6660"><a href="${SITE}" style="color:#1f6f4a">earthatlas.org</a></p>
</td></tr></table></td></tr></table></body></html>`
  const text = [
    heading, '', ...paragraphs.flatMap((t) => [t, '']),
    ...(button ? [`${button.label}: ${button.url}`, ''] : []),
    `${footer || "If you didn't expect this email, you can ignore it."} This mailbox doesn't receive replies.`,
    SITE,
  ].join('\n')
  return { html, text }
}

const TEMPLATES = {
  verify: ({ url }) => ({
    subject: 'Confirm your email for EarthAtlas',
    ...layout({ heading: 'Confirm your email', paragraphs: ['Click the button below to confirm your email address and finish setting up your EarthAtlas account. The link works once and expires in 24 hours.'], button: { label: 'Confirm email', url } }),
  }),
  reset: ({ url }) => ({
    subject: 'Reset your EarthAtlas password',
    ...layout({ heading: 'Reset your password', paragraphs: ['Someone asked to reset the password for this EarthAtlas account. If it was you, click below to choose a new one. The link works once and expires in 1 hour.'], button: { label: 'Choose a new password', url }, footer: "If you didn't ask for this, ignore this email; your password won't change." }),
  }),
  invite: ({ url, name }) => ({
    subject: "You're invited to EarthAtlas",
    ...layout({ heading: name ? `Welcome to EarthAtlas, ${name}` : 'Welcome to EarthAtlas', paragraphs: ["You've been invited to create an EarthAtlas account. Click below to set your password, or sign in with Google using this same email address. The link works once and expires in 7 days."], button: { label: 'Set up my account', url } }),
  }),
  passwordChanged: () => ({
    subject: 'Your EarthAtlas password was changed',
    ...layout({ heading: 'Your password was changed', paragraphs: ['The password for your EarthAtlas account was just changed, and you were signed out on your other devices.', "If this wasn't you, reset your password right away."], button: { label: 'Reset password', url: `${SITE}/account/forgot` }, footer: 'You are getting this because it affects your account security.' }),
  }),
  changeEmailApprove: ({ url, newEmail }) => ({
    subject: 'Approve changing your EarthAtlas email',
    ...layout({ heading: 'Approve your new email address', paragraphs: [`Someone signed in to your EarthAtlas account asked to change its email address to ${newEmail}.`, 'If it was you, click below to approve. We will then send a confirmation link to the new address, and the change happens once that is clicked. The link expires in 24 hours.'], button: { label: 'Approve the change', url }, footer: "If you didn't ask for this, don't click the link, and reset your password." }),
  }),
  deleteConfirm: ({ url }) => ({
    subject: 'Confirm deleting your EarthAtlas account',
    ...layout({ heading: 'Confirm account deletion', paragraphs: ['You asked to delete your EarthAtlas account. Clicking below permanently deletes it and everything stored with it. This cannot be undone.', 'You must be signed in on the device where you open the link. It expires in 1 hour.'], button: { label: 'Delete my account', url }, footer: "If you didn't ask for this, ignore this email and reset your password; nothing will be deleted." }),
  }),
  accountDeleted: () => ({
    subject: 'Your EarthAtlas account was deleted',
    ...layout({ heading: 'Your account was deleted', paragraphs: ['Your EarthAtlas account and the information stored with it have been permanently deleted. Thanks for being part of EarthAtlas.'], footer: 'This is the last email you will get about this account.' }),
  }),
  emailChangedByAdmin: ({ newEmail }) => notice('Your email address was changed', `An EarthAtlas administrator changed the email address on your account to ${newEmail}. Sign-in emails will go there from now on.`),
  twoFactorOff: () => notice('Two-step verification was turned off', 'Two-step verification was just turned off for your EarthAtlas account. Signing in now needs only your password.'),
  passkeyAdded: () => notice('A passkey was added', 'A new passkey was just added to your EarthAtlas account. It can be used to sign in without a password.'),
  passkeyRemoved: () => notice('A passkey was removed', 'A passkey was just removed from your EarthAtlas account.'),
  signinRemoved: () => notice('A sign-in method was removed', 'A sign-in method (such as Google) was just removed from your EarthAtlas account.'),
  signupAttemptExisting: () => ({
    subject: 'Someone tried to sign up with your email',
    ...layout({ heading: 'You already have an account', paragraphs: ['Someone tried to create a new EarthAtlas account with this email address. You already have one, so nothing was changed.', 'If it was you, sign in or reset your password.'], button: { label: 'Sign in', url: `${SITE}/account/signin` } }),
  }),
}

function notice(heading, what) {
  return {
    subject: `EarthAtlas security notice: ${heading.toLowerCase()}`,
    ...layout({ heading, paragraphs: [what, "If this wasn't you, reset your password right away and review your account."], button: { label: 'Review my account', url: `${SITE}/account` }, footer: 'You are getting this because it affects your account security.' }),
  }
}

export function renderEmail(kind, data = {}) {
  const t = TEMPLATES[kind]
  if (!t) throw new Error(`unknown email template: ${kind}`)
  return t(data)
}

/** Send one account email. `kind` is a TEMPLATES key; `data` its fields (url, name). */
export async function sendAccountEmail(to, kind, data = {}) {
  const { subject, html, text } = renderEmail(kind, data)
  const key = process.env.RESEND_API_KEY
  if (!key) {
    if (process.env.VERCEL) throw new Error('RESEND_API_KEY not set')
    console.log(`\n[accounts email → ${to}] ${subject}\n${text}\n`)
    return { id: 'dev-console' }
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
  })
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}
