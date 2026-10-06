/**
 * /sanjuan-docks/review — dev-only labelling page for the dock-detection pilot
 * (scripts/sanjuan-docks/ml). Steps through the pilot area's aerial tiles along the
 * shore; the reviewer marks each model detection dock / not a dock and draws any dock
 * the model missed (shore end → outer end, as a line). Marks are kept in map
 * coordinates, so overlapping tiles show them again, and saved through the dev
 * middleware in vite.config.js (dockReviewPlugin) to data/sanjuan-docks/ml/review/labels.json.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styles from './DockReview.module.css'

const API = '/api/dock-review'
const R = 6378137
const toMerc = ([lon, lat]) => [R * lon * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))]
const toLonLat = ([x, y]) => [x / R * 180 / Math.PI, (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI]
const NEXT_STATE = { undefined: 'yes', yes: 'no', no: undefined }

// Why review_queue.py picked this photo — the question it puts to the reviewer.
const WHY = {
  unknown: 'Why this photo: the model outlined something that isn’t in any dock record. Is it a dock?',
  missed: 'Why this photo: our records put a dock here, but the model didn’t outline it. Is the dock really there?',
  unsure: 'Why this photo: the model outlined a known dock but wasn’t sure. Confirm it.',
  empty: 'Why this photo: a random check of shore where nobody has recorded a dock. Any dock here?',
}
const KNOWN_BY = { osm: 'OpenStreetMap', friends: 'The Friends survey', wdfw_permit: 'A WDFW permit' }

function rings(geom) {
  if (geom.type === 'Polygon') return [geom.coordinates[0]]
  if (geom.type === 'MultiPolygon') return geom.coordinates.map((p) => p[0])
  if (geom.type === 'LineString') return [geom.coordinates]
  return []
}

export default function DockReview() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [labels, setLabels] = useState(null) // { det: {id: 'yes'|'no'}, drawn: [{id, coords}], reviewed: {tileId: true} }
  const [idx, setIdx] = useState(0)
  const [drawing, setDrawing] = useState(null) // [[lon, lat], …] while drawing a missed dock
  const [selected, setSelected] = useState(null) // id of a drawn dock, for deleting
  const [saveState, setSaveState] = useState('')
  const [roundDone, setRoundDone] = useState(false) // every photo in this round's queue answered
  const svgRef = useRef(null)

  useEffect(() => {
    Promise.all([fetch(`${API}/tasks`).then((r) => r.json()), fetch(`${API}/labels`).then((r) => r.json())])
      .then(([tasks, saved]) => {
        if (tasks.error) throw new Error(tasks.error)
        const l = { det: saved.det ?? {}, known: saved.known ?? {}, drawn: saved.drawn ?? [], reviewed: saved.reviewed ?? {} }
        setData(tasks)
        setLabels(l)
        const first = tasks.tiles.findIndex((t) => !l.reviewed[t.id])
        setIdx(first < 0 ? 0 : first)
        setRoundDone(first < 0)
      })
      .catch((e) => setError(String(e)))
  }, [])

  // Save every change (debounced) — the file is the only copy. A failed save (dev
  // server down, or another app on the port) shows a red banner and retries every
  // 10 s until it lands, so answers can't be lost silently.
  const firstSave = useRef(true)
  const [saveTry, setSaveTry] = useState(0)
  useEffect(() => {
    if (!labels) return
    if (firstSave.current) { firstSave.current = false; return }
    setSaveState('saving…')
    const t = setTimeout(() => {
      fetch(`${API}/labels`, { method: 'POST', body: JSON.stringify(labels) })
        .then((r) => r.json()).then((j) => { if (!j.ok) throw new Error('bad reply'); setSaveState('saved'); setSaveTry(0) })
        .catch(() => setSaveState('failed'))
    }, saveTry ? 10000 : 300)
    return () => clearTimeout(t)
  }, [labels, saveTry])
  useEffect(() => { if (saveState === 'failed') setSaveTry((n) => n + 1) }, [saveState])

  const tile = data?.tiles[idx]
  const px = data?.px ?? 640
  const project = useCallback((ll) => {
    const [x0, y0, x1, y1] = tile.bbox
    const [x, y] = toMerc(ll)
    return [(x - x0) / (x1 - x0) * px, (y1 - y) / (y1 - y0) * px]
  }, [tile, px])
  const unproject = useCallback(([u, v]) => {
    const [x0, y0, x1, y1] = tile.bbox
    return toLonLat([x0 + u / px * (x1 - x0), y1 - v / px * (y1 - y0)])
  }, [tile, px])
  const inTile = useCallback((pts) => pts.some(([u, v]) => u >= -20 && u <= px + 20 && v >= -20 && v <= px + 20), [px])

  const view = useMemo(() => {
    if (!tile) return null
    const dets = data.detections.map((f) => ({ id: f.properties.detection_id, conf: f.properties.model_confidence, rings: rings(f.geometry).map((r) => r.map(project)) }))
      .filter((d) => d.rings.some(inTile))
    const knownShapes = data.known.filter((f) => f.properties.kind === 'shape').map((f) => rings(f.geometry).map((r) => r.map(project))).filter((rs) => rs.some(inTile))
    const missedIds = new Set(tile.reasons.filter((r) => r.kind === 'missed').map((r) => r.ref))
    const knownPts = data.known.filter((f) => f.properties.kind === 'point' && (f.properties.located_by !== 'osm' || missedIds.has(f.properties.facility_id)))
      .map((f) => ({ id: f.properties.facility_id, by: f.properties.located_by, missed: missedIds.has(f.properties.facility_id), p: project(f.geometry.coordinates) }))
      .filter((k) => inTile([k.p]))
    const drawn = labels.drawn.map((d) => ({ id: d.id, pts: d.coords.map(project) })).filter((d) => inTile(d.pts))
    return { dets, knownShapes, knownPts, drawn }
  }, [tile, data, labels, project, inTile])

  const go = useCallback((delta, markReviewed) => {
    if (!data) return
    if (markReviewed && tile) setLabels((l) => ({ ...l, reviewed: { ...l.reviewed, [tile.id]: true } }))
    setDrawing(null)
    setSelected(null)
    setIdx((i) => Math.max(0, Math.min(data.tiles.length - 1, i + delta)))
  }, [data, tile])

  const drawingRef = useRef(null)
  drawingRef.current = drawing
  const finishDrawing = useCallback((dropLast = false) => {
    const d = drawingRef.current ? drawingRef.current.slice(0, dropLast ? -1 : undefined) : null
    if (d && d.length >= 2) {
      setLabels((l) => ({ ...l, drawn: [...l.drawn, { id: `d${Date.now()}`, coords: d, tile: tile.id }] }))
    }
    setDrawing(null)
  }, [tile])

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT') return
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); go(1, true) }
      else if (e.key === 'ArrowLeft') go(-1, false)
      else if (e.key === 'd' || e.key === 'D') setDrawing((d) => d ?? [])
      else if (e.key === 'Enter') finishDrawing(false)
      else if (e.key === 'Escape') { setDrawing(null); setSelected(null) }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        setLabels((l) => ({ ...l, drawn: l.drawn.filter((d) => d.id !== selected) }))
        setSelected(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, finishDrawing, selected])

  const svgPoint = (e) => {
    const r = svgRef.current.getBoundingClientRect()
    return [(e.clientX - r.left) / r.width * px, (e.clientY - r.top) / r.height * px]
  }
  const onSvgClick = (e) => {
    if (drawing) setDrawing((d) => [...d, unproject(svgPoint(e))])
    else setSelected(null)
  }
  // A double-click lands two clicks first: drop the duplicate point, then finish.
  const onSvgDoubleClick = () => {
    if (drawing) finishDrawing(true)
  }
  const setKnown = (id, value) => setLabels((l) => {
    const known = { ...l.known }
    if (value) known[id] = value
    else delete known[id]
    return { ...l, known }
  })
  const setDet = (id, value) => setLabels((l) => {
    const det = { ...l.det }
    if (value) det[id] = value
    else delete det[id]
    return { ...l, det }
  })
  // Clicking an outline on the photo steps it: unmarked → dock → not a dock → unmarked.
  const cycleDet = (e, id) => {
    if (drawing) return
    e.stopPropagation()
    setDet(id, NEXT_STATE[labels.det[id]])
  }

  useEffect(() => { document.title = 'Dock review · EarthAtlas' }, [])

  if (error) return <div className={styles.page}><div className={styles.side}>Could not load the review data: {error}</div></div>
  if (!data || !labels) return <div className={styles.page}><div className={styles.side}>Loading…</div></div>

  const reviewedCount = data.tiles.filter((t) => labels.reviewed[t.id]).length // of this queue
  if (roundDone) {
    return (
      <div className={styles.page}>
        <div className={styles.done}>
          <div className={styles.title}>This round is complete</div>
          <p>You’ve answered all {data.tiles.length} photos in this round. The model is retraining on your answers;
            the next round’s photos appear here once it has run on the next stretch of shore.</p>
          <div className={styles.buttons}>
            <button onClick={() => { setRoundDone(false); setIdx(0) }}>Look back through this round</button>
          </div>
        </div>
      </div>
    )
  }
  const vals = Object.values(labels.det)
  const [lon, lat] = toLonLat([(tile.bbox[0] + tile.bbox[2]) / 2, (tile.bbox[1] + tile.bbox[3]) / 2])
  const ring = (pts) => pts.map((p) => p.join(',')).join(' ')

  return (
    <div className={styles.page}>
      <div className={styles.stage}>
        <div className={styles.frame}>
          <img className={styles.photo} src={`${API}/tile/${tile.id}`} alt={`Aerial tile ${tile.id}`} draggable={false} />
          <svg
            ref={svgRef}
            className={`${styles.overlay} ${drawing ? styles.drawingCursor : ''}`}
            viewBox={`0 0 ${px} ${px}`}
            onClick={onSvgClick}
            onDoubleClick={onSvgDoubleClick}
          >
            {view.knownShapes.map((rs, i) => rs.map((r, j) => <polyline key={`k${i}-${j}`} className={styles.known} points={ring(r)} />))}
            {view.knownPts.map((k, i) => <circle key={`kp${i}`} className={k.missed ? styles.knownMissed : styles.knownPt} cx={k.p[0]} cy={k.p[1]} r={k.missed ? 16 : 6} />)}
            {view.dets.map((d) => d.rings.map((r, j) => (
              <polygon
                key={`${d.id}-${j}`}
                className={`${styles.det} ${labels.det[d.id] === 'yes' ? styles.detYes : labels.det[d.id] === 'no' ? styles.detNo : ''}`}
                points={ring(r)}
                onClick={(e) => cycleDet(e, d.id)}
              ><title>{`${d.id} · model confidence ${Math.round(d.conf * 100)}%`}</title></polygon>
            )))}
            {view.dets.map((d, n) => {
              const pts = d.rings.flat().filter(([u, v]) => u >= 0 && u <= px && v >= 0 && v <= px)
              if (!pts.length) return null
              const [u, v] = pts.reduce((a, p) => (p[1] < a[1] ? p : a))
              return (
                <g key={`n${d.id}`} className={styles.badge} transform={`translate(${Math.min(px - 18, Math.max(18, u))},${Math.max(18, v - 16)})`}>
                  <circle r={14} /><text dy={5}>{n + 1}</text>
                </g>
              )
            })}
            {view.drawn.map((d) => (
              <polyline
                key={d.id}
                className={`${styles.drawn} ${selected === d.id ? styles.drawnSelected : ''}`}
                points={ring(d.pts)}
                onClick={(e) => { if (!drawing) { e.stopPropagation(); setSelected(d.id) } }}
              />
            ))}
            {drawing && drawing.length > 0 && <polyline className={styles.drawnLive} points={ring(drawing.map(project))} />}
          </svg>
        </div>
      </div>

      <div className={styles.side}>
        <div className={styles.title}>Dock review</div>
        <div className={styles.meta}>
          Photo {idx + 1} of {data.tiles.length} (only the ones worth a look) · {reviewedCount} done · {vals.filter((v) => v === 'yes').length} ✓{' '}
          {vals.filter((v) => v === 'no').length} ✗ · {labels.drawn.length} drawn
        </div>
        <div className={styles.progress}><div style={{ width: `${reviewedCount / data.tiles.length * 100}%` }} /></div>

        <div className={styles.why}>{WHY[tile.kind]}</div>
        <div className={styles.card}>
          <div className={styles.cardTitle}>In this photo</div>
          {view.knownPts.filter((k) => k.missed).map((k) => (
            <div key={k.id} className={styles.detRow}>
              <span className={styles.knownNum}>◎</span>
              <span className={styles.detText}>{KNOWN_BY[k.by]} says a dock is here (big cyan ring); the model didn’t outline it</span>
              <button className={labels.known[k.id] === 'yes' ? styles.onYes : ''} onClick={() => setKnown(k.id, labels.known[k.id] === 'yes' ? undefined : 'yes')}>✓ Dock is there</button>
              <button className={labels.known[k.id] === 'no' ? styles.onNo : ''} onClick={() => setKnown(k.id, labels.known[k.id] === 'no' ? undefined : 'no')}>✗ No dock here</button>
            </div>
          ))}
          {view.dets.length === 0
            ? <div className={styles.meta}>The model outlined nothing here.</div>
            : view.dets.map((d, n) => (
              <div key={d.id} className={styles.detRow}>
                <span className={styles.detNum}>{n + 1}</span>
                <span className={styles.detText}>Model outline · {Math.round(d.conf * 100)}% sure</span>
                <button className={labels.det[d.id] === 'yes' ? styles.onYes : ''} onClick={() => setDet(d.id, labels.det[d.id] === 'yes' ? undefined : 'yes')}>✓ Dock</button>
                <button className={labels.det[d.id] === 'no' ? styles.onNo : ''} onClick={() => setDet(d.id, labels.det[d.id] === 'no' ? undefined : 'no')}>✗ Not a dock</button>
              </div>
            ))}
          {view.drawn.length > 0 && <div className={styles.meta}>{view.drawn.length} dock{view.drawn.length > 1 ? 's' : ''} you drew {view.drawn.length > 1 ? 'are' : 'is'} in this photo (yellow).</div>}
          <div className={styles.buttons}>
            {drawing
              ? <><button className={styles.primary} onClick={() => finishDrawing(false)}>Finish this dock (Enter)</button><button onClick={() => setDrawing(null)}>Cancel (Esc)</button></>
              : <button onClick={() => setDrawing([])}>＋ Draw a dock the model missed (D)</button>}
            {selected && !drawing && (
              <button onClick={() => { setLabels((l) => ({ ...l, drawn: l.drawn.filter((d) => d.id !== selected) })); setSelected(null) }}>Delete the selected drawn dock</button>
            )}
          </div>
          {drawing && <div className={styles.meta}>Click on the photo from the shore end out along the dock; double-click or Enter to finish.</div>}
        </div>

        <div className={styles.buttons}>
          <button onClick={() => go(-1, false)}>← Back</button>
          <button className={styles.primary} onClick={() => go(1, true)}>
            {view.dets.length === 0 && view.drawn.length === 0 && !view.knownPts.some((k) => k.missed) ? 'No docks in this photo — next →' : 'That’s every dock — next →'}
          </button>
        </div>

        <div className={styles.help}>
          <p><b>For each photo:</b> answer each numbered model outline (dashed magenta) <span className={styles.yes}>✓ Dock</span> or <span className={styles.no}>✗ Not a dock</span>; draw any dock it missed; then press the blue button (or → / Space).</p>
          <p><b>Drawing:</b> click from the shore end out along the dock, one click at each bend or float; double-click or Enter to finish. Click a yellow line, then Delete, to remove it.</p>
          <p className={styles.legendRow}><span className={styles.swKnown} />Docks we already know (OpenStreetMap tracing, Friends / WDFW point) — for reference only.</p>
          <p>Photos overlap: anything you mark shows up again on the next photo, so mark each dock once.</p>
        </div>

        <div className={styles.meta}>
          {tile.id} ·{' '}
          <a href={`/sanjuan-docks?lat=${lat.toFixed(5)}&lng=${lon.toFixed(5)}&z=18`} target="_blank" rel="noopener noreferrer">open on the dock map ↗</a>
          {labels.reviewed[tile.id] && ' · done'}
        </div>
        {saveState === 'failed' || saveTry > 0 && saveState !== 'saved'
          ? <div className={styles.saveFail}>Your answers are NOT saved yet — the EarthAtlas dev server isn’t answering on this address. Keep this tab open: they’ll save automatically when it’s back (retrying every 10 s).</div>
          : <div className={styles.meta}>{saveState}</div>}
      </div>
    </div>
  )
}
