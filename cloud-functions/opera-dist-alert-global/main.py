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
GET /?lat=<lat>&lng=<lng>       → returns OPERA core + land cover (fast)
GET /?lat=<lat>&lng=<lng>&extras=1
                                → returns patch outline, acres, MODIS burn (slow)
"""
import json
import math
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

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

# VEG-DIST-STATUS values per OPERA L3 DIST-ALERT spec (GLAD HLSDIST mirror):
#   0 = no disturbance
#   1 = provisional alert (first detection)
#   2 = recurrent provisional alert
#   3 = confirmed alert
#   4 = provisional alert, substantial (>50%) loss, first detection
#   5 = recurrent provisional alert, substantial loss
#   6 = confirmed alert, substantial loss
#   7 = finished provisional alert (past event, no current change)
#   8 = finished confirmed alert
#   255 = no usable data
STATUS_VIS = {
    'min': 1,
    'max': 8,
    'palette': [
        'fde68a',  # 1: Provisional alert (light yellow)
        'fcd34d',  # 2: Recurrent provisional (deeper yellow)
        'f59e0b',  # 3: Confirmed alert (amber)
        'fb923c',  # 4: Provisional · substantial loss (orange)
        'ef4444',  # 5: Recurrent provisional · substantial loss (red)
        'b91c1c',  # 6: Confirmed · substantial loss (deep red)
        '92400e',  # 7: Finished provisional (muted brown)
        '450a0a',  # 8: Finished confirmed (dark)
    ],
}

CORS_HEADERS = {'Access-Control-Allow-Origin': '*'}

STATUS_LABELS = {
    1: 'Awaiting confirmation (first detection)',
    2: 'Awaiting confirmation (recurring)',
    3: 'Confirmed',
    4: 'Awaiting confirmation · severe loss (first detection)',
    5: 'Awaiting confirmation · severe loss (recurring)',
    6: 'Confirmed · severe loss',
    7: 'No longer active (was unconfirmed)',
    8: 'No longer active (was confirmed)',
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

# ─── Crop-aware profiles for cause inference ────────────────────────────────
# Each CDL crop falls into a profile that tells the cause heuristic how to
# read a dNBR spike or fire signal:
#
#   multicut        Perennial multi-cut forages (alfalfa, hay, clover, sod,
#                   switchgrass). Harvested 2–5× per growing season, so dNBR
#                   spikes during the harvest window are routine cutting,
#                   NOT burning. Field burning is very rare for these crops.
#
#   burn_prone      Crops where pre-harvest or post-harvest burning is a
#                   standard agronomic practice in at least some regions:
#                   sugarcane (pre-harvest leaf burn), rice (stubble burn),
#                   cotton (boll/foliage management). Fire signal here is
#                   credible.
#
#   annual_harvest  Single-harvest annuals (corn, soybeans, wheat, etc.).
#                   Harvest produces a dNBR spike but residue burning is
#                   uncommon in most US regions and increasingly regulated.
#                   Default to "harvest" interpretation when no fire signal.
#
#   orchard         Perennial tree/vine crops (apples, citrus, almonds,
#                   grapes). Tree removal / replanting happens but is rare.
#                   Routine harvest produces minimal canopy disturbance.
#
#   fallow          Fallow / idle cropland — vegetation breaks are part of
#                   the rotation cycle, not a disturbance event.
#
# Harvest months are northern-hemisphere defaults; _classify_crop flips for
# southern-latitude clicks. Months are inclusive of typical start/end.
CDL_CROP_PROFILES = {
    # ── multicut perennial forages (the alfalfa case) ──
    36: {'profile': 'multicut', 'harvest_months': (5, 10),  'burn_practice': 'rare'},        # Alfalfa
    37: {'profile': 'multicut', 'harvest_months': (5, 10),  'burn_practice': 'rare'},        # Other Hay/Non Alfalfa
    58: {'profile': 'multicut', 'harvest_months': (5, 10),  'burn_practice': 'rare'},        # Clover/Wildflowers
    59: {'profile': 'multicut', 'harvest_months': (6, 9),   'burn_practice': 'rare'},        # Sod/Grass Seed
    60: {'profile': 'multicut', 'harvest_months': (8, 10),  'burn_practice': 'occasional'},  # Switchgrass
    176: {'profile': 'multicut','harvest_months': (5, 10),  'burn_practice': 'rare'},        # Grassland/Pasture

    # ── burn-prone crops (pre-harvest field burning is standard practice) ──
    3:  {'profile': 'burn_prone', 'harvest_months': (8, 11), 'burn_practice': 'common'},     # Rice (stubble burn after harvest)
    45: {'profile': 'burn_prone', 'harvest_months': (10, 4), 'burn_practice': 'common'},     # Sugarcane (pre-harvest cane burn; wraps year-end)
    2:  {'profile': 'burn_prone', 'harvest_months': (8, 12), 'burn_practice': 'occasional'}, # Cotton

    # ── single-harvest annuals ──
    1:  {'profile': 'annual_harvest', 'harvest_months': (9, 11), 'burn_practice': 'rare'},        # Corn
    5:  {'profile': 'annual_harvest', 'harvest_months': (9, 11), 'burn_practice': 'rare'},        # Soybeans
    4:  {'profile': 'annual_harvest', 'harvest_months': (8, 10), 'burn_practice': 'rare'},        # Sorghum
    6:  {'profile': 'annual_harvest', 'harvest_months': (7, 10), 'burn_practice': 'rare'},        # Sunflower
    21: {'profile': 'annual_harvest', 'harvest_months': (6, 8),  'burn_practice': 'occasional'}, # Barley
    22: {'profile': 'annual_harvest', 'harvest_months': (7, 9),  'burn_practice': 'occasional'}, # Durum Wheat
    23: {'profile': 'annual_harvest', 'harvest_months': (7, 9),  'burn_practice': 'occasional'}, # Spring Wheat
    24: {'profile': 'annual_harvest', 'harvest_months': (6, 8),  'burn_practice': 'occasional'}, # Winter Wheat
    25: {'profile': 'annual_harvest', 'harvest_months': (6, 9),  'burn_practice': 'occasional'}, # Other Small Grains
    27: {'profile': 'annual_harvest', 'harvest_months': (7, 9),  'burn_practice': 'occasional'}, # Rye
    28: {'profile': 'annual_harvest', 'harvest_months': (6, 8),  'burn_practice': 'occasional'}, # Oats
    29: {'profile': 'annual_harvest', 'harvest_months': (8, 10), 'burn_practice': 'rare'},        # Millet
    10: {'profile': 'annual_harvest', 'harvest_months': (9, 11), 'burn_practice': 'rare'},        # Peanuts
    11: {'profile': 'annual_harvest', 'harvest_months': (8, 10), 'burn_practice': 'occasional'}, # Tobacco
    12: {'profile': 'annual_harvest', 'harvest_months': (7, 10), 'burn_practice': 'rare'},        # Sweet Corn
    31: {'profile': 'annual_harvest', 'harvest_months': (7, 9),  'burn_practice': 'rare'},        # Canola
    41: {'profile': 'annual_harvest', 'harvest_months': (9, 10), 'burn_practice': 'rare'},        # Sugarbeets
    42: {'profile': 'annual_harvest', 'harvest_months': (8, 10), 'burn_practice': 'rare'},        # Dry Beans
    43: {'profile': 'annual_harvest', 'harvest_months': (8, 10), 'burn_practice': 'rare'},        # Potatoes
    51: {'profile': 'annual_harvest', 'harvest_months': (7, 9),  'burn_practice': 'rare'},        # Chick Peas
    52: {'profile': 'annual_harvest', 'harvest_months': (7, 9),  'burn_practice': 'rare'},        # Lentils
    53: {'profile': 'annual_harvest', 'harvest_months': (6, 8),  'burn_practice': 'rare'},        # Peas

    # ── orchards / perennial tree & vine crops ──
    66: {'profile': 'orchard', 'harvest_months': (6, 8),  'burn_practice': 'rare'},   # Cherries
    67: {'profile': 'orchard', 'harvest_months': (6, 9),  'burn_practice': 'rare'},   # Peaches
    68: {'profile': 'orchard', 'harvest_months': (8, 11), 'burn_practice': 'rare'},   # Apples
    69: {'profile': 'orchard', 'harvest_months': (8, 10), 'burn_practice': 'rare'},   # Grapes
    70: {'profile': 'orchard', 'harvest_months': (11, 12),'burn_practice': 'rare'},   # Christmas Trees
    71: {'profile': 'orchard', 'harvest_months': (8, 11), 'burn_practice': 'rare'},   # Other Tree Crops
    72: {'profile': 'orchard', 'harvest_months': (11, 4), 'burn_practice': 'rare'},   # Citrus (winter harvest, wraps)
    74: {'profile': 'orchard', 'harvest_months': (9, 11), 'burn_practice': 'rare'},   # Pecans
    75: {'profile': 'orchard', 'harvest_months': (8, 10), 'burn_practice': 'rare'},   # Almonds
    76: {'profile': 'orchard', 'harvest_months': (9, 11), 'burn_practice': 'rare'},   # Walnuts
    77: {'profile': 'orchard', 'harvest_months': (8, 10), 'burn_practice': 'rare'},   # Pears
    204:{'profile': 'orchard', 'harvest_months': (9, 10), 'burn_practice': 'rare'},   # Pistachios
    210:{'profile': 'orchard', 'harvest_months': (8, 10), 'burn_practice': 'rare'},   # Prunes
    211:{'profile': 'orchard', 'harvest_months': (10, 1), 'burn_practice': 'rare'},   # Olives
    212:{'profile': 'orchard', 'harvest_months': (11, 4), 'burn_practice': 'rare'},   # Oranges
    215:{'profile': 'orchard', 'harvest_months': (2, 9),  'burn_practice': 'rare'},   # Avocados
    217:{'profile': 'orchard', 'harvest_months': (9, 11), 'burn_practice': 'rare'},   # Pomegranates
    218:{'profile': 'orchard', 'harvest_months': (7, 9),  'burn_practice': 'rare'},   # Nectarines
    220:{'profile': 'orchard', 'harvest_months': (8, 10), 'burn_practice': 'rare'},   # Plums
    223:{'profile': 'orchard', 'harvest_months': (5, 8),  'burn_practice': 'rare'},   # Apricots

    # ── fallow ──
    61: {'profile': 'fallow', 'harvest_months': None, 'burn_practice': 'rare'},  # Fallow/Idle Cropland
}

# Friendly common names for the profiles (used in popup reasoning).
CROP_PROFILE_LABELS = {
    'multicut':       'multi-cut forage',
    'burn_prone':     'burn-managed crop',
    'annual_harvest': 'annual harvested crop',
    'orchard':        'perennial tree/vine crop',
    'fallow':         'fallow cropland',
}

# ─── MapBiomas Brazil crop profiles ────────────────────────────────────────
# Same shape as CDL_CROP_PROFILES. Harvest windows expressed in NH-equivalent
# months — _flip_window_for_hemisphere shifts them back by 6 months for the
# Brazilian (southern-hemisphere) clicks where this data applies.
# Sources for harvest timing: Embrapa, USDA Foreign Agricultural Service
# (FAS) commodity calendars, MAPA Brazil crop calendar publications.
#
# Real SH-actual harvest windows for reference:
#   Pasture       → year-round; primary growth Nov–Apr (SH summer)
#   Sugar Cane    → Apr–Nov (Centro-Sul, dominant region)
#   Soybean       → Feb–May
#   Rice          → Feb–May (irrigated Rio Grande do Sul)
#   Coffee        → May–Sep (Minas Gerais arabica)
#   Citrus        → Jun–Oct (São Paulo oranges)
#   Cotton        → May–Sep
MAPBIOMAS_CROP_PROFILES = {
    15: {'profile': 'multicut',       'harvest_months': (5, 10),  'burn_practice': 'rare'},        # Pasture
    20: {'profile': 'burn_prone',     'harvest_months': (10, 5),  'burn_practice': 'common'},      # Sugar Cane
    63: {'profile': 'burn_prone',     'harvest_months': (10, 5),  'burn_practice': 'common'},      # Sugar Cane (alt code)
    39: {'profile': 'annual_harvest', 'harvest_months': (8, 11),  'burn_practice': 'rare'},        # Soybean
    40: {'profile': 'burn_prone',     'harvest_months': (8, 11),  'burn_practice': 'common'},      # Rice
    46: {'profile': 'orchard',        'harvest_months': (11, 3),  'burn_practice': 'rare'},        # Coffee
    47: {'profile': 'orchard',        'harvest_months': (12, 4),  'burn_practice': 'rare'},        # Citrus
    62: {'profile': 'burn_prone',     'harvest_months': (11, 3),  'burn_practice': 'occasional'},  # Cotton
}

# ─── AAFC Canada crop profiles ─────────────────────────────────────────────
# Northern-hemisphere windows (Canada is firmly NH). Sources: AAFC crop
# calendars, Statistics Canada Field Crops Survey.
AAFC_CROP_PROFILES = {
    # Multicut perennial forages
    122: {'profile': 'multicut',       'harvest_months': (6, 10), 'burn_practice': 'rare'},        # Pasture and Forages
    141: {'profile': 'multicut',       'harvest_months': (8, 10), 'burn_practice': 'occasional'}, # Switchgrass
    198: {'profile': 'multicut',       'harvest_months': (5, 10), 'burn_practice': 'rare'},        # Vetch (forage)
    # Cereals (annual harvest)
    132: {'profile': 'annual_harvest', 'harvest_months': (7, 9),  'burn_practice': 'occasional'}, # Cereals (generic)
    133: {'profile': 'annual_harvest', 'harvest_months': (7, 8),  'burn_practice': 'occasional'}, # Barley
    134: {'profile': 'annual_harvest', 'harvest_months': (7, 9),  'burn_practice': 'occasional'}, # Other Grains
    135: {'profile': 'annual_harvest', 'harvest_months': (8, 10), 'burn_practice': 'rare'},        # Millet
    136: {'profile': 'annual_harvest', 'harvest_months': (7, 8),  'burn_practice': 'occasional'}, # Oats
    137: {'profile': 'annual_harvest', 'harvest_months': (7, 9),  'burn_practice': 'occasional'}, # Rye
    138: {'profile': 'annual_harvest', 'harvest_months': (7, 9),  'burn_practice': 'occasional'}, # Spelt
    139: {'profile': 'annual_harvest', 'harvest_months': (7, 9),  'burn_practice': 'occasional'}, # Triticale
    140: {'profile': 'annual_harvest', 'harvest_months': (8, 9),  'burn_practice': 'occasional'}, # Wheat (generic)
    142: {'profile': 'annual_harvest', 'harvest_months': (8, 10), 'burn_practice': 'rare'},        # Sorghum
    143: {'profile': 'annual_harvest', 'harvest_months': (8, 10), 'burn_practice': 'rare'},        # Quinoa
    145: {'profile': 'annual_harvest', 'harvest_months': (7, 8),  'burn_practice': 'occasional'}, # Winter Wheat
    146: {'profile': 'annual_harvest', 'harvest_months': (8, 9),  'burn_practice': 'occasional'}, # Spring Wheat
    147: {'profile': 'annual_harvest', 'harvest_months': (9, 11), 'burn_practice': 'rare'},        # Corn for Grain
    195: {'profile': 'annual_harvest', 'harvest_months': (8, 9),  'burn_practice': 'rare'},        # Buckwheat
    196: {'profile': 'annual_harvest', 'harvest_months': (7, 9),  'burn_practice': 'rare'},        # Canaryseed
    197: {'profile': 'annual_harvest', 'harvest_months': (8, 10), 'burn_practice': 'rare'},        # Hemp
    # Oilseeds (mostly annual)
    150: {'profile': 'annual_harvest', 'harvest_months': (8, 10), 'burn_practice': 'rare'},        # Oilseeds (generic)
    151: {'profile': 'annual_harvest', 'harvest_months': (7, 8),  'burn_practice': 'rare'},        # Borage
    152: {'profile': 'annual_harvest', 'harvest_months': (7, 8),  'burn_practice': 'rare'},        # Camelina
    153: {'profile': 'annual_harvest', 'harvest_months': (8, 9),  'burn_practice': 'rare'},        # Canola and Rapeseed
    154: {'profile': 'annual_harvest', 'harvest_months': (8, 9),  'burn_practice': 'rare'},        # Flaxseed
    155: {'profile': 'annual_harvest', 'harvest_months': (8, 9),  'burn_practice': 'rare'},        # Mustard
    156: {'profile': 'annual_harvest', 'harvest_months': (8, 9),  'burn_practice': 'rare'},        # Safflower
    157: {'profile': 'annual_harvest', 'harvest_months': (9, 10), 'burn_practice': 'rare'},        # Sunflower
    158: {'profile': 'annual_harvest', 'harvest_months': (9, 10), 'burn_practice': 'rare'},        # Soybeans
    159: {'profile': 'annual_harvest', 'harvest_months': (8, 10), 'burn_practice': 'rare'},        # Other Oilseeds
    # Pulses
    160: {'profile': 'annual_harvest', 'harvest_months': (8, 9),  'burn_practice': 'rare'},        # Pulses (generic)
    161: {'profile': 'annual_harvest', 'harvest_months': (8, 9),  'burn_practice': 'rare'},        # Other Pulses
    162: {'profile': 'annual_harvest', 'harvest_months': (7, 8),  'burn_practice': 'rare'},        # Peas
    163: {'profile': 'annual_harvest', 'harvest_months': (8, 9),  'burn_practice': 'rare'},        # Chickpeas
    167: {'profile': 'annual_harvest', 'harvest_months': (8, 9),  'burn_practice': 'rare'},        # Beans
    168: {'profile': 'annual_harvest', 'harvest_months': (8, 9),  'burn_practice': 'rare'},        # Fababeans
    174: {'profile': 'annual_harvest', 'harvest_months': (8, 9),  'burn_practice': 'rare'},        # Lentils
    # Vegetables
    175: {'profile': 'annual_harvest', 'harvest_months': (7, 10), 'burn_practice': 'rare'},        # Vegetables
    176: {'profile': 'annual_harvest', 'harvest_months': (7, 9),  'burn_practice': 'rare'},        # Tomatoes
    177: {'profile': 'annual_harvest', 'harvest_months': (8, 10), 'burn_practice': 'rare'},        # Potatoes
    178: {'profile': 'annual_harvest', 'harvest_months': (9, 10), 'burn_practice': 'rare'},        # Sugarbeets
    179: {'profile': 'annual_harvest', 'harvest_months': (7, 10), 'burn_practice': 'rare'},        # Other Vegetables
    # Orchards / perennial fruits
    180: {'profile': 'orchard',        'harvest_months': (7, 10), 'burn_practice': 'rare'},        # Fruits
    181: {'profile': 'orchard',        'harvest_months': (6, 9),  'burn_practice': 'rare'},        # Berries
    182: {'profile': 'orchard',        'harvest_months': (7, 8),  'burn_practice': 'rare'},        # Blueberry
    183: {'profile': 'orchard',        'harvest_months': (9, 10), 'burn_practice': 'rare'},        # Cranberry
    185: {'profile': 'orchard',        'harvest_months': (6, 9),  'burn_practice': 'rare'},        # Other Berries
    188: {'profile': 'orchard',        'harvest_months': (8, 11), 'burn_practice': 'rare'},        # Orchards
    189: {'profile': 'orchard',        'harvest_months': (7, 10), 'burn_practice': 'rare'},        # Other Fruits
    190: {'profile': 'orchard',        'harvest_months': (8, 10), 'burn_practice': 'rare'},        # Vineyards
    191: {'profile': 'orchard',        'harvest_months': (8, 9),  'burn_practice': 'rare'},        # Hops
    192: {'profile': 'multicut',       'harvest_months': (5, 10), 'burn_practice': 'rare'},        # Sod
    193: {'profile': 'annual_harvest', 'harvest_months': (6, 9),  'burn_practice': 'rare'},        # Herbs
    194: {'profile': 'orchard',        'harvest_months': (5, 10), 'burn_practice': 'rare'},        # Nursery
    148: {'profile': 'annual_harvest', 'harvest_months': (8, 10), 'burn_practice': 'occasional'}, # Tobacco
    149: {'profile': 'orchard',        'harvest_months': (9, 10), 'burn_practice': 'rare'},        # Ginseng (perennial root)
    199: {'profile': 'annual_harvest', 'harvest_months': (7, 10), 'burn_practice': 'rare'},        # Other Crops
    # Fallow
    131: {'profile': 'fallow',         'harvest_months': None,    'burn_practice': 'rare'},        # Fallow
}

# ─── EUCROPMAP profiles ────────────────────────────────────────────────────
# Northern-hemisphere windows for the EU. Sources: USDA FAS commodity
# calendars, Eurostat agricultural calendars.
EUCROPMAP_CROP_PROFILES = {
    211: {'profile': 'annual_harvest', 'harvest_months': (7, 8),  'burn_practice': 'occasional'}, # Common wheat
    212: {'profile': 'annual_harvest', 'harvest_months': (7, 8),  'burn_practice': 'occasional'}, # Durum wheat
    213: {'profile': 'annual_harvest', 'harvest_months': (6, 8),  'burn_practice': 'occasional'}, # Barley
    214: {'profile': 'annual_harvest', 'harvest_months': (7, 8),  'burn_practice': 'occasional'}, # Rye
    215: {'profile': 'annual_harvest', 'harvest_months': (7, 8),  'burn_practice': 'occasional'}, # Oats
    216: {'profile': 'annual_harvest', 'harvest_months': (9, 11), 'burn_practice': 'rare'},        # Maize
    217: {'profile': 'burn_prone',     'harvest_months': (9, 10), 'burn_practice': 'common'},      # Rice (Spain/Italy)
    218: {'profile': 'annual_harvest', 'harvest_months': (7, 8),  'burn_practice': 'occasional'}, # Triticale
    219: {'profile': 'annual_harvest', 'harvest_months': (7, 9),  'burn_practice': 'occasional'}, # Other cereals
    221: {'profile': 'annual_harvest', 'harvest_months': (8, 10), 'burn_practice': 'rare'},        # Potatoes
    222: {'profile': 'annual_harvest', 'harvest_months': (9, 11), 'burn_practice': 'rare'},        # Sugar beet
    223: {'profile': 'annual_harvest', 'harvest_months': (8, 10), 'burn_practice': 'rare'},        # Other root crops
    230: {'profile': 'annual_harvest', 'harvest_months': (7, 10), 'burn_practice': 'rare'},        # Other non-permanent industrial crops
    231: {'profile': 'annual_harvest', 'harvest_months': (8, 10), 'burn_practice': 'rare'},        # Sunflower
    232: {'profile': 'annual_harvest', 'harvest_months': (7, 8),  'burn_practice': 'rare'},        # Rapeseed
    233: {'profile': 'annual_harvest', 'harvest_months': (9, 10), 'burn_practice': 'rare'},        # Soya
    240: {'profile': 'annual_harvest', 'harvest_months': (7, 9),  'burn_practice': 'rare'},        # Dry pulses
    250: {'profile': 'multicut',       'harvest_months': (5, 10), 'burn_practice': 'rare'},        # Fodder crops
    290: {'profile': 'fallow',         'harvest_months': None,    'burn_practice': 'rare'},        # Bare arable land
}

# ─── WorldCereal profiles (global, 3 cereals only) ─────────────────────────
# All annual_harvest. Harvest windows use NH defaults; _classify_crop's
# hemisphere flip handles SH crops correctly. Burn practice rare for maize
# (modern global practice), occasional for cereals where stubble burning
# still happens (e.g. parts of South Asia).
WORLDCEREAL_CROP_PROFILES = {
    1: {'profile': 'annual_harvest', 'harvest_months': (9, 11), 'burn_practice': 'rare'},        # Maize
    2: {'profile': 'annual_harvest', 'harvest_months': (6, 8),  'burn_practice': 'occasional'}, # Winter cereals
    3: {'profile': 'annual_harvest', 'harvest_months': (8, 10), 'burn_practice': 'occasional'}, # Spring cereals
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

# AAFC ACI (Annual Crop Inventory) — Canada-wide, 30 m, annual since 2009.
# Same general shape as CDL — per-species crop classes plus forest/grass/built.
AAFC_LATEST_YEAR = 2024
AAFC_LABELS = {
    10: 'Cloud', 20: 'Water', 30: 'Exposed Land and Barren',
    34: 'Urban and Developed', 35: 'Greenhouses', 50: 'Shrubland',
    60: 'Forest Fire and Burnt Area', 80: 'Wetland', 85: 'Peatland',
    110: 'Grassland', 120: 'Agriculture (undifferentiated)',
    121: 'Cropland', 122: 'Pasture and Forages',
    130: 'Too Wet to be Seeded', 131: 'Fallow', 132: 'Cereals',
    133: 'Barley', 134: 'Other Grains', 135: 'Millet', 136: 'Oats',
    137: 'Rye', 138: 'Spelt', 139: 'Triticale', 140: 'Wheat',
    141: 'Switchgrass', 142: 'Sorghum', 143: 'Quinoa',
    145: 'Winter Wheat', 146: 'Spring Wheat', 147: 'Corn for Grain',
    148: 'Tobacco', 149: 'Ginseng', 150: 'Oilseeds', 151: 'Borage',
    152: 'Camelina', 153: 'Canola and Rapeseed', 154: 'Flaxseed',
    155: 'Mustard', 156: 'Safflower', 157: 'Sunflower', 158: 'Soybeans',
    159: 'Other Oilseeds', 160: 'Pulses', 161: 'Other Pulses',
    162: 'Peas', 163: 'Chickpeas', 167: 'Beans', 168: 'Fababeans',
    174: 'Lentils', 175: 'Vegetables', 176: 'Tomatoes', 177: 'Potatoes',
    178: 'Sugarbeets', 179: 'Other Vegetables', 180: 'Fruits',
    181: 'Berries', 182: 'Blueberry', 183: 'Cranberry',
    185: 'Other Berries', 188: 'Orchards', 189: 'Other Fruits',
    190: 'Vineyards', 191: 'Hops', 192: 'Sod', 193: 'Herbs',
    194: 'Nursery', 195: 'Buckwheat', 196: 'Canaryseed', 197: 'Hemp',
    198: 'Vetch', 199: 'Other Crops', 200: 'Forest (undifferentiated)',
    210: 'Coniferous', 220: 'Broadleaf', 230: 'Mixedwood',
}

# EUCROPMAP (JRC) — EU + UK, 10 m, 2018 + 2022. Per-crop labels for the major
# European crops, with generic woodland / grassland / artificial fallbacks.
EUCROPMAP_ASSET = 'JRC/D5/EUCROPMAP/V1'
EUCROPMAP_LATEST_YEAR = 2022
EUCROPMAP_LABELS = {
    100: 'Artificial', 211: 'Common wheat', 212: 'Durum wheat',
    213: 'Barley', 214: 'Rye', 215: 'Oats', 216: 'Maize',
    217: 'Rice', 218: 'Triticale', 219: 'Other cereals',
    221: 'Potatoes', 222: 'Sugar beet', 223: 'Other root crops',
    230: 'Other non-permanent industrial crops', 231: 'Sunflower',
    232: 'Rapeseed and turnip rapeseed', 233: 'Soya',
    240: 'Dry pulses',
    250: 'Fodder crops (cereals and leguminous)',
    290: 'Bare arable land',
    300: 'Woodland and Shrubland (incl. permanent crops)',
    500: 'Grasslands', 600: 'Bare land/lichens moss',
    700: 'Water', 800: 'Wetlands',
}

# ESA WorldCereal — global 10 m, 2021. Binary per-crop masks, organized as an
# ImageCollection of AEZ × product × season tiles. We extract only the three
# specific-crop products (maize / wintercereals / springcereals) — the
# "temporarycrops" product is redundant with WorldCover Cropland for our
# purposes, and "irrigation" is a management attribute, not a crop type.
WORLDCEREAL_ASSET = 'ESA/WorldCereal/2021/MODELS/v100'
WORLDCEREAL_PRODUCTS = ('maize', 'wintercereals', 'springcereals')
WORLDCEREAL_LABELS = {
    1: 'Maize', 2: 'Winter cereals', 3: 'Spring cereals',
}
# Maps the product string → numeric code used in the popup data flow.
WORLDCEREAL_PRODUCT_CODES = {
    'maize': 1, 'wintercereals': 2, 'springcereals': 3,
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

AAFC_CATEGORY_MAP = {
    # FOREST (natural)
    200: CATEGORY_FOREST, 210: CATEGORY_FOREST, 220: CATEGORY_FOREST, 230: CATEGORY_FOREST,
    # CROPLAND — everything in 120-199 that's farmland (including orchards
    # and vineyards, which are managed agriculture even when tree-covered)
    120: CATEGORY_CROPLAND, 121: CATEGORY_CROPLAND, 122: CATEGORY_CROPLAND,
    130: CATEGORY_CROPLAND, 131: CATEGORY_CROPLAND, 132: CATEGORY_CROPLAND,
    133: CATEGORY_CROPLAND, 134: CATEGORY_CROPLAND, 135: CATEGORY_CROPLAND,
    136: CATEGORY_CROPLAND, 137: CATEGORY_CROPLAND, 138: CATEGORY_CROPLAND,
    139: CATEGORY_CROPLAND, 140: CATEGORY_CROPLAND, 142: CATEGORY_CROPLAND,
    143: CATEGORY_CROPLAND, 145: CATEGORY_CROPLAND, 146: CATEGORY_CROPLAND,
    147: CATEGORY_CROPLAND, 148: CATEGORY_CROPLAND, 149: CATEGORY_CROPLAND,
    150: CATEGORY_CROPLAND, 151: CATEGORY_CROPLAND, 152: CATEGORY_CROPLAND,
    153: CATEGORY_CROPLAND, 154: CATEGORY_CROPLAND, 155: CATEGORY_CROPLAND,
    156: CATEGORY_CROPLAND, 157: CATEGORY_CROPLAND, 158: CATEGORY_CROPLAND,
    159: CATEGORY_CROPLAND, 160: CATEGORY_CROPLAND, 161: CATEGORY_CROPLAND,
    162: CATEGORY_CROPLAND, 163: CATEGORY_CROPLAND, 167: CATEGORY_CROPLAND,
    168: CATEGORY_CROPLAND, 174: CATEGORY_CROPLAND, 175: CATEGORY_CROPLAND,
    176: CATEGORY_CROPLAND, 177: CATEGORY_CROPLAND, 178: CATEGORY_CROPLAND,
    179: CATEGORY_CROPLAND, 180: CATEGORY_CROPLAND, 181: CATEGORY_CROPLAND,
    182: CATEGORY_CROPLAND, 183: CATEGORY_CROPLAND, 185: CATEGORY_CROPLAND,
    188: CATEGORY_CROPLAND, 189: CATEGORY_CROPLAND, 190: CATEGORY_CROPLAND,
    191: CATEGORY_CROPLAND, 193: CATEGORY_CROPLAND, 194: CATEGORY_CROPLAND,
    195: CATEGORY_CROPLAND, 196: CATEGORY_CROPLAND, 197: CATEGORY_CROPLAND,
    198: CATEGORY_CROPLAND, 199: CATEGORY_CROPLAND,
    # GRASSLAND — pasture, shrubland, sod, switchgrass
    50: CATEGORY_GRASSLAND, 110: CATEGORY_GRASSLAND,
    141: CATEGORY_GRASSLAND, 192: CATEGORY_GRASSLAND,
    # BUILT — developed + barren + greenhouses
    30: CATEGORY_BUILT, 34: CATEGORY_BUILT, 35: CATEGORY_BUILT,
    # OTHER (no category): 10 (Cloud), 20 (Water), 60 (Burnt — historical),
    # 80 (Wetland), 85 (Peatland)
}

EUCROPMAP_CATEGORY_MAP = {
    # FOREST (woodland & shrubland incl. permanent crops)
    300: CATEGORY_FOREST,
    # CROPLAND — every per-crop class + bare arable land (rotation fallow)
    211: CATEGORY_CROPLAND, 212: CATEGORY_CROPLAND, 213: CATEGORY_CROPLAND,
    214: CATEGORY_CROPLAND, 215: CATEGORY_CROPLAND, 216: CATEGORY_CROPLAND,
    217: CATEGORY_CROPLAND, 218: CATEGORY_CROPLAND, 219: CATEGORY_CROPLAND,
    221: CATEGORY_CROPLAND, 222: CATEGORY_CROPLAND, 223: CATEGORY_CROPLAND,
    230: CATEGORY_CROPLAND, 231: CATEGORY_CROPLAND, 232: CATEGORY_CROPLAND,
    233: CATEGORY_CROPLAND, 240: CATEGORY_CROPLAND, 250: CATEGORY_CROPLAND,
    290: CATEGORY_CROPLAND,
    # GRASSLAND
    500: CATEGORY_GRASSLAND,
    # BUILT
    100: CATEGORY_BUILT, 600: CATEGORY_BUILT,
    # OTHER: 700 (Water), 800 (Wetlands)
}

# WorldCereal is per-product binary masks; everything that flags positive
# IS cropland by definition. We handle the categorization inline rather
# than as a per-code dict.


def _build_unified_classifier() -> ee.Image:
    """Single global classification image. Each pixel = universal category code
    (1=forest, 2=cropland, 3=grassland, 4=built); masked elsewhere. Uses
    newest-data-wins priority:
        CDL (US 2024) > AAFC (Canada 2024) > MapBiomas Brazil (2023) >
        EUCROPMAP (EU 2022) > WorldCereal (global 2021, cropland-only) >
        Dynamic World (90-day mode) > WorldCover (2021).
    """

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

    # WorldCereal — flag any of the 3 specific crop products as CROPLAND.
    # Mosaic each product across AEZs, then OR them together.
    wco_coll = ee.ImageCollection(WORLDCEREAL_ASSET)
    wco_any = ee.Image(0)
    for product in WORLDCEREAL_PRODUCTS:
        prod_img = (wco_coll.filter(ee.Filter.eq('product', product))
                            .select('classification').mosaic())
        wco_any = wco_any.max(prod_img.gte(100).unmask(0))
    wco_cat = wco_any.gt(0).selfMask().multiply(CATEGORY_CROPLAND).toInt()

    eu = (ee.ImageCollection(EUCROPMAP_ASSET)
          .filter(ee.Filter.calendarRange(EUCROPMAP_LATEST_YEAR, EUCROPMAP_LATEST_YEAR, 'year'))
          .select('classification')
          .mosaic())
    eu_cat = categorize(eu, EUCROPMAP_CATEGORY_MAP)

    mb = (ee.Image(MAPBIOMAS_BR_ASSET)
          .select(f'classification_{MAPBIOMAS_BR_LATEST_YEAR}'))
    mb_cat = categorize(mb, MAPBIOMAS_CATEGORY_MAP)

    aafc = (ee.ImageCollection('AAFC/ACI')
            .filter(ee.Filter.calendarRange(AAFC_LATEST_YEAR, AAFC_LATEST_YEAR, 'year'))
            .select('landcover')
            .mosaic())
    aafc_cat = categorize(aafc, AAFC_CATEGORY_MAP)

    cdl = ee.Image(f'USDA/NASS/CDL/{CDL_LATEST_YEAR}').select('cropland')
    cdl_cat = categorize(cdl, CDL_CATEGORY_MAP)

    # Layer least → most specific. .where() overwrites where the higher
    # priority dataset is unmasked (i.e. has a value).
    unified = wc_cat
    unified = unified.where(dw_cat.mask(), dw_cat)
    unified = unified.where(wco_cat.mask(), wco_cat)
    unified = unified.where(eu_cat.mask(), eu_cat)
    unified = unified.where(mb_cat.mask(), mb_cat)
    unified = unified.where(aafc_cat.mask(), aafc_cat)
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
    """Add CDL, AAFC, MapBiomas, EUCROPMAP, WorldCereal (per-product),
    Dynamic World, and WorldCover bands to a stack. Each band uses the
    source's class codes; resolution is whatever the source provides."""
    cdl = (ee.Image(f'USDA/NASS/CDL/{CDL_LATEST_YEAR}')
           .select('cropland').rename('cdl'))
    aafc = (ee.ImageCollection('AAFC/ACI')
            .filter(ee.Filter.calendarRange(AAFC_LATEST_YEAR, AAFC_LATEST_YEAR, 'year'))
            .filterBounds(point)
            .select('landcover')
            .mosaic()
            .rename('aafc'))
    mb = (ee.Image(MAPBIOMAS_BR_ASSET)
          .select(f'classification_{MAPBIOMAS_BR_LATEST_YEAR}')
          .rename('mapbiomas'))
    eu = (ee.ImageCollection(EUCROPMAP_ASSET)
          .filter(ee.Filter.calendarRange(EUCROPMAP_LATEST_YEAR, EUCROPMAP_LATEST_YEAR, 'year'))
          .filterBounds(point)
          .select('classification')
          .mosaic()
          .rename('eucropmap'))
    today = date.today()
    dw_start = (today - timedelta(days=DYNAMIC_WORLD_LOOKBACK_DAYS)).isoformat()
    dw = (ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
          .filterBounds(point)
          .filterDate(dw_start, today.isoformat())
          .select('label')
          .mode()
          .rename('dynworld'))
    wc = ee.Image(WORLDCOVER_ASSET).select('Map').rename('worldcover')
    out = (stack.addBands(cdl).addBands(aafc).addBands(mb).addBands(eu)
                .addBands(dw).addBands(wc))
    # WorldCereal per-product binary bands. Each is 0/100 with no-data masked.
    wco_coll = ee.ImageCollection(WORLDCEREAL_ASSET).filterBounds(point)
    for product in WORLDCEREAL_PRODUCTS:
        prod_img = (wco_coll.filter(ee.Filter.eq('product', product))
                            .select('classification').mosaic()
                            .rename(f'wc_{product}'))
        out = out.addBands(prod_img)
    return out


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


# ─── VIIRS / MODIS active fires (NASA FIRMS) ────────────────────────────────
# Higher-sensitivity companion to MODIS burned-area. Catches small, fresh, or
# brief fires that the monthly burned-area product misses. Tight spatial /
# temporal window — wildfires happen on specific days near specific pixels,
# not month-long across multi-km windows.
FIRMS_BUFFER_M = 1500       # ~1.5 km radius around the click
FIRMS_WINDOW_DAYS = 21      # ±3 weeks of the OPERA detection date
FIRMS_CONFIDENCE_MIN = 70   # FIRMS confidence threshold (0-100)


def _sample_active_fires(point: ee.Geometry, opera_date_str: str | None) -> dict | None:
    """Count NASA FIRMS active-fire pixel-day detections within a tight
    spatial/temporal window of the OPERA disturbance.

    Bug fix: `coll.size()` returns the number of IMAGES in the collection
    intersecting the buffer — which for a multi-day window is mostly empty
    daily mosaics and runs ~70+ globally regardless of fire activity. We now
    actually count detection pixels: sum the per-image fire-mask across the
    time dimension and reduce across the buffer area.
    """
    if not opera_date_str:
        return None
    try:
        opera_dt = date.fromisoformat(opera_date_str)
        start_iso = (opera_dt - timedelta(days=FIRMS_WINDOW_DAYS)).isoformat()
        end_iso = (opera_dt + timedelta(days=FIRMS_WINDOW_DAYS)).isoformat()
        buffer_geom = point.buffer(FIRMS_BUFFER_M)
        coll = (
            ee.ImageCollection('FIRMS')
            .filterDate(start_iso, end_iso)
            .filterBounds(buffer_geom)
        )

        # For each image, mark pixels where there was a high-confidence
        # detection (confidence >= threshold AND brightness band T21 > 0;
        # T21 is masked where no fire was detected). Sum across time →
        # image whose pixel values = number of days that pixel was flagged.
        def detect_mask(img):
            return (
                img.select('T21').gt(0)
                .updateMask(img.select('confidence').gte(FIRMS_CONFIDENCE_MIN))
            )

        days_with_fire = coll.map(detect_mask).reduce(ee.Reducer.sum())

        # Sum across the buffer area at FIRMS native resolution (~1 km) to
        # get total "pixel-days of fire activity" in the window.
        sampled = days_with_fire.reduceRegion(
            reducer=ee.Reducer.sum(),
            geometry=buffer_geom,
            scale=1000,
            maxPixels=int(1e9),
        ).getInfo()
        # `Reducer.sum()` on a band named "T21" produces "T21_sum"
        count = int(sampled.get('T21_sum') or 0)
        return {'count': count} if count > 0 else None
    except Exception as e:
        print(f'FIRMS sample failed: {e}', flush=True)
        return None


# ─── Named-fire context (MTBS + NIFC) ───────────────────────────────────────
# Matches the click point against authoritative US fire perimeters so the
# popup can name the fire (e.g. "Park Fire, 2024, 429,603 acres") instead
# of just saying "fire detected nearby."
#
# Date filtering: a fire is only relevant if its ignition date is at or
# before the OPERA detection date AND within a reasonable lookback window.
# Cause must precede effect; arbitrarily-old fires that happen to coincide
# spatially are not what we want to attribute to a 2026 OPERA detection.

MTBS_ASSET = 'USFS/GTAC/MTBS/burned_area_boundaries/v1'
MTBS_LOOKBACK_YEARS = 3      # MTBS lags ~1-2y; 3y window covers most relevant fires
NIFC_LOOKBACK_DAYS = 547     # ~1.5 years for current/recent NIFC perimeters
# NIFC WFIGS Interagency Perimeters — multi-year, includes active +
# archived + recently-contained fires. Has perimeters that aren't yet in
# the InterAgencyFirePerimeterHistory "all years" dataset (which lags by
# 1-2 years). Sourced from the same WFIGS feed as the current/year-to-date
# subsets but with the broadest temporal coverage — Bear Gulch 2025 is
# here but missing from the history view.
NIFC_WFIGS_URL = (
    'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/'
    'WFIGS_Interagency_Perimeters/FeatureServer/0/query'
)
# NIFC History view — covers older fires (pre-WFIGS feed) back to early
# 1900s. Used as a fallback for fires before WFIGS coverage begins.
NIFC_HISTORY_URL = (
    'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/'
    'InterAgencyFirePerimeterHistory_All_Years_View/FeatureServer/0/query'
)

# JRC GlobFire v2 — global MODIS-based fire perimeters, 2002-present, ~2 mo
# lag. Fires are UNNAMED (just an ID + start/end dates + burned area). Used
# for non-US clicks so the named-fire context isn't US-only. We display
# these as "{acres}-acre fire ({date})" in the popup.
GLOBFIRE_ASSET = 'JRC/GWIS/GlobFire/v2/FinalPerimeters'
# Only show GlobFire perimeters at least this size — smaller fires create
# popup noise and aren't useful "context for nearby disturbance" the way
# named fires are.
GLOBFIRE_MIN_ACRES = 500


def _is_in_us(lat: float, lng: float) -> bool:
    """Loose bbox check to skip MTBS/NIFC calls for clearly non-US points."""
    if 24.0 <= lat <= 49.5 and -125.0 <= lng <= -66.0:
        return True
    if 51.0 <= lat <= 72.0 and -180.0 <= lng <= -130.0:    # Alaska
        return True
    if 18.5 <= lat <= 22.5 and -161.0 <= lng <= -154.0:    # Hawaii
        return True
    return False


def _sample_mtbs_fires(point: ee.Geometry) -> list:
    """Return ALL MTBS fires whose perimeter contains the point — full
    historical record back to 1984, no date filter. The caller filters to
    recent fires for cause inference; the full list is exposed as the
    "fire history at this location" in the popup.
    """
    try:
        mtbs = ee.FeatureCollection(MTBS_ASSET).filterBounds(point)
        # Sort by ignition date descending so newest fires come first.
        result = mtbs.limit(15, 'Ig_Date', False).getInfo()
        fires = []
        for f in result.get('features', []):
            p = f.get('properties', {})
            ig_ms = p.get('Ig_Date')
            ig_iso = None
            year = None
            if ig_ms is not None:
                try:
                    dt = datetime.fromtimestamp(int(ig_ms) / 1000, tz=timezone.utc)
                    ig_iso = dt.date().isoformat()
                    year = dt.year
                except (TypeError, ValueError):
                    pass
            fires.append({
                'name': p.get('Incid_Name') or p.get('Event_ID') or 'Unnamed fire',
                'date': ig_iso,
                'year': year,
                'acres': p.get('BurnBndAc'),
                'incident_type': p.get('Incid_Type'),
                'source': 'MTBS',
            })
        return fires
    except Exception as e:
        print(f'MTBS sample failed: {e}', flush=True)
        return []


NIFC_MIN_YEAR = 1900  # Excludes paleofire / dendrochronology reconstructions


def _sample_nifc_fires(lat: float, lng: float) -> list:
    """Return NIFC fires whose perimeter contains the point. Filtered to
    modern fires (FIRE_YEAR_INT >= 1900) — the all-years dataset includes
    paleofire reconstructions from tree-ring records going back to the
    1200s that would otherwise pollute the list. We also skip "UNNAMED"
    entries which tend to be the paleofire records that slip through."""
    try:
        params = {
            'geometry': f'{lng},{lat}',
            'geometryType': 'esriGeometryPoint',
            'inSR': '4326',
            'spatialRel': 'esriSpatialRelIntersects',
            'where': (
                f'FIRE_YEAR_INT >= {NIFC_MIN_YEAR} '
                "AND UPPER(INCIDENT) <> 'UNNAMED' "
                "AND INCIDENT IS NOT NULL"
            ),
            'outFields': 'INCIDENT,FIRE_YEAR_INT,GIS_ACRES,DATE_CUR,IRWINID',
            'returnGeometry': 'false',
            'orderByFields': 'FIRE_YEAR_INT DESC',
            'resultRecordCount': '15',
            'f': 'json',
        }
        # Force %20 encoding for spaces (default `+` from urlencode breaks the
        # ArcGIS REST WHERE parser).
        url = NIFC_HISTORY_URL + '?' + urllib.parse.urlencode(
            params, quote_via=urllib.parse.quote
        )
        req = urllib.request.Request(url, headers={'User-Agent': 'EarthAtlas/1.0'})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())

        fires = []
        for f in (data.get('features') or [])[:3]:
            attrs = f.get('attributes', {}) or {}
            name = attrs.get('INCIDENT')
            if not name:
                continue
            # DATE_CUR is a YYYYMMDD string. Convert to ISO when possible.
            date_cur = attrs.get('DATE_CUR')
            iso_date = None
            if date_cur and len(str(date_cur)) >= 8:
                s = str(date_cur)[:8]
                try:
                    iso_date = f'{s[:4]}-{s[4:6]}-{s[6:8]}'
                except Exception:
                    pass
            # Year as fallback when DATE_CUR is malformed
            year = attrs.get('FIRE_YEAR_INT')
            irwin = attrs.get('IRWINID')
            inciweb = (
                f'https://inciweb.wildfire.gov/incident-information/{irwin}'
                if irwin else None
            )
            fires.append({
                'name': str(name).strip().title() if str(name).isupper() else str(name).strip(),
                'date': iso_date,
                'year': year,
                'acres': attrs.get('GIS_ACRES'),
                'inciweb_url': inciweb,
                'source': 'NIFC',
            })
        return fires
    except Exception as e:
        print(f'NIFC sample failed: {e}', flush=True)
        return []


def _sample_nifc_wfigs_fires(lat: float, lng: float) -> list:
    """Query NIFC WFIGS Interagency Perimeters (multi-year). Covers active
    AND recently-contained AND archived fires from the WFIGS feed — this is
    the dataset where 2024–2025 fires live before they make it into the
    older InterAgencyFirePerimeterHistory archive."""
    try:
        params = {
            'geometry': f'{lng},{lat}',
            'geometryType': 'esriGeometryPoint',
            'inSR': '4326',
            'spatialRel': 'esriSpatialRelIntersects',
            'where': '1=1',
            'outFields': ','.join([
                'attr_IncidentName', 'poly_IncidentName',
                'attr_FireDiscoveryDateTime', 'attr_IncidentSize',
                'attr_PercentContained', 'attr_IncidentTypeCategory',
                'attr_IrwinID',
            ]),
            'returnGeometry': 'false',
            'resultRecordCount': '8',
            'f': 'json',
        }
        url = NIFC_WFIGS_URL + '?' + urllib.parse.urlencode(
            params, quote_via=urllib.parse.quote,
        )
        req = urllib.request.Request(url, headers={'User-Agent': 'EarthAtlas/1.0'})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())

        fires = []
        for f in (data.get('features') or [])[:8]:
            attrs = f.get('attributes', {}) or {}
            name = attrs.get('poly_IncidentName') or attrs.get('attr_IncidentName')
            if not name:
                continue
            ms = attrs.get('attr_FireDiscoveryDateTime')
            fire_date = None
            year = None
            if ms:
                try:
                    dt = datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc)
                    fire_date = dt.date().isoformat()
                    year = dt.year
                except (TypeError, ValueError):
                    pass
            irwin = attrs.get('attr_IrwinID')
            # IRWIN can be UUID with braces — strip for clean URL
            clean_irwin = irwin.strip('{}') if irwin else None
            inciweb = (
                f'https://inciweb.wildfire.gov/incident-information/{clean_irwin}'
                if clean_irwin else None
            )
            fires.append({
                'name': str(name).strip(),
                'date': fire_date,
                'year': year,
                'acres': attrs.get('attr_IncidentSize'),
                'contained_pct': attrs.get('attr_PercentContained'),
                'incident_type': attrs.get('attr_IncidentTypeCategory'),
                'inciweb_url': inciweb,
                'source': 'NIFC',
            })
        return fires
    except Exception as e:
        print(f'NIFC WFIGS sample failed: {e}', flush=True)
        return []


def _sample_globfire_fires(point: ee.Geometry) -> list:
    """Query JRC GlobFire v2 perimeters at a point.

    KNOWN ISSUE — currently disabled: GlobFire v2's EE asset
    (JRC/GWIS/GlobFire/v2/FinalPerimeters) has corrupted bbox/geometry
    indexes for the perimeters that come back from filterBounds at any
    point — every returned feature's geometry().area() resolves to
    Infinity, meaning either the geometries themselves are degenerate
    (self-intersecting/antimeridian-wrapping) or EE's area kernel is
    failing on them. Result: filterBounds returns the same 44 features
    everywhere on earth, and we can't distinguish real fires from
    broken-bbox ghosts. Returns [] so the named-fire context falls back
    cleanly to MTBS+NIFC (US-only).

    Follow-up options to revisit:
      1. JRC/GWIS/GlobFire/v2/DailyPerimeters (different indexing)
      2. ESA Fire_cci v5.1 burn-pixel rasters → derived perimeters
      3. FIRMS hot-spot clustering → ad-hoc perimeters
      4. EFFIS for Europe (REST API, requires HTTP fetch like NIFC)
    """
    return []


def _dedupe_and_sort_fires(fires: list) -> list:
    """Combine MTBS + NIFC results, dedupe across sources, and sort
    newest-first. Caps at 10 entries to keep popup payload small.

    Dedupe key: (year, acres bucket). Same fire often appears across
    sources (MTBS + NIFC + GlobFire) with slightly different acres and
    name formatting. Bucketing acres to within ~10% catches these as
    duplicates. Source priority for the winner: MTBS (validated US,
    with severity) > NIFC (US, current) > GlobFire (global, unnamed).
    """
    source_priority = {'MTBS': 0, 'NIFC': 1, 'GlobFire': 2}
    sorted_fires = sorted(
        fires,
        key=lambda f: (
            -(f.get('year') or 0),
            source_priority.get(f.get('source'), 3),
        ),
    )
    seen = set()
    out = []
    for f in sorted_fires:
        year = f.get('year') or 0
        acres = float(f.get('acres') or 0)
        # Bucket acres to nearest 10% (with 1000-acre floor for small fires).
        bucket = int(round(acres / max(1000.0, acres * 0.1))) if acres > 0 else 0
        key = (year, bucket)
        if key in seen:
            continue
        seen.add(key)
        out.append(f)
        if len(out) >= 10:
            break
    return out


def _filter_fires_to_window(fires: list, opera_date_str: str | None) -> list:
    """Subset of fires within the cause-inference window:
    OPERA date − 3 years to OPERA date. Used only by the heuristic so old
    fires (e.g. 1985) don't get attributed as the cause of a 2026 detection.
    """
    if not opera_date_str or not fires:
        return []
    try:
        opera_dt = date.fromisoformat(opera_date_str)
    except ValueError:
        return []
    cutoff = opera_dt - timedelta(days=int(MTBS_LOOKBACK_YEARS * 365.25))
    out = []
    for f in fires:
        fd = f.get('date')
        if not fd:
            continue
        try:
            fire_dt = date.fromisoformat(fd)
        except ValueError:
            continue
        if cutoff <= fire_dt <= opera_dt:
            out.append(f)
    return out


# ─── Sentinel-2 NBR delta (dNBR) ────────────────────────────────────────────
# Normalized Burn Ratio = (NIR - SWIR2) / (NIR + SWIR2). dNBR is the pre/post
# difference; high dNBR (>~0.27) indicates moderate-to-high severity burn per
# the USGS classification, even when active-fire products miss the event.
NBR_PRE_WINDOW_DAYS = (240, 60)   # 240-60 days before OPERA detection
NBR_POST_WINDOW_DAYS = (0, 60)    # 0-60 days after OPERA detection


def _sample_nbr_delta(point: ee.Geometry, opera_date_str: str | None) -> dict | None:
    """Sample Sentinel-2 NBR before/after OPERA date. Returns dnbr or None."""
    if not opera_date_str:
        return None
    try:
        opera_dt = date.fromisoformat(opera_date_str)
        pre_start = (opera_dt - timedelta(days=NBR_PRE_WINDOW_DAYS[0])).isoformat()
        pre_end   = (opera_dt - timedelta(days=NBR_PRE_WINDOW_DAYS[1])).isoformat()
        post_start = opera_dt.isoformat()
        post_end   = (opera_dt + timedelta(days=NBR_POST_WINDOW_DAYS[1])).isoformat()

        def to_nbr(img):
            return img.normalizedDifference(['B8', 'B12']).rename('nbr')

        s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
        pre = (s2.filterDate(pre_start, pre_end)
                 .filterBounds(point)
                 .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 40))
                 .map(to_nbr).median().rename('nbr_pre'))
        post = (s2.filterDate(post_start, post_end)
                  .filterBounds(point)
                  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 60))
                  .map(to_nbr).median().rename('nbr_post'))

        sampled = pre.addBands(post).reduceRegion(
            reducer=ee.Reducer.first(), geometry=point, scale=20,
        ).getInfo()
        nbr_pre = sampled.get('nbr_pre')
        nbr_post = sampled.get('nbr_post')
        if nbr_pre is None or nbr_post is None:
            return None
        dnbr = nbr_pre - nbr_post
        return {
            'pre': round(float(nbr_pre), 3),
            'post': round(float(nbr_post), 3),
            'dnbr': round(float(dnbr), 3),
        }
    except Exception as e:
        print(f'NBR delta sample failed: {e}', flush=True)
        return None


# ─── Patch shape analysis ───────────────────────────────────────────────────
# Pure-Python geometry math on the polygon we already vectorize. Compactness,
# aspect ratio, and the fraction of perimeter aligned to cardinal directions
# distinguish human-cut blocks from irregular natural patches.
STRAIGHT_EDGE_TOLERANCE_DEG = 8


def _analyze_patch_shape(geom: dict | None) -> dict | None:
    """Return shape stats + categorical hint, or None for invalid input."""
    if not geom or geom.get('type') != 'Polygon':
        return None
    rings = geom.get('coordinates', [])
    if not rings:
        return None
    outer = rings[0]
    if len(outer) < 4:
        return None

    # Equirectangular projection centered on the polygon — accurate enough
    # for ratios. Avoids pulling in a real reprojection lib.
    avg_lat = sum(p[1] for p in outer) / len(outer)
    avg_lng = sum(p[0] for p in outer) / len(outer)
    cos_lat = math.cos(math.radians(avg_lat))

    def to_planar(p):
        return (
            (p[0] - avg_lng) * 111320 * cos_lat,
            (p[1] - avg_lat) * 111320,
        )

    planar = [to_planar(p) for p in outer]
    n = len(planar) - 1  # last point repeats the first

    # Shoelace area
    area_signed = 0.0
    for i in range(n):
        x1, y1 = planar[i]
        x2, y2 = planar[i + 1]
        area_signed += (x2 - x1) * (y2 + y1) / 2
    area = abs(area_signed)
    if area < 1:
        return None

    # Perimeter + per-edge alignment to N/S/E/W
    perimeter = 0.0
    aligned_length = 0.0
    for i in range(n):
        x1, y1 = planar[i]
        x2, y2 = planar[i + 1]
        length = math.hypot(x2 - x1, y2 - y1)
        perimeter += length
        if length < 0.5:
            continue
        # Fold orientation to 0-90° so N-S and E-W both count as "aligned"
        angle = math.degrees(math.atan2(y2 - y1, x2 - x1)) % 90
        if angle <= STRAIGHT_EDGE_TOLERANCE_DEG or angle >= 90 - STRAIGHT_EDGE_TOLERANCE_DEG:
            aligned_length += length

    compactness = (4 * math.pi * area) / (perimeter ** 2) if perimeter > 0 else 0
    straight_ratio = aligned_length / perimeter if perimeter > 0 else 0

    xs = [p[0] for p in planar]
    ys = [p[1] for p in planar]
    bbox_w = max(max(xs) - min(xs), 1)
    bbox_h = max(max(ys) - min(ys), 1)
    aspect = max(bbox_w, bbox_h) / min(bbox_w, bbox_h)

    # Categorize. straight_edge_ratio is unreliable here — raster-derived
    # polygons have axis-aligned pixel-grid edges by construction, so the
    # metric is always near 1.0 regardless of underlying shape. We still
    # compute it as raw stat (could be useful after polygon simplification
    # in a later iteration), but only compactness + aspect drive the hint.
    #
    # Pixelated squares cap at ~0.6 compactness; truly irregular natural
    # patches typically come in below 0.2. Mid-range is ambiguous.
    if aspect > 4:
        hint = 'linear'        # road / pipeline / transmission corridor
    elif compactness > 0.45:
        hint = 'blocky'        # likely human-cut field or clearcut
    elif compactness < 0.18:
        hint = 'irregular'     # likely natural (fire, blowdown)
    else:
        hint = 'ambiguous'

    return {
        'compactness': round(compactness, 3),
        'aspect_ratio': round(aspect, 2),
        'straight_edge_ratio': round(straight_ratio, 3),
        'hint': hint,
    }


# ─── Likely-cause inference ─────────────────────────────────────────────────
# Simple rule engine that weighs the signals we've gathered. Outputs a string
# label plus the reasoning so users can audit how we arrived at it.


def _infer_likely_cause(
    burn, fires, nbr, shape, land_cover, named_fires=None,
    crop_profile=None, nass_context=None,
) -> dict:
    """Land-cover-aware cause inference.

    The land cover at the click point is the most important context — a
    fire signal on cropland is almost certainly intentional agricultural
    burning (residue, orchard removal); the same signal in forest is more
    likely a wildfire. We branch on land cover first and tune the cause
    language to match.

    Fire-signal rules:
    - "Strong" fire = MODIS burn scar AND (high dNBR OR many active fires)
    - "Moderate" fire = MODIS burn alone, OR (moderate dNBR AND many fires)
    - FIRMS active fires alone are NOT sufficient — refinery flares,
      industrial heat, and slash burning on adjacent parcels all register.

    dNBR alone is also insufficient: it just confirms vegetation was lost,
    which OPERA already told us. Real fire requires spatial + temporal
    coincidence of multiple fire-specific signals.

    Crop-aware refinements (when crop_profile is set):
    - 'multicut' (alfalfa, hay, clover) — dNBR spikes during the cutting
      window are routine harvest, not fire. Burn label requires very
      strong fire evidence.
    - 'burn_prone' (sugarcane, rice, cotton) — moderate fire signal is
      credibly a managed pre/post-harvest burn.
    - 'annual_harvest' (corn, soy, wheat) — in-season dNBR with no fire
      signal reads as harvest, not disturbance.
    - 'orchard' (apples, citrus) — blocky removal pattern signals tree
      replacement.
    - NASS county tillage data softens "burn" labels in no-till counties.
    """
    has_burn = bool(burn and burn.get('date'))
    fire_count = (fires or {}).get('count', 0) or 0
    dnbr = (nbr or {}).get('dnbr')
    dnbr_high = dnbr is not None and dnbr > 0.44   # USGS high-severity
    dnbr_mod  = dnbr is not None and dnbr > 0.27   # USGS moderate
    named_fires = named_fires or []
    has_named_fire = len(named_fires) > 0  # MTBS or NIFC perimeter contains the point

    # Fire-signal tiers. `fire_count` is "pixel-days of confident FIRMS
    # detections" within the tight 1.5 km / ±21 day window — any nonzero
    # value is meaningful at this scale; >5 is a clear active-fire signal.
    # A named fire perimeter (MTBS/NIFC) is the strongest possible evidence
    # — those datasets are validated, named historical events. A high-
    # severity dNBR (>0.44) is also definitive: the spectral burn-scar
    # signature is hard to confuse with non-fire causes at that magnitude.
    strong_fire = has_named_fire or dnbr_high or (has_burn and (dnbr_mod or fire_count >= 3))
    moderate_fire = strong_fire or has_burn or dnbr_mod or fire_count >= 5
    has_dense_fires = fire_count >= 10  # persistent local activity (often industrial)

    # Shape hints
    hint = (shape or {}).get('hint', 'ambiguous')
    is_blocky = hint == 'blocky'
    is_linear = hint == 'linear'
    is_irregular = hint == 'irregular'

    # Land-cover context. If `crop_profile` is set (CDL / AAFC / MapBiomas /
    # EUCROPMAP / WorldCereal), we KNOW the click is on a crop — the keyword
    # list below was authored when CDL was the only crop source and doesn't
    # cover every label from the newer per-region maps (e.g. "Maize",
    # "Spring Wheat", "Winter cereals"). Treating profile-presence as
    # definitive ag-evidence fixes that gap without expanding the keyword
    # list to track every dataset's vocabulary.
    lc_label = ((land_cover or {}).get('label') or '').lower()
    ag_keywords = (
        'crop', 'pasture', 'farming', 'agriculture', 'cotton', 'corn',
        'soybean', 'wheat', 'rice', 'sugar', 'coffee', 'apples', 'cherries',
        'peaches', 'pears', 'almonds', 'walnuts', 'citrus', 'oranges',
        'grapes', 'orchard', 'hay', 'alfalfa',
    )
    forest_keywords = ('tree cover', 'forest', 'mangrove', 'savanna', 'wooded')
    industrial_keywords = ('built', 'developed', 'urban', 'mining', 'industrial', 'artificial')
    grassland_keywords = ('grass', 'shrub')
    is_ag = bool(crop_profile) or any(k in lc_label for k in ag_keywords)
    is_forest = any(k in lc_label for k in forest_keywords) and not is_ag
    is_industrial = any(k in lc_label for k in industrial_keywords)
    is_grassy = any(k in lc_label for k in grassland_keywords) and not is_ag

    # Build the reasoning trail. Each entry is short, jargon-free text that
    # a non-specialist can scan in one second. Technical specifics (FIRMS
    # buffer width, dNBR thresholds, shape compactness) live in the
    # methodology modal — not in every popup.
    reasons = []
    if has_named_fire:
        top = named_fires[0]
        nm = top.get('name')
        yr = top.get('year') or (top.get('date') or '')[:4]
        ac = top.get('acres')
        bit = f'Inside the {nm} fire'
        if yr: bit += f' ({yr})'
        if ac: bit += f', {int(ac):,} acres'
        reasons.append(bit)
    if has_burn:
        reasons.append('Recent burn detected in MODIS satellite data')
    if fire_count > 0:
        reasons.append('Active fires detected nearby (NASA FIRMS)')
    if dnbr is not None:
        if dnbr_high:
            reasons.append('Strong burn signature in Sentinel-2 imagery')
        elif dnbr_mod:
            reasons.append('Moderate burn signature in Sentinel-2 imagery')
        elif has_dense_fires:
            reasons.append('No burn signature despite nearby fires (likely industrial heat)')
    if shape:
        if is_blocky:
            reasons.append('Blocky, straight-edged patch — typical of human cutting')
        elif is_linear:
            reasons.append('Long, narrow corridor — typical of roads or pipelines')
        elif is_irregular:
            reasons.append('Irregular patch shape — typical of fires or natural events')

    # Crop-profile context (US only, when CDL was the source). Lets us
    # distinguish, e.g., alfalfa harvest cuts from agricultural burns.
    profile_kind = (crop_profile or {}).get('profile')
    crop_name = (crop_profile or {}).get('crop_name')
    in_season = bool((crop_profile or {}).get('in_harvest_season'))
    burn_practice = (crop_profile or {}).get('burn_practice')
    window_str = (crop_profile or {}).get('harvest_window_str')

    # NASS county-level context (US only, when NASS_API_KEY is set).
    county_name = (nass_context or {}).get('county_name')
    state_code  = (nass_context or {}).get('state_code')
    tillage     = (nass_context or {}).get('tillage')
    nass_burn_hint = (nass_context or {}).get('burn_practice_hint')

    # The NASS-aware burn hint overrides the raw profile hint when present.
    effective_burn_practice = nass_burn_hint or burn_practice

    if crop_profile:
        if window_str and in_season:
            reasons.append(f'In {crop_name.lower()} harvest season ({window_str})')
        elif window_str:
            reasons.append(f'Outside {crop_name.lower()} harvest season (typically {window_str})')
    if tillage and tillage.get('dominant'):
        pct = int(round(tillage.get('dominant_share', 0) * 100))
        loc = f'{county_name} Co., {state_code}' if county_name and state_code else 'this county'
        # "no_till" → "no-till"; "conventional"/"conservation" pass through.
        practice = tillage['dominant'].replace('_', '-')
        reasons.append(f'{loc} is {pct}% {practice}-till (2022 USDA Census of Ag)')

    # ─── Decision tree, branched by land cover ─────────────────────────────
    label = None

    if is_ag:
        # Crops, pasture, orchards. Fire here is almost always intentional —
        # but the specific crop profile drastically changes the interpretation.

        if profile_kind == 'multicut':
            # Alfalfa / hay / clover. Routine cutting produces dNBR spikes
            # multiple times per season. Real fires are rare for these crops.
            if has_named_fire or (strong_fire and effective_burn_practice == 'common'):
                label = f'Possible fire on {crop_name.lower()} field (uncommon — multi-cut forages rarely burn)'
            elif in_season:
                label = f'Likely {crop_name.lower()} harvest cut (multi-cut crop, dNBR spikes during cutting are routine)'
            elif moderate_fire and effective_burn_practice in ('common', 'occasional'):
                label = f'Possible {crop_name.lower()} field burn'
            else:
                label = f'Likely {crop_name.lower()} field activity (cutting or grazing rotation)'

        elif profile_kind == 'burn_prone':
            # Sugarcane / rice / cotton. Pre- or post-harvest burning is a
            # standard agronomic practice. Trust the fire signal more here.
            if strong_fire:
                label = f'Likely {crop_name.lower()} field burn (standard pre/post-harvest practice)'
            elif moderate_fire:
                label = f'Likely managed {crop_name.lower()} burn'
            elif in_season:
                label = f'Likely {crop_name.lower()} harvest (residue burning common in season)'
            else:
                label = f'Likely {crop_name.lower()} field management'

        elif profile_kind == 'annual_harvest':
            # Corn / soy / wheat etc. Harvest produces dNBR but residue
            # burning is uncommon (and often regulated) in most US regions.
            if strong_fire and effective_burn_practice == 'common':
                label = f'Likely {crop_name.lower()} residue burn'
            elif strong_fire:
                label = f'Possible {crop_name.lower()} residue burn (uncommon practice in this area)'
            elif in_season and not moderate_fire:
                label = f'Likely {crop_name.lower()} harvest'
            elif moderate_fire and effective_burn_practice == 'rare':
                # Burn signal + rare-burn crop + maybe no-till county = re-route.
                label = f'Possible {crop_name.lower()} harvest with stubble heat signature'
            elif moderate_fire:
                label = f'Possible {crop_name.lower()} residue burn'
            elif is_blocky:
                label = f'Likely {crop_name.lower()} field operations (harvest, plowing, or tillage)'
            else:
                label = f'Likely {crop_name.lower()} field activity'

        elif profile_kind == 'orchard':
            # Apples / citrus / almonds / grapes. Routine harvest doesn't
            # disturb the canopy. dNBR + blocky → tree removal / replanting.
            if strong_fire:
                label = f'Possible {crop_name.lower()} orchard burn (rare — possibly removal/clearing)'
            elif is_blocky:
                label = f'Likely {crop_name.lower()} orchard removal or replanting'
            elif moderate_fire:
                label = f'Possible {crop_name.lower()} orchard clearing'
            else:
                label = f'Likely {crop_name.lower()} orchard management'

        elif profile_kind == 'fallow':
            label = 'Likely fallow-field disturbance (rotation, cover crop, or weed control)'

        # Generic-ag fallback (non-US, MapBiomas/DW/WorldCover crops, or CDL
        # codes we haven't profiled).
        elif strong_fire:
            label = 'Likely agricultural burn (crop residue, orchard removal, or land clearing)'
        elif moderate_fire:
            label = 'Possible agricultural burn'
        elif has_dense_fires:
            label = 'Likely agricultural activity (active fires elsewhere in area)'
        elif is_blocky:
            label = 'Likely agricultural clearing (harvest, plowing, or mechanical removal)'
        else:
            label = 'Likely agricultural activity'

    elif is_forest:
        # Forest land — distinguish wildfire from logging from natural causes.
        if strong_fire:
            label = 'Likely wildfire'
        elif moderate_fire and is_irregular:
            label = 'Possible wildfire'
        elif is_blocky:
            label = 'Likely logging'
        elif is_linear:
            label = 'Likely road, pipeline, or transmission corridor'
        elif is_irregular and fire_count == 0:
            label = 'Likely natural cause (storm, drought, or insect damage)'
        elif has_dense_fires and not moderate_fire:
            label = 'Inconclusive — nearby fires but no burn signature here'
        else:
            label = 'Inconclusive forest disturbance'

    elif is_industrial:
        # Built-up or developed land.
        if strong_fire:
            label = 'Possible structure fire or industrial incident'
        else:
            label = 'Likely construction or demolition'

    elif is_grassy:
        # Grassland/shrubland — fires happen, but so does mowing/clearing.
        if strong_fire:
            label = 'Likely grassland fire'
        elif moderate_fire:
            label = 'Possible grassland fire'
        elif has_dense_fires and not dnbr_mod:
            label = 'Inconclusive — possibly industrial heat source'
        elif is_blocky:
            label = 'Likely mechanical clearing'
        else:
            label = 'Likely grassland disturbance'

    else:
        # Land cover unknown or doesn't fit a clean category (bare, water,
        # wetland, etc.). Fall back on a generic decision.
        if strong_fire:
            label = 'Likely fire'
        elif moderate_fire:
            label = 'Possible fire'
        elif has_dense_fires:
            label = 'Inconclusive — possibly industrial heat source'
        elif is_blocky:
            label = 'Likely mechanical clearing'
        elif is_irregular:
            label = 'Likely natural cause'
        else:
            label = 'Inconclusive'

    return {
        'label': label,
        # Plain-English bullets, rendered as a UL in the popup. Replaces the
        # legacy semicolon-joined `reasoning` string.
        'reasoning_bullets': reasons,
        # Kept for backward compat during deploys; frontend prefers bullets.
        'reasoning': '; '.join(reasons) if reasons else 'no strong signals',
    }


def _sample_tiered_landcover(point: ee.Geometry) -> dict | None:
    """Sample the tiered land-cover classifier at a single point.
    Priority: CDL (US) > AAFC (Canada) > MapBiomas (Brazil) >
    EUCROPMAP (EU) > WorldCereal (global, cereals only) > Dynamic World
    (90-day mode) > WorldCover (2021 global). Standalone variant of
    `_add_landcover_bands` + sampling that doesn't need an OPERA stack."""
    try:
        cdl = (ee.Image(f'USDA/NASS/CDL/{CDL_LATEST_YEAR}')
               .select('cropland').rename('cdl'))
        aafc = (ee.ImageCollection('AAFC/ACI')
                .filter(ee.Filter.calendarRange(AAFC_LATEST_YEAR, AAFC_LATEST_YEAR, 'year'))
                .filterBounds(point)
                .select('landcover').mosaic().rename('aafc'))
        mb = (ee.Image(MAPBIOMAS_BR_ASSET)
              .select(f'classification_{MAPBIOMAS_BR_LATEST_YEAR}')
              .rename('mapbiomas'))
        eu = (ee.ImageCollection(EUCROPMAP_ASSET)
              .filter(ee.Filter.calendarRange(EUCROPMAP_LATEST_YEAR, EUCROPMAP_LATEST_YEAR, 'year'))
              .filterBounds(point)
              .select('classification').mosaic().rename('eucropmap'))
        today = date.today()
        dw_start = (today - timedelta(days=DYNAMIC_WORLD_LOOKBACK_DAYS)).isoformat()
        dw = (ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
              .filterBounds(point)
              .filterDate(dw_start, today.isoformat())
              .select('label').mode().rename('dynworld'))
        wc = ee.Image(WORLDCOVER_ASSET).select('Map').rename('worldcover')
        stack = (cdl.addBands(aafc).addBands(mb).addBands(eu)
                    .addBands(dw).addBands(wc))
        # WorldCereal per-product binary bands.
        wco_coll = ee.ImageCollection(WORLDCEREAL_ASSET).filterBounds(point)
        for product in WORLDCEREAL_PRODUCTS:
            prod_img = (wco_coll.filter(ee.Filter.eq('product', product))
                                .select('classification').mosaic()
                                .rename(f'wc_{product}'))
            stack = stack.addBands(prod_img)
        sampled = stack.reduceRegion(
            reducer=ee.Reducer.first(), geometry=point, scale=10,
        ).getInfo()
        return _resolve_landcover(sampled)
    except Exception as e:
        print(f'_sample_tiered_landcover failed: {e}', flush=True)
        return None


def _resolve_landcover(sampled: dict) -> dict:
    """Pick the most-specific label available, in priority order.

    Priority chain (most → least specific):
      1. CDL (US 2024) — per-species crop classes
      2. AAFC (Canada 2024) — per-species crop classes
      3. MapBiomas (Brazil 2023) — per-species crop classes
      4. EUCROPMAP (EU 2022) — per-species crop classes
      5. WorldCereal (global 2021) — 3 specific cereals
      6. Dynamic World (global, 90-day mode) — generic categories
      7. WorldCover (global 2021) — final fallback

    Also returns the raw class code + source key so downstream consumers
    (e.g. the crop-aware cause inference) can look up the specific crop
    profile without re-parsing the human label.
    """
    v = sampled.get('cdl')
    if v and int(v) > 0 and CDL_LABELS.get(int(v)):
        return {
            'label': CDL_LABELS[int(v)],
            'source': 'USDA Cropland Data Layer',
            'source_key': 'cdl',
            'code': int(v),
            'year': CDL_LATEST_YEAR,
        }
    v = sampled.get('aafc')
    if v and int(v) > 0 and AAFC_LABELS.get(int(v)):
        return {
            'label': AAFC_LABELS[int(v)],
            'source': 'AAFC Annual Crop Inventory (Canada)',
            'source_key': 'aafc',
            'code': int(v),
            'year': AAFC_LATEST_YEAR,
        }
    v = sampled.get('mapbiomas')
    if v and int(v) in MAPBIOMAS_LABELS:
        return {
            'label': MAPBIOMAS_LABELS[int(v)],
            'source': 'MapBiomas Brazil',
            'source_key': 'mapbiomas',
            'code': int(v),
            'year': MAPBIOMAS_BR_LATEST_YEAR,
        }
    v = sampled.get('eucropmap')
    if v and int(v) in EUCROPMAP_LABELS:
        return {
            'label': EUCROPMAP_LABELS[int(v)],
            'source': 'EUCROPMAP (JRC, EU)',
            'source_key': 'eucropmap',
            'code': int(v),
            'year': EUCROPMAP_LATEST_YEAR,
        }
    # WorldCereal — pick the most-specific product that flagged positive.
    # Each product's binary mask is 100 if the pixel is in that crop, 0/null
    # otherwise. Priority order matches WORLDCEREAL_PRODUCTS tuple.
    for product in WORLDCEREAL_PRODUCTS:
        v = sampled.get(f'wc_{product}')
        if v is not None and int(v) >= 100:
            code = WORLDCEREAL_PRODUCT_CODES[product]
            return {
                'label': WORLDCEREAL_LABELS[code],
                'source': 'ESA WorldCereal (global)',
                'source_key': 'worldcereal',
                'code': code,
                'year': 2021,
            }
    v = sampled.get('dynworld')
    if v is not None and int(v) in DYNAMIC_WORLD_LABELS:
        return {
            'label': DYNAMIC_WORLD_LABELS[int(v)],
            'source': 'Dynamic World',
            'source_key': 'dynworld',
            'code': int(v),
            'year': None,
        }
    v = sampled.get('worldcover')
    if v and int(v) in WORLDCOVER_LABELS:
        return {
            'label': WORLDCOVER_LABELS[int(v)],
            'source': 'ESA WorldCover',
            'source_key': 'worldcover',
            'code': int(v),
            'year': 2021,
        }
    return None


# ─── Crop-aware seasonality + harvest classification ───────────────────────
# Given a tiered land-cover result, an OPERA detection date, and the click
# latitude, decide what kind of cropland we're looking at and whether the
# alert falls inside the typical harvest window for the crop. Used by
# _infer_likely_cause to tell "Likely alfalfa harvest cut" from "Likely
# agricultural burn" when both could fit the same raw signal mix.


def _month_in_window(month: int, window: tuple) -> bool:
    """Inclusive month check. `window` is (start_month, end_month). If end <
    start, the window wraps the year-end (e.g. citrus: (11, 4) covers
    Nov–Dec–Jan–Feb–Mar–Apr)."""
    if not window:
        return False
    start, end = window
    if start <= end:
        return start <= month <= end
    return month >= start or month <= end


def _flip_window_for_hemisphere(window: tuple, lat: float) -> tuple:
    """For southern-hemisphere clicks, shift the harvest window by ~6 months.
    Done by adding 6 to each bound and wrapping mod-12. This is a heuristic
    — actual harvest in equatorial/tropical regions doesn't flip cleanly —
    but for mid-latitude S.H. cropland it's a much better default than the
    raw N.H. window."""
    if not window or lat is None or lat >= 0:
        return window
    start, end = window
    return (((start - 1 + 6) % 12) + 1, ((end - 1 + 6) % 12) + 1)


def _classify_crop(
    land_cover: dict | None,
    opera_date_str: str | None,
    lat: float | None,
) -> dict | None:
    """Look up the crop profile + harvest seasonality for this click.

    Fires for CDL (US per-species crop classes) and MapBiomas Brazil
    (per-species BR crop classes). Dynamic World and WorldCover only
    expose generic categories ("Crops", "Cropland") with no harvest
    timing — fall through to the generic land-cover branch for those.

    Returns:
        None when no crop profile applies (no source-specific table for
        this code, or non-crop class).
        Otherwise dict with:
          - profile: 'multicut'/'burn_prone'/'annual_harvest'/'orchard'/'fallow'
          - profile_label: friendly description (e.g. "multi-cut forage")
          - crop_name: source-specific species name (e.g. "Alfalfa", "Soybean")
          - burn_practice: 'rare'/'occasional'/'common'
          - in_harvest_season: bool — alert date is inside the typical window
          - harvest_window_str: human label for the window (e.g. "May–Oct")
    """
    if not land_cover:
        return None
    src = land_cover.get('source_key')
    code = land_cover.get('code')
    if code is None:
        return None
    if src == 'cdl':
        profile = CDL_CROP_PROFILES.get(int(code))
    elif src == 'aafc':
        profile = AAFC_CROP_PROFILES.get(int(code))
    elif src == 'mapbiomas':
        profile = MAPBIOMAS_CROP_PROFILES.get(int(code))
    elif src == 'eucropmap':
        profile = EUCROPMAP_CROP_PROFILES.get(int(code))
    elif src == 'worldcereal':
        profile = WORLDCEREAL_CROP_PROFILES.get(int(code))
    else:
        # Dynamic World / WorldCover have no per-crop differentiation.
        return None
    if not profile:
        return None

    window = profile.get('harvest_months')
    window_shifted = _flip_window_for_hemisphere(window, lat)

    in_season = False
    if opera_date_str and window_shifted:
        try:
            opera_dt = date.fromisoformat(opera_date_str)
            in_season = _month_in_window(opera_dt.month, window_shifted)
        except ValueError:
            pass

    month_names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                   'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    window_str = None
    if window_shifted:
        s, e = window_shifted
        window_str = f'{month_names[s-1]}–{month_names[e-1]}'

    return {
        'profile':         profile['profile'],
        'profile_label':   CROP_PROFILE_LABELS.get(profile['profile'], profile['profile']),
        'crop_name':       land_cover.get('label'),
        'crop_code':       int(code),
        'burn_practice':   profile['burn_practice'],
        'in_harvest_season': in_season,
        'harvest_window_str': window_str,
    }


# ─── USDA NASS Quick Stats county-practice lookup ──────────────────────────
# Free API; requires registration at https://quickstats.nass.usda.gov/api.
# We pull two pieces of context for US clicks:
#   1. Tillage practice mix at county level (Census of Agriculture, every 5y) —
#      tells us whether the county is conventional-till vs no-till dominant.
#      No-till counties shouldn't be producing residue-burn signals.
#   2. Top crops by acreage at county level — confirms the CDL pixel label
#      against the county's actual mix (and helps detect mis-classified
#      pixels at field edges).
#
# Both calls graceful-fall-back to None when the key is missing or the
# upstream API errors out. The cause heuristic uses NASS context only as a
# tiebreaker, never as the sole signal — so missing data degrades the label
# specificity but doesn't break the popup.
#
# County resolution: we use EE's TIGER/2018/Counties FeatureCollection to
# spatial-join the click point → STATEFP + COUNTYFP. Keeps the dependency
# inside EE rather than adding another external API.

import os as _os
NASS_API_KEY = _os.environ.get('NASS_API_KEY')
NASS_API_URL = 'https://quickstats.nass.usda.gov/api/api_GET/'
NASS_CACHE: dict = {}  # module-level; warm-instance reuse only
NASS_CACHE_MAX = 256

# State FIPS → two-letter postal code. TIGER counties only exposes STATEFP,
# so we keep this lookup local instead of an extra round-trip.
US_STATE_FIPS_TO_CODE = {
    '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA',
    '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL',
    '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN',
    '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME',
    '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS',
    '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
    '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
    '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
    '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
    '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI',
    '56': 'WY', '60': 'AS', '66': 'GU', '69': 'MP', '72': 'PR', '78': 'VI',
}


def _resolve_us_county(lat: float, lng: float) -> dict | None:
    """Lat/lng → US county FIPS dict via EE TIGER counties. Returns None
    outside the US. Cached per (rounded) coordinate to avoid re-querying
    repeated clicks in the same area within a warm instance."""
    key = ('county', round(lat, 3), round(lng, 3))
    if key in NASS_CACHE:
        return NASS_CACHE[key]
    try:
        point = ee.Geometry.Point([lng, lat])
        fc = ee.FeatureCollection('TIGER/2018/Counties').filterBounds(point)
        feat_info = fc.limit(1).getInfo().get('features', [])
        if not feat_info:
            result = None
        else:
            props = feat_info[0].get('properties', {}) or {}
            state_fips = props.get('STATEFP')
            result = {
                'state_fips':  state_fips,
                'county_fips': props.get('COUNTYFP'),
                'county_name': props.get('NAME'),
                # TIGER/2018/Counties doesn't have a postal-code field —
                # derive from STATEFP via our local lookup.
                'state_code':  US_STATE_FIPS_TO_CODE.get(state_fips),
            }
    except Exception as e:
        print(f'_resolve_us_county failed: {e}', flush=True)
        result = None
    if len(NASS_CACHE) >= NASS_CACHE_MAX:
        NASS_CACHE.pop(next(iter(NASS_CACHE)))
    NASS_CACHE[key] = result
    return result


def _nass_get(params: dict, timeout: int = 12) -> list | None:
    """Thin Quick Stats GET wrapper. Returns the `data` array or None on any
    failure (no key, HTTP error, JSON shape mismatch). Caches by query."""
    if not NASS_API_KEY:
        return None
    cache_key = ('nass', tuple(sorted(params.items())))
    if cache_key in NASS_CACHE:
        return NASS_CACHE[cache_key]
    qp = {**params, 'key': NASS_API_KEY, 'format': 'JSON'}
    url = NASS_API_URL + '?' + urllib.parse.urlencode(
        qp, quote_via=urllib.parse.quote,
    )
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'EarthAtlas/1.0'})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read())
        data = payload.get('data') if isinstance(payload, dict) else None
    except Exception as e:
        print(f'NASS query failed ({params.get("commodity_desc")}/'
              f'{params.get("statisticcat_desc")}): {e}', flush=True)
        data = None
    if len(NASS_CACHE) >= NASS_CACHE_MAX:
        NASS_CACHE.pop(next(iter(NASS_CACHE)))
    NASS_CACHE[cache_key] = data
    return data


def _fetch_nass_tillage(county: dict) -> dict | None:
    """County-level tillage practice mix from the most recent Census of
    Agriculture (typically 2022). Returns acres + share for conventional,
    conservation, and no-till. Returns None if the data isn't published
    for this county (small/non-farming counties)."""
    if not county or not county.get('state_fips') or not county.get('county_fips'):
        return None

    # NASS Quick Stats exposes Census tillage data under three specific
    # short_desc values — querying each explicitly is the only reliable way.
    # (Generic CROP TOTALS / FIELD CROPS queries don't return them.)
    short_descs = {
        'no_till':      'PRACTICES, LAND USE, CROPLAND, CONSERVATION TILLAGE, NO-TILL - ACRES',
        'conservation': 'PRACTICES, LAND USE, CROPLAND, CONSERVATION TILLAGE, (EXCL NO-TILL) - ACRES',
        'conventional': 'PRACTICES, LAND USE, CROPLAND, CONVENTIONAL TILLAGE - ACRES',
    }

    def _to_int(s):
        try:
            return int((s or '').replace(',', ''))
        except (ValueError, AttributeError):
            return None

    buckets: dict = {}
    years_seen: list = []
    for bucket_key, sd in short_descs.items():
        rows = _nass_get({
            'source_desc': 'CENSUS',
            'state_fips_code': county['state_fips'],
            'county_code': county['county_fips'],
            'short_desc': sd,
            'year__GE': '2017',
        })
        if not rows:
            continue
        # Latest year wins (Census runs every 5 years; 2022 is the most recent).
        latest_year = max(int(r.get('year', 0) or 0) for r in rows)
        latest_rows = [r for r in rows if int(r.get('year', 0) or 0) == latest_year]
        total_for_bucket = 0
        for r in latest_rows:
            val = _to_int(r.get('Value'))
            if val is not None:
                total_for_bucket += val
        if total_for_bucket > 0:
            buckets[bucket_key] = total_for_bucket
            years_seen.append(latest_year)

    total = sum(buckets.values())
    if total <= 0 or not years_seen:
        return None
    shares = {k: round(v / total, 3) for k, v in buckets.items()}
    dominant = max(shares.items(), key=lambda kv: kv[1])
    return {
        'year': max(years_seen),
        'acres': buckets,
        'shares': shares,
        'dominant': dominant[0],
        'dominant_share': dominant[1],
    }


def _fetch_nass_county_practices(
    lat: float,
    lng: float,
    crop_profile: dict | None,
) -> dict | None:
    """Top-level NASS lookup for cause inference. Returns a context dict the
    heuristic can use, or None when nothing useful is available.

    The shape we return is intentionally small:
      {
        'county_name': 'Woodford',
        'state_code': 'IL',
        'tillage': {'dominant': 'no_till', 'dominant_share': 0.62, ...} | None,
        'burn_practice_hint': 'rare' | 'occasional' | 'common' | None,
      }

    `burn_practice_hint` is currently driven by the crop profile (since NASS
    doesn't expose a clean per-county residue-burn statistic). The tillage
    field, however, is real county data — and is the strongest tiebreaker
    we have for the alfalfa/no-till case.
    """
    if not NASS_API_KEY:
        return None
    # Don't waste an EE call (TIGER county join) on non-US clicks.
    if not _is_in_us(lat, lng):
        return None
    county = _resolve_us_county(lat, lng)
    if not county:
        return None
    tillage = _fetch_nass_tillage(county)
    burn_hint = crop_profile.get('burn_practice') if crop_profile else None
    # If the county is no-till dominant (>50%), downgrade burn likelihood
    # — residue burning is incompatible with no-till management.
    if tillage and tillage.get('dominant') == 'no_till' and tillage.get('dominant_share', 0) >= 0.5:
        if burn_hint == 'occasional':
            burn_hint = 'rare'
    return {
        'county_name': county.get('county_name'),
        'state_code':  county.get('state_code'),
        'tillage':     tillage,
        'burn_practice_hint': burn_hint,
    }


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
    # Statuses 1-8 are all real alerts; only 0 (no disturbance) and 255 (no
    # usable data) are excluded.
    img = img.updateMask(img.gte(1).And(img.lte(8)))
    img = img.updateMask(date_img.gte(start_days).And(date_img.lte(end_days)))
    img = _maybe_apply_landuse(img, landuse)
    return (jsonify({'tileUrl': _tile_url(img, STATUS_VIS)}), 200, CORS_HEADERS)


def _handle_point_core(lat: float, lng: float) -> tuple:
    """Fast path: OPERA core (date / status / severity) + tiered land cover.

    One reduceRegion at scale=10. Returns in ~1 s; called on every click so
    the popup can show meaningful data fast. Patch outline + MODIS burn live
    on `_handle_point_extras` so the slow GEE work doesn't gate this response.
    """
    point = ee.Geometry.Point([lng, lat])

    status_img = _mosaic_band('VEG-DIST-STATUS').rename('status')
    date_img = _mosaic_band('VEG-DIST-DATE').rename('date')
    severity_img = _mosaic_band('VEG-ANOM-MAX').rename('severity')
    opera_stack = status_img.addBands(date_img).addBands(severity_img)

    # Stack OPERA + all 4 land-cover datasets in one reduceRegion call.
    # If any land-cover asset is unavailable, fall back to OPERA-only.
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
    status_code_int = int(status_code) if status_code is not None else 0

    # OPERA STATUS values: 0 = no disturbance, 1-6 = real alerts (see
    # STATUS_LABELS), 7 = no usable data (clouds / missing imagery / sensor
    # issue), 8+ = other special states. Only 1-6 are real disturbances —
    # render anything else as the "no disturbance recorded" popup.
    if status_code_int not in STATUS_LABELS:
        return (
            jsonify({
                'date': None,
                'statusCode': status_code_int,
                'statusLabel': None,
                'landCover': land_cover,
            }),
            200,
            CORS_HEADERS,
        )

    status_code = status_code_int
    days_since_epoch = sampled.get('date')
    severity = sampled.get('severity')

    alert_date_str = None
    if days_since_epoch is not None:
        alert_date = DATE_EPOCH + timedelta(days=int(days_since_epoch))
        alert_date_str = alert_date.isoformat()

    return (
        jsonify({
            'date': alert_date_str,
            'statusCode': status_code,
            'statusLabel': STATUS_LABELS.get(status_code, f'Status {status_code}'),
            'severity': round(float(severity), 1) if severity is not None else None,
            'landCover': land_cover,
        }),
        200,
        CORS_HEADERS,
    )


def _handle_point_extras(lat: float, lng: float) -> tuple:
    """Slow path: connected-component patch outline + MODIS burn check.

    Fires in parallel with `_handle_point_core` from the frontend. Re-samples
    the OPERA date band itself (cheap) so it doesn't need to wait on the core
    response for the MODIS burn window. ~2-3 s on a typical disturbance click.
    """
    point = ee.Geometry.Point([lng, lat])

    date_img = _mosaic_band('VEG-DIST-DATE')
    status_img = _mosaic_band('VEG-DIST-STATUS')

    # Sample BOTH status and date in one reduceRegion. We need status to gate
    # the heavy work — OPERA's date band can carry leftover values even where
    # status is 0 (no current disturbance), and we don't want to compute fires
    # / dNBR / cause inference for non-disturbance pixels.
    sampled = (
        status_img.rename('status')
        .addBands(date_img.rename('date'))
        .reduceRegion(reducer=ee.Reducer.first(), geometry=point, scale=30)
        .getInfo()
    )
    status_code = sampled.get('status')
    days_since_epoch = sampled.get('date')

    alert_date_str = None
    # OPERA's date band stores 0 for "no disturbance recorded" — not None.
    # Treating 0 as a real date would give 2020-12-31 (the epoch + 0 days),
    # which silently breaks downstream date filters.
    if days_since_epoch is not None and int(days_since_epoch) > 0:
        alert_date = DATE_EPOCH + timedelta(days=int(days_since_epoch))
        alert_date_str = alert_date.isoformat()

    status_valid = (
        status_code is not None and int(status_code) in STATUS_LABELS
    )

    # Named-fire context is queried for ANY click, regardless of whether
    # OPERA currently flags the pixel. OPERA transitions finished alerts
    # back to status 0 once vegetation recovers, so older fire scars (like
    # the 2024 Park Fire two years on) wouldn't otherwise show their fire
    # context.
    #   * US clicks: MTBS + NIFC (named, validated, with severity)
    #   * All clicks: GlobFire (global MODIS perimeters, unnamed)
    # Dedupe merges the same fire across sources, preferring MTBS > NIFC.
    early_named_fires = []
    if _is_in_us(lat, lng):
        early_named_fires.extend(_sample_mtbs_fires(point))
        early_named_fires.extend(_sample_nifc_wfigs_fires(lat, lng))
        early_named_fires.extend(_sample_nifc_fires(lat, lng))
    early_named_fires.extend(_sample_globfire_fires(point))
    early_named_fires = _dedupe_and_sort_fires(early_named_fires)

    if not status_valid or alert_date_str is None:
        return (
            jsonify({
                'acres': None, 'truncated': False, 'patchGeometry': None,
                'burn': None, 'fires': None, 'nbr': None,
                'shape': None, 'namedFires': early_named_fires, 'likelyCause': None,
            }),
            200,
            CORS_HEADERS,
        )

    # Statuses 1-8 are real alerts (any kind); 0 = no disturbance, 255 = no data.
    disturbed_mask = status_img.gte(1).And(status_img.lte(8)).selfMask()

    # Vectorize ALL disturbed regions inside a 5 km buffer, then pick the
    # polygon that contains the click point. Skipping `connectedComponents`
    # entirely (it has a per-component pixel cap) means we can measure
    # arbitrarily large connected patches accurately, up to the search buffer.
    # The 5 km radius covers ~19,000 acres of search space — bigger than all
    # but the most extreme megafires.
    SEARCH_RADIUS_M = 5000

    patch_geometry = None
    acres = None
    truncated = False
    try:
        all_vectors = disturbed_mask.reduceToVectors(
            geometry=point.buffer(SEARCH_RADIUS_M),
            scale=30,
            geometryType='polygon',
            eightConnected=True,
            bestEffort=True,
            maxPixels=int(1e10),
        )
        # filterBounds with a small buffer catches polygons that mathematically
        # exclude the click point due to pixel-boundary effects (the vectorizer
        # sometimes produces polygons whose edges sit microscopically inside
        # the pixel they came from).
        containing = all_vectors.filterBounds(point.buffer(45))
        features_info = containing.limit(1).getInfo().get('features', [])
        if features_info:
            patch_geometry = features_info[0].get('geometry')
            # Pull area straight from the polygon — no pixel-count cap.
            polygon = ee.Geometry(patch_geometry)
            area_sqm = polygon.area(maxError=1).getInfo()
            acres = round(area_sqm / 4046.86, 2)

            # If the polygon's bbox reaches the search buffer edge, the patch
            # likely extends beyond what we measured — flag as truncated.
            bbox = polygon.bounds(maxError=1).coordinates().getInfo()[0]
            xs = [c[0] for c in bbox]
            ys = [c[1] for c in bbox]
            search_bbox = point.buffer(SEARCH_RADIUS_M).bounds(maxError=1).coordinates().getInfo()[0]
            search_xs = [c[0] for c in search_bbox]
            search_ys = [c[1] for c in search_bbox]
            # 0.001° tolerance (~100 m at the equator) — close enough = touching
            tol = 0.001
            if (min(xs) - min(search_xs) < tol or max(search_xs) - max(xs) < tol
                or min(ys) - min(search_ys) < tol or max(search_ys) - max(ys) < tol):
                truncated = True
    except Exception as e:
        print(f'patch geometry failed: {e}', flush=True)

    # Cause-inference signals. Each call is independent; we accept the
    # latency cost (~2-3 s combined) for the diagnostic payoff.
    burn = _sample_modis_burn(point, alert_date_str)
    fires = _sample_active_fires(point, alert_date_str)
    nbr = _sample_nbr_delta(point, alert_date_str)
    shape = _analyze_patch_shape(patch_geometry)

    # Named US fires (reuse the early query — already done above). The
    # full list is the "fire history" the popup shows; the cause heuristic
    # uses only the recent subset within the OPERA-relevant window.
    named_fires = early_named_fires
    recent_fires_for_cause = _filter_fires_to_window(named_fires, alert_date_str)

    # Tiered land cover (CDL > MapBiomas > Dynamic World > WorldCover) so
    # the cause heuristic sees the same specific label as the popup's land-
    # cover line. WorldCover alone misses critical context — apple orchards
    # become "Cropland" (not "Apples"), Brazilian pasture becomes "Grassland"
    # (not "Pasture") — both of which steered the inference wrong.
    land_cover = _sample_tiered_landcover(point)

    # Crop profile (US only, CDL source) + seasonal context. Tells us that
    # an alfalfa pixel hit in July is almost certainly a hay cut, not a burn.
    crop_profile = _classify_crop(land_cover, alert_date_str, lat)

    # NASS Quick Stats county-level practice data (US only, optional). Adds
    # county tillage mix so we can soften "burn" labels in no-till counties.
    # Silently returns None when NASS_API_KEY isn't set, so OK to call always.
    nass_context = _fetch_nass_county_practices(lat, lng, crop_profile) if crop_profile else None

    likely_cause = _infer_likely_cause(
        burn, fires, nbr, shape, land_cover, recent_fires_for_cause,
        crop_profile=crop_profile, nass_context=nass_context,
    )

    return (
        jsonify({
            'acres': acres,
            'truncated': truncated,
            'patchGeometry': patch_geometry,
            'burn': burn,
            'fires': fires,
            'nbr': nbr,
            'shape': shape,
            'namedFires': named_fires,
            'likelyCause': likely_cause,
            # Debug fields — lets us see exactly which land-cover label and
            # crop profile drove the cause inference (helps auditing).
            'landCoverContext': land_cover,
            'cropProfile': crop_profile,
            'nassContext': nass_context,
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
            # `?extras=1` returns patch geometry + MODIS burn (slow ~2-3 s);
            # the default fast path returns only OPERA core + land cover (~1 s).
            # Frontend fires both in parallel and progressively renders.
            if request.args.get('extras'):
                return _handle_point_extras(float(lat), float(lng))
            return _handle_point_core(float(lat), float(lng))

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
