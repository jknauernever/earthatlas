import { useEffect, useState } from 'react'
import styles from './ZoomIndicator.module.css'

/**
 * ZoomIndicator — tiny live "current zoom level" badge for EarthAtlas map
 * tools. Sits top-right, just below the Mapbox NavigationControl, and reads
 * the same on every map (/forestmonitor, /fire, /quakes, …) so the suite is
 * consistent. Pass the Mapbox map instance; it self-subscribes to zoom
 * changes and cleans up on unmount.
 *
 * Standard EarthAtlas map-tool feature — see EarthAtlas map-tool conventions
 * (docs/MAP_TOOL_CONVENTIONS.md). Render it once the map exists:
 *   {mapReady && <ZoomIndicator map={mapRef.current} />}
 */
export default function ZoomIndicator({ map }) {
  const [zoom, setZoom] = useState(null)

  useEffect(() => {
    if (!map) return
    const update = () => {
      try { setZoom(map.getZoom()) } catch { /* map torn down */ }
    }
    update()
    map.on('zoom', update)
    return () => { try { map.off('zoom', update) } catch { /* already removed */ } }
  }, [map])

  if (zoom == null) return null

  return (
    <div className={styles.badge} aria-label={`Map zoom level ${zoom.toFixed(1)}`}>
      <span className={styles.label}>z</span>{zoom.toFixed(1)}
    </div>
  )
}
