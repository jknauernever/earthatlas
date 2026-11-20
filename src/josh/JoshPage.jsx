import { useEffect } from 'react'
import styles from './JoshPage.module.css'

/**
 * /josh — Josh's own index of every EarthAtlas subsite and its reports. Unlisted: noindex, not in the sitemap,
 * no link from anywhere. Add a row here whenever a route goes into src/main.jsx.
 */
const SECTIONS = [
  {
    title: 'Main site',
    items: [
      { name: 'EarthAtlas home', href: '/' },
      { name: 'Live globe', href: '/live' },
      { name: 'Live local', href: '/live-local' },
      { name: 'In Motion — Earth’s systems, animated', href: '/inmotion' },
    ],
  },
  {
    title: 'Ships & the Salish Sea',
    items: [
      {
        name: 'Ships', href: '/ships',
        sub: [
          { name: 'Reports', href: '/ships/reports' },
          { name: 'Scrubber report', href: '/ships/reports/scrubbers' },
          { name: 'Bunkering (anchorage) report', href: '/ships/reports/bunkering', note: 'unlisted' },
          { name: 'Oil transfers report', href: '/ships/reports/oil-transfers', note: 'unlisted' },
          { name: 'Changelog', href: '/ships/changelog' },
          { name: 'Ship intake', href: '/ships/intake' },
          { name: 'Live view', href: '/ships?live=1', note: 'hidden' },
        ],
      },
      { name: 'Ship Traffic & Whales', href: '/shiptraffic' },
      { name: 'Whale Watch', href: '/whalewatch' },
      { name: 'HappyWhale', href: '/happywhale' },
      { name: 'Oil Spill Scenarios', href: '/spillrisk' },
    ],
  },
  {
    title: 'San Juan County',
    items: [
      {
        name: 'Salish Sea Explorer: Shoreline Ecosystems', href: '/shoreline',
        sub: [
          { name: 'Counts by island report', href: '/shoreline/reports' },
          { name: 'Stories', href: '/shoreline/stories' },
          { name: 'Partner host: sanjuans.earthatlas.org', href: 'https://sanjuans.earthatlas.org/' },
        ],
      },
      {
        name: 'Sea-Level Rise Risks', href: '/risks',
        sub: [{ name: 'Land value report', href: '/risks/reports/land-value' }],
      },
      {
        name: 'PermitTracker (water permits)', href: '/permits',
        sub: [
          { name: 'Dashboard', href: '/permits/dashboard' },
          { name: 'Glossary', href: '/permits/glossary' },
        ],
      },
      { name: 'Docks & dock permits', href: '/sanjuan-docks' },
    ],
  },
  {
    title: 'National & global tools',
    items: [
      {
        name: 'Fossil Fuel Spills & Releases', href: '/spills',
        sub: [{ name: 'Report', href: '/spills/reports' }],
      },
      { name: 'Species of Concern', href: '/species-of-concern' },
      { name: 'Forest Monitor', href: '/forestmonitor' },
      { name: 'FireApp', href: '/fire' },
      { name: 'Quakes', href: '/quakes' },
      { name: 'Carbon', href: '/carbon' },
      { name: 'Birdsong', href: '/birdsong' },
    ],
  },
  {
    title: 'Explore (species maps)',
    items: ['whales', 'sharks', 'dolphins', 'birds', 'butterflies', 'fungi', 'tigers', 'lions', 'elephants', 'bears',
      'monkeys', 'hippos', 'wolves', 'condors', 'sloths']
      .map((s) => ({ name: s[0].toUpperCase() + s.slice(1), href: `/${s}` })),
    compact: true,
  },
  {
    title: 'Admin',
    items: [
      { name: 'Users', href: '/admin/users' },
      { name: 'Account', href: '/account' },
    ],
  },
]

function Item({ item }) {
  return (
    <li>
      <a href={item.href}>{item.name}</a>
      <span className={styles.path}>{item.href}</span>
      {item.note && <span className={styles.note}>{item.note}</span>}
      {item.sub && (
        <ul className={styles.sub}>
          {item.sub.map((s) => <Item key={s.href} item={s} />)}
        </ul>
      )}
    </li>
  )
}

export default function JoshPage() {
  useEffect(() => {
    document.title = 'Josh’s index · EarthAtlas'
    const m = document.createElement('meta'); m.name = 'robots'; m.content = 'noindex, nofollow'
    document.head.appendChild(m)
    return () => m.remove()
  }, [])

  return (
    <main className={styles.page}>
      <h1>EarthAtlas — every subsite</h1>
      <p className={styles.lede}>Josh’s index. Unlisted.</p>
      {SECTIONS.map((sec) => (
        <section key={sec.title} className={styles.section}>
          <h2>{sec.title}</h2>
          <ul className={sec.compact ? styles.compact : styles.list}>
            {sec.items.map((it) => <Item key={it.href} item={it} />)}
          </ul>
        </section>
      ))}
    </main>
  )
}
