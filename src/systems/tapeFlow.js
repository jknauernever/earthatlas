/**
 * Motion between two tape frames — a small dense optical-flow solver
 * (Lucas–Kanade, iterative, on a 4× downsampled, smoothed copy of the byte
 * grids). The replay warps both frames along this flow so plumes TRAVEL
 * between the 3-hourly analyses instead of dissolving. Where the field is
 * featureless the flow is ~0 and the blend degrades to a plain dissolve.
 *
 * Output: { W, H, ds, fx, fy } — displacement in COARSE cells from frame A
 * to frame B, row-major, longitude-periodic.
 */

const DS = 4
const WIN = 2          // half window (5×5)
const ITER = 3
const MAX_CELLS = 3    // clamp: 3 coarse cells = 12 grid cells ≈ 4.8° per 3 h
const LAMBDA = 4       // Tikhonov regularisation (byte² units)

function downsample(bytes, w, h, ds) {
  const W = Math.floor(w / ds)
  const H = Math.floor(h / ds)
  const out = new Float32Array(W * H)
  const inv = 1 / (ds * ds)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0
      for (let j = 0; j < ds; j++) {
        const row = (y * ds + j) * w + x * ds
        for (let i = 0; i < ds; i++) s += bytes[row + i]
      }
      out[y * W + x] = s * inv
    }
  }
  return { a: out, W, H }
}

// 3×3 binomial blur, periodic in x, clamped in y.
function blur(src, W, H) {
  const tmp = new Float32Array(W * H)
  const out = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const xm = (x - 1 + W) % W, xp = (x + 1) % W
      tmp[y * W + x] = 0.25 * src[y * W + xm] + 0.5 * src[y * W + x] + 0.25 * src[y * W + xp]
    }
  }
  for (let y = 0; y < H; y++) {
    const ym = Math.max(0, y - 1), yp = Math.min(H - 1, y + 1)
    for (let x = 0; x < W; x++) out[y * W + x] = 0.25 * tmp[ym * W + x] + 0.5 * tmp[y * W + x] + 0.25 * tmp[yp * W + x]
  }
  return out
}

function sampleBilinear(f, W, H, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y)
  const fx = x - x0, fy = y - y0
  const xa = ((x0 % W) + W) % W, xb = (xa + 1) % W
  const ya = Math.max(0, Math.min(H - 1, y0)), yb = Math.max(0, Math.min(H - 1, y0 + 1))
  return (f[ya * W + xa] * (1 - fx) + f[ya * W + xb] * fx) * (1 - fy) + (f[yb * W + xa] * (1 - fx) + f[yb * W + xb] * fx) * fy
}

export function computeFlow(bytesA, bytesB, w, h) {
  const { a: a0, W, H } = downsample(bytesA, w, h, DS)
  const { a: b0 } = downsample(bytesB, w, h, DS)
  const a = blur(a0, W, H)
  const b = blur(b0, W, H)
  const Ix = new Float32Array(W * H)
  const Iy = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    const ym = Math.max(0, y - 1), yp = Math.min(H - 1, y + 1)
    for (let x = 0; x < W; x++) {
      const xm = (x - 1 + W) % W, xp = (x + 1) % W
      Ix[y * W + x] = 0.5 * (a[y * W + xp] - a[y * W + xm])
      Iy[y * W + x] = 0.5 * (a[yp * W + x] - a[ym * W + x])
    }
  }
  let fx = new Float32Array(W * H)
  let fy = new Float32Array(W * H)
  const It = new Float32Array(W * H)
  for (let it = 0; it < ITER; it++) {
    // Temporal difference against B warped back by the current estimate.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const k = y * W + x
        It[k] = sampleBilinear(b, W, H, x + fx[k], y + fy[k]) - a[k]
      }
    }
    const nfx = new Float32Array(W * H)
    const nfy = new Float32Array(W * H)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let sxx = LAMBDA, sxy = 0, syy = LAMBDA, sxt = 0, syt = 0
        for (let j = -WIN; j <= WIN; j++) {
          const yy = Math.max(0, Math.min(H - 1, y + j))
          for (let i = -WIN; i <= WIN; i++) {
            const k = yy * W + (((x + i) % W) + W) % W
            const gx = Ix[k], gy = Iy[k], gt = It[k]
            sxx += gx * gx; sxy += gx * gy; syy += gy * gy; sxt += gx * gt; syt += gy * gt
          }
        }
        const det = sxx * syy - sxy * sxy
        const k = y * W + x
        if (det > 1e-6) {
          const dx = -(syy * sxt - sxy * syt) / det
          const dy = -(sxx * syt - sxy * sxt) / det
          nfx[k] = fx[k] + dx
          nfy[k] = fy[k] + dy
        } else { nfx[k] = fx[k]; nfy[k] = fy[k] }
      }
    }
    fx = blur(nfx, W, H)
    fy = blur(nfy, W, H)
  }
  for (let k = 0; k < W * H; k++) {
    const m = Math.hypot(fx[k], fy[k])
    if (m > MAX_CELLS) { fx[k] *= MAX_CELLS / m; fy[k] *= MAX_CELLS / m }
  }
  return { W, H, ds: DS, fx, fy }
}

/** Flow (in GRID cells) at fractional grid coords, bilinear on the coarse field. */
export function flowAt(flow, col, row) {
  const x = col / flow.ds - 0.5
  const y = row / flow.ds - 0.5
  return {
    dx: sampleBilinear(flow.fx, flow.W, flow.H, x, y) * flow.ds,
    dy: sampleBilinear(flow.fy, flow.W, flow.H, x, y) * flow.ds,
  }
}
