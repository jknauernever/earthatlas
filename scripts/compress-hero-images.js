/**
 * Compress hero images in /public.
 *
 * Re-encodes each *-hero.jpg with sharp at quality 78 and caps the longest
 * edge at 1600px (sufficient for retina up to ~800px display width). Writes
 * back to the same path so existing references in src/explore/configs keep
 * working unchanged.
 *
 * Run once before a deploy:
 *   node scripts/compress-hero-images.js
 */

import sharp from 'sharp'
import { readdir, stat, rename, unlink } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = join(__dirname, '..', 'public')

const MAX_EDGE = 1600
const QUALITY = 78

async function compressOne(path) {
  const tmp = `${path}.tmp.jpg`
  const before = (await stat(path)).size
  await sharp(path)
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: QUALITY, mozjpeg: true, progressive: true })
    .toFile(tmp)
  const after = (await stat(tmp)).size
  if (after < before) {
    await unlink(path)
    await rename(tmp, path)
    return { before, after, kept: 'compressed' }
  }
  await unlink(tmp)
  return { before, after, kept: 'original (compressed was larger)' }
}

const files = (await readdir(PUBLIC_DIR))
  .filter(f => /-hero\.jpe?g$/i.test(f) || /-social\.jpe?g$/i.test(f))
  .sort()

let totalBefore = 0
let totalAfter = 0
for (const f of files) {
  const path = join(PUBLIC_DIR, f)
  const { before, after, kept } = await compressOne(path)
  totalBefore += before
  totalAfter += after
  const beforeKb = (before / 1024).toFixed(0)
  const afterKb = (after / 1024).toFixed(0)
  const pct = (((before - after) / before) * 100).toFixed(0)
  console.log(`  ${f.padEnd(28)} ${beforeKb.padStart(5)} KB → ${afterKb.padStart(5)} KB (${pct}% saved, ${kept})`)
}

const beforeMb = (totalBefore / 1024 / 1024).toFixed(2)
const afterMb = (totalAfter / 1024 / 1024).toFixed(2)
const totalPct = (((totalBefore - totalAfter) / totalBefore) * 100).toFixed(0)
console.log(`\n  Total: ${beforeMb} MB → ${afterMb} MB (${totalPct}% saved across ${files.length} files)`)
