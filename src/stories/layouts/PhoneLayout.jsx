import { useCallback, useEffect, useRef, useState } from 'react'
import StoryMap, { MAP_CREDIT } from '../StoryMap.jsx'
import s from './PhoneLayout.module.css'

/**
 * Phone layout (docs/design/stories-split/phone.html, DESIGN-PHONE.md): the Split layout turned on its side. The
 * chapter's photo on the top 44% with the words over it, the live map below, the gold seam across with the stat
 * circle on it. Swipe left or right to change chapter; the map is locked to the chapter's view ("Open the full map"
 * is the way to explore). Display only, same props as SplitLayout; StoryPage picks it on phones.
 */
const KEY_SWATCH = (k) => ({ background: k.color, boxShadow: k.glow ? `0 0 8px ${k.glow}` : undefined })
const SWIPE = 40                 // px, mostly sideways (DESIGN-PHONE.md "Behavior")
const LINE_SCALE = 0.55          // line weights ~1.8 × desktop relative to the map (DESIGN-PHONE.md "Map on a phone")
const MILES = [0.25, 0.5, 1, 2, 5, 10, 20]
const METERS_PER_MILE = 1609.344

/** One pixel of the 390px-wide design, as the stylesheet's --s computes it */
const unit = () => Math.min(window.innerWidth / 390, window.innerHeight / 640)

/**
 * Where a photo sits in the pane: at least 125% of the pane's height, its focal point at 60% across and 78% down,
 * clamped so no edge shows (phone.html place()). This keeps the subject below the words.
 */
function placePhoto(W, H, nw, nh, fx, fy) {
  const a = nw / nh, h = Math.max(1.25 * H, W / a), w = h * a
  return { width: w, height: h, left: Math.min(0, Math.max(W - w, 0.6 * W - fx * w)), top: Math.min(0.2 * H, Math.max(H - h, 0.78 * H - fy * h)) }
}

/** The chapter's view goes in the part of the map pane that nothing covers: right of the stat circle, above the footer */
const fitMap = () => { const u = unit(); return { top: 16 * u, right: 4 * u, bottom: 112 * u, left: 146 * u } }

/** A true scale bar in miles, at most ~60 design pixels long */
function scaleFor(cam) {
  if (!cam) return null
  const mpp = (40075016.686 * Math.cos((cam.lat * Math.PI) / 180)) / (512 * 2 ** cam.zoom)
  const u = unit()
  const mi = [...MILES].reverse().find((m) => (m * METERS_PER_MILE) / mpp <= 60 * u) || MILES[0]
  return { label: mi === 1 ? '1 mile' : `${mi} miles`, px: (mi * METERS_PER_MILE) / mpp }
}

export default function PhoneLayout({ story, index, go, playing, togglePlay, reducedMotion, fullMapHref, onCamera, look }) {
  const ch = story.chapters[index]
  const n = story.chapters.length
  const last = n - 1
  const keyItems = story.key.map((id) => look?.layers[id]?.key).filter(Boolean)

  // photo sizes: the pane's and each photo's own
  const pane = useRef(null)
  const [box, setBox] = useState(null)
  const [natural, setNatural] = useState({})
  useEffect(() => {
    const el = pane.current
    const ro = new ResizeObserver(() => setBox({ W: el.clientWidth, H: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const [cam, setCam] = useState(null)
  const camera = useCallback((c) => { setCam(c); onCamera?.(c) }, [onCamera])
  const scale = scaleFor(cam)

  // Swipe left for the next chapter, right for the previous, anywhere on the screen
  const start = useRef(null)
  const touchStart = (e) => { start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }
  const touchEnd = (e) => {
    const t0 = start.current
    start.current = null
    if (!t0) return
    const dx = e.changedTouches[0].clientX - t0.x, dy = e.changedTouches[0].clientY - t0.y
    if (Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(dy) * 1.5) go(index + (dx < 0 ? 1 : -1))
  }

  const credit = <a className={s.credit} href={MAP_CREDIT.href} target="_blank" rel="noopener noreferrer">Satellite: {MAP_CREDIT.text}</a>

  return (
    <div className={s.stage} onTouchStart={touchStart} onTouchEnd={touchEnd}>
      <div className={s.photo} ref={pane}>
        {story.chapters.map((c, i) => {
          const nat = natural[c.id]
          const pos = box && nat ? placePhoto(box.W, box.H, nat.w, nat.h, c.photo.subject.x / 100, c.photo.subject.y / 100) : { width: '100%', height: '100%', left: 0, top: 0 }
          return (
            <img key={c.id} src={c.photo.src} alt={i === index ? c.photo.alt : ''} aria-hidden={i === index ? undefined : true}
              className={`${s.img} ${i === index ? s.now : ''}`} style={pos}
              onLoad={(e) => { const { naturalWidth: w, naturalHeight: h } = e.currentTarget; setNatural((m) => ({ ...m, [c.id]: { w, h } })) }} />
          )
        })}
        <div className={s.photoShade} aria-hidden="true" />
      </div>

      <div className={s.mapPane}>
        <StoryMap subsite={story.subsite} layerIds={story.key} view={ch.view} reducedMotion={reducedMotion} onCamera={camera}
          locked fit={fitMap} small lineScale={LINE_SCALE} />
        <div className={s.mapShade} aria-hidden="true" />
      </div>

      <div className={s.seam} aria-hidden="true" />

      {ch.stat && (
        <div className={s.stat}>
          <span className={s.statNum}>{ch.stat.value}{ch.stat.unit && <span className={s.statUnit}>{ch.stat.unit}</span>}</span>
          <span className={s.statLabel}>{ch.stat.label}</span>
        </div>
      )}

      <header className={s.head}>
        <span className={s.wordmark}>{story.author.wordmark.lead}{story.author.wordmark.tail && <> <span className={s.wordmarkTail}>{story.author.wordmark.tail}</span></>}</span>
        <a href={fullMapHref} className={s.full}>Open the full map</a>
      </header>

      <section className={s.text} aria-live="polite">
        <div className={s.rise} key={ch.id}>
          <span className={s.kicker}>{ch.kicker}</span>
          <h1 className={s.headline}>{ch.headline}</h1>
          <p className={s.body}>{ch.body}</p>
        </div>
      </section>

      <span className={s.cap}>Photo: {ch.photo.caption} · {ch.photo.credit}</span>

      <div className={s.under}>
        {ch.actions.length > 0 && (
          <div className={s.cta}>
            {ch.actions.map((a, i) => <a key={a.href} href={a.href} className={i === 0 ? s.primary : undefined}>{a.label}</a>)}
          </div>
        )}
        {!ch.actions.length && credit}
      </div>

      <div className={s.foot}>
        {/* with the actions under the seam, the credit would run over the islands below them: it sits above the key instead */}
        {ch.actions.length > 0 && credit}
        <div className={s.keyRow}>
          <div className={s.key} aria-label="Map key">
            {keyItems.map((k) => <span key={k.label} className={s.keyItem}><span className={s.swatch} style={KEY_SWATCH(k)} />{k.label}</span>)}
          </div>
          {scale && <div className={s.scale}><span>{scale.label}</span><span className={s.scaleBar} style={{ width: scale.px }} /></div>}
        </div>
        <nav className={s.rail} aria-label="Story chapters" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
          {story.chapters.map((c, i) => (
            <button key={c.id} type="button" className={s.railBtn} aria-label={`Chapter ${i + 1}: ${c.railLabel}`} aria-current={i === index ? 'step' : 'false'} onClick={() => go(i)}>
              <span className={`${s.railBar} ${i < index ? s.done : i === index ? s.now : ''}`} />
            </button>
          ))}
        </nav>
        <div className={s.ctl}>
          <span className={s.where}><span className={s.whereNum}>{index + 1} / {n}</span>{ch.railLabel}</span>
          <div className={s.btns}>
            <button type="button" className={s.btn} aria-pressed={playing} aria-label={playing ? 'Pause' : 'Play story'} onClick={togglePlay}>
              {playing
                ? <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
                : <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>}
            </button>
            <button type="button" className={s.btn} aria-label="Previous chapter" onClick={() => go(index - 1)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
            </button>
            {index < last
              ? <button type="button" className={`${s.btn} ${s.next}`} onClick={() => go(index + 1)}>Next</button>
              : <button type="button" className={`${s.btn} ${s.next}`} onClick={() => go(0)}>Start over</button>}
          </div>
        </div>
      </div>
    </div>
  )
}
