"""
OPERA DIST-ALERT Global — Cloud Function
Serves OPERA DIST-ALERT HLS land disturbance tile URLs and point-sample data
for the Forest Monitor application.

Entry point: get_tiles (HTTP Cloud Function)
"""

import json
import logging
from datetime import date, timedelta

import ee
import flask
import google.auth

# ── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Earth Engine initialization ──────────────────────────────────────────────

_credentials, _project = google.auth.default(
    scopes=['https://www.googleapis.com/auth/earthengine']
)
ee.Initialize(credentials=_credentials, project=_project)

# ── OPERA asset ───────────────────────────────────────────────────────────────

OPERA_DIST_ALERT_ASSET = 'projects/opera-dist-alert/assets/DIST-ALERT'

# ── CDL ───────────────────────────────────────────────────────────────────────

CDL_LATEST_YEAR = 2024

CDL_LABELS = {
    1: 'Corn', 2: 'Cotton', 3: 'Rice', 4: 'Sorghum', 5: 'Soybeans',
    6: 'Sunflower', 10: 'Peanuts', 11: 'Tobacco', 12: 'Sweet Corn',
    13: 'Pop or Orn Corn', 14: 'Mint',
    21: 'Barley', 22: 'Durum Wheat', 23: 'Spring Wheat', 24: 'Winter Wheat',
    25: 'Other Small Grains', 26: 'Dbl Crop WinWht/Soybeans',
    27: 'Rye', 28: 'Oats', 29: 'Millet', 30: 'Speltz',
    31: 'Canola', 32: 'Flaxseed', 33: 'Safflower', 34: 'Rape Seed',
    35: 'Mustard', 36: 'Alfalfa', 37: 'Other Hay/Non Alfalfa',
    38: 'Camelina', 39: 'Buckwheat',
    41: 'Sugarbeets', 42: 'Dry Beans', 43: 'Potatoes', 44: 'Other Crops',
    45: 'Sugarcane', 46: 'Sweet Potatoes', 47: 'Misc Vegs & Fruits',
    48: 'Watermelons', 49: 'Onions', 50: 'Cucumbers', 51: 'Chick Peas',
    52: 'Lentils', 53: 'Peas', 54: 'Tomatoes', 55: 'Caneberries',
    56: 'Hops', 57: 'Herbs', 58: 'Clover/Wildflowers',
    59: 'Sod/Grass Seed', 60: 'Switchgrass', 61: 'Fallow/Idle Cropland',
    63: 'Forest', 64: 'Shrubland', 65: 'Barren',
    66: 'Cherries', 67: 'Peaches', 68: 'Apples', 69: 'Grapes',
    70: 'Christmas Trees', 71: 'Other Tree Crops', 72: 'Citrus',
    74: 'Pecans', 75: 'Almonds', 76: 'Walnuts', 77: 'Pears',
    81: 'Clouds/No Data', 82: 'Developed', 83: 'Water',
    87: 'Wetlands', 88: 'Nonag/Undefined', 92: 'Aquaculture',
    111: 'Open Water', 112: 'Perennial Ice/Snow',
    121: 'Developed/Open Space', 122: 'Developed/Low Intensity',
    123: 'Developed/Med Intensity', 124: 'Developed/High Intensity',
    131: 'Barren',
    141: 'Deciduous Forest', 142: 'Evergreen Forest', 143: 'Mixed Forest',
    152: 'Shrubland', 176: 'Grassland/Pasture',
    190: 'Woody Wetlands', 195: 'Herbaceous Wetlands',
    204: 'Pistachios', 205: 'Triticale', 206: 'Carrots', 207: 'Asparagus',
    208: 'Garlic', 209: 'Cantaloupes', 210: 'Prunes', 211: 'Olives',
    212: 'Oranges', 213: 'Honeydew Melons', 214: 'Broccoli',
    215: 'Avocados', 216: 'Peppers', 217: 'Pomegranates',
    218: 'Nectarines', 219: 'Greens', 220: 'Plums', 221: 'Strawberries',
    222: 'Squash', 223: 'Apricots', 224: 'Vetch',
    225: 'Dbl Crop WinWht/Corn', 226: 'Dbl Crop Oats/Corn',
    227: 'Lettuce', 228: 'Dbl Crop Triticale/Corn', 229: 'Pumpkins',
    230: 'Dbl Crop Lettuce/Durum Wht', 231: 'Dbl Crop Lettuce/Cantaloupe',
    232: 'Dbl Crop Lettuce/Cotton', 233: 'Dbl Crop Lettuce/Barley',
    234: 'Dbl Crop Durum Wht/Sorghum', 235: 'Dbl Crop Barley/Sorghum',
    236: 'Dbl Crop WinWht/Sorghum', 237: 'Dbl Crop Barley/Corn',
    238: 'Dbl Crop WinWht/Cotton', 239: 'Dbl Crop Soybeans/Cotton',
    240: 'Dbl Crop Soybeans/Oats', 241: 'Dbl Crop Corn/Soybeans',
    242: 'Blueberries', 243: 'Cabbage', 244: 'Cauliflower', 245: 'Celery',
    246: 'Radishes', 247: 'Turnips', 248: 'Eggplants', 249: 'Gourds',
    250: 'Cranberries', 254: 'Dbl Crop Barley/Soybeans',
}

# ── MapBiomas Brazil ──────────────────────────────────────────────────────────

MAPBIOMAS_BR_ASSET = (
    'projects/mapbiomas-public/assets/brazil/lulc/collection9/'
    'mapbiomas_collection90_integration_v1'
)
MAPBIOMAS_BR_LATEST_YEAR = 2023

MAPBIOMAS_LABELS = {
    1: 'Forest', 3: 'Forest Formation', 4: 'Savanna Formation',
    5: 'Mangrove', 6: 'Flooded Forest', 9: 'Forest Plantation',
    10: 'Non-Forest Natural Formation', 11: 'Wetland',
    12: 'Grassland', 13: 'Other Non-Forest Natural Formation',
    14: 'Farming', 15: 'Pasture', 18: 'Agriculture',
    19: 'Temporary Crop', 20: 'Sugar Cane',
    21: 'Mosaic of Agriculture and Pasture',
    22: 'Non-Vegetated', 23: 'Beach/Dune/Sand',
    24: 'Urban Area', 25: 'Other Non-Vegetated',
    26: 'Water', 29: 'Rocky Outcrop', 30: 'Mining',
    31: 'Aquaculture', 32: 'Salt Flat', 33: 'River/Lake/Ocean',
    36: 'Perennial Crop', 39: 'Soybean', 40: 'Rice',
    41: 'Other Temporary Crops', 46: 'Coffee', 47: 'Citrus',
    48: 'Other Perennial Crops', 49: 'Wooded Restinga',
    50: 'Herbaceous Restinga', 62: 'Cotton', 63: 'Sugarcane',
}

# ── Dynamic World ─────────────────────────────────────────────────────────────

DYNAMIC_WORLD_LOOKBACK_DAYS = 90

DYNAMIC_WORLD_LABELS = {
    0: 'Water', 1: 'Trees', 2: 'Grass', 3: 'Flooded Vegetation',
    4: 'Crops', 5: 'Shrub & Scrub', 6: 'Built Area',
    7: 'Bare Ground', 8: 'Snow & Ice',
}

# ── WorldCover ────────────────────────────────────────────────────────────────

WORLDCOVER_ASSET = 'ESA/WorldCover/v200/2021'

WORLDCOVER_LABELS = {
    10: 'Tree cover', 20: 'Shrubland', 30: 'Grassland',
    40: 'Cropland', 50: 'Built-up', 60: 'Bare / sparse vegetation',
    70: 'Snow and ice', 80: 'Permanent water bodies',
    90: 'Herbaceous wetland', 95: 'Mangroves', 100: 'Moss and lichen',
}

# ── Universal land-use categories ─────────────────────────────────────────────

CATEGORY_FOREST    = 1
CATEGORY_CROPLAND  = 2
CATEGORY_GRASSLAND = 3
CATEGORY_BUILT     = 4

LANDUSE_CATEGORY_CODES = {
    'forest':    CATEGORY_FOREST,
    'cropland':  CATEGORY_CROPLAND,
    'grassland': CATEGORY_GRASSLAND,
    'built':     CATEGORY_BUILT,
}

# CDL → universal categories. Use the existing CDL_LABELS for reference.
# Orchards and tree crops (cherries/apples/almonds/etc.) classified as CROPLAND,
# not FOREST — they're agriculture even if tree-covered.
CDL_CATEGORY_MAP = {
    # FOREST — only true forest classes
    63: CATEGORY_FOREST, 141: CATEGORY_FOREST, 142: CATEGORY_FOREST, 143: CATEGORY_FOREST,
    # CROPLAND — annual + perennial crops, orchards, double crops
    1: CATEGORY_CROPLAND, 2: CATEGORY_CROPLAND, 3: CATEGORY_CROPLAND, 4: CATEGORY_CROPLAND,
    5: CATEGORY_CROPLAND, 6: CATEGORY_CROPLAND, 10: CATEGORY_CROPLAND, 11: CATEGORY_CROPLAND,
    12: CATEGORY_CROPLAND, 13: CATEGORY_CROPLAND, 14: CATEGORY_CROPLAND,
    21: CATEGORY_CROPLAND, 22: CATEGORY_CROPLAND, 23: CATEGORY_CROPLAND, 24: CATEGORY_CROPLAND,
    25: CATEGORY_CROPLAND, 26: CATEGORY_CROPLAND, 27: CATEGORY_CROPLAND, 28: CATEGORY_CROPLAND,
    29: CATEGORY_CROPLAND, 30: CATEGORY_CROPLAND, 31: CATEGORY_CROPLAND, 32: CATEGORY_CROPLAND,
    33: CATEGORY_CROPLAND, 34: CATEGORY_CROPLAND, 35: CATEGORY_CROPLAND, 36: CATEGORY_CROPLAND,
    37: CATEGORY_CROPLAND, 38: CATEGORY_CROPLAND, 39: CATEGORY_CROPLAND,
    41: CATEGORY_CROPLAND, 42: CATEGORY_CROPLAND, 43: CATEGORY_CROPLAND, 44: CATEGORY_CROPLAND,
    45: CATEGORY_CROPLAND, 46: CATEGORY_CROPLAND, 47: CATEGORY_CROPLAND, 48: CATEGORY_CROPLAND,
    49: CATEGORY_CROPLAND, 50: CATEGORY_CROPLAND, 51: CATEGORY_CROPLAND, 52: CATEGORY_CROPLAND,
    53: CATEGORY_CROPLAND, 54: CATEGORY_CROPLAND, 55: CATEGORY_CROPLAND, 56: CATEGORY_CROPLAND,
    57: CATEGORY_CROPLAND, 66: CATEGORY_CROPLAND, 67: CATEGORY_CROPLAND, 68: CATEGORY_CROPLAND,
    69: CATEGORY_CROPLAND, 70: CATEGORY_CROPLAND, 71: CATEGORY_CROPLAND, 72: CATEGORY_CROPLAND,
    74: CATEGORY_CROPLAND, 75: CATEGORY_CROPLAND, 76: CATEGORY_CROPLAND, 77: CATEGORY_CROPLAND,
    204: CATEGORY_CROPLAND, 205: CATEGORY_CROPLAND, 206: CATEGORY_CROPLAND, 207: CATEGORY_CROPLAND,
    208: CATEGORY_CROPLAND, 209: CATEGORY_CROPLAND, 210: CATEGORY_CROPLAND, 211: CATEGORY_CROPLAND,
    212: CATEGORY_CROPLAND, 213: CATEGORY_CROPLAND, 214: CATEGORY_CROPLAND, 215: CATEGORY_CROPLAND,
    216: CATEGORY_CROPLAND, 217: CATEGORY_CROPLAND, 218: CATEGORY_CROPLAND, 219: CATEGORY_CROPLAND,
    220: CATEGORY_CROPLAND, 221: CATEGORY_CROPLAND, 222: CATEGORY_CROPLAND, 223: CATEGORY_CROPLAND,
    224: CATEGORY_CROPLAND, 225: CATEGORY_CROPLAND, 226: CATEGORY_CROPLAND, 227: CATEGORY_CROPLAND,
    228: CATEGORY_CROPLAND, 229: CATEGORY_CROPLAND, 230: CATEGORY_CROPLAND, 231: CATEGORY_CROPLAND,
    232: CATEGORY_CROPLAND, 233: CATEGORY_CROPLAND, 234: CATEGORY_CROPLAND, 235: CATEGORY_CROPLAND,
    236: CATEGORY_CROPLAND, 237: CATEGORY_CROPLAND, 238: CATEGORY_CROPLAND, 239: CATEGORY_CROPLAND,
    240: CATEGORY_CROPLAND, 241: CATEGORY_CROPLAND, 242: CATEGORY_CROPLAND, 243: CATEGORY_CROPLAND,
    244: CATEGORY_CROPLAND, 245: CATEGORY_CROPLAND, 246: CATEGORY_CROPLAND, 247: CATEGORY_CROPLAND,
    248: CATEGORY_CROPLAND, 249: CATEGORY_CROPLAND, 250: CATEGORY_CROPLAND, 254: CATEGORY_CROPLAND,
    # GRASSLAND — pasture, shrubland, wildflowers, switchgrass
    58: CATEGORY_GRASSLAND, 59: CATEGORY_GRASSLAND, 60: CATEGORY_GRASSLAND,
    64: CATEGORY_GRASSLAND, 152: CATEGORY_GRASSLAND, 176: CATEGORY_GRASSLAND,
    # BUILT — developed + barren (anthropogenic / non-vegetated)
    65: CATEGORY_BUILT, 82: CATEGORY_BUILT, 121: CATEGORY_BUILT, 122: CATEGORY_BUILT,
    123: CATEGORY_BUILT, 124: CATEGORY_BUILT, 131: CATEGORY_BUILT,
    # OTHER (mapped to 0 implicitly via remap default): 61 (Fallow), 81 (Clouds),
    # 83 (Water), 87 (Wetlands), 88 (Nonag), 92 (Aquaculture), 111 (Open Water),
    # 112 (Snow), 190 (Woody Wetlands), 195 (Herbaceous Wetlands)
}

# MapBiomas Brazil → universal categories.
MAPBIOMAS_CATEGORY_MAP = {
    # FOREST
    1: CATEGORY_FOREST, 3: CATEGORY_FOREST, 4: CATEGORY_FOREST, 5: CATEGORY_FOREST,
    6: CATEGORY_FOREST, 9: CATEGORY_FOREST, 49: CATEGORY_FOREST,
    # CROPLAND
    14: CATEGORY_CROPLAND, 18: CATEGORY_CROPLAND, 19: CATEGORY_CROPLAND, 20: CATEGORY_CROPLAND,
    21: CATEGORY_CROPLAND, 36: CATEGORY_CROPLAND, 39: CATEGORY_CROPLAND, 40: CATEGORY_CROPLAND,
    41: CATEGORY_CROPLAND, 46: CATEGORY_CROPLAND, 47: CATEGORY_CROPLAND, 48: CATEGORY_CROPLAND,
    62: CATEGORY_CROPLAND, 63: CATEGORY_CROPLAND,
    # GRASSLAND — pasture + natural non-forest
    10: CATEGORY_GRASSLAND, 12: CATEGORY_GRASSLAND, 13: CATEGORY_GRASSLAND,
    15: CATEGORY_GRASSLAND, 50: CATEGORY_GRASSLAND,
    # BUILT — urban, mining, non-vegetated
    22: CATEGORY_BUILT, 24: CATEGORY_BUILT, 25: CATEGORY_BUILT, 29: CATEGORY_BUILT, 30: CATEGORY_BUILT,
    # OTHER: 11 (Wetland), 23 (Beach), 26 (Water), 31 (Aquaculture), 32 (Salt Flat), 33 (River)
}

# Dynamic World → universal categories.
DYNAMIC_WORLD_CATEGORY_MAP = {
    1: CATEGORY_FOREST,     # Trees
    4: CATEGORY_CROPLAND,   # Crops
    2: CATEGORY_GRASSLAND,  # Grass
    5: CATEGORY_GRASSLAND,  # Shrub & scrub
    6: CATEGORY_BUILT,      # Built area
    7: CATEGORY_BUILT,      # Bare ground
    # OTHER: 0 (Water), 3 (Flooded vegetation), 8 (Snow & ice)
}

# WorldCover → universal categories.
WORLDCOVER_CATEGORY_MAP = {
    10: CATEGORY_FOREST,    # Tree cover
    95: CATEGORY_FOREST,    # Mangroves
    40: CATEGORY_CROPLAND,  # Cropland
    20: CATEGORY_GRASSLAND, # Shrubland
    30: CATEGORY_GRASSLAND, # Grassland
    50: CATEGORY_BUILT,     # Built-up
    60: CATEGORY_BUILT,     # Bare/sparse vegetation
    # OTHER: 70 (Snow), 80 (Water), 90 (Wetland), 100 (Moss/lichen)
}

# ── OPERA visualization parameters ───────────────────────────────────────────

# VEG-DIST-DATE counts days since 2014-01-01 (HLS collection start).
_MAX_DATE_VALUE = 3650  # ~10 years

RECENCY_VIS_PARAMS = {
    'bands': ['VEG-DIST-DATE'],
    'min': 0,
    'max': _MAX_DATE_VALUE,
    'palette': ['#ffffcc', '#fd8d3c', '#800026'],
}

STATUS_VIS_PARAMS = {
    'bands': ['VEG-DIST-STATUS'],
    'min': 0,
    'max': 4,
    'palette': ['#d9d9d9', '#fed976', '#fd8d3c', '#e31a1c', '#800026'],
}

SEVERITY_VIS_PARAMS = {
    'bands': ['VEG-ANOM-MAX'],
    'min': 0,
    'max': 100,
    'palette': ['#ffffb2', '#fecc5c', '#fd8d3c', '#f03b20', '#bd0026'],
}

# ── Land-use helpers ──────────────────────────────────────────────────────────

def _build_unified_classifier() -> ee.Image:
    """Build a single global classification image. Each pixel = category code
    (1=forest, 2=cropland, 3=grassland, 4=built); masked where no category
    applies. Uses newest-data-wins priority: CDL (US 2024) → MapBiomas Brazil
    Collection 9 (2023) → Dynamic World (recent 90-day mode) → WorldCover (2021)."""

    def categorize(img, mapping):
        # ee.Image.remap converts class codes to category codes. Anything
        # not in the `from` list becomes the default value (0 = no category).
        # We then mask out 0s so .where() only overwrites where a higher-
        # priority dataset actually has an opinion.
        cat = img.remap(
            list(mapping.keys()),
            list(mapping.values()),
            0,
        )
        return cat.updateMask(cat.gt(0))

    # WorldCover (lowest priority, global fallback)
    wc = ee.Image(WORLDCOVER_ASSET).select('Map')
    wc_cat = categorize(wc, WORLDCOVER_CATEGORY_MAP)

    # Dynamic World — mode label over recent window
    today_iso = date.today().isoformat()
    dw_start_iso = (date.today() - timedelta(days=DYNAMIC_WORLD_LOOKBACK_DAYS)).isoformat()
    dw = (ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
          .filterDate(dw_start_iso, today_iso)
          .select('label')
          .mode())
    dw_cat = categorize(dw, DYNAMIC_WORLD_CATEGORY_MAP)

    # MapBiomas Brazil
    mb = (ee.Image(MAPBIOMAS_BR_ASSET)
          .select(f'classification_{MAPBIOMAS_BR_LATEST_YEAR}'))
    mb_cat = categorize(mb, MAPBIOMAS_CATEGORY_MAP)

    # CDL (US, highest priority)
    cdl = (ee.Image(f'USDA/NASS/CDL/{CDL_LATEST_YEAR}')
           .select('cropland'))
    cdl_cat = categorize(cdl, CDL_CATEGORY_MAP)

    # Layer from least → most specific. .where() overwrites where the higher
    # priority dataset has a value (i.e. is not masked).
    unified = wc_cat
    unified = unified.where(dw_cat.mask(), dw_cat)
    unified = unified.where(mb_cat.mask(), mb_cat)
    unified = unified.where(cdl_cat.mask(), cdl_cat)
    return unified.rename('landuse_category')


def _landuse_mask(filter_id):
    """Return a binary mask selecting one category from the unified classifier.
    None = no filter (caller skips applying it)."""
    if not filter_id:
        return None
    code = LANDUSE_CATEGORY_CODES.get(filter_id.lower())
    if code is None:
        return None
    return _build_unified_classifier().eq(code)


def _maybe_apply_landuse(img, landuse):
    """Apply land-use mask to img if a filter is specified; otherwise passthrough."""
    mask = _landuse_mask(landuse)
    if mask is None:
        return img
    return img.updateMask(mask)

# ── Point-sample helpers ──────────────────────────────────────────────────────

def _add_landcover_bands(point):
    """Sample all four land-cover datasets at point and return a property dict."""
    today_iso = date.today().isoformat()
    dw_start_iso = (date.today() - timedelta(days=DYNAMIC_WORLD_LOOKBACK_DAYS)).isoformat()

    wc = ee.Image(WORLDCOVER_ASSET).select('Map')
    dw = (ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
          .filterDate(dw_start_iso, today_iso)
          .select('label')
          .mode())
    mb = (ee.Image(MAPBIOMAS_BR_ASSET)
          .select(f'classification_{MAPBIOMAS_BR_LATEST_YEAR}'))
    cdl = ee.Image(f'USDA/NASS/CDL/{CDL_LATEST_YEAR}').select('cropland')

    combined = (wc.rename('worldcover')
                .addBands(dw.rename('dynamic_world'))
                .addBands(mb.rename('mapbiomas'))
                .addBands(cdl.rename('cdl')))
    return combined.reduceRegion(
        reducer=ee.Reducer.first(),
        geometry=point,
        scale=30,
        bestEffort=True,
    ).getInfo()


def _resolve_landcover(props):
    """Resolve land-cover label from sampled properties using CDL > MapBiomas > DW > WorldCover priority."""
    cdl_code = props.get('cdl')
    if cdl_code is not None:
        label = CDL_LABELS.get(int(cdl_code))
        if label:
            return {'label': label, 'source': 'CDL', 'code': int(cdl_code)}

    mb_code = props.get('mapbiomas')
    if mb_code is not None:
        label = MAPBIOMAS_LABELS.get(int(mb_code))
        if label:
            return {'label': label, 'source': 'MapBiomas', 'code': int(mb_code)}

    dw_code = props.get('dynamic_world')
    if dw_code is not None:
        label = DYNAMIC_WORLD_LABELS.get(int(dw_code))
        if label:
            return {'label': label, 'source': 'Dynamic World', 'code': int(dw_code)}

    wc_code = props.get('worldcover')
    if wc_code is not None:
        label = WORLDCOVER_LABELS.get(int(wc_code))
        if label:
            return {'label': label, 'source': 'WorldCover', 'code': int(wc_code)}

    return None

# ── Tile request handlers ─────────────────────────────────────────────────────

def _opera_collection():
    """Latest OPERA DIST-ALERT mosaic."""
    return ee.ImageCollection(OPERA_DIST_ALERT_ASSET).mosaic()


def _handle_recency(request):
    landuse = request.args.get('landuse')
    img = _opera_collection().select('VEG-DIST-DATE').unmask(0)
    img = img.updateMask(img.gt(0))
    img = _maybe_apply_landuse(img, landuse)
    tile_info = img.getMapId(RECENCY_VIS_PARAMS)
    return flask.jsonify({'tileUrl': tile_info['tile_fetcher'].url_format})


def _handle_status(request):
    landuse = request.args.get('landuse')
    img = _opera_collection().select('VEG-DIST-STATUS').unmask(0)
    img = img.updateMask(img.gt(0))
    img = _maybe_apply_landuse(img, landuse)
    tile_info = img.getMapId(STATUS_VIS_PARAMS)
    return flask.jsonify({'tileUrl': tile_info['tile_fetcher'].url_format})


def _handle_severity(request):
    landuse = request.args.get('landuse')
    img = _opera_collection().select('VEG-ANOM-MAX').unmask(0)
    img = img.updateMask(img.gt(0))
    img = _maybe_apply_landuse(img, landuse)
    tile_info = img.getMapId(SEVERITY_VIS_PARAMS)
    return flask.jsonify({'tileUrl': tile_info['tile_fetcher'].url_format})


def _handle_point_request(request):
    lat = request.args.get('lat', type=float)
    lng = request.args.get('lng', type=float)
    if lat is None or lng is None:
        return flask.jsonify({'error': 'lat and lng required'}), 400

    point = ee.Geometry.Point([lng, lat])
    props = _add_landcover_bands(point)
    landcover = _resolve_landcover(props)

    opera_props = _opera_collection().reduceRegion(
        reducer=ee.Reducer.first(),
        geometry=point,
        scale=30,
        bestEffort=True,
    ).getInfo()

    return flask.jsonify({
        'landcover': landcover,
        'opera': opera_props,
        'coordinates': {'lat': lat, 'lng': lng},
    })

# ── Cloud Function entry point ────────────────────────────────────────────────

def get_tiles(request: flask.Request):
    """HTTP Cloud Function entry point. Dispatches to handler based on `mode`."""
    if request.method == 'OPTIONS':
        headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '3600',
        }
        return ('', 204, headers)

    headers = {'Access-Control-Allow-Origin': '*'}

    try:
        mode = request.args.get('mode', 'recency')
        if mode == 'recency':
            response = _handle_recency(request)
        elif mode == 'status':
            response = _handle_status(request)
        elif mode == 'severity':
            response = _handle_severity(request)
        elif mode == 'point':
            response = _handle_point_request(request)
        else:
            response = flask.jsonify({'error': f'Unknown mode: {mode}'}), 400

        if isinstance(response, tuple):
            body, status = response
            return (body.get_data(), status, headers)
        return (response.get_data(), 200, headers)

    except Exception as exc:  # pylint: disable=broad-except
        logger.exception('Error handling request')
        return (
            flask.jsonify({'error': str(exc)}).get_data(),
            500,
            headers,
        )
