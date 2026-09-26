"""Turn cached GFW 4Wings presence tiles (one zoom, whole world) into a
0.1-degree equirectangular grid of vessel-hours (float32, rows north->south,
lat 85..-85, lon -180..180). Each cell's hours are spread over the bins it overlaps, by area."""
import sys, os, math, glob, numpy as np, mapbox_vector_tile as mvt
src, z, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
RES = 0.1; W, H = 3600, 1700
g = np.zeros((H, W), np.float32)
n2 = 2 ** z; cells = 0
for f in glob.glob(os.path.join(src, '*.pbf')):
    if os.path.getsize(f) == 0: continue
    x, y = map(int, os.path.basename(f)[:-4].split('_'))
    t = mvt.decode(open(f, 'rb').read(), default_options={'y_coord_down': True})
    L = t.get('main')
    if not L: continue
    ext = L.get('extent', 4096)
    def lonlat(px, py):
        lon = (x + px / ext) / n2 * 360 - 180
        lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + py / ext) / n2))))
        return lon, lat
    for ft in L['features']:
        geom = ft['geometry']; c = geom['coordinates']
        ring = c[0] if geom['type'] == 'Polygon' else c[0][0]
        xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
        lon0, lat1 = lonlat(min(xs), min(ys)); lon1, lat0 = lonlat(max(xs), max(ys))
        if lat1 <= -85 or lat0 >= 85 or lon1 <= lon0 or lat1 <= lat0: continue
        lat0, lat1 = max(lat0, -85), min(lat1, 85)
        val = float(ft['properties'].get('count', 0)); cells += 1
        # spread the cell's hours over the 0.1-degree bins it overlaps, by overlap area
        c0, c1 = int((lon0 + 180) / RES), int((lon1 + 180 - 1e-9) / RES)
        r0, r1 = int((85 - lat1) / RES), int((85 - lat0 - 1e-9) / RES)
        area = (lon1 - lon0) * (lat1 - lat0)
        for r in range(max(r0, 0), min(r1, H - 1) + 1):
            bt, bb = 85 - r * RES, 85 - (r + 1) * RES
            oy = min(lat1, bt) - max(lat0, bb)
            if oy <= 0: continue
            for cc in range(max(c0, 0), min(c1, W - 1) + 1):
                bl = -180 + cc * RES
                ox = min(lon1, bl + RES) - max(lon0, bl)
                if ox > 0: g[r, cc] += val * ox * oy / area
g.tofile(out)
nz = g[g > 0]
print('cells', cells, 'nonzero', nz.size, 'sum hours', float(nz.sum()), 'pcts', np.percentile(nz, [25, 50, 75, 90, 99]).round(1).tolist(), 'max', float(nz.max()))
