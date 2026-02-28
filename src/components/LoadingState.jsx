import styles from './LoadingState.module.css'

export default function LoadingState() {
  return (
    <div className={styles.wrap}>
      <div className={styles.grid}>
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className={styles.cell} style={{ animationDelay: `${(i % 3 + Math.floor(i / 3)) * 0.1}s` }} />
        ))}
      </div>
      <span className={styles.text}>Scanning the field…</span>
    </div>
  )
}
