import { brand } from '../lib/brand.js'
import s from './SiteBrand.module.css'

/**
 * The upper-left chip on every map site: "EarthAtlas | <tool>" — or, on a white-label host
 * (lib/brand.js), the partner's logo beside their site title with the tool's name beneath it.
 *
 *   styles    the site's CSS module (its .branding / .brandingLink / .wordmark, unchanged)
 *   children  the tool badge, e.g. <span className={q.subBadge}>Sea-Level Rise Risks</span>
 *   wholeLink true where the whole chip is one link home (/live, /live-local)
 */
export default function SiteBrand({ styles, children, wholeLink = false }) {
  if (!brand) {
    const mark = <span className={styles.wordmark}>Earth<em>Atlas</em></span>
    return wholeLink
      ? <a href="/" className={styles.branding}>{mark}{children}</a>
      : (
        <div className={styles.branding}>
          <a className={styles.brandingLink} href="/" aria-label="EarthAtlas home">{mark}</a>
          {children}
        </div>
      )
  }
  const light = brand.chip === 'light'
  return (
    <div className={`${styles.branding} ${s.chip} ${light ? s.light : ''}`} style={light ? { '--brand-accent': brand.accent } : undefined}>
      <a href={brand.href} target="_blank" rel="noopener noreferrer" className={s.logoLink}>
        <img src={light ? brand.logo.light : brand.logo.dark} alt={brand.logoAlt} className={s.logo} />
      </a>
      <span className={s.stack}>
        <a href="/" className={s.title}>{brand.title}</a>
        <span className={s.tool}>{children}</span>
      </span>
    </div>
  )
}
