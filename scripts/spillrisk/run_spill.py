"""Phase 1 benchmark: one PyGNOME spill on an SSCOFS surface subset. Writes hourly particle positions + status and a
timing/memory record. Benchmark only; the 1,000 bbl amount is a test value, not a site preset.

usage: env/bin/python scripts/spillrisk/run_spill.py <forcing.nc> <lon> <lat> <hours> <oil.json> <out.npz>
         [--uncertain] [--elements N] [--seed S] [--wind-scale F] [--wind-rot DEG] [--cur-scale F] [--no-weather]
"""
import argparse, json, os, resource, sys, time
import numpy as np

t_start = time.time()
import gnome.scripting as gs
from gnome.maps.map import MapFromUGrid
from gnome.weatherers import Evaporation, NaturalDispersion, Emulsification
import netCDF4

ap = argparse.ArgumentParser()
ap.add_argument('forcing'); ap.add_argument('lon', type=float); ap.add_argument('lat', type=float)
ap.add_argument('hours', type=int); ap.add_argument('oil'); ap.add_argument('out')
ap.add_argument('--uncertain', action='store_true'); ap.add_argument('--elements', type=int, default=1000)
ap.add_argument('--seed', type=int, default=0); ap.add_argument('--wind-scale', type=float, default=1.0)
ap.add_argument('--wind-rot', type=float, default=0.0); ap.add_argument('--cur-scale', type=float, default=1.0)
ap.add_argument('--no-weather', action='store_true'); ap.add_argument('--amount-bbl', type=float, default=1000); ap.add_argument('--water-temp-c', type=float, default=10.0); ap.add_argument('--land', default='data/spillrisk/forcing/salish_land_gshhg.bna'); ap.add_argument('--timestep-min', type=int, default=15)
a = ap.parse_args()
np.random.seed(a.seed)

with netCDF4.Dataset(a.forcing) as d:
    t = netCDF4.num2date(d['time'][:], d['time'].units, only_use_cftime_datetimes=False)
start = t[0].replace(tzinfo=None) if hasattr(t[0], 'tzinfo') else t[0]
avail_h = (t[-1] - t[0]).total_seconds() / 3600
hours = min(a.hours, int(avail_h))

t_load = time.time()
model = gs.Model(start_time=start, duration=gs.hours(hours), time_step=gs.minutes(a.timestep_min),
                 uncertain=a.uncertain)
model.map = gs.MapFromBNA(a.land, refloat_halflife=1)  # land from --land BNA (GSHHG or /ships OSM); beached oil refloats with 1 h half-life
current = gs.GridCurrent.from_netCDF(a.forcing)
wind = gs.GridWind.from_netCDF(a.forcing, varnames=['uwind_speed', 'vwind_speed'])
if a.wind_scale != 1.0 or a.wind_rot != 0.0:
    # ensemble member: perturb the wind in memory (no file copy); currents stay shared
    th = np.deg2rad(a.wind_rot)
    u, v = wind.variables[0].data[:], wind.variables[1].data[:]
    wind.variables[0].data = (a.wind_scale * (u * np.cos(th) - v * np.sin(th))).astype('f4')
    wind.variables[1].data = (a.wind_scale * (u * np.sin(th) + v * np.cos(th))).astype('f4')
model.movers += gs.CurrentMover(current, scale_value=a.cur_scale)
model.movers += gs.WindMover(wind)
model.movers += gs.RandomMover(diffusion_coef=10000)  # cm2/s, PyGNOME's usual default for open water
substance = gs.GnomeOil(filename=a.oil)
model.spills += gs.point_line_spill(num_elements=a.elements, start_position=(a.lon, a.lat, 0.0),
                                    release_time=start, end_release_time=start + gs.hours(1),
                                    substance=substance, amount=a.amount_bbl, units='bbl')
if not a.no_weather:
    water = gs.Water(temperature=273.15 + a.water_temp_c, salinity=30)
    waves = gs.Waves(wind, water)
    model.environment += [water, wind, waves]
    model.weatherers += [Evaporation(water, wind), NaturalDispersion(waves, water), Emulsification(waves)]
t_built = time.time()

frames, budget = [], []
step_per_h = 60 // a.timestep_min
for i, step in enumerate(model):
    if i % step_per_h:
        continue
    rec = {}
    for tag, sc in (('best', model.spills.items()[0]),) + ((('unc', model.spills.items()[1]),) if a.uncertain else ()):
        rec[tag + '_pos'] = sc['positions'][:, :2].astype('f4').copy()
        rec[tag + '_status'] = sc['status_codes'].astype('i1').copy()
        if tag == 'best' and 'mass' in sc.data_arrays:
            rec['best_mass'] = sc['mass'].astype('f4').copy()
    mb = model.spills.items()[0].mass_balance
    budget.append({k: float(v) for k, v in mb.items() if np.isscalar(v)})
    frames.append(rec)
t_run = time.time()

np.savez_compressed(a.out, **{f'h{h:03d}_{k}': v for h, r in enumerate(frames) for k, v in r.items()})
rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 * 1024 if sys.platform == 'darwin' else 1024)
meta = dict(lon=a.lon, lat=a.lat, hours=hours, uncertain=a.uncertain, elements=a.elements, oil=os.path.basename(a.oil),
            wind_scale=a.wind_scale, wind_rot=a.wind_rot, cur_scale=a.cur_scale, weather=not a.no_weather,
            s_import=round(t_load - t_start, 1), s_build=round(t_built - t_load, 1), s_run=round(t_run - t_built, 1),
            s_total=round(time.time() - t_start, 1), amount_bbl=a.amount_bbl, water_temp_c=a.water_temp_c, start=str(start), budget_kg=budget, peak_rss_mb=round(rss), out_mb=round(os.path.getsize(a.out) / 1e6, 2))
json.dump(meta, open(a.out.replace('.npz', '.json'), 'w'))
print(json.dumps(meta))
