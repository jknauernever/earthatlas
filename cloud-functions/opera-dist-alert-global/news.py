"""News-correlation backend for the /forestmonitor popup.

Builds a query from the popup's diagnosis (cause + location + OPERA date)
and fetches matching news articles. Designed as an adapter layer so the
choice of search provider is a deploy-time decision (env var):

    NEWS_PROVIDER=tavily   → Tavily Search API (1k/mo free, has images)
    NEWS_PROVIDER=brave    → Brave Search News (2k/mo free, has images)
    NEWS_PROVIDER=gnews    → Google News RSS (no key needed, thumbnails spotty)

Default = gnews when no key is set; falls through to whichever adapter has
credentials. Every adapter returns the same article dict shape, so the
calling code (main.py) is unaware of which backend is active.

Article dict shape:
    {
        'title':          str,
        'source':         str,    # publisher name (e.g. 'Reuters')
        'url':            str,
        'image_url':      str | None,
        'snippet':        str | None,
        'published_date': str | None,   # ISO 'YYYY-MM-DD'
        'favicon_url':    str | None,   # for fallback when image_url is None
    }
"""
import hashlib
import json
import os
import re
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from xml.etree import ElementTree as ET


# ─── Cause → keyword mapping ────────────────────────────────────────────────
# Maps the cause-label phrasing produced by main.py's _infer_likely_cause
# to a list of search-keyword groups. Matched against the lowercased label
# in priority order; first match wins. Each group becomes an OR-clause in
# the search query.
CAUSE_KEYWORDS = [
    # Fire-family
    (('wildfire',),                 ['wildfire', 'forest fire', 'brush fire', 'bushfire']),
    (('grassland fire',),           ['grassland fire', 'wildfire', 'brush fire']),
    (('sugarcane', 'cane'),         ['sugarcane fire', 'cane burn', 'sugarcane harvest']),
    (('rice field burn', 'rice'),   ['rice stubble', 'paddy burn', 'rice field burn']),
    (('field burn', 'crop burn',
      'residue burn', 'managed burn'), ['field burn', 'crop residue burn', 'stubble burn']),
    (('structure fire', 'industrial incident'),
                                   ['structure fire', 'industrial fire', 'refinery fire']),
    (('fire',),                     ['fire', 'wildfire']),
    # Agricultural activity (non-fire)
    (('alfalfa', 'hay'),            ['hay harvest', 'alfalfa cut', 'forage harvest']),
    (('orchard removal', 'replanting'),
                                   ['orchard removal', 'orchard clearing', 'replanting']),
    (('orchard',),                  ['orchard']),
    (('harvest',),                  ['harvest', 'farm operations']),
    (('mechanical clearing',),      ['land clearing', 'mechanical clearing']),
    # Forest / corridor / natural
    (('logging', 'clearcut'),       ['logging', 'timber harvest', 'clearcut']),
    (('corridor', 'pipeline',
      'transmission'),              ['pipeline', 'transmission line', 'road construction']),
    (('natural cause', 'storm',
      'drought', 'insect',
      'natural disturbance'),       ['storm damage', 'tree mortality', 'beetle outbreak', 'drought']),
    (('agricultural activity',
      'field activity',
      'field operations'),          ['farm operations', 'agriculture']),
    # Built / construction
    (('construction', 'demolition'),
                                   ['construction', 'demolition', 'land clearing']),
]

# Default fallback when nothing in the label matches.
_DEFAULT_KEYWORDS = ['land use change', 'environment']


def _keywords_for_cause(cause_label: str | None) -> list:
    """Return the keyword group whose first matching token is found in the
    cause label (lowercased substring match). Falls back to a safe generic
    set when no match — never returns []."""
    if not cause_label:
        return _DEFAULT_KEYWORDS
    label = cause_label.lower()
    for triggers, keywords in CAUSE_KEYWORDS:
        if any(t in label for t in triggers):
            return keywords
    return _DEFAULT_KEYWORDS


# ─── Query builder ──────────────────────────────────────────────────────────

def _location_terms(named_fire: str | None, location: str | None) -> str:
    """Build the spatial part of the query. Named-fire (MTBS/NIFC) wins —
    those are the strongest possible search signals (the actual fire name).
    Otherwise use the admin location string from Mapbox geocoding."""
    if named_fire:
        # Quote so search engines treat it as a phrase. Strip "Fire" suffix
        # so it doesn't appear twice in the query.
        nm = named_fire.strip()
        if nm.lower().endswith(' fire'):
            return f'"{nm}"'
        return f'"{nm} Fire"'
    if location:
        # Use the first few admin components — full string can be too long
        # and exclude valid matches. Mapbox returns e.g.
        # "El Paso, Woodford County, Illinois, United States" — pick the
        # county + state for US, region + country elsewhere.
        parts = [p.strip() for p in location.split(',')]
        # Drop the country if present (too broad on its own).
        if len(parts) >= 3:
            parts = parts[:-1]
        return ' '.join(f'"{p}"' for p in parts[:3])
    return ''


def _build_query(cause: str | None, location: str | None, named_fire: str | None) -> str:
    """Compose the full search query string from cause + location."""
    kw = _keywords_for_cause(cause)
    kw_clause = '(' + ' OR '.join(f'"{k}"' for k in kw) + ')'
    loc_clause = _location_terms(named_fire, location)
    return f'{kw_clause} {loc_clause}'.strip()


def _date_window(opera_date_str: str | None, window_days: int) -> tuple:
    """Return (start_date, end_date) bracketing the OPERA detection by
    `window_days` on each side. Defaults to today ± window if opera_date
    is missing."""
    if opera_date_str:
        try:
            center = date.fromisoformat(opera_date_str)
        except ValueError:
            center = date.today()
    else:
        center = date.today()
    return (
        center - timedelta(days=window_days),
        center + timedelta(days=window_days),
    )


# ─── Provider adapters ──────────────────────────────────────────────────────

def _http_get_json(url: str, headers: dict | None = None, timeout: int = 12) -> dict:
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def _favicon_url_for(article_url: str) -> str | None:
    """Derive a favicon URL from an article URL using Google's S2 favicon
    service — never fails, always renders something for any domain."""
    try:
        host = urllib.parse.urlparse(article_url).netloc
        if not host:
            return None
        return f'https://www.google.com/s2/favicons?domain={host}&sz=64'
    except Exception:
        return None


def _publisher_from_url(article_url: str) -> str:
    """Cheap publisher-name extraction from URL. Used when the API doesn't
    return a clean source field. Strips www. and common TLDs."""
    try:
        host = urllib.parse.urlparse(article_url).netloc
        host = re.sub(r'^www\.', '', host)
        # Convert e.g. 'reuters.com' → 'Reuters'
        root = host.split('.')[0]
        return root.capitalize() if root else host
    except Exception:
        return 'Unknown source'


def _adapter_tavily(query: str, start: date, end: date, max_results: int) -> list:
    """Tavily Search API — https://tavily.com/. Needs TAVILY_API_KEY."""
    key = os.environ.get('TAVILY_API_KEY')
    if not key:
        return []
    body = json.dumps({
        'api_key': key,
        'query': query,
        'topic': 'news',
        'days': max((end - start).days, 1),
        'max_results': max_results,
        'include_images': True,
        'include_image_descriptions': False,
    }).encode('utf-8')
    req = urllib.request.Request(
        'https://api.tavily.com/search',
        data=body,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
    except Exception as e:
        print(f'Tavily search failed: {e}', flush=True)
        return []
    results = []
    for r in data.get('results', [])[:max_results]:
        results.append({
            'title':          r.get('title', ''),
            'source':         r.get('source') or _publisher_from_url(r.get('url', '')),
            'url':            r.get('url', ''),
            'image_url':      (r.get('images') or [None])[0] if r.get('images') else None,
            'snippet':        (r.get('content') or '')[:200],
            'published_date': r.get('published_date'),
            'favicon_url':    _favicon_url_for(r.get('url', '')),
        })
    return results


def _adapter_brave(query: str, start: date, end: date, max_results: int) -> list:
    """Brave Search News — https://api.search.brave.com/. Needs BRAVE_API_KEY."""
    key = os.environ.get('BRAVE_API_KEY')
    if not key:
        return []
    # Brave supports `freshness` only in coarse buckets (pd/pw/pm/py).
    span_days = (end - start).days
    if span_days <= 1:    freshness = 'pd'
    elif span_days <= 7:  freshness = 'pw'
    elif span_days <= 31: freshness = 'pm'
    else:                  freshness = 'py'
    qp = urllib.parse.urlencode({
        'q': query, 'count': max_results, 'freshness': freshness,
        'safesearch': 'moderate', 'spellcheck': '1',
    })
    url = f'https://api.search.brave.com/res/v1/news/search?{qp}'
    try:
        data = _http_get_json(url, headers={
            'X-Subscription-Token': key,
            'Accept': 'application/json',
        })
    except Exception as e:
        print(f'Brave search failed: {e}', flush=True)
        return []
    results = []
    for r in (data.get('results') or [])[:max_results]:
        thumb = (r.get('thumbnail') or {}).get('src')
        page_age = r.get('page_age')  # ISO datetime
        pub_date = page_age[:10] if page_age else None
        results.append({
            'title':          r.get('title', ''),
            'source':         (r.get('meta_url') or {}).get('hostname') or _publisher_from_url(r.get('url', '')),
            'url':            r.get('url', ''),
            'image_url':      thumb,
            'snippet':        r.get('description'),
            'published_date': pub_date,
            'favicon_url':    _favicon_url_for(r.get('url', '')),
        })
    return results


def _adapter_gnews_rss(query: str, start: date, end: date, max_results: int) -> list:
    """Google News RSS feed. No key needed. Thumbnails not reliably
    returned — frontend should gracefully fall back to favicon."""
    # Google News RSS supports date filtering via `after:` and `before:`
    # within the query string.
    full_q = f'{query} after:{start.isoformat()} before:{end.isoformat()}'
    qp = urllib.parse.urlencode({'q': full_q, 'hl': 'en-US', 'gl': 'US', 'ceid': 'US:en'})
    url = f'https://news.google.com/rss/search?{qp}'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'EarthAtlas/1.0'})
        with urllib.request.urlopen(req, timeout=12) as resp:
            xml = resp.read()
    except Exception as e:
        print(f'GNews RSS failed: {e}', flush=True)
        return []
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as e:
        print(f'GNews RSS parse failed: {e}', flush=True)
        return []
    results = []
    for item in root.findall('.//item')[:max_results]:
        link = item.findtext('link') or ''
        title_raw = item.findtext('title') or ''
        # GNews titles end with " - Publisher Name" — split that off.
        if ' - ' in title_raw:
            title, source = title_raw.rsplit(' - ', 1)
        else:
            title, source = title_raw, _publisher_from_url(link)
        # pubDate is RFC 2822 — convert to ISO YYYY-MM-DD
        pub_iso = None
        pub_raw = item.findtext('pubDate')
        if pub_raw:
            try:
                from email.utils import parsedate_to_datetime
                pub_iso = parsedate_to_datetime(pub_raw).date().isoformat()
            except Exception:
                pass
        # Snippet from description — strip HTML tags
        desc = item.findtext('description') or ''
        snippet = re.sub(r'<[^>]+>', '', desc).strip()[:200] if desc else None
        results.append({
            'title':          title.strip(),
            'source':         source.strip(),
            'url':            link,
            'image_url':      None,   # RSS doesn't carry reliable thumbnails
            'snippet':        snippet,
            'published_date': pub_iso,
            'favicon_url':    _favicon_url_for(link),
        })
    return results


_ADAPTERS = {
    'tavily': _adapter_tavily,
    'brave':  _adapter_brave,
    'gnews':  _adapter_gnews_rss,
}


def _pick_provider() -> str:
    """Pick the active provider — env override beats auto-detection of
    available keys; falls back to gnews (zero setup) when nothing else
    is configured."""
    explicit = os.environ.get('NEWS_PROVIDER', '').lower().strip()
    if explicit in _ADAPTERS:
        return explicit
    if os.environ.get('TAVILY_API_KEY'):
        return 'tavily'
    if os.environ.get('BRAVE_API_KEY'):
        return 'brave'
    return 'gnews'


# ─── In-process cache ──────────────────────────────────────────────────────
# Same shape as the NASS cache — module-level dict, warm-instance reuse
# only. Keyed by query+date hash. Cache lifetime = 12 hours.

_NEWS_CACHE: dict = {}
_NEWS_CACHE_MAX = 256
_CACHE_TTL_SEC = 12 * 3600


def _cache_key(query: str, start: date, end: date, provider: str) -> str:
    h = hashlib.sha1(
        f'{provider}|{query}|{start.isoformat()}|{end.isoformat()}'.encode('utf-8'),
    ).hexdigest()
    return h


def _cache_get(key: str):
    entry = _NEWS_CACHE.get(key)
    if not entry:
        return None
    if (datetime.now(tz=timezone.utc) - entry['stored_at']).total_seconds() > _CACHE_TTL_SEC:
        _NEWS_CACHE.pop(key, None)
        return None
    return entry['data']


def _cache_set(key: str, data: list):
    if len(_NEWS_CACHE) >= _NEWS_CACHE_MAX:
        _NEWS_CACHE.pop(next(iter(_NEWS_CACHE)))
    _NEWS_CACHE[key] = {
        'data':      data,
        'stored_at': datetime.now(tz=timezone.utc),
    }


# ─── Public API ────────────────────────────────────────────────────────────

def fetch_news(
    cause: str | None,
    location: str | None,
    named_fire: str | None,
    opera_date: str | None,
    window_days: int = 14,
    max_results: int = 8,
) -> dict:
    """Top-level call — builds query, picks provider, returns results +
    metadata for the frontend. Shape:
        {
            'query':    final search string,
            'provider': 'tavily' | 'brave' | 'gnews',
            'window':   {'start': 'YYYY-MM-DD', 'end': 'YYYY-MM-DD'},
            'articles': [ {title, source, url, ...}, ... ],
        }
    """
    start, end = _date_window(opera_date, window_days)
    query = _build_query(cause, location, named_fire)
    provider = _pick_provider()
    cache_key = _cache_key(query, start, end, provider)
    cached = _cache_get(cache_key)
    if cached is not None:
        return {
            'query': query, 'provider': provider,
            'window': {'start': start.isoformat(), 'end': end.isoformat()},
            'articles': cached, 'cached': True,
        }
    adapter = _ADAPTERS.get(provider, _adapter_gnews_rss)
    articles = adapter(query, start, end, max_results) or []
    _cache_set(cache_key, articles)
    return {
        'query': query, 'provider': provider,
        'window': {'start': start.isoformat(), 'end': end.isoformat()},
        'articles': articles, 'cached': False,
    }
