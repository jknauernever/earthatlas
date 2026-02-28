import styles from './EmptyState.module.css'

const STATES = {
  initial: {
    icon: '🔭',
    title: 'Ready to Explore',
    body: 'Click "Locate Me" to use your current location, then hit Search to discover what\'s living nearby.',
  },
  noResults: {
    icon: '🔍',
    title: 'No Observations Found',
    body: 'Try expanding your radius or time window, or select a different taxon filter.',
  },
  error: {
    icon: '⚠️',
    title: 'Something Went Wrong',
    body: null, // shown via props.message
  },
}

export default function EmptyState({ variant = 'initial', message }) {
  const s = STATES[variant] || STATES.initial
  return (
    <div className={styles.wrap}>
      <div className={styles.icon}>{s.icon}</div>
      <h2 className={styles.title}>{s.title}</h2>
      <p className={styles.body}>{message || s.body}</p>
    </div>
  )
}
