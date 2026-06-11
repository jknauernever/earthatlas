import { useState, useCallback } from 'react'

export function useGeolocation() {
  const [coords, setCoords]   = useState(null)   // { lat, lng }
  const [status, setStatus]   = useState('idle') // idle | loading | success | error
  const [error,  setError]    = useState(null)

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser.')
      setStatus('error')
      return
    }

    setStatus('loading')
    setError(null)

    const onSuccess = (pos) => {
      setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      setStatus('success')
    }

    // On mobile, a cold high-accuracy (GPS) fix frequently takes longer than the
    // timeout — especially indoors — so getCurrentPosition fires a TIMEOUT error,
    // no coords arrive, and the map never loads. Try a quick high-accuracy fix
    // first, and on timeout/position-unavailable fall back to a low-accuracy,
    // cache-friendly request. Network/wifi location resolves almost instantly and
    // is plenty precise for a neighborhood-scale wildlife search.
    navigator.geolocation.getCurrentPosition(
      onSuccess,
      (firstErr) => {
        // Don't retry (or re-prompt) when the user explicitly denied access.
        if (firstErr.code === firstErr.PERMISSION_DENIED) {
          setError('Location access denied. Please allow location permissions and try again.')
          setStatus('error')
          return
        }
        navigator.geolocation.getCurrentPosition(
          onSuccess,
          () => {
            setError("Couldn't determine your location. Try searching for a place instead.")
            setStatus('error')
          },
          { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
        )
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    )
  }, [])

  return { coords, status, error, locate }
}
