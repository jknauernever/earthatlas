import StoryMap, { MAP_CREDIT } from '../StoryMap.jsx'
import s from './SplitLayout.module.css'

/**
 * Split layout (docs/design/stories-split): the chapter's photo on the left half, the live map on the right, a gold
 * seam between with the stat on it. Display only: everything shown comes from the assembled story (src/stories/content.js).
 *
 *   story, index    the story and the current chapter
 *   go(i)           change chapter
 *   playing, togglePlay
 *   reducedMotion
 *   fullMapHref     "Open the full map" link (the subsite's explorer, this host, this chapter's layers and camera)
 *   onCamera        the map reports its camera here
 */
const KEY_SWATCH = (k) => ({ background: k.color, boxShadow: k.glow ? `0 0 8px ${k.glow}` : undefined })

export default function SplitLayout({ story, index, go, playing, togglePlay, reducedMotion, fullMapHref, onCamera, look }) {
  const ch = story.chapters[index]
  const last = story.chapters.length - 1
  const keyItems = story.key.map((id) => look?.layers[id]?.key).filter(Boolean)

  return (
    <div className={s.stage}>
      <div className={s.photoPane}>
        {story.chapters.map((c, i) => (
          <img key={c.id} src={c.photo.src} alt={i === index ? c.photo.alt : ''} aria-hidden={i === index ? undefined : true}
            className={`${s.photo} ${i === index ? s.now : ''}`} style={{ objectPosition: `${c.photo.focalPoint.x}% ${c.photo.focalPoint.y}%` }} />
        ))}
        <div className={s.photoShade} aria-hidden="true" />
      </div>

      <div className={s.mapPane}>
        <StoryMap subsite={story.subsite} layerIds={story.key} view={ch.view} reducedMotion={reducedMotion} onCamera={onCamera} />
        <div className={s.mapShade} aria-hidden="true" />
        <a className={s.credit} href={MAP_CREDIT.href} target="_blank" rel="noopener noreferrer">Satellite: {MAP_CREDIT.text}</a>
      </div>

      <div className={s.seam} aria-hidden="true" />

      {ch.stat && (
        <div className={s.stat}>
          <span className={s.statNum}>{ch.stat.value}{ch.stat.unit && <span className={s.statUnit}>{ch.stat.unit}</span>}</span>
          <span className={s.statLabel}>{ch.stat.label}</span>
        </div>
      )}

      <section className={s.text} aria-live="polite">
        <div className={s.rise} key={ch.id}>
          <span className={s.kicker}>{ch.kicker}</span>
          <h1 className={s.headline}>{ch.headline}</h1>
          <p className={s.body}>{ch.body}</p>
          {ch.actions.length > 0 && (
            <div className={s.actions}>
              {ch.actions.map((a, i) => <a key={a.href} href={a.href} className={i === 0 ? s.actionPrimary : s.action}>{a.label}</a>)}
            </div>
          )}
        </div>
      </section>

      <span className={s.caption}>Photo: {ch.photo.caption} · {ch.photo.credit}</span>

      {keyItems.length > 0 && (
        <div className={s.key} aria-label="Map key">
          {keyItems.map((k) => <span key={k.label} className={s.keyItem}><span className={s.swatch} style={KEY_SWATCH(k)} />{k.label}</span>)}
        </div>
      )}

      <header className={s.header}>
        <span className={s.wordmark}>{story.author.wordmark.lead}{story.author.wordmark.tail && <> <span className={s.wordmarkTail}>{story.author.wordmark.tail}</span></>}</span>
        <div className={s.headerRight}>
          <a href={fullMapHref} className={s.fullMap}>Open the full map</a>
        </div>
      </header>

      <nav className={s.nav} aria-label="Story chapters">
        <div className={s.rail} style={{ gridTemplateColumns: `repeat(${story.chapters.length}, minmax(0, 1fr))` }}>
          {story.chapters.map((c, i) => (
            <button key={c.id} type="button" className={s.railBtn} aria-current={i === index ? 'step' : 'false'} onClick={() => go(i)}>
              <span className={`${s.railBar} ${i < index ? s.done : i === index ? s.now : ''}`} />
              <span className={`${s.railText} ${i === index ? s.now : ''}`}>{c.railLabel}</span>
            </button>
          ))}
        </div>
        <div className={s.controls}>
          <button type="button" className={s.play} aria-pressed={playing} onClick={togglePlay}>{playing ? 'Pause' : 'Play story'}</button>
          <button type="button" className={s.back} aria-label="Previous chapter" onClick={() => go(index - 1)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
          </button>
          {index < last
            ? <button type="button" className={s.next} onClick={() => go(index + 1)}>Next</button>
            : <button type="button" className={s.next} onClick={() => go(0)}>Start over</button>}
        </div>
      </nav>
    </div>
  )
}
