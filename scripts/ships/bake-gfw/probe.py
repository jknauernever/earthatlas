"""Is GFW up? Three tiny requests that tell an outage of the feature we use apart from GFW being down or our token failing.

Run by ships-gfw-tracks-bake.yml when a fetch fails, so the log (and failure triage) says what GFW is serving right now
(Josh 2026-11-06: "why can't you check if their server is actually online"). 2026-11-06 it showed GFW up, plain reports
fine, and only group-by=VESSEL_ID (the per-vessel positions the track bake needs) paused with "temporarily unavailable".
Token: GFW_API_TOKEN (env, else .env.local). Never fails the job; prints one PROBE line per check and a verdict.

--gate (the bake's plan job, before any fetch): also prints "GATE paused" when GFW is up and answers the per-vessel
request with 404, else "GATE open". The 404 is GFW's announced pause (their notice of 2026-11-03: group-by=VESSEL_ID or
MMSI with spatial-aggregation=false is switched off, no restore date), so the run skips its fetch instead of failing
every day. Anything else (GFW down, token rejected, probe skipped) is "open": the bake runs and fails loudly as before.
"""
import datetime as dt, gzip, json, os, sys, urllib.error, urllib.parse, urllib.request

G = 'https://gateway.api.globalfishingwatch.org/v3'


def token():
    t = os.environ.get('GFW_API_TOKEN')
    if not t and os.path.exists('../../../.env.local'):
        t = next((l.split('=', 1)[1].strip().strip('"') for l in open('../../../.env.local') if l.startswith('GFW_API_TOKEN=')), None)
    return t


def call(url, tok, data=None):
    hdr = {'Authorization': f'Bearer {tok}', 'User-Agent': 'Mozilla/5.0', 'Accept-Encoding': 'gzip', 'Content-Type': 'application/json'}
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=hdr, method='POST' if data else 'GET'), timeout=60) as r:
            code, body = r.status, r.read()
    except urllib.error.HTTPError as e:
        code, body = e.code, e.read()
    except Exception as e:
        return 0, f'{type(e).__name__}: {e}'
    if body[:2] == b'\x1f\x8b':
        try: body = gzip.decompress(body)
        except (OSError, EOFError): pass
    text = body.decode('utf-8', 'replace')
    try:   # GFW's error detail, when there is one
        text = json.loads(text)['messages'][0]['detail']
    except Exception:
        text = text[:160]
    return code, text


def main():
    gate = '--gate' in sys.argv
    tok = token()
    if not tok:
        print('PROBE skipped: GFW_API_TOKEN not set')
        if gate: print('GATE open')
        return
    day = (dt.date.today() - dt.timedelta(days=6)).isoformat()
    d1 = (dt.date.fromisoformat(day) + dt.timedelta(days=1)).isoformat()
    w, s, e, n = -123.0, 48.5, -122.9, 48.6          # a small box in Haro Strait, one day
    geo = json.dumps({'geojson': {'type': 'Polygon', 'coordinates': [[[w, s], [e, s], [e, n], [w, n], [w, s]]]}}).encode()
    base = {'datasets[0]': 'public-global-presence:v5.0', 'format': 'JSON', 'date-range': f'{day},{d1}',
            'temporal-resolution': 'HOURLY', 'spatial-resolution': 'HIGH'}
    checks = [
        ('vessel search (token + API up)', f'{G}/vessels/search?query=ferry&datasets[0]=public-global-vessel-identity:latest&limit=1', None),
        ('report, no grouping', f'{G}/4wings/report?{urllib.parse.urlencode(base)}', geo),
        ('report, group-by VESSEL_ID (what the bake uses)',
         f'{G}/4wings/report?{urllib.parse.urlencode({**base, "spatial-aggregation": "false", "group-by": "VESSEL_ID"})}', geo),
    ]
    res = []
    for name, url, data in checks:
        code, text = call(url, tok, data)
        res.append(code)
        print(f'PROBE {name}: HTTP {code}' + ('' if code == 200 else f' :: {text}'))
    if res[0] in (401, 403):
        print('PROBE verdict: our GFW token is rejected (needs a new token)')
    elif res[0] != 200:
        print('PROBE verdict: GFW API unreachable or down')
    elif res[2] == 200:
        print('PROBE verdict: GFW serves everything the bake needs right now (the failure was not a standing GFW outage)')
    elif res[1] == 200:
        print('PROBE verdict: GFW is up; only per-vessel grouping is unavailable on their side (upstream outage, nothing to fix here)')
    else:
        print('PROBE verdict: GFW is up but 4wings reports fail on their side (upstream outage)')
    if gate:
        print('GATE paused' if res[0] == 200 and res[2] == 404 else 'GATE open')


if __name__ == '__main__':
    main()
