"""Phase 1 sanity plot: land + 5 benchmark runs (best estimate h24/h72) + Haro ensemble probability at h72."""
import json, sys, numpy as np, matplotlib
matplotlib.use('Agg'); import matplotlib.pyplot as plt
R = 'data/spillrisk/runs'
PFX = sys.argv[2] if len(sys.argv) > 2 else 'b5'
land = json.load(open(sys.argv[3] if len(sys.argv) > 3 else 'scripts/bake-shiptraffic/salish_land.geojson'))
land = land.get('geometry', land)
fig, axs = plt.subplots(1, 2, figsize=(16, 8))
for ax in axs:
    for p in land['coordinates']:
        r = np.array(p[0]); ax.fill(r[:, 0], r[:, 1], color='#ccc', lw=0)
    ax.set_xlim(-124.0, -122.2); ax.set_ylim(47.4, 49.3); ax.set_aspect(1 / np.cos(np.deg2rad(48.3)))
for k, c in zip(['haro', 'rosario', 'cherrypoint', 'pugetsound', 'juandefuca'], ['C0', 'C1', 'C2', 'C3', 'C4']):
    z = np.load(f'{R}/{PFX}-{k}.npz'); m = json.load(open(f'{R}/{PFX}-{k}.json'))
    for h, a in ((24, .25), (72, .8)):
        p = z[f'h{h:03d}_unc_pos']; axs[0].scatter(p[:, 0], p[:, 1], s=1, c='k', alpha=.05)
        p = z[f'h{h:03d}_best_pos']; axs[0].scatter(p[:, 0], p[:, 1], s=1, c=c, alpha=a)
    axs[0].plot(m['lon'], m['lat'], 'k*', ms=12); axs[0].annotate(k, (m['lon'], m['lat']), fontsize=9)
axs[0].set_title('Best estimate h24 (faint) / h72 (solid); grey = uncertainty particles')
import glob
mem = sorted(glob.glob(f'{R}/ens-haro-?.npz'))
H, C = {}, 0.005
for f in mem:
    z = np.load(f); s = set()
    for h in range(73):
        k = f'h{h:03d}_best_pos'
        if k in z.files and len(z[k]): s |= set(map(tuple, np.floor(z[k] / [0.0075, C]).astype(int).tolist()))
    for c in s: H[c] = H.get(c, 0) + 1
xy = np.array(list(H)); v = np.array(list(H.values())) / len(mem)
sc = axs[1].scatter((xy[:, 0] + .5) * 0.0075, (xy[:, 1] + .5) * C, c=v, s=3, cmap='Reds', vmin=0, vmax=1, marker='s')
plt.colorbar(sc, ax=axs[1], label='share of 10 ensemble runs reaching cell within 72 h')
axs[1].set_title('Haro Strait: 10-member ensemble, reached within 72 h')
plt.tight_layout(); plt.savefig(sys.argv[1], dpi=110)
