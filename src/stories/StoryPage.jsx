import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { loadStory } from './content.js'
import { STORY_SUBSITES } from './subsites.js'
import SplitLayout from './layouts/SplitLayout.jsx'
import PhoneLayout from './layouts/PhoneLayout.jsx'

/**
 * /:subsite/stories/:slug — one story, on every host, in its author's branding (src/stories/content.js assembles it).
 * Owns what every layout shares: the current chapter (#<chapter id> links), arrow keys, Play story, reduced motion,
 * and the "Open the full map" link. Layouts only draw.
 */
const LAYOUTS = { split: SplitLayout }
const PLAY_MS = 6500
// phones: under 700px wide, or portrait under 900px wide (DESIGN-PHONE.md); landscape phones and tablets get the story's layout
const PHONE = '(max-width: 699.98px), (orientation: portrait) and (max-width: 899.98px)'
const FONTS = 'https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,300;0,8..60,400;1,8..60,400&family=Inter:wght@400;500;600&display=swap'

function useFonts() {
  useEffect(() => {
    if (document.querySelector(`link[href="${FONTS}"]`)) return
    const l = document.createElement('link')
    l.rel = 'stylesheet'; l.href = FONTS
    document.head.appendChild(l)
  }, [])
}

const useReducedMotion = () => useMedia('(prefers-reduced-motion: reduce)')

function useMedia(query) {
  const q = useMemo(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query) : null), [query])
  const [on, setOn] = useState(!!q?.matches)
  useEffect(() => {
    if (!q) return
    const f = () => setOn(q.matches)
    q.addEventListener('change', f)
    return () => q.removeEventListener('change', f)
  }, [q])
  return on
}

export default function StoryPage() {
  const { subsite, slug } = useParams()
  const [story, setStory] = useState(undefined)   // undefined loading, null not found
  const [failed, setFailed] = useState(false)      // the subsite's counts didn't load: never show a story without its numbers
  const [look, setLook] = useState(null)
  const [registry, setRegistry] = useState(null)
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const camera = useRef(null)
  const [camTick, bump] = useState(0)
  const reducedMotion = useReducedMotion()
  const phone = useMedia(PHONE)
  useFonts()

  useEffect(() => {
    let live = true
    setStory(undefined)
    setFailed(false)
    loadStory(subsite, slug).then((s) => {
      if (!live) return
      setStory(s)
      if (!s) return
      const i = s.chapters.findIndex((c) => `#${c.id}` === window.location.hash)
      setIndex(i < 0 ? 0 : i)
      STORY_SUBSITES[subsite].look().then((l) => live && setLook(l))
      STORY_SUBSITES[subsite].registry().then((r) => live && setRegistry(r))
    }).catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [subsite, slug])

  const count = story?.chapters.length || 0
  const go = useCallback((i) => {
    if (!story) return
    const n = Math.max(0, Math.min(count - 1, i))
    setIndex(n)
    try { window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#${story.chapters[n].id}`) } catch { /* sandboxed */ }
  }, [story, count])

  // Arrow keys change chapter
  useEffect(() => {
    const f = (e) => {
      if (e.target.closest?.('input, textarea, select, [contenteditable]')) return
      if (e.key === 'ArrowRight') go(index + 1)
      if (e.key === 'ArrowLeft') go(index - 1)
    }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [go, index])

  // Links to a chapter (#eggs) opened or changed by hand
  useEffect(() => {
    const f = () => { const i = story?.chapters.findIndex((c) => `#${c.id}` === window.location.hash); if (i >= 0) setIndex(i) }
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [story])

  // Play story: a chapter every 6.5 s, stops on the last
  useEffect(() => {
    if (!playing) return
    if (index >= count - 1) { setPlaying(false); return }
    const t = setTimeout(() => go(index + 1), PLAY_MS)
    return () => clearTimeout(t)
  }, [playing, index, count, go])
  const togglePlay = () => { if (!playing && index >= count - 1) go(0); setPlaying((p) => !p) }

  useEffect(() => {
    if (!story) return
    const prev = document.title
    document.title = `${story.title} · EarthAtlas`
    let robots = null
    if (story.status !== 'published') {
      robots = document.createElement('meta'); robots.name = 'robots'; robots.content = 'noindex'
      document.head.appendChild(robots)
    }
    return () => { document.title = prev; robots?.remove() }
  }, [story])

  // "Open the full map": the subsite's explorer on this host, with this chapter's layers on and the same camera
  const ch = story?.chapters[index]
  const fullMapHref = useMemo(() => {
    if (!story) return '#'
    const sp = new URLSearchParams()
    const c = camera.current
    if (c) { sp.set('lat', c.lat.toFixed(4)); sp.set('lng', c.lng.toFixed(4)); sp.set('z', c.zoom.toFixed(1)) }
    if (registry) {
      const on = new Set(ch.view.layers.map((l) => l.id))
      const off = registry.layerIds.filter((id) => !on.has(id))
      if (off.length) sp.set('off', off.join(','))
    }
    return `${story.explorer}?${sp.toString()}`
    // camera.current changes are signalled by camTick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story, ch, registry, camTick])
  const onCamera = useCallback((c) => { camera.current = c; bump((n) => n + 1) }, [])

  if (failed) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#040C14', color: '#F2F7FA', fontFamily: 'Inter, system-ui, sans-serif', display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <div>
          <p>This story couldn’t load its numbers.</p>
          <p><button type="button" onClick={() => window.location.reload()} style={{ height: 44, padding: '0 24px', borderRadius: 22, border: 0, background: '#FFE7A3', color: '#1A1406', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Try again</button></p>
        </div>
      </div>
    )
  }
  if (story === undefined) return <div style={{ position: 'fixed', inset: 0, background: '#040C14' }} />
  if (story === null) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#040C14', color: '#F2F7FA', fontFamily: 'Inter, system-ui, sans-serif', display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <div>
          <p>There’s no story here.</p>
          {STORY_SUBSITES[subsite] && <p><a style={{ color: '#9FE3EE' }} href={STORY_SUBSITES[subsite].explorer}>Open the map</a></p>}
        </div>
      </div>
    )
  }
  const Layout = phone ? PhoneLayout : LAYOUTS[story.layout] || SplitLayout
  return <Layout story={story} index={index} go={go} playing={playing} togglePlay={togglePlay} reducedMotion={reducedMotion}
    fullMapHref={fullMapHref} onCamera={onCamera} look={look} />
}
