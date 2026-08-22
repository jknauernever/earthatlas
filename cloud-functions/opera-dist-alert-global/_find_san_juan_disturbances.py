"""
Helper script: find OPERA DIST-ALERT pixels in the San Juan Islands bbox and
report their date + status. We'll then probe the deployed cloud function
for the highest-likely fire candidates.
"""
from __future__ import annotations

import json
import sys
from datetime import date, timedelta

import ee
import google.auth

PROJECT = 'earthatlas'

# OPERA DIST-ALERT folder (mirror via GLAD).
FOLDER = 'projects/glad/HLSDIST/current'
DATE_EPOCH = date(2020, 12, 31)


def main():
    creds, _ = google.auth.default(scopes=['https://www.googleapis.com/auth/earthengine'])
    ee.Initialize(creds, project=PROJECT)

    # Eastern WA fire belt (Cascades east slope + Okanogan-Wenatchee +
    # Yakima Highlands — these are the WA regions that actually burn).
    # San Juan Islands have no OPERA-flagged fires; we widened the search.
    bbox = ee.Geometry.BBox(-121.5, 46.5, -118.0, 48.6)

    def mosaic_band(name: str) -> ee.Image:
        return ee.ImageCollection(f'{FOLDER}/{name}').mosaic()

    status = mosaic_band('VEG-DIST-STATUS').rename('status')
    date_img = mosaic_band('VEG-DIST-DATE').rename('date')
    severity = mosaic_band('VEG-ANOM-MAX').rename('severity')

    # Only consider pixels INSIDE recent MTBS fire perimeters — guarantees
    # the disturbance was actually a fire, not logging / clearing.
    mtbs = (
        ee.FeatureCollection('USFS/GTAC/MTBS/burned_area_boundaries/v1')
        .filterBounds(bbox)
        .filter(ee.Filter.gte('Ig_Date', '2023-01-01'))
    )
    print(f'MTBS recent fires in bbox: {mtbs.size().getInfo()}')
    # Print the fires so we have names + dates.
    mtbs_info = mtbs.getInfo().get('features', [])
    fires_meta = sorted(
        [
            {
                'name':  f['properties'].get('Incid_Name'),
                'date':  f['properties'].get('Ig_Date'),
                'acres': f['properties'].get('BurnBndAc'),
            } for f in mtbs_info
        ],
        key=lambda x: (x['date'] or ''), reverse=True
    )
    print('Recent named MTBS fires in this bbox:')
    for fr in fires_meta[:8]:
        print(f"  {fr['date']} · {fr['name']} ({fr['acres']:.0f} ac)" if fr['acres'] else
              f"  {fr['date']} · {fr['name']}")
    if not fires_meta:
        print('  (none — bbox missed all recent MTBS fires)')
        return

    mtbs_mask = ee.Image.constant(1).clip(mtbs.geometry()).mask()

    # Disturbed pixels INSIDE the MTBS perimeters only.
    disturbed = status.gte(1).And(status.lte(8)).selfMask().updateMask(mtbs_mask)
    stacked = (
        status.addBands(date_img).addBands(severity).updateMask(disturbed)
    )

    # Vectorize ALL disturbed patches, not a stochastic sample. Each
    # connected component becomes a polygon; we report centroid + acres.
    vectors = disturbed.reduceToVectors(
        geometry=bbox,
        scale=30,
        geometryType='polygon',
        eightConnected=True,
        bestEffort=True,
        maxPixels=int(1e10),
    )

    # Per-feature: get the centroid and the underlying date/status/severity.
    def annotate(f):
        centroid = f.geometry().centroid(maxError=1)
        sampled = stacked.reduceRegion(
            reducer=ee.Reducer.first(), geometry=centroid, scale=30
        )
        return f.setGeometry(centroid).set({
            'sample_status': sampled.get('status'),
            'sample_date':   sampled.get('date'),
            'sample_sev':    sampled.get('severity'),
            'patch_acres':   f.geometry().area(maxError=1).divide(4046.86),
        })
    annotated = vectors.map(annotate)
    features = annotated.limit(60).getInfo().get('features', [])
    print(f'Vectorized {len(features)} disturbed OPERA patches in San Juan Islands bbox.')

    out = []
    for f in features:
        p = f.get('properties', {})
        coords = f.get('geometry', {}).get('coordinates', [None, None])
        days = p.get('sample_date')
        if days is None or int(days) <= 0:
            continue
        date_str = (DATE_EPOCH + timedelta(days=int(days))).isoformat()
        out.append({
            'lat': round(coords[1], 5),
            'lng': round(coords[0], 5),
            'status': int(p.get('sample_status') or 0),
            'date': date_str,
            'severity': round(float(p.get('sample_sev') or 0), 1),
            'acres': round(float(p.get('patch_acres') or 0), 2),
        })

    # Sort by acres desc (bigger patches more interesting), then severity.
    out.sort(key=lambda x: (x['acres'], x['severity']), reverse=True)
    print(json.dumps(out[:30], indent=2))


if __name__ == '__main__':
    main()
