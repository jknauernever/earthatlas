"""Pull NOAA SSCOFS surface currents + model 10 m wind into one FVCOM-style NetCDF that PyGNOME reads.
Idempotent: hours already fetched are skipped.

  forecast  one live forecast cycle, f000..fNNN, from NOAA's OPeNDAP server (keeps only recent cycles)
            env/bin/python scripts/spillrisk/fetch_sscofs.py forecast YYYYMMDD HH [hours=72] [out_dir]
  archive   a past window from the AWS archive (noaa-nos-ofs-pds, Nov 2024 →), stitched from NOWCAST hours
            (each cycle tCCz has n000..n005 = valid times CC-6h..CC-1h), read by HTTP byte range so only the
            surface layer is downloaded (~15 MB per hour, not the 210 MB file)
            env/bin/python scripts/spillrisk/fetch_sscofs.py archive YYYY-MM-DDTHH [hours=72] [out_dir]
"""
import datetime as dt, os, sys, time
import numpy as np
import netCDF4

OPENDAP = 'https://opendap.co-ops.nos.noaa.gov/thredds/dodsC/NOAA/SSCOFS/MODELS'
S3 = 'https://noaa-nos-ofs-pds.s3.amazonaws.com/sscofs/netcdf'


def open_retry(url, tries=4):
    for i in range(tries):
        try:
            return netCDF4.Dataset(url)
        except (OSError, RuntimeError) as e:
            if i == tries - 1:
                raise
            print('retry', url, e, flush=True)
            time.sleep(5 * (i + 1))


def archive_url(t):
    """nowcast file holding valid time t (UTC, whole hour)"""
    n = (t.hour - 3) % 6
    cyc = t - dt.timedelta(hours=n) + dt.timedelta(hours=6)
    return f'{S3}/{cyc:%Y/%m/%d}/sscofs.t{cyc:%H}z.{cyc:%Y%m%d}.fields.n{n:03d}.nc#mode=bytes'


def fetch(urls, parts):
    os.makedirs(parts, exist_ok=True)
    mesh_f = os.path.join(parts, 'mesh.npz')
    if not os.path.exists(mesh_f):
        d = open_retry(urls[0])
        np.savez(mesh_f, lon=d['lon'][:], lat=d['lat'][:], lonc=d['lonc'][:], latc=d['latc'][:], nv=d['nv'][:],
                 nbe=d['nbe'][:], h=d['h'][:])
        d.close()
    t0 = time.time()
    for h, url in enumerate(urls):
        f = os.path.join(parts, f'f{h:03d}.npz')
        if os.path.exists(f):
            continue
        d = open_retry(url)
        np.savez(f + '.tmp.npz', time=d['time'][:], u=d['u'][0, 0, :], v=d['v'][0, 0, :], uw=d['uwind_speed'][0, :],
                 vw=d['vwind_speed'][0, :], time_units=d['time'].units)
        os.replace(f + '.tmp.npz', f)
        d.close()
        print(f'h{h:03d} {time.time() - t0:.0f}s', flush=True)


def assemble(parts, n, out, title):
    m = np.load(os.path.join(parts, 'mesh.npz'))
    hours = [np.load(os.path.join(parts, f'f{h:03d}.npz')) for h in range(n)]
    # source times are float32 (~16 s precision at 2.5e8 s): snap to the whole hour they stand for
    tt = np.round(np.concatenate([x['time'] for x in hours]).astype('f8') / 3600) * 3600
    assert np.all(np.diff(tt) == 3600), 'hours are not consecutive'
    ds = netCDF4.Dataset(out + '.tmp', 'w')
    ds.createDimension('time', None)
    ds.createDimension('node', m['lon'].size)
    ds.createDimension('nele', m['lonc'].size)
    ds.createDimension('three', 3)
    ds.Conventions = 'CF-1.0'
    ds.source = 'FVCOM'
    ds.title = title

    def var(name, typ, dims, data, **att):
        v = ds.createVariable(name, typ, dims, zlib=True)
        v[:] = data
        for k, a in att.items():
            setattr(v, k, a)

    lon = np.where(m['lon'] > 180, m['lon'] - 360, m['lon'])
    lonc = np.where(m['lonc'] > 180, m['lonc'] - 360, m['lonc'])
    var('lon', 'f4', ('node',), lon, units='degrees_east', standard_name='longitude')
    var('lat', 'f4', ('node',), m['lat'], units='degrees_north', standard_name='latitude')
    var('lonc', 'f4', ('nele',), lonc, units='degrees_east', standard_name='longitude')
    var('latc', 'f4', ('nele',), m['latc'], units='degrees_north', standard_name='latitude')
    var('nv', 'i4', ('three', 'nele'), m['nv'], long_name='nodes surrounding element')
    var('nbe', 'i4', ('three', 'nele'), m['nbe'], long_name='elements surrounding each element')
    var('h', 'f4', ('node',), m['h'], units='m', long_name='bathymetry')
    var('time', 'f8', ('time',), tt, units=str(hours[0]['time_units']), standard_name='time')
    for name, key, std, ln in (('u', 'u', 'eastward_sea_water_velocity', 'Eastward Water Velocity'),
                               ('v', 'v', 'northward_sea_water_velocity', 'Northward Water Velocity'),
                               ('uwind_speed', 'uw', 'eastward_wind', 'Eastward Wind Velocity'),
                               ('vwind_speed', 'vw', 'northward_wind', 'Northward Wind Velocity')):
        var(name, 'f4', ('time', 'nele'), np.stack([x[key] for x in hours]), units='m s-1', standard_name=std,
            long_name=ln)
    ds.close()
    os.replace(out + '.tmp', out)
    print('wrote', out, f'{os.path.getsize(out) / 1e6:.0f} MB', flush=True)


if __name__ == '__main__':
    mode = sys.argv[1]
    if mode == 'forecast':
        day, cyc = sys.argv[2], sys.argv[3]
        last = int(sys.argv[4]) if len(sys.argv) > 4 else 72
        out_dir = sys.argv[5] if len(sys.argv) > 5 else 'data/spillrisk/forcing'
        base = f'{OPENDAP}/{day[:4]}/{day[4:6]}/{day[6:]}'
        urls = [f'{base}/sscofs.t{cyc}z.{day}.fields.f{h:03d}.nc' for h in range(last + 1)]
        tag, title = f'sscofs-{day}-{cyc}z', f'SSCOFS {day} {cyc}z forecast, surface sigma layer + model 10 m wind'
    elif mode == 'archive':
        start = dt.datetime.strptime(sys.argv[2], '%Y-%m-%dT%H')
        last = int(sys.argv[3]) if len(sys.argv) > 3 else 72
        out_dir = sys.argv[4] if len(sys.argv) > 4 else 'data/spillrisk/forcing'
        urls = [archive_url(start + dt.timedelta(hours=h)) for h in range(last + 1)]
        tag = f'sscofs-nowcast-{start:%Y%m%dT%H}z-{last}h'
        title = f'SSCOFS nowcast {start:%Y-%m-%d %H}z + {last} h, surface sigma layer + model 10 m wind'
    else:
        sys.exit(__doc__)
    parts = os.path.join(out_dir, tag + '-parts')
    fetch(urls, parts)
    assemble(parts, last + 1, os.path.join(out_dir, tag + '-surface.nc'), title + ' (EarthAtlas subset)')
