import styles from './Header.module.css'

export default function Header() {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <a href="/" className={styles.wordmark} style={{ textDecoration: 'none', color: 'inherit' }}>
          <h1 className={styles.title}>
            Earth<em>Atlas</em>
          </h1>
          <span className={styles.sub}>Discover what's living around you — right now</span>
        </a>
        <div className={styles.badge}>
          <span className={styles.dot} />
          Live Observations
        </div>
      </div>
    </header>
  )
}
