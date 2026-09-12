const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/**
 * SeasonRibbon — "which months are they here?", docked on the map.
 *
 * A read-only histogram of sighting density by month across all years of
 * records, for every species on the map — or, when a species is selected
 * in the list, for that species alone (`subjectLabel` names it).
 *
 * Props:
 *   pattern      — [{ month: 1..12, count }] (fetchSeasonalPattern)
 *   subjectLabel — species common name when one is selected, else null
 *   styles       — CSS module from parent
 */
export default function SeasonRibbon({ pattern = [], subjectLabel = null, styles }) {
  const maxCount = Math.max(...pattern.map((p) => p.count), 1)
  const total = pattern.reduce((s, p) => s + p.count, 0)
  const thisMonth = new Date().getMonth()

  return (
    <div className={styles.ribbon}>
      <div className={styles.ribbonHead}>
        <div className={styles.ribbonTitle}>
          {subjectLabel ? `When is the ${subjectLabel} here?` : 'When are they here?'}
          <small>{total.toLocaleString()} sightings · all years combined</small>
        </div>
      </div>
      <div className={styles.ribbonBars}>
        {MONTHS.map((label, i) => {
          const count = pattern[i]?.count || 0
          const current = i === thisMonth
          return (
            <div
              key={label}
              className={styles.ribbonBarCol}
              title={`${MONTHS_FULL[i]}: ${count.toLocaleString()} sightings across all years`}
            >
              <div
                className={current ? styles.ribbonBarOn : styles.ribbonBar}
                style={{ height: `${Math.max(6, (count / maxCount) * 100)}%` }}
              />
              <span className={current ? styles.ribbonLblOn : styles.ribbonLbl}>{label}</span>
            </div>
          )
        })}
      </div>
      <div className={styles.ribbonProv}>
        {'Sighting density by month, all years of records combined — the current month is highlighted · '}
        <a href="https://www.gbif.org" target="_blank" rel="noreferrer">GBIF</a>
      </div>
    </div>
  )
}
