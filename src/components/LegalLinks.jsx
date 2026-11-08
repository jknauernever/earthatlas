import { ACCOUNTS_LIVE } from '../accounts/live.js'

/**
 * " · Privacy · Terms · Contact" — follows "EarthAtlas is built by KnauerNever.com" on every subsite
 * (BuiltByCredit, SourcesFooter and the hand-written credits), so the policies and contact form are one
 * click from any page. `linkClassName` = the credit's own link style.
 */
export default function LegalLinks({ linkClassName = '' }) {
  if (!ACCOUNTS_LIVE) return null // hidden until the accounts launch (src/accounts/live.js)
  return (
    <>
      {' · '}<a href="/privacy" className={linkClassName}>Privacy</a>
      {' · '}<a href="/terms" className={linkClassName}>Terms</a>
      {' · '}<a href="/contact" className={linkClassName}>Contact</a>
    </>
  )
}
