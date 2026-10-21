"""Minimal .xlsx reader (standard library only): rows of one sheet as lists of strings."""
import re
import zipfile
import xml.etree.ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}


def _col(ref):
    n = 0
    for ch in re.match(r'[A-Z]+', ref).group():
        n = n * 26 + ord(ch) - 64
    return n - 1


def sheets(path):
    with zipfile.ZipFile(path) as z:
        wb = ET.fromstring(z.read('xl/workbook.xml'))
        rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
        target = {r.get('Id'): r.get('Target') for r in rels}
        return [(s.get('name'), 'xl/' + target[s.get('{%s}id' % NS['r'])].lstrip('/').removeprefix('xl/'))
                for s in wb.find('m:sheets', NS)]


def rows(path, sheet=None):
    with zipfile.ZipFile(path) as z:
        shared = []
        if 'xl/sharedStrings.xml' in z.namelist():
            for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS):
                shared.append(''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])))
        names = sheets(path)
        part = next(p for n, p in names if sheet in (None, n))
        out = []
        for row in ET.fromstring(z.read(part)).iter('{%s}row' % NS['m']):
            vals = {}
            for c in row.findall('m:c', NS):
                v = c.find('m:v', NS)
                if c.get('t') == 's' and v is not None:
                    val = shared[int(v.text)]
                elif c.get('t') == 'inlineStr':
                    val = ''.join(t.text or '' for t in c.iter('{%s}t' % NS['m']))
                else:
                    val = v.text if v is not None else ''
                vals[_col(c.get('r'))] = (val or '').strip()
            if vals:
                out.append([vals.get(i, '') for i in range(max(vals) + 1)])
        return out
