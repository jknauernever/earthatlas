/**
 * /permits/glossary: every permit term /permits uses, in plain words, each with the law or agency page behind it
 * (glossary.js; Josh 2026-10-15: "we also need to define things"). Same light document look as the permit report.
 */
import { Fragment, useEffect } from 'react'
import BuiltByCredit from '../components/BuiltByCredit.jsx'
import { TERMS } from './glossary.js'
import c from './PermitsReport.module.css'

export default function PermitsGlossary() {
  useEffect(() => { const prev = document.title; document.title = 'Permit terms · PermitTracker · EarthAtlas'; return () => { document.title = prev } }, [])
  return (
    <div className={c.page}>
      <header className={c.top}>
        <a href="/permits" className={c.brand}>EarthAtlas <span>PermitTracker</span></a>
        <div className={c.actions}><a className={c.src} href="/permits/dashboard">Dashboard</a><a className={c.src} href="/permits">Map</a></div>
      </header>
      <main className={c.main}>
        <div className={c.kicker}>PermitTracker</div>
        <h1 className={c.title}>Permit terms, in plain words</h1>
        <p className={c.sub}>What the agencies’ terms on these pages mean. Each definition is EarthAtlas’s summary; the linked law or agency page is the authority.</p>
        <dl className={c.terms}>
          {TERMS.map((t) => <Fragment key={t.id}><dt id={t.id}>{t.term}</dt><dd>{t.plain} <a className={c.src} href={t.href} target="_blank" rel="noopener noreferrer">{t.law}</a></dd></Fragment>)}
        </dl>
        <footer className={c.footer}><BuiltByCredit variant="light" /></footer>
      </main>
    </div>
  )
}
