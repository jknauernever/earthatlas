import { useState } from 'react'
import styles from './Insights.module.css'

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function formatDayLabel(label) {
  const parts = label.split('-')
  if (parts.length === 3) {
    return `${MONTH_NAMES[parseInt(parts[1], 10) - 1]} ${parseInt(parts[2], 10)}`
  }
  return label
}

function niceMax(value) {
  if (value <= 5) return Math.max(value, 1)
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)))
  const normalized = value / magnitude
  if (normalized <= 1) return magnitude
  if (normalized <= 2) return 2 * magnitude
  if (normalized <= 5) return 5 * magnitude
  return 10 * magnitude
}

export default function RecentTrendChart({ data, loading, hourly }) {
  const [hover, setHover] = useState(null)

  if (loading) {
    return <div className={`${styles.shimmer} ${styles.shimmerChart}`} />
  }

  if (!data || data.length === 0) return <div className={styles.noData}>No recent activity data</div>

  const totalCount = data.reduce((sum, b) => sum + b.count, 0)
  const rawMax = Math.max(...data.map(b => b.count), 1)
  const ceilMax = niceMax(rawMax)

  // SVG dimensions
  const W = 900
  const H = 240
  const PAD = { top: 12, right: 16, bottom: 36, left: 48 }
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const barCount = data.length
  const barGap = Math.max(2, plotW * 0.02)
  const barW = (plotW - barGap * (barCount - 1)) / barCount

  const y = (count) => PAD.top + plotH - (count / ceilMax) * plotH

  // Y-axis ticks: 4–5 nice ticks from 0 to ceilMax
  const tickCount = ceilMax <= 5 ? ceilMax : 4
  const yTicks = Array.from({ length: tickCount + 1 }, (_, i) =>
    Math.round((ceilMax / tickCount) * i)
  )

  // X-axis label thinning
  const maxLabels = Math.floor(plotW / (hourly ? 50 : 60))
  const showEveryN = Math.max(1, Math.ceil(barCount / maxLabels))

  const hoverData = hover !== null ? data[hover] : null

  return (
    <div className={styles.yearChart}>
      {/* Hover detail */}
      <div className={styles.seasonDetail}>
        {hoverData ? (
          <>
            <span className={styles.seasonDetailMonth}>
              {hourly ? hoverData.label : formatDayLabel(hoverData.label)}
            </span>
            <span className={styles.seasonDetailCount}>
              {hoverData.count.toLocaleString()} observation{hoverData.count !== 1 ? 's' : ''}
            </span>
            <span className={styles.seasonDetailPct}>
              {totalCount > 0 ? `${((hoverData.count / totalCount) * 100).toFixed(1)}%` : ''}
            </span>
          </>
        ) : (
          <span className={styles.seasonDetailHint}>Hover over a bar for details</span>
        )}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className={styles.yearSvg}>
        {/* Y-axis gridlines */}
        {yTicks.map(tick => (
          <line
            key={`grid-${tick}`}
            x1={PAD.left} y1={y(tick)}
            x2={W - PAD.right} y2={y(tick)}
            stroke="var(--border)" strokeWidth="1"
          />
        ))}

        {/* Y-axis labels */}
        {yTicks.map(tick => (
          <text
            key={`y-${tick}`}
            x={PAD.left - 8} y={y(tick) + 3.5}
            textAnchor="end"
            className={styles.yearLabel}
          >
            {tick.toLocaleString()}
          </text>
        ))}

        {/* Y-axis line */}
        <line
          x1={PAD.left} y1={PAD.top}
          x2={PAD.left} y2={PAD.top + plotH}
          stroke="var(--border)" strokeWidth="1"
        />

        {/* Baseline */}
        <line
          x1={PAD.left} y1={PAD.top + plotH}
          x2={W - PAD.right} y2={PAD.top + plotH}
          stroke="var(--border)" strokeWidth="1"
        />

        {/* Bars */}
        {data.map((b, i) => {
          const bx = PAD.left + i * (barW + barGap)
          const barH = (b.count / ceilMax) * plotH
          const isHovered = hover === i
          return (
            <g key={b.key}>
              <rect
                x={bx} y={y(b.count)}
                width={barW} height={Math.max(barH, 1)}
                rx={Math.min(barW * 0.15, 3)}
                fill={isHovered ? 'var(--amber)' : 'var(--moss)'}
                opacity={hover !== null && !isHovered ? 0.4 : 1}
                style={{ transition: 'opacity 0.15s, fill 0.15s' }}
              />
              {/* Invisible wider hit target */}
              <rect
                x={bx - barGap / 2} y={PAD.top}
                width={barW + barGap} height={plotH}
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          )
        })}

        {/* X-axis labels */}
        {data.map((b, i) => {
          if (i % showEveryN !== 0 && i !== barCount - 1) return null
          const bx = PAD.left + i * (barW + barGap) + barW / 2
          return (
            <text
              key={`x-${b.key}`}
              x={bx} y={H - 8}
              textAnchor="middle"
              className={styles.yearLabel}
            >
              {hourly ? b.label : formatDayLabel(b)}
            </text>
          )
        })}
      </svg>
    </div>
  )
}
