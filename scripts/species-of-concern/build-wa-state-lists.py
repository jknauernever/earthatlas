#!/usr/bin/env python3
"""Build three more Washington State status lists, in the same format as wa-state-listed.json:

  wa-dnr-rare-plants.json   DNR Natural Heritage Program, vascular plant species of conservation concern
  wa-sgcn.json              WDFW State Wildlife Action Plan 2025-2035, Species of Greatest Conservation Need
  wa-phs.json               WDFW Priority Habitats and Species list (species only)

    python3 scripts/species-of-concern/build-wa-state-lists.py
    node scripts/species-of-concern/resolve-ids.mjs data/species-of-concern/<file>.json

Source spreadsheets are downloaded to the system temp folder (the PHS workbook is ~45 MB).
Source IDs already resolved in an existing file are carried over.
"""
import datetime
import json
import os
import re
import sys
import tempfile
import urllib.request

sys.path.insert(0, os.path.dirname(__file__))
import xlsx  # noqa: E402

OUT = 'data/species-of-concern'
CACHE = os.path.join(tempfile.gettempdir(), 'earthatlas-species-of-concern')
SRC = {
    'dnr_plants': 'https://dnr.wa.gov/sites/default/files/2025-03/amp_nh_vascular_ets_excel.xlsx',
    'dnr_plants_pdf': 'https://dnr.wa.gov/sites/default/files/2025-03/amp_nh_vascular_ets.pdf',
    'sgcn_animals': 'https://wdfw.wa.gov/sites/default/files/publications/02665/Table%20A.%20SGCN-254%20Animals-with%20status%20and%20reasons.xlsx',
    'sgcn_plants': 'https://wdfw.wa.gov/sites/default/files/publications/02665/Table%20B.%20SGCN-127%20Plants-with%20status.xlsx',
    'swap_page': 'https://wdfw.wa.gov/species-habitats/at-risk/swap',
    'phs': 'https://wdfw.wa.gov/sites/default/files/publications/00165/2026_distribution_by_county.xlsx',
    'phs_page': 'https://wdfw.wa.gov/publications/00165',
}
ID_FIELDS = ['inat_taxon_id', 'inat_species_taxon_id', 'gbif_taxon_key', 'gbif_species_key',
             'ebird_species_code', 'ebird_issf_code']


def fetch(key):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, key + '.xlsx')
    if not os.path.exists(path):
        req = urllib.request.Request(SRC[key], headers={'User-Agent': 'Mozilla/5.0 (EarthAtlas)'})
        with urllib.request.urlopen(req) as r, open(path, 'wb') as f:
            f.write(r.read())
    return path


def clean(s):
    return re.sub(r'\s+', ' ', (s or '').replace('’', "'")).strip()


def name_rank(sci):
    """'Actaea elata var. elata' -> ('Actaea elata elata', 'variety')."""
    sci = clean(sci)
    rank = 'variety' if ' var. ' in sci else 'subspecies' if (' ssp. ' in sci or ' subsp. ' in sci or len(sci.split()) == 3) else 'species'
    return re.sub(r' (var|ssp|subsp)\. ', ' ', sci), rank


# Source spellings that iNaturalist/GBIF do not match: source name -> (current name, note or None).
# The source spelling is kept as a synonym.
NAME_FIXES = {
    'Isöetes minima': ('Isoetes minima', None), 'Isöetes nuttallii': ('Isoetes nuttallii', None),
    'Hackelia hispda var. disjuncta': ('Hackelia hispida var. disjuncta', None),
    'Amphispiza nevadensis': ('Artemisiospiza nevadensis', None),
    'Algamorda subrotundata': ('Littorina subrotundata', None),
    'Oncorhynchus clarki clarki': ('Oncorhynchus clarkii clarkii', None),
    'Oncorhynchus clarki lewisi': ('Oncorhynchus clarkii lewisi', None),
    'Clupea pallasi': ('Clupea pallasii', None), 'Buprestis gibbsi': ('Buprestis gibbsii', None),
    'Vespericola depressa': ('Vespericola depressus', None), 'Corynorhinus townsendi': ('Corynorhinus townsendii', None),
    'Callophrys nelsoni': ('Callophrys gryneus nelsoni', None),
    'Corydalis aquae-gelidae': ('Corydalis caseana aquae-gelidae', None),
    'Lupinus oreganus var. kincaidii': ('Lupinus oreganus', "Kincaid's lupine; iNaturalist and GBIF treat it as Lupinus oreganus."),
    'Lupinus oreganus kincaidii': ('Lupinus oreganus', "Kincaid's lupine; iNaturalist and GBIF treat it as Lupinus oreganus."),
}
NAME_FIXES.update({
    'Primula austrofrigidum': ('Primula austrofrigida', None),
    'Astragalus australis var. cottonii': ('Astragalus cottonii', None), 'Astragalus australis cottonii': ('Astragalus cottonii', None),
    'Fisherola nuttalli': ('Fisherola nuttallii', None), 'Prosopium coulteri': ('Prosopium coulterii', None),
})
# iNaturalist's name for the same taxon where it differs in rank (used only for the iNaturalist lookup).
INAT_NAME = {
    'Oncorhynchus clarkii clarkii': 'Oncorhynchus clarkii',  # iNat: coastal cutthroat is the species
    'Oncorhynchus clarkii lewisi': 'Oncorhynchus lewisi',
    'Plectritis brachystemon': 'Plectritis congesta brachystemon',
}
# Names the sources fold into a different taxon: records of that taxon are not records of the listed
# one, so only the species is matched (as "listed taxon not confirmed"); the resolver leaves these alone.
LOCK = {
    'Oxytropis campestris gracilis': {
        'inat_taxon_id': None, 'inat_species_taxon_id': 154238,
        'note': 'iNaturalist folds this variety into var. spicata and GBIF into Oxytropis monticola; only records filed under the listed name are confirmed.'},
}
# Older names the GBIF backbone still uses, added as synonyms.
EXTRA_SYNONYMS = {
    'Anarhynchus nivosus': ['Charadrius nivosus'], 'Occidentis ayresii': ['Lampetra ayresii'],
    'Boloria myrina': ['Boloria selene myrina'],
}


def entry(common, sci, status, source, note=None, synonyms=(), **extra):
    note = extra.pop('note', note)
    sci = re.sub(r'\s+[´x×]\s+', ' ', clean(sci))  # hybrid sign: "Myosurus × alopecuroides"
    if sci in NAME_FIXES:
        sci, fix_note = NAME_FIXES[clean(sci)][0], NAME_FIXES[clean(sci)][1]
        synonyms = [*synonyms, *[k for k, v in NAME_FIXES.items() if v[0] == sci]]
        note = note or fix_note
    synonyms = [*synonyms, *EXTRA_SYNONYMS.get(name_rank(sci)[0], [])]
    name, rank = name_rank(sci)
    if name in INAT_NAME:
        extra['inat_name'] = INAT_NAME[name]
    syns = []
    for s in synonyms:
        n, _ = name_rank(s)
        if n != name and n not in syns:
            syns.append(n)
    e = {'common_name': clean(common) or None, 'scientific_name': name, 'synonyms': syns, 'rank': rank,
         'status': status, 'status_source': source,
         'match_level': 'species' if rank == 'species' else 'subspecies_or_population', 'note': note}
    e.update(extra)
    return e


def expand_synonyms(sci, paren):
    """'(A. lackschewitzii)' after 'Agoseris ...' -> ['Agoseris lackschewitzii']. Skips abbreviations
    that cannot be expanded safely (e.g. 'A. c. ssp. borealis var. w.')."""
    genus = sci.split()[0]
    out = []
    for part in re.split(r'[;,]', paren):
        p = clean(part)
        if not p or p.lower().startswith(('includes', 'incl', 'see', 'formerly', 'not ')):
            continue
        p = re.sub(r'^[A-Z]\. ', genus + ' ', p)
        p = re.sub(r'^×\s*', '', p).replace(' × ', ' ')
        if re.search(r'\b[a-z]\.(\s|$)', p) or not re.match(r'^[A-Z][a-z]+ [a-z-]+', p):
            continue
        out.append(p)
    return out


def dnr_plants():
    rows = xlsx.rows(fetch('dnr_plants'))
    assert rows[1][0].startswith('Species'), rows[1]
    status_map = {'Endang': 'Endangered', 'Threat': 'Threatened', 'Sens': 'Sensitive', 'Extirp': 'Possibly extirpated'}
    out = []
    for r in rows[2:]:
        if not r[0]:
            continue
        lines = [l.strip() for l in r[0].split('\n') if l.strip()]
        # first line is the scientific name; lines that start with "(" right after it are synonyms;
        # the next line is the common name; anything after it is an alternate common name
        i = 1
        while i < len(lines) and (lines[i].startswith('(') or ' '.join(lines[:i]).count('(') > ' '.join(lines[:i]).count(')')):
            i += 1
        body = ' '.join(lines[:i])
        common = lines[i] if i < len(lines) else None
        alt_common = clean(' '.join(lines[i + 1:]).strip('()').removeprefix('or ')) or None
        paren = re.findall(r'\(([^)]*)\)', body)
        sci = clean(re.sub(r'\([^)]*\)', '', body))
        note = None
        incl = [p for p in paren if p.lower().startswith('incl')]
        if incl:
            note = f'DNR list entry {incl[0]}.'
        syns = [s for p in paren for s in expand_synonyms(sci, p)]
        statuses = [status_map[s] for s in re.split(r'\s+', r[2].strip()) if s in status_map]
        out.append(entry(common, sci, statuses[0], 'Washington Natural Heritage Program, 2024 Vascular Plant Species of Conservation Concern',
                         note, syns, heritage_rank=clean(r[1]) or None, counties=clean(r[5]) or None,
                         alt_common_name=alt_common))
    return out


def sgcn():
    out = []
    a = xlsx.rows(fetch('sgcn_animals'))
    assert a[0][2] == 'Scientific Name', a[0]
    for r in a[1:]:
        if not r[2]:
            continue
        sci, note = r[2], None
        if r[2] == 'Catostomus catostomus sp. 4':  # Salish sucker: undescribed form, no name in the sources
            sci, note = 'Catostomus catostomus', 'Salish sucker is an undescribed form of longnose sucker (listed as "Catostomus catostomus sp. 4"). Longnose sucker records are not confirmed Salish sucker records.'
        e = entry(r[1], sci, 'Species of Greatest Conservation Need', 'WDFW State Wildlife Action Plan 2025-2035, Table A', note,
                  species_group=r[5] or None, wdfw_taxo_id=r[11] or None)
        if '(Georgia Basin DPS)' in r[1]:
            e['note'] = 'SGCN covers only the Georgia Basin population of Pacific herring.'
        if e['note'] and 'not confirmed' in e['note'] or '(Georgia Basin DPS)' in r[1]:
            e['match_level'] = 'subspecies_or_population'
        out.append(e)
    p = xlsx.rows(fetch('sgcn_plants'))
    assert p[0][2] == 'Species Scientific Name', p[0]
    for r in p[1:]:
        if len(r) < 3 or not r[2]:
            continue
        out.append(entry(r[1], r[2], 'Species of Greatest Conservation Need', 'WDFW State Wildlife Action Plan 2025-2035, Table B',
                         species_group=r[4] or None, natureserve_elcode=(r[8] if len(r) > 8 else '') or None))
    return out


# Typos in the PHS sheet's scientific-name column: (common name, as printed) -> corrected name.
PHS_FIXES = {
    ('white sturgeon', 'Acipenser medirostris'): 'Acipenser transmontanus',  # sheet repeats green sturgeon's name
    ('Cascade red fox', 'Vulpes vulpes cascadens'): 'Vulpes vulpes cascadensis',
    ('coastal resident - searun cutthroat', 'Oncorhynchus clarki clarki'): 'Oncorhynchus clarkii clarkii',
    ('westslope cutthroat trout', 'Oncorhynchus clarki lewisi'): 'Oncorhynchus clarkii lewisi',
}

PHS_CRITERIA = {5: 'State listed or candidate species', 6: 'Vulnerable aggregations',
                7: 'Species of recreational, commercial or tribal importance'}


def phs():
    rows = xlsx.rows(fetch('phs'), 'Statewide')
    assert rows[1][1].startswith('Scien') and rows[1][3] == 'Priority species', rows[1]
    out = []
    for r in rows[2:]:
        r = r + [''] * (12 - len(r))
        if not r[3] or not r[1]:
            continue  # priority habitats and concentration areas are places, not species
        crit = [v for k, v in PHS_CRITERIA.items() if r[k]]
        extra = {'phs_criteria': crit, 'phs_group': r[2] or None}
        if r[2] == 'Non-native species':
            extra['non_native'] = True
        if r[2] == 'Extirpated priority species':
            extra['extirpated_in_wa'] = True
        src = 'WDFW Priority Habitats and Species List, 2026'
        if r[1] == 'Salvelinus confluentus/S. malma':  # one PHS row for two species
            out.append(entry('bull trout', 'Salvelinus confluentus', 'Priority species', src, **extra))
            out.append(entry('Dolly Varden', 'Salvelinus malma', 'Priority species', src, **extra))
            continue
        fixed = PHS_FIXES.get((r[0], r[1]))
        if fixed:
            extra['source_name'] = r[1]
            extra['note'] = f'PHS list prints the scientific name as "{r[1]}"; corrected to {fixed}.'
        out.append(entry(r[0], fixed or r[1], 'Priority species', src, **extra))
    return out


def write(fname, authority, sources, notes, species):
    path = os.path.join(OUT, fname)
    prev = {}
    if os.path.exists(path):
        prev = {e['scientific_name']: e for e in json.load(open(path))['species']}
    for e in species:
        old = prev.get(e['scientific_name'], {})
        for f in ID_FIELDS:
            e[f] = old.get(f)
        if e['scientific_name'] in LOCK:
            lock = LOCK[e['scientific_name']]
            e.update({k: v for k, v in lock.items() if k != 'note'})
            e.update(note=lock['note'], match_level='subspecies_or_population', locked=True)
        if not e['common_name'] and old.get('common_name'):
            e['common_name'], e['common_name_source'] = old['common_name'], old.get('common_name_source')
    doc = {'jurisdiction': 'US-WA', 'authority': authority, 'compiled': datetime.date.today().isoformat(),
           'sources': sources, 'notes': notes, 'species': species}
    with open(path, 'w') as f:
        f.write(json.dumps(doc, indent=2, ensure_ascii=False) + '\n')
    print(f'{len(species):4d} -> {path}')


write('wa-dnr-rare-plants.json', 'Washington State (DNR Natural Heritage Program)',
      {'excel': SRC['dnr_plants'], 'pdf': SRC['dnr_plants_pdf'], 'page': 'https://dnr.wa.gov/natural-heritage-program/rare-species/species-lists'},
      ['State status for plants is set by the DNR Natural Heritage Program (2024 list, posted 2025-03). Statuses: Endangered, Threatened, Sensitive, Possibly extirpated.',
       'Synonyms come from the parenthetical names in the DNR list; abbreviated forms that cannot be expanded safely are skipped.'],
      dnr_plants())
write('wa-sgcn.json', 'Washington State (WDFW State Wildlife Action Plan 2025-2035)',
      {'animals': SRC['sgcn_animals'], 'plants': SRC['sgcn_plants'], 'page': SRC['swap_page']},
      ['Species of Greatest Conservation Need (SGCN) from the 2025-2035 State Wildlife Action Plan, approved by USFWS in April 2026: 254 animals (Table A) and the plant SGCN (Table B).',
       'SGCN is a planning designation; it carries no legal protection by itself.'],
      sgcn())
write('wa-phs.json', 'Washington State (WDFW Priority Habitats and Species)',
      {'excel': SRC['phs'], 'page': SRC['phs_page']},
      ['Priority species from the 2026 PHS list (Statewide sheet). Priority habitats and the vulnerable concentration areas (e.g. heron colonies, ungulate winter range) are places, not species, and are not included.',
       'phs_criteria gives the reason each species is on the list. Three non-native game birds are listed only for recreational importance (non_native: true).'],
      phs())
