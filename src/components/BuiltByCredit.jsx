import panel from './panel/Panel.module.css'
import s from './BuiltByCredit.module.css'
import { SITE_RUNS_NOTE, SITE_RUNS_SHORT } from './panel/siteRunsNote.js'

/**
 * "EarthAtlas is built by KnauerNever.com" — on every EarthAtlas subsite. Pages with a
 * left panel get it via SourcesFooter; this is for the rest:
 *   variant="panel"   inside a dark panel (same look as SourcesFooter's credit)
 *   variant="light"   at the foot of a light document page (species, news)
 *   variant="corner"  a small label pinned bottom-left over a full-screen map
 * aiNote (default true) adds "No AI runs on this site." (full statement on hover); false on pages that show
 * AI-written text (/news articles).
 */
export default function BuiltByCredit({ variant = 'panel', className = '', aiNote = true }) {
  const cls = variant === 'panel' ? panel.builtBy : variant === 'light' ? s.light : s.corner
  const link = variant === 'panel' ? panel.builtByLink : s.link
  return (
    <div className={`${cls} ${className}`}>
      EarthAtlas is built by{' '}
      <a href="https://knauernever.com" target="_blank" rel="noopener noreferrer" className={link}>KnauerNever.com</a>
      {aiNote && <> · <span title={SITE_RUNS_NOTE.body}>{SITE_RUNS_SHORT}</span></>}
    </div>
  )
}
