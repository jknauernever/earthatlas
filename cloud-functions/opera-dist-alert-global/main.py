"""
Cloud Function: OPERA DIST-ALERT (forest disturbance, near-real-time).

Global variant for earthatlas.org/forestmonitor. Adapted from the
salish-sea-propmapper version, with the regional bounding box removed so
the tile service responds anywhere DIST-ALERT covers (global tropics +
temperate forests, 30 m HLS).

Source: GLAD's GEE mirror of NASA OPERA L3 DIST-ALERT HLS V1, published as
a folder of per-band ImageCollections under projects/glad/HLSDIST/current/.

Three visualization modes (switched by `?mode=`):
  - recency  (default): bright-red recent → dark-red older, based on
                        VEG-DIST-DATE (days since 2020-12-31)
  - status            : categorical palette over VEG-DIST-STATUS
                        (1–4 = provisional/confirmed, first/recurrent)
  - severity          : yellow → orange → red ramp over VEG-ANOM-MAX
                        (0–100 % vegetation loss)

GET /                           → returns { tileUrl } for the default mode
GET /?mode=<recency|status|severity>
                                → returns { tileUrl } for that mode
GET /?lat=<lat>&lng=<lng>       → returns alert info at the click point:
    { date, status, statusCode, statusLabel, severity, acres,
      pixelCount, truncated, patchGeometry }
"""
from datetime import date, timedelta, datetime

import ee
import google.auth
import functions_framework
from flask import jsonify

FOLDER = 'projects/glad/HLSDIST/current'
PROJECT = 'earthatlas'

# OPERA encodes dates as days since 2020-12-31. Recency window we paint:
# anything from day 730 (2023-01-01) onward; brighter = more recent.
DATE_MIN = 730    # ~2023-01-01
DATE_MAX = 2200   # ~2027 — auto-comfortable headroom

RECENCY_VIS = {
    'min': DATE_MIN,
    'max': DATE_MAX,
    'palette': ['450a0a', '7f1d1d', 'b91c1c', 'dc2626', 'ef4444', 'fb923c', 'fbbf24'],
}

SEVERITY_VIS = {
    'min': 0,
    'max': 100,
    'palette': ['fef3c7', 'fde68a', 'fbbf24', 'fb923c', 'ef4444', 'b91c1c'],
}

# VEG-DIST-STATUS values per OPERA L3 DIST-ALERT spec:
#   0 = no disturbance
#   1 = provisional (anomaly), first detection
#   2 = confirmed,  first detection
#   3 = provisional, ongoing
#   4 = confirmed,  ongoing
#   5 = finished provisional
#   6 = finished confirmed
#   7 = no data
STATUS_VIS = {
    'min': 1,
    'max': 6,
    'palette': ['fde68a', 'fb923c', 'fca5a5', 'ef4444', 'b91c1c', '7f1d1d'],
}

CORS_HEADERS = {'Access-Control-Allow-Origin': '*'}

STATUS_LABELS = {
    1: 'Provisional alert (first detection)',
    2: 'Confirmed alert (first detection)',
    3: 'Provisional alert (ongoing)',
    4: 'Confirmed alert (ongoing)',
    5: 'Provisional alert (resolved)',
    6: 'Confirmed alert (resolved)',
}

DATE_EPOCH = date(2020, 12, 31)

# ─── Land cover datasets (tiered) ───────────────────────────────────────────
# We sample four land-cover products in priority order so each click gets the
# most-specific available label. CDL identifies actual crop species in the US,
# MapBiomas does the same level of detail for Brazil, Dynamic World gives
# near-real-time global state, and WorldCover is the global fallback.

# CDL (US only) — annual, 30 m, identifies specific crop species.
CDL_LATEST_YEAR = 2024  # bump when USDA releases the next year
CDL_LABELS = {
    1: 'Corn', 2: 'Cotton', 3: 'Rice', 4: 'Sorghum', 5: 'Soybeans',
    6: 'Sunflower', 10: 'Peanuts', 11: 'Tobacco', 12: 'Sweet Corn',
    13: 'Pop or Orn Corn', 14: 'Mint', 21: 'Barley', 22: 'Durum Wheat',
    23: 'Spring Wheat', 24: 'Winter Wheat', 25: 'Other Small Grains',
    26: 'Dbl Crop WinWht/Soybeans', 27: 'Rye', 28: 'Oats', 29: 'Millet',
    30: 'Speltz', 31: 'Canola', 32: 'Flaxseed', 33: 'Safflower',
    34: 'Rape Seed', 35: 'Mustard', 36: 'Alfalfa',
    37: 'Other Hay/Non Alfalfa', 38: 'Camelina', 39: 'Buckwheat',
    41: 'Sugarbeets', 42: 'Dry Beans', 43: 'Potatoes', 44: 'Other Crops',
    45: 'Sugarcane', 46: 'Sweet Potatoes', 47: 'Misc Vegs & Fruits',
    48: 'Watermelons', 49: 'Onions', 50: 'Cucumbers', 51: 'Chick Peas',
    52: 'Lentils', 53: 'Peas', 54: 'Tomatoes', 55: 'Caneberries',
    56: 'Hops', 57: 'Herbs', 58: 'Clover/Wildflowers',
    59: 'Sod/Grass Seed', 60: 'Switchgrass', 61: 'Fallow/Idle Cropland',
    63: 'Forest', 64: 'Shrubland', 65: 'Barren', 66: 'Cherries',
    67: 'Peaches', 68: 'Apples', 69: 'Grapes', 70: 'Christmas Trees',
    71: 'Other Tree Crops', 72: 'Citrus', 74: 'Pecans', 75: 'Almonds',
    76: 'Walnuts', 77: 'Pears', 81: 'Clouds/No Data', 82: 'Developed',
    83: 'Water', 87: 'Wetlands', 88: 'Nonag/Undefined',
    92: 'Aquaculture', 111: 'Open Water', 112: 'Perennial Ice/Snow',
    121: 'Developed/Open Space', 122: 'Developed/Low Intensity',
    123: 'Developed/Med Intensity', 124: 'Developed/High Intensity',
    131: 'Barren', 141: 'Deciduous Forest', 142: 'Evergreen Forest',
    143: 'Mixed Forest', 152: 'Shrubland', 176: 'Grassland/Pasture',
    190: 'Woody Wetlands', 195: 'Herbaceous Wetlands', 204: 'Pistachios',
    205: 'Triticale', 206: 'Carrots', 207: 'Asparagus', 208: 'Garlic',
    209: 'Cantaloupes', 210: 'Prunes', 211: 'Olives', 212: 'Oranges',
    213: 'Honeydew Melons', 214: 'Broccoli', 215: 'Avocados',
    216: 'Peppers', 217: 'Pomegranates', 218: 'Nectarines',
    219: 'Greens', 220: 'Plums', 221: 'Strawberries', 222: 'Squash',
    223: 'Apricots', 224: 'Vetch', 225: 'Dbl Crop WinWht/Corn',
    226: 'Dbl Crop Oats/Corn', 227: 'Lettuce',
    228: 'Dbl Crop Triticale/Corn', 229: 'Pumpkins',
    230: 'Dbl Crop Lettuce/Durum Wht',
    231: 'Dbl Crop Lettuce/Cantaloupe', 232: 'Dbl Crop Lettuce/Cotton',
    233: 'Dbl Crop Lettuce/Barley', 234: 'Dbl Crop Durum Wht/Sorghum',
    235: 'Dbl Crop Barley/Sorghum', 236: 'Dbl Crop WinWht/Sorghum',
    237: 'Dbl Crop Barley/Corn', 238: 'Dbl Crop WinWht/Cotton',
    239: 'Dbl Crop Soybeans/Cotton', 240: 'Dbl Crop Soybeans/Oats',
    241: 'Dbl Crop Corn/Soybeans', 242: 'Blueberries', 243: 'Cabbage',
    244: 'Cauliflower', 245: 'Celery', 246: 'Radishes', 247: 'Turnips',
    248: 'Eggplants', 249: 'Gourds', 250: 'Cranberries',
    254: 'Dbl Crop Barley/Soybeans',
}

# MapBiomas Brazil — Collection 9, annual to 2023. Detailed national LULC.
MAPBIOMAS_BR_ASSET = (
    'projects/mapbiomas-public/assets/brazil/lulc/collection9/'
    'mapbiomas_collection90_integration_v1'
)
MAPBIOMAS_BR_LATEST_YEAR = 2023
MAPBIOMAS_LABELS = {
    1: 'Forest', 3: 'Forest Formation', 4: 'Savanna Formation',
    5: 'Mangrove', 6: 'Floodable Forest', 9: 'Forest Plantation',
    10: 'Natural Non-Forest Formations', 11: 'Wetland',
    12: 'Grassland', 13: 'Other Non-Forest Formations',
    14: 'Farming', 15: 'Pasture', 18: 'Agriculture',
    19: 'Temporary Crop', 20: 'Sugar Cane', 21: 'Mosaic of Uses',
    22: 'Non-vegetated Area', 23: 'Beach, Dune, Sand Spot',
    24: 'Urban Area', 25: 'Other Non-Vegetated Areas', 26: 'Water',
    29: 'Rocky Outcrop', 30: 'Mining', 31: 'Aquaculture',
    32: 'Salt Flat', 33: 'River, Lake, Ocean', 36: 'Perennial Crop',
    39: 'Soybean', 40: 'Rice', 41: 'Other Temporary Crops',
    46: 'Coffee', 47: 'Citrus', 48: 'Other Perennial Crops',
    49: 'Wooded Sandbank Vegetation',
    50: 'Herbaceous Sandbank Vegetation', 62: 'Cotton', 63: 'Sugar Cane',
}

# Dynamic World — near-real-time, 10 m, single 'label' band per scene.
DYNAMIC_WORLD_LOOKBACK_DAYS = 90
DYNAMIC_WORLD_LABELS = {
    0: 'Water', 1: 'Trees', 2: 'Grass', 3: 'Flooded vegetation',
    4: 'Crops', 5: 'Shrub & scrub', 6: 'Built area',
    7: 'Bare ground', 8: 'Snow & ice',
}

# ESA WorldCover — global 10 m, 2021. Final fallback.
WORLDCOVER_ASSET = 'ESA/WorldCover/v200/2021'
WORLDCOVER_LABELS = {
    10:  'Tree cover', 20:  'Shrubland', 30:  'Grassland', 40:  'Cropland',
    50:  'Built-up', 60:  'Bare / sparse vegetation', 70:  'Snow and ice',
    80:  'Permanent water', 90:  'Herbaceous wetland', 95:  'Mangroves',
    100: 'Moss and lichen',
}

# ─── Universal land-use categories ──────────────────────────────────────────
# The filter is the same four chips users see (Forest / Cropland / Grassland /
# Built), but the underlying classifier is now tiered. Each dataset has a
# per-class map into the universal codes; a unified classifier image picks
# the freshest available source per pixel via .where() priority.
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

# CDL → universal categories. Orchards/tree crops classify as CROPLAND
# (agriculture even when tree-covered). Only true natural forest classes
# (63, 141-143) get FOREST.
CDL_CATEGORY_MAP = {
    # FOREST
    63: CATEGORY_FOREST, 141: CATEGORY_FOREST, 142: CATEGORY_FOREST, 143: CATEGORY_FOREST,
    # CROPLAND — annual + perennial + orchards + double-crops
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
    # BUILT — developed + barren
    65: CATEGORY_BUILT, 82: CATEGORY_BUILT, 121: CATEGORY_BUILT, 122: CATEGORY_BUILT,
    123: CATEGORY_BUILT, 124: CATEGORY_BUILT, 131: CATEGORY_BUILT,
    # OTHER (no category, falls through to lower tier): 61 (Fallow), 81 (Clouds),
    # 83 (Water), 87 (Wetlands), 88 (Nonag), 92 (Aquaculture), 111 (Open Water),
    # 112 (Snow), 190 (Woody Wetlands), 195 (Herbaceous Wetlands)
}

MAPBIOMAS_CATEGORY_MAP = {
    # FOREST — natural forest + savanna + mangrove + floodable forest + plantation
    1: CATEGORY_FOREST, 3: CATEGORY_FOREST, 4: CATEGORY_FOREST, 5: CATEGORY_FOREST,
    6: CATEGORY_FOREST, 9: CATEGORY_FOREST, 49: CATEGORY_FOREST,
    # CROPLAND
    14: CATEGORY_CROPLAND, 18: CATEGORY_CROPLAND, 19: CATEGORY_CROPLAND, 20: CATEGORY_CROPLAND,
    21: CATEGORY_CROPLAND, 36: CATEGORY_CROPLAND, 39: CATEGORY_CROPLAND, 40: CATEGORY_CROPLAND,
    41: CATEGORY_CROPLAND, 46: CATEGORY_CROPLAND, 47: CATEGORY_CROPLAND, 48: CATEGORY_CROPLAND,
    62: CATEGORY_CROPLAND, 63: CATEGORY_CROPLAND,
    # GRASSLAND — pasture + natural non-forest formations
    10: CATEGORY_GRASSLAND, 12: CATEGORY_GRASSLAND, 13: CATEGORY_GRASSLAND,
    15: CATEGORY_GRASSLAND, 50: CATEGORY_GRASSLAND,
    # BUILT — urban + mining + non-vegetated + rocky outcrop
    22: CATEGORY_BUILT, 24: CATEGORY_BUILT, 25: CATEGORY_BUILT, 29: CATEGORY_BUILT, 30: CATEGORY_BUILT,
    # OTHER: 11 (Wetland), 23 (Beach), 26 (Water), 31 (Aquaculture), 32 (Salt Flat), 33 (River)
}

DYNAMIC_WORLD_CATEGORY_MAP = {
    1: CATEGORY_FOREST,     # Trees
    4: CATEGORY_CROPLAND,   # Crops
    2: CATEGORY_GRASSLAND,  # Grass
    5: CATEGORY_GRASSLAND,  # Shrub & scrub
    6: CATEGORY_BUILT,      # Built area
    7: CATEGORY_BUILT,      # Bare ground
    # OTHER: 0 (Water), 3 (Flooded vegetation), 8 (Snow & ice)
}

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


def _build_unified_classifier() -> ee.Image:
    """Single global classification image. Each pixel = universal category code
    (1=forest, 2=cropland, 3=grassland, 4=built); masked elsewhere. Uses
    newest-data-wins priority: CDL (US 2024) > MapBiomas Brazil (2023) >
    Dynamic World (90-day mode) > WorldCover (2021)."""

    def categorize(img, mapping):
        # ee.Image.remap converts class codes to category codes. Unmapped
        # codes default to 0; we then mask 0s so .where() only overwrites
        # where the higher-priority dataset actually has an opinion.
        cat = img.remap(list(mapping.keys()), list(mapping.values()), 0)
        return cat.updateMask(cat.gt(0))

    wc = ee.Image(WORLDCOVER_ASSET).select('Map')
    wc_cat = categorize(wc, WORLDCOVER_CATEGORY_MAP)

    today = date.today()
    dw_start = (today - timedelta(days=DYNAMIC_WORLD_LOOKBACK_DAYS)).isoformat()
    dw = (ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
          .filterDate(dw_start, today.isoformat())
          .select('label')
          .mode())
    dw_cat = categorize(dw, DYNAMIC_WORLD_CATEGORY_MAP)

    mb = (ee.Image(MAPBIOMAS_BR_ASSET)
          .select(f'classification_{MAPBIOMAS_BR_LATEST_YEAR}'))
    mb_cat = categorize(mb, MAPBIOMAS_CATEGORY_MAP)

    cdl = ee.Image(f'USDA/NASS/CDL/{CDL_LATEST_YEAR}').select('cropland')
    cdl_cat = categorize(cdl, CDL_CATEGORY_MAP)

    # Layer least → most specific. .where() overwrites where the higher
    # priority dataset is unmasked (i.e. has a value).
    unified = wc_cat
    unified = unified.where(dw_cat.mask(), dw_cat)
    unified = unified.where(mb_cat.mask(), mb_cat)
    unified = unified.where(cdl_cat.mask(), cdl_cat)
    return unified.rename('landuse_category')


def _landuse_mask(filter_id):
    """Binary mask selecting one universal category from the tiered classifier.
    Returns None when no filter is requested (caller skips applying it)."""
    if not filter_id:
        return None
    code = LANDUSE_CATEGORY_CODES.get(filter_id.lower())
    if code is None:
        return None
    return _build_unified_classifier().eq(code)


def _add_landcover_bands(stack: ee.Image, point: ee.Geometry) -> ee.Image:
    """Add CDL, MapBiomas, Dynamic World, and WorldCover bands to a stack."""
    cdl = (ee.Image(f'USDA/NASS/CDL/{CDL_LATEST_YEAR}')
           .select('cropland').rename('cdl'))
    mb = (ee.Image(MAPBIOMAS_BR_ASSET)
          .select(f'classification_{MAPBIOMAS_BR_LATEST_YEAR}')
          .rename('mapbiomas'))
    today = date.today()
    dw_start = (today - timedelta(days=DYNAMIC_WORLD_LOOKBACK_DAYS)).isoformat()
    dw = (ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
          .filterBounds(point)
          .filterDate(dw_start, today.isoformat())
          .select('label')
          .mode()
          .rename('dynworld'))
    wc = ee.Image(WORLDCOVER_ASSET).select('Map').rename('worldcover')
    return stack.addBands(cdl).addBands(mb).addBands(dw).addBands(wc)


# ─── MODIS Burned Area ──────────────────────────────────────────────────────
# Flags fire-driven OPERA disturbances. MCD64A1 is monthly; we look ±90 days
# around the OPERA detection date so a burn that happened a few weeks before
# or after still counts as the likely cause.
MODIS_BURN_WINDOW_DAYS = 90


def _sample_modis_burn(point: ee.Geometry, opera_date_str: str | None) -> dict | None:
    """Return {'date': ISO} if MODIS detected a burn near the OPERA date, else None."""
    if not opera_date_str:
        return None
    opera_dt = date.fromisoformat(opera_date_str)
    window_start = (opera_dt - timedelta(days=MODIS_BURN_WINDOW_DAYS)).isoformat()
    window_end = (opera_dt + timedelta(days=MODIS_BURN_WINDOW_DAYS)).isoformat()

    coll = (
        ee.ImageCollection('MODIS/061/MCD64A1')
        .filterDate(window_start, window_end)
        .filterBounds(point)
    )

    # Encode each image's burn observations as (year * 1000 + day-of-year) so
    # we can mosaic and decode back to a real date. Unburned pixels are masked.
    def encode(img: ee.Image) -> ee.Image:
        year = ee.Number(ee.Date(img.get('system:time_start')).get('year'))
        burn_day = img.select('BurnDate')
        encoded = burn_day.add(ee.Image.constant(year.multiply(1000)))
        return encoded.updateMask(burn_day.gt(0)).rename('encoded')

    encoded = coll.map(encode).max()
    try:
        result = encoded.reduceRegion(
            reducer=ee.Reducer.first(), geometry=point, scale=500
        ).getInfo()
    except Exception as e:
        print(f'MODIS burn sample failed: {e}', flush=True)
        return None

    val = result.get('encoded') if result else None
    if val is None:
        return None
    val = int(val)
    burn_year = val // 1000
    burn_day = val % 1000
    try:
        burn_date = date(burn_year, 1, 1) + timedelta(days=burn_day - 1)
        return {'date': burn_date.isoformat()}
    except (ValueError, OverflowError):
        return None


def _resolve_landcover(sampled: dict) -> dict:
    """Pick the most-specific label available, in priority order."""
    v = sampled.get('cdl')
    if v and int(v) > 0 and CDL_LABELS.get(int(v)):
        return {
            'label': CDL_LABELS[int(v)],
            'source': 'USDA Cropland Data Layer',
            'year': CDL_LATEST_YEAR,
        }
    v = sampled.get('mapbiomas')
    if v and int(v) in MAPBIOMAS_LABELS:
        return {
            'label': MAPBIOMAS_LABELS[int(v)],
            'source': 'MapBiomas Brazil',
            'year': MAPBIOMAS_BR_LATEST_YEAR,
        }
    v = sampled.get('dynworld')
    if v is not None and int(v) in DYNAMIC_WORLD_LABELS:
        return {
            'label': DYNAMIC_WORLD_LABELS[int(v)],
            'source': 'Dynamic World',
            'year': None,
        }
    v = sampled.get('worldcover')
    if v and int(v) in WORLDCOVER_LABELS:
        return {
            'label': WORLDCOVER_LABELS[int(v)],
            'source': 'ESA WorldCover',
            'year': 2021,
        }
    return None

# connectedPixelCount caps at 1024; at 30 m that's ~225 acres, enough to
# capture all but the largest single events. We surface the cap to clients.
PATCH_MAX_SIZE_PX = 1024

# HLS pixels are 30 m × 30 m square in the native UTM projection at any latitude.
HLS_PIXEL_AREA_SQM = 30 * 30

_ee_initialized = False


def _ensure_ee():
    global _ee_initialized
    if _ee_initialized:
        return
    credentials, _ = google.auth.default(
        scopes=['https://www.googleapis.com/auth/earthengine']
    )
    ee.Initialize(credentials, project=PROJECT)
    _ee_initialized = True


def _mosaic_band(band: str) -> ee.Image:
    """Mosaic one DIST-ALERT band globally.

    Each per-band ImageCollection at projects/glad/HLSDIST/current/<band>
    exposes its data as a single `b1` band. GLAD does not set
    system:time_start on these images, so we mosaic the whole collection
    and let getMapId() do tile-level lazy evaluation.
    """
    coll = ee.ImageCollection(f'{FOLDER}/{band}')
    return coll.mosaic()


def _parse_date_range(request) -> tuple:
    """Return (start_days, end_days) since DATE_EPOCH (2020-12-31).

    Defaults: start = 2023-01-01 (data origin), end = today + 30 (headroom).
    Accepts query params `start` and `end` as ISO dates (YYYY-MM-DD).
    Clamps both into the valid data window [DATE_MIN, DATE_MAX].
    """
    today_days = (date.today() - DATE_EPOCH).days
    default_end = min(today_days + 30, DATE_MAX)

    start_str = request.args.get('start')
    end_str = request.args.get('end')
    try:
        start_days = (date.fromisoformat(start_str) - DATE_EPOCH).days if start_str else DATE_MIN
    except ValueError:
        start_days = DATE_MIN
    try:
        end_days = (date.fromisoformat(end_str) - DATE_EPOCH).days if end_str else default_end
    except ValueError:
        end_days = default_end

    start_days = max(start_days, DATE_MIN)
    end_days = min(end_days, DATE_MAX)
    if end_days <= start_days:
        end_days = start_days + 1
    return start_days, end_days


def _tile_url(image: ee.Image, vis: dict) -> str:
    map_id = image.visualize(**vis).getMapId()
    return map_id['tile_fetcher'].url_format


def _maybe_apply_landuse(img: ee.Image, landuse: str | None) -> ee.Image:
    """AND in a WorldCover-derived land-use mask when the filter is set."""
    lc_mask = _landuse_mask(landuse)
    return img.updateMask(lc_mask) if lc_mask is not None else img


def _handle_recency(start_days: int, end_days: int, landuse: str | None) -> tuple:
    img = _mosaic_band('VEG-DIST-DATE')
    img = img.updateMask(img.gte(start_days).And(img.lte(end_days)))
    img = _maybe_apply_landuse(img, landuse)
    # Palette stays anchored to the FULL data window (2023-01-01 → today) so
    # colors mean the same thing regardless of slider position. The mask
    # above hides pixels outside [start_days, end_days]; only colors of the
    # remaining pixels are shown.
    today_days = (date.today() - DATE_EPOCH).days
    vis = {**RECENCY_VIS, 'max': max(today_days, DATE_MIN + 1)}
    return (jsonify({'tileUrl': _tile_url(img, vis)}), 200, CORS_HEADERS)


def _handle_severity(start_days: int, end_days: int, landuse: str | None) -> tuple:
    img = _mosaic_band('VEG-ANOM-MAX')
    date_img = _mosaic_band('VEG-DIST-DATE')
    img = img.updateMask(img.gt(0))
    img = img.updateMask(date_img.gte(start_days).And(date_img.lte(end_days)))
    img = _maybe_apply_landuse(img, landuse)
    return (jsonify({'tileUrl': _tile_url(img, SEVERITY_VIS)}), 200, CORS_HEADERS)


def _handle_status(start_days: int, end_days: int, landuse: str | None) -> tuple:
    img = _mosaic_band('VEG-DIST-STATUS')
    date_img = _mosaic_band('VEG-DIST-DATE')
    img = img.updateMask(img.gte(1).And(img.lte(6)))
    img = img.updateMask(date_img.gte(start_days).And(date_img.lte(end_days)))
    img = _maybe_apply_landuse(img, landuse)
    return (jsonify({'tileUrl': _tile_url(img, STATUS_VIS)}), 200, CORS_HEADERS)


def _handle_point_request(lat: float, lng: float) -> tuple:
    """Sample DIST-ALERT at a click point and return per-pixel info + patch outline."""
    point = ee.Geometry.Point([lng, lat])

    status_img = _mosaic_band('VEG-DIST-STATUS').rename('status')
    date_img = _mosaic_band('VEG-DIST-DATE').rename('date')
    severity_img = _mosaic_band('VEG-ANOM-MAX').rename('severity')
    opera_stack = status_img.addBands(date_img).addBands(severity_img)

    # Stack OPERA + all 4 land-cover datasets in one reduceRegion call.
    # If any asset is unavailable, this will raise and we fall back to OPERA
    # alone (so a broken upstream dataset never breaks the popup entirely).
    try:
        stack = _add_landcover_bands(opera_stack, point)
        sampled = stack.reduceRegion(
            reducer=ee.Reducer.first(), geometry=point, scale=10
        ).getInfo()
        land_cover = _resolve_landcover(sampled)
    except Exception as e:
        print(f'land-cover sampling failed, falling back: {e}', flush=True)
        sampled = opera_stack.reduceRegion(
            reducer=ee.Reducer.first(), geometry=point, scale=30
        ).getInfo()
        land_cover = None

    status_code = sampled.get('status')
    if not status_code:
        return (
            jsonify({
                'date': None,
                'statusCode': 0,
                'statusLabel': None,
                'landCover': land_cover,
            }),
            200,
            CORS_HEADERS,
        )

    status_code = int(status_code)
    days_since_epoch = sampled.get('date')
    severity = sampled.get('severity')

    alert_date_str = None
    if days_since_epoch is not None:
        alert_date = DATE_EPOCH + timedelta(days=int(days_since_epoch))
        alert_date_str = alert_date.isoformat()

    disturbed_mask = status_img.gte(1).And(status_img.lte(6)).selfMask()

    connected = disturbed_mask.connectedPixelCount(
        maxSize=PATCH_MAX_SIZE_PX, eightConnected=True
    )
    pixel_count = (
        connected.reduceRegion(
            reducer=ee.Reducer.first(), geometry=point, scale=30
        ).getInfo().get('b1') or 0
    )
    acres = (pixel_count * HLS_PIXEL_AREA_SQM) / 4046.86
    truncated = pixel_count >= PATCH_MAX_SIZE_PX

    patch_geometry = None
    try:
        labels = disturbed_mask.connectedComponents(
            connectedness=ee.Kernel.square(1), maxSize=PATCH_MAX_SIZE_PX
        ).select('labels')
        label_sample = labels.reduceRegion(
            reducer=ee.Reducer.first(), geometry=point, scale=30
        ).getInfo()
        label = label_sample.get('labels')
        if label is not None:
            component_mask = labels.eq(label).selfMask()
            vectors = component_mask.reduceToVectors(
                geometry=point.buffer(2000),
                scale=30,
                geometryType='polygon',
                eightConnected=True,
                bestEffort=True,
                maxPixels=int(1e9),
            ).getInfo()
            features = vectors.get('features', [])
            if features:
                patch_geometry = features[0].get('geometry')
    except Exception:
        patch_geometry = None

    burn = _sample_modis_burn(point, alert_date_str)

    return (
        jsonify({
            'date': alert_date_str,
            'statusCode': status_code,
            'statusLabel': STATUS_LABELS.get(status_code, f'Status {status_code}'),
            'severity': round(float(severity), 1) if severity is not None else None,
            'pixelCount': int(pixel_count),
            'acres': round(acres, 2),
            'truncated': truncated,
            'patchGeometry': patch_geometry,
            'landCover': land_cover,
            'burn': burn,
        }),
        200,
        CORS_HEADERS,
    )


@functions_framework.http
def get_tiles(request):
    if request.method == 'OPTIONS':
        return ('', 204, {
            **CORS_HEADERS,
            'Access-Control-Allow-Methods': 'GET',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '3600',
        })

    try:
        _ensure_ee()

        lat = request.args.get('lat')
        lng = request.args.get('lng')
        if lat is not None and lng is not None:
            return _handle_point_request(float(lat), float(lng))

        start_days, end_days = _parse_date_range(request)
        landuse = request.args.get('landuse')
        mode = (request.args.get('mode') or 'recency').lower()
        if mode == 'severity':
            return _handle_severity(start_days, end_days, landuse)
        if mode == 'status':
            return _handle_status(start_days, end_days, landuse)
        return _handle_recency(start_days, end_days, landuse)
    except Exception as e:
        return (jsonify({'error': str(e)}), 500, CORS_HEADERS)
