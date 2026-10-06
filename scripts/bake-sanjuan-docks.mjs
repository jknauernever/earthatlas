#!/usr/bin/env node
// Bake every dock permit we can get for San Juan County into one static GeoJSON,
// one point per dock with all its permits oldest → newest:
//
//   1. WDFW Hydraulic Project Approvals (HPA), 2014–2024 — WDFW public ArcGIS view
//      (last edited by WDFW 2024-12-02). Dock = ProjectType "Overwater Structure" /
//      "Dock Maintenance/Repair", or an untyped record (~40% are) whose name mentions
//      dock/pier/float/gangway. Typed non-dock work is excluded even if named for a
//      dock ("West Dock Beach Stabilization").
//   2. San Juan County land-use permits, pre-SmartGov (dates 1972–2010, despite the layer name "1991-2009") — county ArcGIS layer
//      Orion/Permits/3; description mentions dock/pier/float/gangway.
//   3. San Juan County SmartGov permits 2010→ — optional, read from
//      data/sanjuan-docks/smartgov-permits.json when present (scripts/sanjuan-docks/
//      smartgov-parcel-permits.mjs fetches them one parcel at a time).
//
//   node scripts/bake-sanjuan-docks.mjs
//
// Grouping: permits sharing a county parcel are one dock. WDFW points are at the dock
// itself, so WDFW permits without a parcel also join anything within 10 m. County
// points sit at the parcel, so they join by parcel only. A dock is drawn at its most
// recent WDFW permit's location, else at the county parcel point.

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';

const OUT = 'public/hpa/san-juan-docks.geojson';
const WDFW_SERVICE =
  'https://services.arcgis.com/rcya3vExsaVBGUDp/arcgis/rest/services/HPALocations_ProjectTypePublicView/FeatureServer/0';
const WDFW_PAGE = 'https://wdfw.wa.gov/licenses/environmental/hpa';
const SJC_1991_LAYER = 'https://gis.sanjuancountywa.gov/arcgis/rest/services/Orion/Permits/MapServer/3';
const SMARTGOV_FILE = 'data/sanjuan-docks/smartgov-permits.json';
// Per-permit page links (source_url points at the permit itself, not a search page):
//  - WDFW: APPS ID → Salesforce recordId, captured from the public APPS search
//    (County = San Juan); each page lists the permit PDF and every attachment.
//  - SmartGov: permit number → case GUID (scripts/sanjuan-docks/smartgov-permit-links.mjs).
//  - County pre-2010: not in SmartGov, so the link is that record in the county layer.
const WDFW_IDS_FILE = 'data/sanjuan-docks/wdfw-record-ids.json';
const SMARTGOV_GUIDS_FILE = 'data/sanjuan-docks/smartgov-guids.json';
const readJson = (f, fallback) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : fallback);
const wdfwRecordIds = readJson(WDFW_IDS_FILE, { record_ids: {} }).record_ids;
const smartgovGuids = readJson(SMARTGOV_GUIDS_FILE, {});
const WDFW_SEARCH = 'https://hpa.wdfw.wa.gov/s/application-search';
const wdfwUrl = (appId) => (wdfwRecordIds[String(appId)]
  ? `https://hpa.wdfw.wa.gov/s/application-search-results?recordId=${wdfwRecordIds[String(appId)]}`
  : WDFW_SEARCH);
const smartgovUrl = (permitNumber) => (smartgovGuids[permitNumber]
  ? `https://co-sanjuan-wa.smartgovcommunity.com/PermittingPublic/PermitLandingPagePublic/Index/${smartgovGuids[permitNumber]}`
  : 'https://co-sanjuan-wa.smartgovcommunity.com/ApplicationPublic/ApplicationSearch');
const sjc1991Url = (fid) => `${SJC_1991_LAYER}/query?where=FID%3D${fid}&outFields=*&f=html`;
const SMARTGOV_PAGE = 'https://co-sanjuan-wa.smartgovcommunity.com/Public/ReportsView';

const DOCK_TYPES = new Set(['Overwater Structure', 'Dock Maintenance/Repair']);
const DOCK_WORDS = /\b(dock|docks|pier|piers|float|floats|gangway|gangways)\b/i;
const SAME_SPOT_M = 10;

// Both layers return everything we ask for in one page (county map services reject
// resultRecordCount); exceededTransferLimit guards against silent truncation.
async function arcgisGeojson(layer, where) {
  const params = new URLSearchParams({ where, outFields: '*', outSR: '4326', f: 'geojson' });
  const res = await fetch(`${layer}/query?${params}`);
  if (!res.ok) throw new Error(`${layer} query failed: ${res.status}`);
  const fc = await res.json();
  if (!fc.features) throw new Error(`Unexpected response: ${JSON.stringify(fc).slice(0, 300)}`);
  if (fc.properties?.exceededTransferLimit) throw new Error(`${layer}: hit transfer limit — paginate`);
  return fc;
}

// "MM/DD/YYYY[ ...]" → "YYYY-MM-DD"
const isoDate = (s) => {
  const m = s && /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
};
const isoEpoch = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null);
const blank = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);

// ─── 1. WDFW HPAs ───────────────────────────────────────────────────────────
const wdfwAll = await arcgisGeojson(WDFW_SERVICE, "County = 'San Juan'");
const wdfw = wdfwAll.features
  .filter(({ properties: p }) =>
    DOCK_TYPES.has(p.ProjectType) ||
    (!p.ProjectType && DOCK_WORDS.test(`${p.ProjectName ?? ''} ${p.ApplicationName ?? ''}`)))
  .map(({ geometry, properties: p }) => ({
    geometry,
    atDock: true,
    permit: {
      source: 'WDFW Hydraulic Project Approval (HPA)',
      source_url: wdfwUrl(p.ApplicationID),
      permit_number: p.PermitNumber,
      application_id: p.ApplicationID,
      project_name: p.ProjectName,
      project_type: p.ProjectType,
      project_subtype: p.ProjectSubType,
      application_type: p.ApplicationType,
      status: p.CurrentApplicationStatus,
      submitted: isoDate(p.ApplicationSubmissionDate),
      issued: isoDate(p.LastPermitIssueDate),
      expires: isoDate(p.LastPermitExpirationDate),
      year: p.Year,
      location_name: p.LocationName,
      address: [p.LocationAddress1, p.LocationCity].filter(Boolean).join(', ') || null,
      parcel_number: p.ParcelNumber,
      waterbody: p.StreamName,
      wria: p.WRIANumber,
      longitude: geometry.coordinates[0],
      latitude: geometry.coordinates[1],
    },
  }));

// ─── 2. County land-use permits, pre-SmartGov ────────────────────────────────────
const likes = ['DOCK', 'PIER', 'FLOAT', 'GANGWAY']
  .flatMap((w) => [`UPPER(Project_De) LIKE '%${w}%'`, `UPPER(Addntl_Des) LIKE '%${w}%'`]).join(' OR ');
const sjc1991All = await arcgisGeojson(SJC_1991_LAYER, likes);
const sjc1991 = sjc1991All.features
  .filter(({ properties: p }) => DOCK_WORDS.test(`${p.Project_De ?? ''} ${p.Addntl_Des ?? ''}`))
  .map(({ geometry, properties: p }) => ({
    geometry,
    atDock: false,
    permit: {
      source: 'San Juan County land-use permits, pre-SmartGov records (1972–2010)',
      source_url: sjc1991Url(p.FID),
      permit_number: blank(p.Permit_Num),
      project_name: blank(p.Project_De),
      additional_description: blank(p.Addntl_Des),
      applicant: [blank(p.Applicant_), blank(p.Applicant1)].filter(Boolean).join(' ') || null,
      submitted: isoDate(p.Submit_Dat),
      issued: isoEpoch(p.Approval_D),
      denied: blank(p.Denied_dat),
      withdrawn: blank(p.Withdrawal),
      island: blank(p.Island_Nam),
      waterbody: blank(p.Waterbody),
      shoreline_designation: blank(p.Shoreline_),
      comp_plan_designation: blank(p.Comprehens),
      activity: blank(p.Activity_C),
      parcel_number: blank(p.PIN),
      longitude: geometry.coordinates[0],
      latitude: geometry.coordinates[1],
    },
  }));

// ─── 3. County SmartGov permits 2010→ (optional) ─────────────────────────────
// Each record: { parcel_number, permit_number, permit_type, project_description,
// site_address, applicant, submitted, issued, status, island } — dock rows only.
const smartgov = existsSync(SMARTGOV_FILE)
  ? JSON.parse(readFileSync(SMARTGOV_FILE, 'utf8')).map((r) => ({
    geometry: null, // placed at its dock (joined by parcel) — never drawn on its own
    atDock: false,
    permit: {
      source: 'San Juan County SmartGov permits 2010–present',
      source_url: smartgovUrl(r.permit_number),
      permit_number: r.permit_number,
      project_name: r.project_description,
      permit_type: r.permit_type,
      status: r.status,
      submitted: r.submitted,
      issued: r.issued,
      applicant: r.applicant,
      address: r.site_address,
      island: r.island,
      parcel_number: r.parcel_number,
    },
  }))
  : [];

// ─── Group into docks ───────────────────────────────────────────────────────
const records = [...wdfw, ...sjc1991, ...smartgov];
const parcelKeys = (s) => (String(s ?? '').match(/\d{9,12}/g) ?? []).map((d) => d.slice(0, 9));
const metres = ([x1, y1], [x2, y2]) =>
  Math.hypot((x1 - x2) * Math.cos((y1 * Math.PI) / 180) * 111320, (y1 - y2) * 111320);

const parent = records.map((_, i) => i);
const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
const union = (a, b) => { parent[find(a)] = find(b); };
const byParcel = new Map();
records.forEach((r, i) => {
  for (const k of parcelKeys(r.permit.parcel_number)) {
    if (byParcel.has(k)) union(i, byParcel.get(k)); else byParcel.set(k, i);
  }
});
for (let i = 0; i < records.length; i++) {
  if (!records[i].atDock) continue;
  for (let j = i + 1; j < records.length; j++) {
    if (records[j].atDock && metres(records[i].geometry.coordinates, records[j].geometry.coordinates) <= SAME_SPOT_M) union(i, j);
  }
}
const groups = new Map();
records.forEach((r, i) => {
  const root = find(i);
  if (!groups.has(root)) groups.set(root, []);
  groups.get(root).push(r);
});

// Permits oldest → newest; undated ones (rejected / never issued) last. Dates after
// today are source typos (the county layer has a "2090-01-13"): shown raw, ordered as undated.
const TODAY = new Date().toISOString().slice(0, 10);
const dateKey = (p) => [p.issued, p.submitted].find((d) => d && d <= TODAY) ?? '9999';
const usedIds = new Set();
const siteId = (rs) => {
  // Lowest parcel / permit identifier in the group — stable across re-bakes. One WDFW
  // application can cover two docks ("North and South docks"), so suffix repeats.
  const keys = rs.map((r) => String(r.permit.application_id ?? r.permit.parcel_number ?? r.permit.permit_number)).sort();
  const base = `s${keys[0].replace(/\W+/g, '')}`;
  let id = base;
  for (let n = 2; usedIds.has(id); n++) id = `${base}-${n}`;
  usedIds.add(id);
  return id;
};

// A parcel whose only dock permits are SmartGov ones has no point of its own: place it
// at the waterfront parcel (vertex-mean of its outline, like the county's parcel points),
// so scripts/sanjuan-docks/bake-dock-locations.py can tie it to the dock on that parcel.
const WATERFRONT = 'data/sanjuan-docks/waterfront-parcels.geojson';
let parcelPoint = null;
const pointForParcel = (pin) => {
  if (!parcelPoint) {
    parcelPoint = new Map();
    if (existsSync(WATERFRONT)) {
      for (const f of JSON.parse(readFileSync(WATERFRONT, 'utf8')).features) {
        if (!f.geometry) continue;
        const ring = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0];
        const [x, y] = ring.reduce(([a, b], [c, d]) => [a + c, b + d], [0, 0]);
        parcelPoint.set(String(f.properties.PIN).slice(0, 9), [x / ring.length, y / ring.length]);
      }
    }
  }
  return parcelPoint.get(String(pin ?? '').slice(0, 9));
};
for (const rs of groups.values()) {
  if (rs.some((r) => r.geometry)) continue;
  const pin = rs.flatMap((r) => parcelKeys(r.permit.parcel_number))[0];
  const pt = pin && pointForParcel(pin);
  if (pt) rs[0].geometry = { type: 'Point', coordinates: pt };
}

const sites = [...groups.values()]
  .filter((rs) => rs.some((r) => r.geometry)) // a SmartGov permit on a non-waterfront parcel is not drawn
  .map((rs) => {
    rs.sort((a, b) => dateKey(a.permit).localeCompare(dateKey(b.permit)));
    const dated = rs.filter((r) => dateKey(r.permit) !== '9999');
    const latest = dated[dated.length - 1] ?? rs[rs.length - 1];
    const placed = [...rs].reverse().find((r) => r.atDock) ?? [...rs].reverse().find((r) => r.geometry);
    return {
      type: 'Feature',
      geometry: placed.geometry,
      properties: {
        site_id: siteId(rs),
        permit_count: rs.length,
        located_at: placed.atDock ? 'dock (WDFW location)' : 'county parcel point',
        sources: [...new Set(rs.map((r) => r.permit.source))].join('; '),
        first_date: dated.length ? dateKey(dated[0].permit) : null,
        last_date: dated.length ? dateKey(latest.permit) : null,
        latest_status: latest.permit.status ?? null,
        // Map colour: latest WDFW permit still active / WDFW-permitted / a county SmartGov
        // permit (2010–present) / county pre-SmartGov records only (1972–2010).
        category: rs.some((r) => r.atDock)
          ? ([...rs].reverse().find((r) => r.atDock).permit.status === 'HPA Issued (Active)' ? 'wdfw_active' : 'wdfw')
          : rs.some((r) => r.permit.source.startsWith('San Juan County SmartGov')) ? 'county_recent' : 'county_only',
        latest_name: latest.permit.project_name,
        permits: rs.map((r) => r.permit),
      },
    };
  })
  .sort((a, b) => (a.properties.last_date ?? '').localeCompare(b.properties.last_date ?? ''));

const counts = { wdfw: wdfw.length, sjc_1991_2009: sjc1991.length, smartgov_2010_on: smartgov.length };
const out = {
  type: 'FeatureCollection',
  metadata: {
    title: 'Dock permits — San Juan County, grouped by dock',
    sources: [
      { name: 'WDFW Hydraulic Project Approval (HPA) issued permits', page: WDFW_PAGE, service: WDFW_SERVICE, count: counts.wdfw, county_total: wdfwAll.features.length },
      { name: 'San Juan County land-use permits, pre-SmartGov records (1972–2010)', service: SJC_1991_LAYER, count: counts.sjc_1991_2009 },
      { name: 'San Juan County SmartGov permits 2010–present', page: SMARTGOV_PAGE, count: counts.smartgov_2010_on },
    ],
    grouping: `permits sharing a county parcel are one dock; WDFW permits also join within ${SAME_SPOT_M} m`,
    permit_count: records.length,
    site_count: sites.length,
    baked_at: new Date().toISOString(),
  },
  features: sites,
};

mkdirSync('public/hpa', { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
console.log(`WDFW ${counts.wdfw} + county pre-2010 ${counts.sjc_1991_2009} + SmartGov ${counts.smartgov_2010_on} permits → ${sites.length} docks → ${OUT}`);
