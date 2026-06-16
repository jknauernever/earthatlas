// ArcGIS source adapter: pages an ArcGIS MapServer/FeatureServer and yields
// normalized GeoJSON Features. Used by NM (gis.ose.nm.gov). The next region
// may use a different adapter (see file.mjs) — the extract driver is adapter-agnostic.

import { normalizeProps } from '../normalize.mjs';
import { deriveExtras } from '../derive.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseLayerIds(spec) {
  if (Array.isArray(spec)) return spec;
  const m = String(spec).match(/^(\d+)\s*-\s*(\d+)$/);
  if (m) {
    const a = +m[1], b = +m[2];
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  }
  return String(spec).split(',').map((s) => +s.trim());
}

async function fetchJson(url, { tries = 4 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 60_000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (j.error) throw new Error(`ArcGIS error: ${JSON.stringify(j.error)}`);
      return j;
    } catch (e) {
      lastErr = e;
      if (attempt < tries) await sleep(1000 * attempt); // backoff
    }
  }
  throw lastErr;
}

// Yields { feature, layerId } for every record across all layers.
export async function* extractArcgis(cfg, { onProgress } = {}) {
  const { serviceUrl, layerIds, pageSize = 5000, outFields, geometryPrecision = 6 } = cfg.source;
  const ids = parseLayerIds(layerIds);

  for (const layerId of ids) {
    let offset = 0;
    let layerCount = 0;
    for (;;) {
      const params = new URLSearchParams({
        where: '1=1',
        outFields: outFields.join(','),
        returnGeometry: 'true',
        outSR: '4326',
        geometryPrecision: String(geometryPrecision),
        resultRecordCount: String(pageSize),
        resultOffset: String(offset),
        f: 'geojson',
      });
      const url = `${serviceUrl}/${layerId}/query?${params}`;
      const data = await fetchJson(url);
      const feats = data.features || [];
      for (const f of feats) {
        if (!f.geometry) continue;
        const props = normalizeProps(f.properties || {}, cfg);
        deriveExtras(props, f.properties || {}, f.geometry, cfg); // acres from geom, land_use from code
        yield {
          layerId,
          feature: { type: 'Feature', properties: props, geometry: f.geometry },
        };
      }
      layerCount += feats.length;
      offset += feats.length;
      onProgress?.({ layerId, layerCount, offset });
      if (feats.length < pageSize) break; // last page
      await sleep(120); // be polite to the public service
    }
  }
}
