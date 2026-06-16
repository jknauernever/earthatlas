// Map a source feature's raw properties onto the canonical parcel schema.
// Every region's PMTiles ends up with the SAME property keys, so the client
// and popup never need a per-region fieldMap at runtime.
//
// Canonical keys: apn, owner, owner2, addr, city, zip, land_use, acres,
//                 county, structures, tax_year, region_id
// (assessed_value is canonical too, but NM has no such field — stays absent.)

export function normalizeProps(rawProps, { fieldMap, constants = {}, numberFields = [] }) {
  const out = {};
  for (const [canonical, sourceField] of Object.entries(fieldMap)) {
    let v = rawProps[sourceField];
    if (v === null || v === undefined) continue;
    if (typeof v === 'string') {
      v = v.trim();
      if (v === '') continue; // drop empties to keep tiles lean
    }
    if (numberFields.includes(canonical)) {
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) continue;
      // round acreage to 2dp; leave integer-ish fields whole
      v = canonical === 'acres' ? Math.round(n * 100) / 100 : n;
    }
    out[canonical] = v;
  }
  for (const [k, val] of Object.entries(constants)) out[k] = val;
  return out;
}
