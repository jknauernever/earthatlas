/**
 * Mode B — Chapters (guided story). Numbered chapter pills, the globe, and
 * one card: chapter number, headline, paragraph, chips naming the layers on
 * the globe, Back / Next, "Explore this view yourself", a data credit, and
 * "See this where you live". The camera moves for the visitor.
 */

import { useEffect, useRef } from 'react'
import { CHAPTERS } from './chapters.js'
import { COPY } from './layers.js'
import { Brand } from './FieldGuide.jsx'
import s from './StoryLab.module.css'

export default function Chapters({ chapter, goChapter, openGuide, openHere, useMyLocation, layers, isMobile, setPlace }) {
  const ch = CHAPTERS[chapter - 1] || CHAPTERS[0]
  const total = CHAPTERS.length
  const cardRef = useRef(null)
  const prev = () => goChapter(Math.max(1, chapter - 1))
  const next = () => goChapter(Math.min(total, chapter + 1))

  // B → A: this chapter's layers stay on, the camera stays where it is.
  const explore = () => openGuide({ layers: ch.layers, legend: ch.layers[0] })

  // B → C: Here, Now for the visitor's spot, this chapter's layer first.
  const whereYouLive = async () => {
    const first = ch.layers[0]
    if (!navigator.geolocation) { openHere(null, { first }); return }
    navigator.geolocation.getCurrentPosition(
      (pos) => openHere({ lat: pos.coords.latitude, lng: pos.coords.longitude, name: '' }, { first }),
      () => openHere(null, { first }),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    )
  }

  // Arrow keys move between chapters (on the card or anywhere on the page).
  useEffect(() => {
    const k = (e) => {
      if (e.target?.closest?.('input, textarea')) return
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
      // Capture phase + stop: on this page the arrows change chapters, not
      // the time bar's frame steps (that bar listens on window too).
      e.stopImmediatePropagation()
      if (e.key === 'ArrowRight') next(); else prev()
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  })

  // Phones: swipe the card left / right.
  const touch = useRef(null)
  const onTouchStart = (e) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY } }
  const onTouchEnd = (e) => {
    const a = touch.current; touch.current = null
    if (!a) return
    const t = e.changedTouches[0]
    const dx = t.clientX - a.x, dy = t.clientY - a.y
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) (dx < 0 ? next : prev)()
  }

  const chips = ch.layers.map((id) => COPY[id]?.name || id)

  return (
    <>
      <header className={s.chHead}>
        {isMobile ? <span className={s.brandSub}>EARTHATLAS · STORIES</span> : <Brand sub="IN MOTION · STORIES" />}
        {!isMobile && (
          <nav className={s.chPills} aria-label="Chapters">
            {CHAPTERS.map((c, i) => (
              <button key={c.short} type="button" className={i + 1 === chapter ? s.chipOn : s.chip} aria-current={i + 1 === chapter ? 'step' : undefined} onClick={() => goChapter(i + 1)}>
                {i + 1}. {c.short}
              </button>
            ))}
          </nav>
        )}
        <button type="button" className={s.pillBtn} onClick={explore}>{isMobile ? 'Explore freely' : 'Skip to free explore'}</button>
      </header>
      {!isMobile && <div className={s.chHint}>The camera moves for you in each chapter. Use the arrow keys or the buttons on the card.</div>}
      <article ref={cardRef} className={s.chCard} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} aria-live="polite">
        <span className={s.chNum}>CHAPTER {chapter} OF {total}</span>
        {isMobile && (
          <div className={s.dots} aria-hidden="true">
            {CHAPTERS.map((c, i) => <span key={c.short} className={i + 1 === chapter ? s.dotOn : s.dot} />)}
          </div>
        )}
        <h1 className={s.chTitle}>{ch.title}</h1>
        <p className={s.chBody}>{isMobile ? ch.phoneBody : ch.body}</p>
        {!isMobile && <span className={s.eyebrow}>On the globe now</span>}
        <div className={s.chipWrap}>
          {chips.map((n) => <span key={n} className={s.tag}>{n}</span>)}
        </div>
        <div className={s.rule} />
        <div className={s.chNav}>
          <button type="button" className={s.pillBtn} onClick={prev} disabled={chapter === 1}>Back</button>
          {!isMobile && <button type="button" className={s.linkBtn} onClick={explore}>Explore this view yourself</button>}
          <button type="button" className={s.nextBtn} onClick={chapter === total ? explore : next}>{chapter === total ? 'Explore' : 'Next'}</button>
        </div>
        <button type="button" className={s.linkBtn} onClick={whereYouLive}>See this where you live</button>
        {isMobile ? <span className={s.chSwipe}>Swipe the card to move between chapters</span>
          : <span className={s.chCredit}>Data: {ch.source}</span>}
      </article>
    </>
  )
}
