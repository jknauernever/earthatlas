"""Spill scenarios: one-line-per-scenario summary of the baked files (markdown table to stdout).
usage: python3 scripts/spillrisk/summarize.py
"""
import json, os
D = os.path.join(os.path.dirname(__file__), '..', '..', 'public/spillrisk-data')
idx = json.load(open(os.path.join(D, 'scenarios.json')))
names = {p['id']: (i + 1, p['name']) for i, p in enumerate(idx['points'])}
print('| # | Point | Volume (bbl) | Weather | First ashore (runs) | Ashore at h24 (run 1) | Barrels ashore at h24 | SRKW habitat | Friends places by h72 | Protected areas by h72 |')
print('|---|---|---|---|---|---|---|---|---|---|')
for w in ('winter-storm', 'summer'):
    for pid, (n, nm) in names.items():
        f = os.path.join(D, f'{pid}--{w}.json')
        if not os.path.exists(f):
            continue
        sc = json.load(open(f))
        s = sc['shore']
        b = sc['hours'][min(24, len(sc['hours']) - 1)].get('budget', {})
        srkw = next((g['first'][0] for g in sc['impacts'] if g['group'].startswith('Killer whale')), None)
        fr = sum(len(g['first']) for g in sc['impacts'] if g['layer'] == 'friends')
        pa = sum(1 for g in sc['impacts'] if g['layer'] == 'padus')
        shore = f"h{s['first_min']}–{s['first_max']} ({s['members_reaching']}/10)" if s['first_min'] is not None else 'none'
        print(f"| {n} | {nm} | {sc['amount_bbl']:,.0f} | {'Winter storm' if w == 'winter-storm' else 'Summer'} | {shore} | {round(b.get('ashore', 0) * 100)}% | {b.get('ashore', 0) * sc['amount_bbl']:,.0f} | "
              f"{'h' + str(srkw) if srkw is not None else '—'} | {fr or '—'} | {pa or '—'} |")
