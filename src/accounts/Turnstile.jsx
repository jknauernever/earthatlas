import { useEffect, useRef } from 'react'

// Cloudflare Turnstile widget (explicit render). https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let loading = null
function loadScript() {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = SRC
      s.async = true
      s.onload = () => resolve(window.turnstile)
      s.onerror = () => { loading = null; reject(new Error('Could not load the human check.')) }
      document.head.appendChild(s)
    })
  }
  return loading
}

/**
 * Renders the widget and reports its token through onToken (null when it expires or errors).
 * `resetKey` changes → widget resets (a token works once, so reset after every submit).
 */
export default function Turnstile({ siteKey, action, onToken, resetKey = 0 }) {
  const box = useRef(null)
  const widget = useRef(null)
  const cb = useRef(onToken)
  cb.current = onToken

  useEffect(() => {
    if (!siteKey) return undefined
    let cancelled = false
    loadScript().then((ts) => {
      if (cancelled || !box.current) return
      widget.current = ts.render(box.current, {
        sitekey: siteKey,
        action,
        theme: 'light',
        size: 'flexible',
        callback: (t) => cb.current(t),
        'expired-callback': () => cb.current(null),
        'error-callback': () => cb.current(null),
      })
    }).catch(() => cb.current(null))
    return () => {
      cancelled = true
      if (widget.current != null && window.turnstile) window.turnstile.remove(widget.current)
      widget.current = null
    }
  }, [siteKey, action])

  useEffect(() => {
    if (resetKey && widget.current != null && window.turnstile) { window.turnstile.reset(widget.current); cb.current(null) }
  }, [resetKey])

  return <div ref={box} style={{ minHeight: 65 }} />
}
