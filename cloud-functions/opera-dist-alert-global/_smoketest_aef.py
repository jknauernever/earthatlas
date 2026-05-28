"""
Local smoke test for the new AEF helpers. Stubs out `ee` and
`google.auth` / `functions_framework` / `flask` enough that `main.py` can
be imported, then exercises the pure-Python branches of the AEF code:

  - _aef_dot           : numeric correctness on canned vectors
  - _aef_change_magnitude: threshold tiers + awaiting_post fallback
  - _aef_context       : orchestrator returns the expected keys
  - renderable shape   : every leaf in the bundled dict is JSON-serializable

This does NOT call Earth Engine; the EE-touching helpers are stubbed
via _aef_sample_point monkey-patch so we can exercise the math/structure
without authentication. End-to-end verification against the real EE
backend has to happen post-deploy.

Run: python3 _smoketest_aef.py
"""
import json
import sys
import types

# ── 1. Stub out heavy external deps so `import main` works locally. ─────────
_ee = types.ModuleType('ee')
class _MockGeometry:
    def __init__(self, *a, **k): pass
    def buffer(self, *a, **k): return self
    def bounds(self, *a, **k): return self
    def coordinates(self): return self
    def getInfo(self): return [[[0,0],[1,0],[1,1],[0,1],[0,0]]]
    def area(self, *a, **k): return self
class _MockImage:
    def __init__(self, *a, **k): pass
    def addBands(self, *a, **k): return self
    def select(self, *a, **k): return self
    def filter(self, *a, **k): return self
    def filterDate(self, *a, **k): return self
    def filterBounds(self, *a, **k): return self
    def mosaic(self): return self
    def mean(self): return self
    def mode(self): return self
    def first(self): return self
    def toInt(self): return self
    def updateMask(self, *a, **k): return self
    def selfMask(self): return self
    def reduce(self, *a, **k): return self
    def multiply(self, *a, **k): return self
    def gte(self, *a, **k): return self
    def lte(self, *a, **k): return self
    def And(self, *a, **k): return self
    def rename(self, *a, **k): return self
    def bandNames(self): return ['classification_1985', 'classification_2020']
    def reduceRegion(self, *a, **k):
        # Return a minimal dict; functions handle None as failure path
        return self
    def reduceToVectors(self, *a, **k): return _MockGeometry()
    def stratifiedSample(self, *a, **k): return _MockGeometry()
    def sample(self, *a, **k): return _MockGeometry()
    def getInfo(self): return {}
_ee.Geometry = type('G', (), {'Point': lambda *a, **k: _MockGeometry()})
class _MockImageFactory:
    def __call__(self, *a, **k): return _MockImage()
    @staticmethod
    def cat(*a, **k): return _MockImage()
_ee.Image = _MockImageFactory()
_ee.ImageCollection = lambda *a, **k: _MockImage()
_ee.FeatureCollection = lambda *a, **k: _MockImage()
_ee.Date = type('D', (), {'fromYMD': staticmethod(lambda *a, **k: _MockImage())})
_ee.Reducer = type('R', (), {
    'first': staticmethod(lambda *a, **k: None),
    'sum': staticmethod(lambda *a, **k: None),
    'mean': staticmethod(lambda *a, **k: None),
})
_ee.Filter = type('F', (), {
    'stringStartsWith': staticmethod(lambda *a, **k: None),
    'calendarRange': staticmethod(lambda *a, **k: None),
})
_ee.Algorithms = type('A', (), {'If': staticmethod(lambda c, t, f: t)})
_ee.String = lambda x: x
sys.modules['ee'] = _ee

# google.auth stub
_ga = types.ModuleType('google')
_ga.auth = types.ModuleType('google.auth')
_ga.auth.default = lambda *a, **k: (None, 'earthatlas')
sys.modules['google'] = _ga
sys.modules['google.auth'] = _ga.auth

# functions_framework stub (decorator pass-through)
_ff = types.ModuleType('functions_framework')
_ff.http = lambda f: f
sys.modules['functions_framework'] = _ff

# Minimal flask.jsonify stub — returns the payload unchanged.
_flask = types.ModuleType('flask')
def _jsonify(x): return x
_flask.jsonify = _jsonify
sys.modules['flask'] = _flask

# ── 2. Import main now that stubs are in place. ─────────────────────────────
import main  # noqa: E402

# ── 3. Exercise _aef_dot ────────────────────────────────────────────────────
print('--- _aef_dot ---')
assert abs(main._aef_dot([1, 0, 0], [1, 0, 0]) - 1.0) < 1e-9
assert abs(main._aef_dot([1, 0, 0], [0, 1, 0]) - 0.0) < 1e-9
assert abs(main._aef_dot([1, 0, 0], [-1, 0, 0]) - (-1.0)) < 1e-9
print('  ok')

# ── 4. Patch _aef_sample_point so the higher-level helpers run without EE. ─
import math
import random
def _make_vec(seed):
    """Build a unit-length 64-vec from a seed for reproducible tests."""
    rng = random.Random(seed)
    raw = [rng.gauss(0, 1) for _ in range(main.AEF_DIM)]
    norm = math.sqrt(sum(v*v for v in raw))
    return [v/norm for v in raw]

ORIG_SAMPLE = main._aef_sample_point
SAMPLE_CALLS = []

def fake_sample(lat, lng, year):
    SAMPLE_CALLS.append((lat, lng, year))
    # Year 2017 returns one fingerprint; later years drift away to simulate change.
    # Drift is added linearly so we can predict the distance roughly.
    base = _make_vec('baseline')
    drift = _make_vec(f'drift-{year}')
    alpha = max(0.0, (year - 2017) * 0.04)
    mixed = [(1 - alpha) * b + alpha * d for b, d in zip(base, drift)]
    norm = math.sqrt(sum(v*v for v in mixed))
    return [v / norm for v in mixed]

main._aef_sample_point = fake_sample

# ── 5. _aef_change_magnitude — happy path, threshold tiers, awaiting_post. ──
print('--- _aef_change_magnitude ---')
# 2024 OPERA: pre=2023, post=2025 (both in coverage)
cm = main._aef_change_magnitude(10.0, -50.0, 2024)
assert cm is not None
assert cm['preYear'] == 2023 and cm['postYear'] == 2025
assert cm['magnitude'] in {'unchanged', 'subtle', 'substantial', 'major'}
assert cm['distance'] is not None and 0 <= cm['distance'] <= 2
print(f"  2024 OPERA → mag={cm['magnitude']!r} dist={cm['distance']}")

# 2026 OPERA: post=2027 exceeds AEF_LATEST_YEAR (2025) → awaiting_post
cm2 = main._aef_change_magnitude(10.0, -50.0, 2026)
assert cm2 is not None and cm2['magnitude'] == 'awaiting_post'
assert cm2['distance'] is None
print(f"  2026 OPERA → magnitude={cm2['magnitude']!r} (expected)")

# ── 6. _aef_stability ───────────────────────────────────────────────────────
# Verify the no-data path returns None gracefully (since our ee mock returns
# empty getInfo). Successful path is exercised in production with real EE.
print('--- _aef_stability (no-data path) ---')
stab = main._aef_stability(10.0, -50.0, 2024)
# With our stub returning empty dict, this should hit the "len(vecs) < 2"
# guard and return None — no crash.
assert stab is None, f'expected None on empty data, got {stab!r}'
print('  returns None on empty data (graceful) ok')

# Verify the year-count guard: if opera_year is too early to have 2 prior
# AEF years in coverage, returns None without errors.
stab_early = main._aef_stability(10.0, -50.0, 2018)
assert stab_early is None, f'expected None for early year, got {stab_early!r}'
print('  early opera_year returns None ok')

# ── 6b. _aef_trajectory + _aef_nearest_class + _aef_similar_disturbances ───
# All three should return None gracefully when reduceRegion returns empty.
print('--- _aef_trajectory / _aef_nearest_class / _aef_similar_disturbances ---')
assert main._aef_trajectory(10.0, -50.0, 2024) is None
assert main._aef_nearest_class(10.0, -50.0, 2024) is None
assert main._aef_similar_disturbances(10.0, -50.0, 2024) is None
print('  all three handle empty EE results without crashing ok')

# Restore real _aef_sample_point.
main._aef_sample_point = ORIG_SAMPLE

# ── 7. _aef_context orchestrator — verify it bundles + handles None. ───────
print('--- _aef_context bundling ---')
# Force trajectory/nearest_class/similar_disturbances to fail safely by
# replacing them with stubs that return None (simulates EE unavailable).
main._aef_trajectory = lambda *a, **k: None
main._aef_nearest_class = lambda *a, **k: None
main._aef_similar_disturbances = lambda *a, **k: None

# Re-patch the sample for change_magnitude + stability to succeed.
main._aef_sample_point = fake_sample

bundle = main._aef_context(10.0, -50.0, '2024-04-15')
assert bundle is not None
expected_keys = {'operaYear', 'dataset', 'latestYear', 'nearestClass',
                 'changeMagnitude', 'trajectory', 'stability',
                 'similarDisturbances'}
assert set(bundle.keys()) == expected_keys, f'missing keys: {expected_keys - set(bundle.keys())}'
assert bundle['operaYear'] == 2024
# changeMagnitude uses _aef_sample_point which we mocked, so it should yield data.
assert bundle['changeMagnitude'] is not None
# stability/trajectory/etc. call reduceRegion directly; the mock returns
# empty, so they correctly return None. The orchestrator should NOT crash.
# JSON-serializable sanity check
json.dumps(bundle)
print('  bundled keys ok, json-serializable ok')
print(f'  changeMagnitude={bundle["changeMagnitude"]["magnitude"]!r}')
print(f'  stability={bundle["stability"]} trajectory={bundle["trajectory"]}')

# ── 8. _aef_context with bad date returns None ──────────────────────────────
print('--- _aef_context bad-date handling ---')
assert main._aef_context(10.0, -50.0, None) is None
assert main._aef_context(10.0, -50.0, '') is None
assert main._aef_context(10.0, -50.0, 'not-a-date') is None
print('  ok')

print('\nALL AEF SMOKE TESTS PASSED')
