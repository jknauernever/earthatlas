/**
 * /privacy and /terms — EarthAtlas Privacy Policy and Terms of Use.
 * DRAFT (2026-11-05): written from what the site actually does (docs/USER_ACCOUNTS_PLAN.md); needs Josh's
 * review (and ideally a lawyer's) before launch. Items marked <Todo> are facts only Josh can supply.
 * Keep in step with the code: if a vendor, cookie or data field changes, update the matching section.
 */
import { useEffect } from 'react'
import BuiltByCredit from '../components/BuiltByCredit.jsx'
import s from './AccountPages.module.css'

const EFFECTIVE = 'DRAFT — not yet in effect'
// eslint-disable-next-line no-unused-vars -- kept for future placeholders
const Todo = ({ children }) => <mark className={s.todo}>[TO CONFIRM: {children}]</mark>
const OPERATOR = <a href="https://knauernever.com">KnauerNever</a>
const CONTACT = <a href="/contact">our contact form</a>

function Legal({ title, children }) {
  useEffect(() => { document.title = `${title} · EarthAtlas` }, [title])
  return (
    <main className={s.page}>
      <article className={`${s.card} ${s.legal}`}>
        <div className={s.topRow}><a href="/" className={s.brand}>EarthAtlas</a><span className={s.meta}><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/contact">Contact</a></span></div>
        <h1 className={s.title}>{title}</h1>
        <p className={s.meta}>Effective: {EFFECTIVE}</p>
        {children}
      </article>
      <div className={`${s.credit} ${s.creditLegal}`}><BuiltByCredit variant="light" /></div>
    </main>
  )
}

export function PrivacyPage() {
  return (
    <Legal title="Privacy Policy">
      <p>EarthAtlas (earthatlas.org and its subdomains) is a non-commercial conservation project run by {OPERATOR}. This policy explains what we collect, why, and what you can do about it. Questions: use {CONTACT}.</p>

      <h2>The short version</h2>
      <ul>
        <li>You don't need an account to use EarthAtlas.</li>
        <li>We don't sell your information, show ads, or share it with anyone except the service providers that run the site (listed below).</li>
        <li>If you have an account, you can see, download and delete what we store about you on <a href="/account">Your account</a>.</li>
      </ul>

      <h2>When you use the site</h2>
      <ul>
        <li><strong>Usage analytics.</strong> Google Analytics, PostHog and Vercel Web Analytics record which pages you view, how you use the maps and tools, your browser and device type, and an approximate location worked out from your IP address. We use this to see what's useful and what's broken.</li>
        <li><strong>Error reports.</strong> When something breaks, Sentry receives a report of the error, the page, your browser, and sometimes a short replay of the screen leading up to it.</li>
        <li><strong>Server logs.</strong> Our host, Vercel, logs requests (including IP address) to run and protect the site.</li>
        <li><strong>Maps and data.</strong> Your browser loads map imagery from Mapbox, and some tools fetch data directly from public sources such as iNaturalist, GBIF and eBird. Those services see your IP address, as with any website.</li>
        <li><strong>Link previews.</strong> When you view a map at a particular place or setting, a picture of that map view may be saved so a shared link can show a preview. It contains only the map image, never information about you.</li>
      </ul>

      <h2>If you have an account</h2>
      <p>Accounts are invitation-only for now. For an account we store:</p>
      <ul>
        <li>your email address and name, and a profile photo if you add one (or link Google, which supplies your Google profile photo; you can remove it);</li>
        <li>your password, only as a one-way scrambled form (a hash) that can't be turned back into the password;</li>
        <li>the ways you sign in: a linked Google account's ID, and for passkeys only the public half of the key;</li>
        <li>if you turn on two-step verification, its secret key and backup codes, stored encrypted;</li>
        <li>the devices you're signed in on (browser, operating system, IP address, when you signed in);</li>
        <li>a security log of sign-ins and account changes (for example a password change or a removed sign-in method), with the time and IP address, so we and you can spot misuse.</li>
      </ul>
      <p>To protect accounts we also use:</p>
      <ul>
        <li><strong>Cloudflare Turnstile</strong>, a bot check on the sign-up, sign-in and password forms, which looks at signals from your browser to tell people from bots;</li>
        <li><strong>Have I Been Pwned</strong>, to refuse passwords that have appeared in known data breaches. Only the first five characters of a scrambled form of the password are sent, never the password itself;</li>
        <li><strong>Resend</strong>, which delivers our account emails (confirmation, password reset, security notices).</li>
      </ul>
      <p>Account, admin and contact pages don't send your clicks or what you type to analytics or error reporting, and the one-time codes in email links are removed from anything we report.</p>

      <h2>If you contact us</h2>
      <p>The <a href="/contact">contact form</a> sends us your name, email address, topic and message, along with your IP address. We use them only to read and answer you, and to keep the form free of spam: the form uses the same bot check as accounts, and messages that look automated are set aside instead of delivered. We never send anything to the address you enter except our answer. Messages are kept for up to a year; ones set aside as spam are deleted after 90 days at most.</p>

      <h2>Service providers</h2>
      <p>These companies process data for us, only to provide their service: Vercel (hosting), Neon (account database, in the United States), Resend (email), Cloudflare (bot check), Google (sign-in, Google Analytics, web fonts), PostHog (analytics), Sentry (error reports), Mapbox (maps), Have I Been Pwned (breached-password check). We may also disclose information if the law requires it.</p>

      <h2>Cookies and similar storage</h2>
      <ul>
        <li><strong>Sign-in cookies</strong> keep you signed in. They're required for accounts to work.</li>
        <li><strong>Analytics cookies</strong> from Google Analytics and PostHog tell repeat visits apart.</li>
        <li>Your browser's local storage keeps some map and tool settings on your device.</li>
      </ul>

      <h2>How long we keep it</h2>
      <ul>
        <li>Account information: until you delete your account (or we do, see the Terms).</li>
        <li>Sign-ups that are never confirmed: deleted after 7 days.</li>
        <li>Signed-in devices: each sign-in expires after 30 days without use, or when you sign out.</li>
        <li>The security log is kept after an account is deleted, including the account's email address, so misuse can still be investigated. It's visible only to EarthAtlas administrators.</li>
        <li>Analytics and error data: as long as each provider's retention settings allow.</li>
      </ul>

      <h2>Your choices</h2>
      <ul>
        <li>On <a href="/account">Your account</a> you can change your name, photo, email and password, see and sign out your devices, download your data, and delete your account.</li>
        <li>You can block analytics cookies in your browser or with a content blocker; the site still works.</li>
        <li>For anything else, including a copy or correction of your data, use {CONTACT}.</li>
      </ul>

      <h2>Children</h2>
      <p>Accounts are for people 13 or older. If we learn an account belongs to someone younger, we delete it.</p>

      <h2>Changes</h2>
      <p>If we change this policy, we'll update the date above, and email account holders about significant changes.</p>
    </Legal>
  )
}

export function TermsPage() {
  return (
    <Legal title="Terms of Use">
      <p>These terms cover your use of EarthAtlas (earthatlas.org and its subdomains), run by {OPERATOR}. By using the site you agree to them. Our <a href="/privacy">Privacy Policy</a> explains how we handle your information.</p>

      <h2>What EarthAtlas is</h2>
      <p>EarthAtlas is a free, non-commercial conservation project that maps public data about wildlife, ecosystems, climate, ships and more. Most of the data comes from other organizations; every value links to its source.</p>

      <h2>Use of the data</h2>
      <ul>
        <li>Data shown on EarthAtlas belongs to its sources and comes under their own licenses, which are credited and linked where the data appears. Some allow only non-commercial use. If you reuse data, follow the source's license.</li>
        <li>The data can be incomplete, delayed or wrong, and maps and estimates are approximations. Don't rely on EarthAtlas for navigation, safety, emergency, legal or financial decisions; check the original source.</li>
      </ul>

      <h2>Accounts</h2>
      <ul>
        <li>Accounts are invitation-only for now. You must be 13 or older.</li>
        <li>Give accurate information, keep your sign-in details to yourself, and tell us if you think someone else is using your account.</li>
        <li>One account per person. Accounts can't be shared, sold or transferred.</li>
        <li>You can delete your account at any time on <a href="/account">Your account</a>.</li>
        <li>We may suspend or delete an account that breaks these terms or puts the site or other people at risk.</li>
      </ul>

      <h2>Don't</h2>
      <ul>
        <li>attack, overload or try to break into the site or its accounts, or get around its security or limits;</li>
        <li>create accounts automatically or in bulk, or use someone else's account;</li>
        <li>scrape or download data in ways that slow the site for others (use the original sources, linked on every page);</li>
        <li>use the site to break the law or anyone's rights.</li>
      </ul>

      <h2>No warranty</h2>
      <p>EarthAtlas is provided "as is" and "as available", without warranties of any kind, express or implied. We don't promise it will be accurate, complete, uninterrupted or error-free.</p>

      <h2>Limitation of liability</h2>
      <p>To the fullest extent the law allows, {OPERATOR} is not liable for any indirect, incidental, special, consequential or punitive damages, or any loss of data, use or profits, arising from your use of EarthAtlas.</p>

      <h2>Changes</h2>
      <p>We may change the site or these terms. If we change the terms, we'll update the date above and email account holders about significant changes. Using the site after a change means you accept it.</p>

      <h2>Law</h2>
      <p>These terms are governed by the laws of the State of Washington, USA, without regard to its conflict-of-law rules.</p>

      <h2>Contact</h2>
      <p>Questions about these terms: use {CONTACT}.</p>
    </Legal>
  )
}
