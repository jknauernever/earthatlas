/**
 * Tracks-layer controls for the left panel, under the Ship tracks row: the
 * month/year chooser (default export) and the kind-of-ship list (TRACK_KINDS).
 * Both used to sit in a top-centre pill; Josh moved them to the data nav
 * (2026-09-25).
 */

export const TRACK_KINDS = [
  ['cargo', 'Cargo'], ['tanker', 'Tanker'], ['passenger', 'Passenger'], ['fishing', 'Fishing'],
  ['tug', 'Tug / tow'], ['pleasure', 'Pleasure craft'], ['other', 'Other'], ['unknown', 'Not reported'],
]
const MONTH_LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const fmtMonth = (ym) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`

/**
 * Month / year chooser for the tracks layer, shown in the left panel above the
 * kind-of-ship filter (Josh, 2026-09-25): /shiptraffic's month grid (click a
 * month, shift-click a span) plus All and per-year chips.
 */
export default function TrackMonths({ months, range, onRange, styles: s }) {
  const [a, b] = range
  const isAll = a === 0 && b === months.length - 1
  const years = [...new Set(months.map((m) => m.slice(0, 4)))]
  const yearSpan = (y) => { const idx = months.map((m, i) => (m.startsWith(y) ? i : -1)).filter((i) => i >= 0); return [idx[0], idx[idx.length - 1]] }
  const isYear = (y) => { const [ya, yb] = yearSpan(y); return a === ya && b === yb && !isAll }
  const label = isAll ? `All ${months.length} month${months.length === 1 ? '' : 's'}`
    : a === b ? fmtMonth(months[a]) : `${fmtMonth(months[a])} – ${fmtMonth(months[b])}`
  const pick = (idx, shift) => onRange(shift ? [Math.min(a, idx), Math.max(a, idx)] : [idx, idx])
  return (
    <div>
      <div className={s.fieldLabel}>When · <span className={s.fieldHint}>{label}</span></div>
      <div className={s.chipRow}>
        <button type="button" className={isAll ? s.chipTrack : s.chip} onClick={() => onRange([0, months.length - 1])}>All</button>
        {years.length > 1 && years.map((y) => (
          <button key={y} type="button" className={isYear(y) ? s.chipTrack : s.chip} onClick={() => onRange(yearSpan(y))}>{y}</button>
        ))}
      </div>
      <div className={s.monthStrip}>
        {years.map((y) => (
          <div className={s.monthRow} key={y}>
            <span className={s.monthYear}>’{y.slice(2)}</span>
            {MONTH_LETTERS.map((L, mi) => {
              const idx = months.indexOf(`${y}-${String(mi + 1).padStart(2, '0')}`)
              if (idx < 0) return <span key={mi} className={s.monthCellEmpty} />
              const active = idx >= a && idx <= b
              return (
                <button key={mi} type="button" className={active ? s.monthCellActive : s.monthCell}
                  onClick={(e) => pick(idx, e.shiftKey)} title={fmtMonth(months[idx])}>{L}</button>
              )
            })}
          </div>
        ))}
      </div>
      <div className={s.legendNoteText}>Click a month · shift-click for a span</div>
    </div>
  )
}
