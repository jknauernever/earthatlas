import { brand, onBrandHost } from './brand.js'

/**
 * The browser's Mapbox token. On a white-label partner's own hostname it is that partner's token (lib/brand.js
 * mapboxToken, made by scripts/brand/new-partner.mjs), so their map loads show up under their own token in
 * Mapbox's statistics and can be billed to them. Everywhere else — including ?brand= previews on localhost,
 * which partner tokens' URL restrictions would refuse — it is EarthAtlas's own VITE_MAPBOX_TOKEN.
 */
export const mapboxToken = (onBrandHost && brand?.mapboxToken) || import.meta.env.VITE_MAPBOX_TOKEN
