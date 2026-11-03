#!/usr/bin/env python3
"""
Quarterly refresh of the Friends of the San Juans article index that the habitat and property popups draw "Related
content" from (src/friends/friendsContent.js; docs/SHORELINE_PORT_PLAN.md decision 9).

Harvests every published post and page on sanjuans.org through its public WordPress REST API (title, date, body,
excerpt, categories/tags, featured image: the same reads as SSE's scripts/harvest-friends-content.py), then merges
them into the current index:
  - an article already in the index keeps its tags and summary (SSE's one-time hand-checked pass); its title, date,
    URL and photos are refreshed from the site
  - a new article is tagged by RULES ONLY (no AI): keyword patterns over its title, excerpt, WordPress categories and
    tags and body, the same topic vocabulary SSE used. Its summary is the article's own excerpt. Articles that match no
    topic are left out, as SSE's pass left out off-topic pages
  - an article no longer on the site is dropped
byLayer (topic → map layer ids, ranking) is rebuilt exactly as SSE's build-friends-content-index.py does.

Usage:  python3 scripts/shoreline/friends-content.py [--sample N]     --sample: first N posts only (a check)
Needs:  beautifulsoup4
Base:   the live index on Blob (shoreline/friends-content.json), else public/friends/friends-content.json
Output: data/shoreline/friends-content.json (+ friends-content.meta.json: counts, for the upload gates)
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from bs4 import BeautifulSoup

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SITE = 'https://sanjuans.org'
UA = 'EarthAtlas Shoreline Explorer article index (+https://earthatlas.org/shoreline)'
BLOB = 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com/shoreline/friends-content.json'
REPO_COPY = os.path.join(ROOT, 'public', 'friends', 'friends-content.json')
PROJECTS = os.path.join(ROOT, 'public', 'shoreline-data', 'friends-projects.geojson')
OUT_DIR = os.path.join(ROOT, 'data', 'shoreline')
SAMPLE = int(sys.argv[sys.argv.index('--sample') + 1]) if '--sample' in sys.argv else None

# SSE build-friends-content-index.py: topic → map layer ids that surface it (unchanged)
TOPIC_LAYERS = {
    'kelp': ['friends-bull-kelp'],
    'eelgrass': ['friends-deepwater-eelgrass', 'eelgrass', 'friends-herring-spawning'],
    'forage-fish': ['friends-documented-forage-spawning', 'friends-potential-forage-spawning', 'pacific-sand-lance', 'surf-smelt'],
    'herring': ['friends-herring-spawning', 'pacific-herring'],
    'salmon': ['chinook-salmon', 'chum-salmon', 'pink-salmon'],
    'seabirds': ['marbled-murrelet-observations', 'marbled-murrelet-breeding', 'marbled-murrelet-winter', 'ebird-hotspots'],
    'shoreline-armor': ['friends-armor', 'friends-armor-change-2019', 'friends-shoreline-geology', 'friends-groins'],
    'docks-and-moorings': ['friends-docks', 'friends-mooring-buoys', 'friends-pilings', 'friends-boat-ramps', 'friends-marine-railway'],
    'restoration': ['friends-projects'],
    'riparian': ['friends-projects', 'ndvi', 'forest-loss', 'opera-dist-alert'],
    'landowner-stewardship': ['tax-parcels', 'friends-shoreline-geology'],
    'water-quality': ['stormwater-pipes'],
    'green-boating': ['friends-mooring-buoys', 'friends-deepwater-eelgrass'],
    'climate': ['upland-property'],
}
for _t in ('landowner-stewardship', 'water-quality', 'riparian'):
    TOPIC_LAYERS[_t] = TOPIC_LAYERS.get(_t, []) + ['upland-property']
MARINE = {'eelgrass', 'kelp', 'herring', 'forage-fish', 'docks-and-moorings', 'green-boating', 'shoreline-armor', 'restoration'}

# Rule tagging. A topic applies when its pattern hits the title, excerpt, categories or tags once, or the body twice.
TOPIC_RULES = {
    'kelp': r'\bkelp\b',
    'eelgrass': r'\beel ?grass|\bseagrass',
    'forage-fish': r'forage fish|surf smelt|sand lance',
    'herring': r'\bherring\b',
    'salmon': r'\bsalmon|\bchinook\b|\bcoho\b|\bchum\b|\bsteelhead\b',
    'orca': r'\borcas?\b|killer whale|southern resident',
    'seabirds': r'seabird|murrelet|guillemot|\bcormorant',
    'shoreline-armor': r'bulkhead|shoreline armou?r|\barmou?ring\b|seawall|rip-?rap|soft shore',
    'docks-and-moorings': r'\bdocks?\b|\bmooring|\bbuoys?\b|\bpilings?\b',
    'restoration': r'\brestor(e|ed|ing|ation)\b',
    'riparian': r'riparian|shoreline vegetation|native plant',
    'landowner-stewardship': r'landowner|homeowner|property owner|waterfront owner|stewardship',
    'water-quality': r'water quality|stormwater|septic|pollut|contaminat',
    'green-boating': r'green boating|\bboaters?\b|\banchor(ing|age)\b',
    'climate': r'climate',
    'sea-level-rise': r'sea[- ]level rise',
    'oil-and-vessels': r'oil spill|\btankers?\b|vessel traffic|\bcrude oil|shipping',
    'policy': r'shoreline master program|\bSMP\b|legislat|public comment|hearing|critical areas ordinance|\bpermits?\b|rulemaking',
    'education': r'\bstudents?\b|\bschools?\b|\beducation|workshop|curriculum',
    'community': r'volunteer|community|\bmembers?\b|celebrat',
}
TOPIC_RX = {t: re.compile(p, re.I) for t, p in TOPIC_RULES.items()}
ISLANDS = ['San Juan', 'Orcas', 'Lopez', 'Shaw', 'Waldron', 'Blakely', 'Decatur', 'Sucia', 'Stuart', 'Jones', 'Brown', 'Crane']
ISLAND_RX = {i: re.compile(rf'\b{i} Island\b' if i == 'San Juan' else rf'\b{i}\b(?: Island)?', re.I) for i in ISLANDS}
SKIP_IMG = ('logo', 'icon', 'avatar', 'gravatar', 'button', 'badge', 'emoji', 'spacer', 'pixel')
requests = 0


def get(url):
    global requests
    requests += 1
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r), r.headers


def fetch_all(kind):
    items, page = [], 1
    per_page = min(SAMPLE, 50) if SAMPLE else 50
    while True:
        q = {'per_page': per_page, 'page': page, '_embed': 'wp:featuredmedia,wp:term', 'status': 'publish'}
        try:
            data, headers = get(f'{SITE}/wp-json/wp/v2/{kind}?{urllib.parse.urlencode(q)}')
        except urllib.error.HTTPError as e:
            if e.code == 400:
                break  # past the last page
            raise
        items.extend(data)
        pages = int(headers.get('X-WP-TotalPages', '1'))
        print(f'  {kind} page {page}/{pages} ({len(items)} so far)', flush=True)
        if SAMPLE or page >= pages or not data:
            break
        page += 1
        time.sleep(0.5)
    return items


def clean(html):
    soup = BeautifulSoup(html or '', 'html.parser')
    images = []
    for fig in soup.find_all('figure'):
        img, cap = fig.find('img'), fig.find('figcaption')
        if img and img.get('src'):
            images.append({'url': img['src'], 'caption': (cap.get_text(' ', strip=True) if cap else img.get('alt', '')).strip()})
    seen = {i['url'] for i in images}
    for img in soup.find_all('img'):
        src = img.get('src')
        if src and src not in seen and not src.startswith('data:'):
            images.append({'url': src, 'caption': (img.get('alt') or '').strip()})
            seen.add(src)
    for t in soup(['script', 'style', 'noscript', 'iframe', 'form']):
        t.decompose()
    return re.sub(r'\n{3,}', '\n\n', soup.get_text('\n', strip=True)), images


def terms(item):
    tags, cats = [], []
    for group in (item.get('_embedded', {}).get('wp:term') or []):
        for t in group:
            (tags if t.get('taxonomy') == 'post_tag' else cats if t.get('taxonomy') == 'category' else []).append(t['name'])
    return tags, cats


def featured(item):
    media = (item.get('_embedded', {}).get('wp:featuredmedia') or [None])[0]
    if not media or not media.get('source_url'):
        return None
    sizes = (media.get('media_details') or {}).get('sizes') or {}
    pick = sizes.get('large') or sizes.get('medium_large') or {}
    caption = BeautifulSoup((media.get('caption') or {}).get('rendered', ''), 'html.parser').get_text(' ', strip=True)
    return {'url': pick.get('source_url') or media['source_url'], 'caption': caption or (media.get('alt_text') or '')}


def good_image(im):
    u = (im.get('url') or '').lower()
    return u.startswith('http') and not any(s in u for s in SKIP_IMG) and not u.endswith('.svg')


def rule_tags(title, excerpt, cats, tags, text):
    head = ' '.join([title, excerpt, *cats, *tags])
    topics = [t for t, rx in TOPIC_RX.items() if rx.search(head) or len(rx.findall(text)) >= 2]
    islands = [i for i, rx in ISLAND_RX.items() if rx.search(head) or len(rx.findall(text)) >= 2]
    return topics, islands


def rule_kind(kind, cats):
    c = ' '.join(cats).lower()
    if 'event' in c:
        return 'event'
    if kind == 'page':
        return 'program'
    return 'news'


def load_base():
    try:
        req = urllib.request.Request(BLOB, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=30) as r:
            print('base: live index on Blob')
            return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise
    print('base: public/friends/friends-content.json (no index on Blob yet)')
    return json.load(open(REPO_COPY))


def main():
    t0 = time.time()
    base = load_base()
    old = base['items']
    project_links = set()
    if os.path.exists(PROJECTS):
        project_links = {f['properties'].get('LINK', '').rstrip('/') for f in json.load(open(PROJECTS))['features'] if f['properties'].get('LINK')}

    items, added, kept, skipped = {}, [], 0, 0
    for kind in ('posts', 'pages'):
        print(f'Fetching {kind}…', flush=True)
        for it in fetch_all(kind):
            iid = f'{kind[:-1]}-{it["id"]}'
            url = it.get('link') or ''
            text, body_images = clean(it.get('content', {}).get('rendered', ''))
            title = BeautifulSoup(it.get('title', {}).get('rendered', ''), 'html.parser').get_text(' ', strip=True)
            excerpt = BeautifulSoup(it.get('excerpt', {}).get('rendered', ''), 'html.parser').get_text(' ', strip=True)
            tags, cats = terms(it)
            images = []
            feat = featured(it)
            if feat and good_image(feat):
                images.append(feat)
            for im in body_images:
                if good_image(im) and im['url'] not in {x['url'] for x in images}:
                    images.append(im)
            fresh = {'id': iid, 'url': url, 'title': title, 'date': (it.get('date') or '')[:10], 'type': kind[:-1],
                     'excerpt': excerpt, 'image': images[0] if images else None, 'images': images[:6]}
            if iid in old:
                rec = {**old[iid], **fresh}  # tags + summary from the hand-checked pass, the rest from the site
                kept += 1
            else:
                topics, islands = rule_tags(title, excerpt, cats, tags, text)
                is_project = url.rstrip('/') in project_links
                if is_project and 'restoration' not in topics:
                    topics.append('restoration')
                if not topics:
                    skipped += 1
                    continue
                summary = excerpt if len(excerpt) <= 320 else excerpt[:317].rsplit(' ', 1)[0] + '…'
                rec = {**fresh, 'summary': summary or text[:300], 'topics': topics, 'islands': islands, 'places': [],
                       'projectMatch': '', 'kind': 'project-story' if is_project else rule_kind(kind[:-1], cats),
                       'quality': 2 if len(text.split()) >= 300 and images else 1}
                added.append(iid)
            items[iid] = rec
    if SAMPLE:  # a check: the sample's records only, merged into nothing
        print(f'sample: {len(items)} records ({kept} already indexed, {len(added)} new by rules, {skipped} no topic)')
        for iid in added:
            print(f'  new {iid}: {items[iid]["title"][:60]!r} topics={items[iid]["topics"]} islands={items[iid]["islands"]}')
    dropped = sorted(set(old) - set(items)) if not SAMPLE else []

    by_layer = {}
    for rec in items.values():
        for t in rec['topics']:
            for lid in TOPIC_LAYERS.get(t, []):
                by_layer.setdefault(lid, []).append(rec['id'])
    for lid, ids in by_layer.items():
        if lid == 'upland-property':
            ids = [i for i in ids if items[i]['kind'] != 'project-story' and not (set(items[i]['topics']) & MARINE)]
        uniq = list(dict.fromkeys(ids))
        uniq.sort(key=lambda i: (-items[i]['quality'], 0 if items[i]['image'] else 1))
        by_layer[lid] = uniq[:12]

    out = {'generated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'items': items, 'byLayer': by_layer,
           'byUrl': {r['url'].rstrip('/'): r['id'] for r in items.values()}}
    meta = {'sample': bool(SAMPLE), 'items': len(items), 'before': len(old), 'kept': kept, 'added': len(added),
            'dropped': len(dropped), 'noTopic': skipped, 'layers': len(by_layer), 'requests': requests}
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, 'friends-content.json'), 'w') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(OUT_DIR, 'friends-content.meta.json'), 'w') as f:
        json.dump(meta, f, indent=2)
    print(json.dumps(meta), f'{time.time() - t0:.0f}s')
    if dropped:
        print('dropped (no longer on the site):', ', '.join(dropped))


if __name__ == '__main__':
    sys.exit(main())
