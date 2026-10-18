// The photos on a satellite basemap, shared by every EarthAtlas map (Josh 2026-10-18: /ships' picker everywhere).
// One choice ('best' by default, URL param `ph`) → local government aerials and/or other imagery laid over the style's own
// Mapbox photos (lib/localAerials.js). Re-applied on every style.load, so basemap switches keep the pick.
import { useEffect, useMemo, useRef, useState } from 'react'
import { addLocalAerials, setBaseImagery, localAerialsInView, photoLayers, isPhotoChoice } from '../../lib/localAerials.js'

/** The photo choice from a URL's `ph` (or 'best'). */
export const readPhoto = (sp) => (isPhotoChoice(sp.get('ph')) ? sp.get('ph') : 'best')
/** Writes the choice into URLSearchParams (left out when 'best'). */
export const writePhoto = (sp, photo) => { if (photo && photo !== 'best') sp.set('ph', photo) }

/**
 * mapRef: ref to the mapboxgl.Map; mapReady: true after its first style.load; basemap: the app's basemap id ('satellite'
 * shows photos; other styles have no photo layer, so nothing is added there).
 */
export default function useMapPhotos(mapRef, { mapReady, basemap = 'satellite', initialPhoto } = {}) {
  // From the page's own `ph` unless the site passes one.
  const [photo, setPhoto] = useState(() => {
    const ph = initialPhoto ?? (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('ph') : null)
    return isPhotoChoice(ph) ? ph : 'best'
  })
  const layers = useMemo(() => photoLayers(photo), [photo])
  const layersRef = useRef(layers)
  layersRef.current = layers
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const apply = () => {
      const { choice, base } = layersRef.current
      if (addLocalAerials(map, choice)) setBaseImagery(map, base)
      setTick((n) => n + 1)
    }
    const onMove = () => setTick((n) => n + 1)
    apply()
    map.on('style.load', apply)
    map.on('moveend', onMove)
    return () => { map.off('style.load', apply); map.off('moveend', onMove) }
  }, [mapRef, mapReady, layers])

  const satellite = basemap === 'satellite'
  const map = mapRef.current
  const aerialsHere = useMemo(() => (mapReady && satellite && map ? localAerialsInView(map, layers.choice) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick, layers, satellite, mapReady, map])
  const zoom = mapReady && map ? map.getZoom() : null

  return { photo, setPhoto, base: layers.base, aerialsHere, zoom, satellite, mapReady }
}
