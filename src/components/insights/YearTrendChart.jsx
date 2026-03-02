import { useState, useRef, useCallback } from 'react'
import styles from './Insights.module.css'

export default function YearTrendChart({ years, loading, onYearClick, activeYear }) {
  const [hover, setHover] = useState(null)
  const svgRef = useRef(null)

  if (loading) {
    return <div className={`${styles.shimmer} ${styles.shimmerChart}`} />
  }

  if (!years || years.length === 0) return <div className={styles.noData}>No yearly data available</div>

  // Sort years ascending
  const sorted = [...years]
    .map(y => ({ year: Number(y.name), count: y.count }))
    .sort((a, b) => a.year - b.year)

  if (sorted.length < 2) {
    return (
      <div className={styles.noData}>
        {sorted[0] ? `${sorted[0].count.toLocaleString()} observations in ${sorted[0].year}` : 'No data'}
      </div>
    )
  }

  const maxCount = Math.max(...sorted.map(d => d.count), 1)
  const minYear = sorted[0].year
  const maxYear = sorted[sorted.length - 1].year
  const yearSpan = maxYear - minYear

  const W = 900
  const H = 260
  const PAD = { top: 20, right: 20, bottom: 36, left: 20 }
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom

  const x = (year) => PAD.left + ((year - minYear) / Math.max(yearSpan, 1)) * plotW
  const y = (count) => PAD.top + plotH - (count / maxCount) * plotH

  const points = sorted.map(d => `${x(d.year)},${y(d.count)}`)
  const linePath = `M ${points.join(' L ')}`
  const areaPath = `${linePath} L ${x(maxYear)},${PAD.top + plotH} L ${x(minYear)},${PAD.top + plotH} Z`

  // Smart label spacing: aim for labels ~80px apart in SVG units
  const targetSpacing = 80
  const maxLabels = Math.floor(plotW / targetSpacing)
  const yearStep = Math.max(1, Math.ceil(yearSpan / maxLabels))
  // Round step to nice intervals
  const niceStep = yearStep <= 1 ? 1 : yearStep <= 2 ? 2 : yearStep <= 5 ? 5 : yearStep <= 10 ? 10 : yearStep <= 20 ? 20 : yearStep <= 25 ? 25 : 50
  const labelYears = []
  const firstNice = Math.ceil(minYear / niceStep) * niceStep
  for (let yr = firstNice; yr <= maxYear; yr += niceStep) labelYears.push(yr)
  // Always include first and last year
  if (labelYears[0] !== minYear) labelYears.unshift(minYear)
  if (labelYears[labelYears.length - 1] !== maxYear) labelYears.push(maxYear)
  // Remove labels that are too close to neighbors
  const filtered = labelYears.filter((yr, i) => {
    if (i === 0 || i === labelYears.length - 1) return true
    const prevX = x(labelYears[i - 1])
    const nextX = x(labelYears[i + 1])
    return (x(yr) - prevX > 40) && (nextX - x(yr) > 40)
  })

  const hoverData = hover != null ? sorted.find(d => d.year === hover) : null

  return (
    <div className={styles.yearChart}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className={styles.yearSvg}>
        {/* Area fill */}
        <path d={areaPath} fill="var(--moss)" opacity="0.1" />
        {/* Line */}
        <path d={linePath} fill="none" stroke="var(--moss)" strokeWidth="2" strokeLinejoin="round" />
        {/* Baseline */}
        <line x1={PAD.left} y1={PAD.top + plotH} x2={W - PAD.right} y2={PAD.top + plotH}
          stroke="var(--border)" strokeWidth="1" />

        {/* Hover guide line */}
        {hoverData && (
          <line
            x1={x(hoverData.year)} y1={PAD.top}
            x2={x(hoverData.year)} y2={PAD.top + plotH}
            stroke="var(--moss)" strokeWidth="1" strokeDasharray="3,3" opacity="0.5"
          />
        )}

        {/* Dots */}
        {sorted.map(d => {
          const isHovered = hover === d.year
          const isActive = activeYear === d.year
          return (
            <circle
              key={d.year}
              cx={x(d.year)} cy={y(d.count)}
              r={isHovered || isActive ? 6 : 3}
              fill={isActive ? 'var(--amber)' : 'var(--moss)'}
              stroke={isHovered ? 'var(--ink)' : 'none'}
              strokeWidth={isHovered ? 1.5 : 0}
              style={{ cursor: 'pointer', transition: 'r 0.15s, fill 0.15s' }}
              onMouseEnter={() => setHover(d.year)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onYearClick?.(d.year)}
            />
          )
        })}

        {/* Invisible wider hit targets for small dots */}
        {sorted.map(d => (
          <circle
            key={`hit-${d.year}`}
            cx={x(d.year)} cy={y(d.count)}
            r="10" fill="transparent"
            style={{ cursor: 'pointer' }}
            onMouseEnter={() => setHover(d.year)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onYearClick?.(d.year)}
          />
        ))}

        {/* X labels */}
        {filtered.map(yr => (
          <text key={yr} x={x(yr)} y={H - 8} textAnchor="middle"
            className={styles.yearLabel}>{yr}</text>
        ))}

        {/* Hover tooltip */}
        {hoverData && (() => {
          const tx = x(hoverData.year)
          const ty = y(hoverData.count)
          const tooltipW = 130
          const tooltipH = 42
          // Flip tooltip if too close to right edge
          const flipX = tx + tooltipW / 2 > W - 10
          const tooltipX = flipX ? tx - tooltipW - 12 : tx - tooltipW / 2
          const tooltipY = Math.max(2, ty - tooltipH - 12)
          return (
            <g style={{ pointerEvents: 'none' }}>
              <rect x={tooltipX} y={tooltipY} width={tooltipW} height={tooltipH}
                rx="6" fill="var(--ink)" opacity="0.92" />
              <text x={tooltipX + tooltipW / 2} y={tooltipY + 17}
                textAnchor="middle" fill="var(--cream)"
                style={{ fontSize: '13px', fontFamily: 'var(--font-serif)', fontWeight: 700 }}>
                {hoverData.year}
              </text>
              <text x={tooltipX + tooltipW / 2} y={tooltipY + 33}
                textAnchor="middle" fill="var(--sage)"
                style={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
                {hoverData.count.toLocaleString()} obs
              </text>
            </g>
          )
        })()}
      </svg>

    </div>
  )
}
