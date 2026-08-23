/**
 * ClipStudio — the "record a clip" UI for /inmotion.
 *
 * Launcher button (top-right, under the basemap picker) → options panel
 * (length + camera mode) → 3·2·1 countdown → recording HUD → preview modal
 * with Download / native Share. The heavy lifting lives in clipRecorder.js;
 * this component owns the camera during Drift mode and the interaction
 * locking during Hold/Drift so a stray drag can't ruin a take.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ClipRecorder, clipSupport, mapboxBasemapSource, CLIP_LENGTHS } from './clipRecorder'
import styles from './ClipStudio.module.css'

const MODES = [
  { id: 'drift', label: 'Drift', sub: 'slow auto-rotation' },
  { id: 'hold', label: 'Hold', sub: 'camera stays put' },
  { id: 'live', label: 'Live', sub: 'you drive the globe' },
]
const CAMERA_HANDLERS = ['dragPan', 'scrollZoom', 'boxZoom', 'dragRotate', 'touchZoomRotate', 'doubleClickZoom', 'keyboard']

const fmtSec = (s) => `0:${String(Math.max(0, Math.round(s))).padStart(2, '0')}`

export default function ClipStudio({ getMap, getOverlays, getBrand, onBeforeRecord }) {
  const [ui, setUi] = useState('closed') // closed | panel | countdown | recording | finishing | preview | error
  const [seconds, setSeconds] = useState(15)
  const [mode, setMode] = useState('drift')
  const [count, setCount] = useState(3)
  const [elapsed, setElapsed] = useState(0)
  const [result, setResult] = useState(null) // { url, blob, ext, mime, name }
  const [error, setError] = useState(null)
  const recorderRef = useRef(null)
  const lockedRef = useRef(null)
  const support = clipSupport()

  // Restore camera handlers and halt any drift ease. Reads refs only, so the
  // unmount effect below can stay dependency-free — an effect that re-runs on
  // parent re-renders would tear down (and cancel!) an in-flight recording.
  const getMapRef = useRef(getMap)
  getMapRef.current = getMap
  const cleanup = useCallback(() => {
    const l = lockedRef.current
    if (l) {
      for (const h of l.handlers) { try { l.map[h].enable() } catch { /* handler gone */ } }
      lockedRef.current = null
    }
    try { getMapRef.current()?.stop() } catch { /* map gone */ }
  }, [])

  // Revoke the preview object URL when it's replaced or on unmount.
  useEffect(() => () => { if (result?.url) URL.revokeObjectURL(result.url) }, [result])
  // True unmount only — deps deliberately empty.
  useEffect(() => () => { recorderRef.current?.cancel(); cleanup() }, [cleanup])

  const record = useCallback(async () => {
    const map = getMap()
    if (!map) return
    onBeforeRecord?.()
    setUi('countdown')
    for (const n of [3, 2, 1]) {
      setCount(n)
      await new Promise((r) => setTimeout(r, 700))
    }

    // Hold/Drift: freeze user input so a stray drag can't ruin the take.
    if (mode !== 'live') {
      const handlers = CAMERA_HANDLERS.filter((h) => map[h]?.isEnabled())
      lockedRef.current = { map, handlers }
      for (const h of handlers) { try { map[h].disable() } catch { /* optional handler */ } }
    }
    // Drift: one linear ease across the whole take — visually it's a user
    // slowly dragging, which every overlay renderer already handles.
    if (mode === 'drift') {
      const c = map.getCenter()
      const rate = Math.min(5, Math.max(0.4, 4 / Math.pow(2, Math.max(0, map.getZoom() - 2)))) // °/s eastward
      map.easeTo({ center: [c.lng + rate * seconds, c.lat], duration: seconds * 1000, easing: (t) => t, essential: true })
    }

    const recorder = new ClipRecorder({
      basemap: mapboxBasemapSource(map),
      overlays: getOverlays(),
      getBrand,
      onProgress: (sec, total, phase) => {
        setElapsed(sec)
        if (phase === 'finish') setUi('finishing')
      },
    })
    recorderRef.current = recorder
    if (import.meta.env.DEV) window.__clipRec = recorder // dev-only QA handle
    setElapsed(0)
    setUi('recording')
    try {
      const out = await recorder.start({ seconds })
      cleanup()
      const brand = getBrand()
      const date = new Date().toISOString().slice(0, 10)
      const slug = brand.layerIds.length ? brand.layerIds.join('-') : 'globe'
      setResult({
        ...out,
        url: URL.createObjectURL(out.blob),
        name: `earthatlas-inmotion-${date}-${slug}.${out.ext}`,
      })
      setUi('preview')
    } catch (err) {
      cleanup()
      if (err?.message === 'cancelled') { setUi('closed'); return }
      console.error('[systems] clip recording failed:', err)
      setError(err?.message || 'Recording failed')
      setUi('error')
    } finally {
      recorderRef.current = null
    }
  }, [getMap, getOverlays, getBrand, onBeforeRecord, mode, seconds, cleanup])

  const download = useCallback(() => {
    if (!result) return
    const a = document.createElement('a')
    a.href = result.url
    a.download = result.name
    a.click()
  }, [result])

  const share = useCallback(async () => {
    if (!result) return
    const file = new File([result.blob], result.name, { type: result.mime })
    try { await navigator.share({ files: [file] }) } catch { /* user dismissed the sheet */ }
  }, [result])

  const canShareFiles = result && typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [new File([''], 'x.mp4', { type: 'video/mp4' })] })

  return (
    <>
      <div className={styles.launcher}>
        <button
          type="button"
          className={ui !== 'closed' ? styles.toggleActive : styles.toggle}
          onClick={() => setUi(ui === 'closed' ? 'panel' : 'closed')}
          aria-label="Record a clip" title="Record a clip"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m22 8-6 4 6 4V8Z" /><rect x="2" y="6" width="14" height="12" rx="2" />
          </svg>
        </button>

        {ui === 'panel' && (
          <div className={styles.panel}>
            <div className={styles.panelTitle}>Record a clip</div>
            {!support.engine ? (
              <p className={styles.note}>This browser can&apos;t record video — try Chrome, Edge, or Safari.</p>
            ) : (
              <>
                <div className={styles.fieldLabel}>Length</div>
                <div className={styles.chipRow}>
                  {CLIP_LENGTHS.map((s) => (
                    <button key={s} type="button" className={s === seconds ? styles.chipActive : styles.chip} onClick={() => setSeconds(s)}>
                      {s}s
                    </button>
                  ))}
                </div>
                <div className={styles.fieldLabel}>Camera</div>
                <div className={styles.modeCol}>
                  {MODES.map((m) => (
                    <button key={m.id} type="button" className={m.id === mode ? styles.modeActive : styles.mode} onClick={() => setMode(m.id)}>
                      <span className={styles.modeLabel}>{m.label}</span>
                      <span className={styles.modeSub}>{m.sub}</span>
                    </button>
                  ))}
                </div>
                <button type="button" className={styles.recordBtn} onClick={record}>
                  <span className={styles.recDot} aria-hidden="true" /> Record {seconds}s
                </button>
                {support.ext === 'webm' && (
                  <p className={styles.note}>This browser saves WebM (fine for YouTube; Instagram prefers MP4 — use Chrome or Safari for that).</p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {ui === 'countdown' && (
        <div className={styles.countdown} aria-hidden="true"><span key={count}>{count}</span></div>
      )}

      {(ui === 'recording' || ui === 'finishing') && (
        <div className={styles.hud}>
          <span className={styles.recDotLive} aria-hidden="true" />
          {ui === 'finishing'
            ? <span className={styles.hudText}>Finishing…</span>
            : <span className={styles.hudText}>REC {fmtSec(elapsed)} / {fmtSec(seconds)}</span>}
          {ui === 'recording' && (
            <>
              <button type="button" className={styles.hudBtn} onClick={() => recorderRef.current?.stop()}>Stop</button>
              <button type="button" className={styles.hudBtnDim} onClick={() => recorderRef.current?.cancel()}>Cancel</button>
            </>
          )}
        </div>
      )}

      {ui === 'preview' && result && (
        <div className={styles.modalBackdrop} onClick={() => setUi('closed')}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <button type="button" className={styles.modalClose} onClick={() => setUi('closed')} aria-label="Close">×</button>
            <div className={styles.modalTitle}>Your clip is ready</div>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption -- silent video */}
            <video className={styles.video} src={result.url} controls autoPlay loop playsInline muted />
            <div className={styles.modalRow}>
              <button type="button" className={styles.primaryBtn} onClick={download}>Download</button>
              {canShareFiles && <button type="button" className={styles.secondaryBtn} onClick={share}>Share…</button>}
              <button type="button" className={styles.secondaryBtn} onClick={() => { setUi('panel') }}>Record again</button>
            </div>
            <p className={styles.modalHint}>
              MP4, 1080p — ready for YouTube, Instagram, Facebook, LinkedIn, or your blog.
              The end card&apos;s QR code opens this exact live view.
            </p>
          </div>
        </div>
      )}

      {ui === 'error' && (
        <div className={styles.modalBackdrop} onClick={() => setUi('closed')}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <button type="button" className={styles.modalClose} onClick={() => setUi('closed')} aria-label="Close">×</button>
            <div className={styles.modalTitle}>Couldn&apos;t record</div>
            <p className={styles.modalHint}>{error}</p>
          </div>
        </div>
      )}
    </>
  )
}
