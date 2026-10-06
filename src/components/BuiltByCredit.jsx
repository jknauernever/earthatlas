import panel from './panel/Panel.module.css'
import s from './BuiltByCredit.module.css'

/**
 * "EarthAtlas is built by KnauerNever.com" — on every EarthAtlas subsite. Pages with a
 * left panel get it via SourcesFooter; this is for the rest:
 *   variant="panel"   inside a dark panel (same look as SourcesFooter's credit)
 *   variant="light"   at the foot of a light document page (species, news)
 *   variant="corner"  a small label pinned bottom-left over a full-screen map
 */
export default function BuiltByCredit({ variant = 'panel', className = '' }) {
  const cls = variant === 'panel' ? panel.builtBy : variant === 'light' ? s.light : s.corner
  const link = variant === 'panel' ? panel.builtByLink : s.link
  return (
    <div className={`${cls} ${className}`}>
      EarthAtlas is built by{' '}
      <a href="https://knauernever.com" target="_blank" rel="noopener noreferrer" className={link}>KnauerNever.com</a>
    </div>
  )
}
