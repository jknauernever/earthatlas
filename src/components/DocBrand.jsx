import { brand } from '../lib/brand.js'
import s from './DocBrand.module.css'

/**
 * The top-line brand on report / document pages. With no white-label brand it renders its child — the page's
 * own "EarthAtlas <span>Tool</span>" link — untouched. On a brand host (lib/brand.js) it shows the partner's
 * logo beside their site title with the tool's name beneath it, like SiteBrand's chip on the map sites.
 *
 *   tool   the tool's name under the title, e.g. "Ships"
 *   href   the tool's home, e.g. "/ships"
 *   dark   page has a dark background (white logo, light text)
 */
export default function DocBrand({ tool, href, dark = false, children }) {
  if (!brand) return children
  return (
    <span className={`${s.row} ${dark ? s.dark : ''}`}>
      <a href={brand.href} target="_blank" rel="noopener noreferrer" className={s.logoLink}>
        <img src={dark ? brand.logo.dark : brand.logo.light} alt={brand.logoAlt} className={s.logo} />
      </a>
      <a href={href} className={s.stack} style={dark ? undefined : { '--brand-accent': brand.accent }}>
        <span className={s.title}>{brand.title}</span>
        <span className={s.tool}>{tool}</span>
      </a>
    </span>
  )
}
