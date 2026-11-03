import { brand } from '../lib/brand.js'
import s from './PoweredBy.module.css'

/**
 * "Powered by EarthAtlas" — shown above the KnauerNever credit on white-label hosts only (lib/brand.js).
 * onLight for light document pages (dark text). always: show it on every host (a partner's own tool, e.g. /shoreline).
 */
export default function PoweredBy({ onLight = false, always = false }) {
  if (!brand && !always) return null
  return (
    <div className={`${s.row} ${onLight ? s.onLight : ''}`}>
      Powered by{' '}
      <a href="https://earthatlas.org" target="_blank" rel="noopener noreferrer" className={s.mark}>Earth<em>Atlas</em></a>
    </div>
  )
}
