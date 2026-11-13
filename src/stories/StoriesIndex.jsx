import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import BuiltByCredit from '../components/BuiltByCredit.jsx'
import DocBrand from '../components/DocBrand.jsx'
import { BRANDS } from '../lib/brand.js'
import { loadStory, storiesOf } from './content.js'
import { STORY_SUBSITES } from './subsites.js'
import c from '../ships/ScrubberReport.module.css'
import s from './StoriesIndex.module.css'

/**
 * /:subsite/stories — the stories told on a subsite. NOT DESIGNED YET: built in the frame of the subsite's report page
 * (/shoreline/reports: light document page, the subsite's brand on every host, built-by credit), one card per story:
 * its opening photo, author, title, opening line and chapter count. Everything on a card comes from the story file.
 */
export default function StoriesIndex() {
  const { subsite } = useParams()
  const site = STORY_SUBSITES[subsite]
  const [cards, setCards] = useState(undefined)   // undefined loading, [] none
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!site) return
    let live = true
    Promise.all(storiesOf(subsite).map((st) => loadStory(subsite, st.slug)))
      .then((list) => live && setCards(list.filter(Boolean)))
      .catch(() => live && setFailed(true))
    return () => { live = false }
  }, [subsite, site])

  useEffect(() => {
    if (site) document.title = `Stories · ${site.name} · EarthAtlas`
  }, [site])

  if (!site) return <main className={c.main}><h1 className={c.title}>No stories here</h1></main>
  const brand = BRANDS.find((b) => b.id === site.brand)

  return (
    <div className={c.page}>
      <header className={`${c.top} ${s.top}`}>
        <DocBrand tool={site.name} href={site.explorer} brand={brand} />
        <a className={s.mapBtn} href={site.explorer}>Open the map</a>
      </header>
      <main className={c.main}>
        <div className={c.kicker}>{site.name} · stories</div>
        <h1 className={c.title}>Stories</h1>
        <p className={c.lede}>
          Short, illustrated walks through the <a className={c.src} href={site.explorer}>{site.name} map</a>. Every number in them comes
          from the <a className={c.src} href={site.reports.href}>{site.reports.name}</a>.
        </p>

        {failed && <p className={s.note}>The stories couldn’t load. Please try again in a moment.</p>}
        {cards && cards.length === 0 && <p className={s.note}>No stories yet.</p>}

        {cards && cards.length > 0 && (
          <ul className={s.grid}>
            {cards.map((st) => {
              const first = st.chapters[0]
              const href = `/${subsite}/stories/${st.slug}`
              return (
                <li key={st.slug} className={s.card}>
                  <a href={href} className={s.photoLink} tabIndex={-1} aria-hidden="true">
                    <img src={first.photo.src} alt="" className={s.photo} style={{ objectPosition: `${first.photo.focalPoint.x}% ${first.photo.focalPoint.y}%` }} />
                  </a>
                  <div className={s.body}>
                    <div className={s.meta}>
                      <a href={st.author.href} className={s.author} target="_blank" rel="noopener noreferrer">{st.author.name}</a>
                      <span>{st.chapters.length} chapters</span>
                      {st.status === 'draft' && <span className={s.draft}>Draft</span>}
                    </div>
                    <h2 className={s.title}><a href={href}>{st.title}</a></h2>
                    <p className={s.lede}>{first.body}</p>
                    <div className={s.foot}>
                      <a href={href} className={s.start}>Start the story</a>
                      <span className={s.credit}>Photo: {first.photo.credit}</span>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <BuiltByCredit variant="light" className={c.builtBy} />
      </main>
    </div>
  )
}
