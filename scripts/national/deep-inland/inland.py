"""
Reader for the national `deep-inland` dataset (build.py): is a point deep inland (land more than 2 km from any
sizeable sea, river or lake)?

    from inland import DeepInland
    g = DeepInland.load()            # local build (data/national/deep-inland/build/<newest>) or the published version
    g.at(lon_array, lat_array)       # → bool array; positions outside the grid's boxes are never inland

DeepInland.load(source) also takes a build folder or a catalog URL. Published files are cached in
$DEEP_INLAND_CACHE (default: data/national/deep-inland/work/cache).
"""
import gzip, json, os, urllib.request
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, '..', '..', '..'))
BUILD = os.path.join(REPO, 'data', 'national', 'deep-inland', 'build')
CATALOG = 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com/national/catalog.json'
UA = {'User-Agent': 'earthatlas-bake/1.0 (+https://earthatlas.org)'}


def _get(url, dest):
    if not os.path.exists(dest):
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600) as r, open(dest + '.tmp', 'wb') as fh:
            fh.write(r.read())
        os.replace(dest + '.tmp', dest)
    return dest


class DeepInland:
    def __init__(self, meta, boxes, version):
        self.meta, self.version = meta, version
        self.cell = meta['cell_deg']
        self.boxes = boxes   # [(box meta, bits ndarray uint8 [ny, ceil(nx/8)])]

    @classmethod
    def load(cls, source=None):
        """source: a build folder, a catalog URL, or None (newest local build if any, else the published version)."""
        if source is None:
            local = sorted(d for d in (os.listdir(BUILD) if os.path.isdir(BUILD) else [])
                           if not d.endswith('-test') and os.path.exists(os.path.join(BUILD, d, 'deep-inland.json')))
            source = os.path.join(BUILD, local[-1]) if local else CATALOG
        if source.startswith('http'):
            entry = json.load(urllib.request.urlopen(urllib.request.Request(source, headers=UA), timeout=60))['datasets']['deep-inland']
            cache = os.path.join(os.environ.get('DEEP_INLAND_CACHE') or os.path.join(REPO, 'data', 'national', 'deep-inland', 'work', 'cache'), entry['version'])
            path = lambda f: _get(entry['files'][f], os.path.join(cache, f))
            version = entry['version']
        else:
            path = lambda f: os.path.join(source, f)
            version = os.path.basename(os.path.normpath(source))
        meta = json.load(open(path('deep-inland.json')))
        boxes = []
        for b in meta['boxes'].values():
            raw = gzip.open(path(b['file'])).read()
            boxes.append((b, np.frombuffer(raw, np.uint8).reshape(b['ny'], (b['nx'] + 7) // 8)))
        return cls(meta, boxes, version)

    def at(self, lon, lat):
        lon = np.asarray(lon, dtype=np.float64)
        lat = np.asarray(lat, dtype=np.float64)
        out = np.zeros(lon.shape, dtype=bool)
        for b, bits in self.boxes:
            m = (lon >= b['w']) & (lon < b['e']) & (lat > b['s']) & (lat <= b['n'])
            if not m.any():
                continue
            col = np.minimum(((lon[m] - b['w']) / self.cell).astype(np.int64), b['nx'] - 1)
            row = np.minimum(((b['n'] - lat[m]) / self.cell).astype(np.int64), b['ny'] - 1)
            out[m] = ((bits[row, col >> 3] >> (7 - (col & 7))) & 1) == 1
        return out

    def describe(self):
        return dict(dataset='deep-inland', version=self.version, cell_deg=self.cell, inland_m=self.meta['inland_m'], min_px=self.meta['min_px'])
