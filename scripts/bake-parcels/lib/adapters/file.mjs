// File source adapter: reads a local GeoJSON FeatureCollection and yields
// normalized features — for regions published as a downloadable file rather
// than a live ArcGIS service. Used by San Juan County, WA (a static
// Tax_Parcels.geojson). Same output shape as the arcgis adapter, so the rest of
// the pipeline (normalize → derive → tippecanoe) is identical.

import { readFileSync } from 'node:fs';
import { normalizeProps } from '../normalize.mjs';
import { deriveExtras } from '../derive.mjs';

// Strip 3D z + round to ~6 decimals (≈0.1 m) to keep tiles lean — matches the
// geometryPrecision the arcgis adapter requests server-side.
const P = 1e6;
const round = (pt) => [Math.round(pt[0] * P) / P, Math.round(pt[1] * P) / P];
function clean(geom) {
  if (!geom) return geom;
  if (geom.type === 'Polygon') return { type: 'Polygon', coordinates: geom.coordinates.map((r) => r.map(round)) };
  if (geom.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: geom.coordinates.map((p) => p.map((r) => r.map(round))) };
  return geom;
}

export async function* extractFile(cfg, { onProgress } = {}) {
  const data = JSON.parse(readFileSync(cfg.source.path, 'utf8'));
  const feats = data.features || [];
  let count = 0;
  for (const f of feats) {
    if (!f.geometry) continue;
    const geometry = clean(f.geometry);
    const props = normalizeProps(f.properties || {}, cfg);
    deriveExtras(props, f.properties || {}, geometry, cfg);
    yield { layerId: 0, feature: { type: 'Feature', properties: props, geometry } };
    count++;
    if (count % 2000 === 0) onProgress?.({ layerId: 0, offset: count });
  }
}
