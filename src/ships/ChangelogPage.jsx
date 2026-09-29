/**
 * /ships/changelog: public "what's new" for /ships, with the data counts on top (Josh, 2026-09-28).
 * Content lives in shipsChangelog.js; light page styling in ChangelogPage.module.css.
 */
import { useEffect } from 'react'
import { COUNTS, COUNTS_AS_OF, COVERAGE_NOTE, ENTRIES } from './shipsChangelog.js'
import c from './ChangelogPage.module.css'

const fmtDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })

function Sources({ list }) {
  return list.map((src, i) => (
    <span key={i}>
      {i > 0 && ', '}
      {typeof src === 'string' ? src : <a href={src.href} target="_blank" rel="noopener noreferrer">{src.name}</a>}
    </span>
  ))
}

export default function ChangelogPage() {
  useEffect(() => { document.title = 'Changelog · EarthAtlas Ships' }, [])
  const days = [...new Set(ENTRIES.map((e) => e.date))]
  return (
    <div className={c.page}>
      <header className={c.top}>
        <a href="/ships" className={c.brand}>EarthAtlas <span>Ships</span></a>
      </header>
      <main className={c.main}>
        <div className={c.kicker}>Changelog</div>
        <h1 className={c.title}>What’s new on EarthAtlas Ships</h1>
        <div className={c.sub}>Every change below is live on <a href="/ships" className={c.link}>earthatlas.org/ships</a>.</div>

        <section className={c.counts} aria-labelledby="counts-h">
          <h2 id="counts-h" className={c.h2}>Data on the site <span>as of {fmtDay(COUNTS_AS_OF)}</span></h2>
          <div className={c.grid}>
            {COUNTS.map((k) => (
              <div key={k.label} className={c.tile}>
                <div className={c.value}>{k.value}</div>
                <div className={c.label}>{k.label}</div>
                {k.detail && <div className={c.detail}>{k.detail}</div>}
                <div className={c.src}>Source: <Sources list={k.sources} /></div>
              </div>
            ))}
          </div>
          <p className={c.note}>{COVERAGE_NOTE} Every value on the map links to its own source.</p>
        </section>

        <section aria-labelledby="log-h">
          <h2 id="log-h" className={c.h2}>Changes</h2>
          {days.map((d) => (
            <div key={d} className={c.day}>
              <h3 className={c.date}><time dateTime={d}>{fmtDay(d)}</time></h3>
              <ul className={c.list}>
                {ENTRIES.filter((e) => e.date === d).map((e, i) => (
                  <li key={i}><span className={c.area}>{e.area}</span>{e.text}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      </main>
    </div>
  )
}
