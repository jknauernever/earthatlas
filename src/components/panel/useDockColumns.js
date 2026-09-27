import { useLayoutEffect, useState } from 'react'

/**
 * How many icons per row the collapsed icon dock needs to fit the window (Josh 2026-09-27: on shorter screens the
 * icons ran off the bottom). Tries 2, then 3, up to 6 columns and keeps the first whose bottom edge clears the
 * window; re-checks on resize and whenever `itemCount` changes (layers that appear after loading).
 *
 * The dock's CSS reads the result as `--dock-cols` (grid columns and dock width), so set it in the dock's style:
 *   const cols = useDockColumns(dockRef, layers.length)
 *   <div ref={dockRef} style={{ '--dock-cols': cols }} …>
 */
export default function useDockColumns(ref, itemCount, { min = 2, max = 6, margin = 12 } = {}) {
  const [cols, setCols] = useState(min)
  useLayoutEffect(() => {
    const fit = () => {
      const el = ref.current
      if (!el) return
      let c = min
      for (; c < max; c++) {
        el.style.setProperty('--dock-cols', String(c)) // measure synchronously at this width
        if (el.getBoundingClientRect().bottom <= window.innerHeight - margin) break
      }
      el.style.setProperty('--dock-cols', String(c))
      setCols(c)
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [ref, itemCount, min, max, margin])
  return cols
}
