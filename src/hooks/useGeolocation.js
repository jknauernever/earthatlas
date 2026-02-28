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

    navigator.geolocation.getCurrentPosition(
      pos => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setStatus('success')
      },
      err => {
        setError('Location access denied. Please allow location permissions and try again.')
        setStatus('error')
      },
      { enableHighAccuracy: true, timeout: 12000 }
    )
  }, [])

  return { coords, status, error, locate }
}
