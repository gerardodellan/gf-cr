"""Exporta de Auto Mercado (Algolia, key PÚBLICA de búsqueda que la web inyecta en su HTML) los productos con
ingredientes -> indexer/data/automercado.jsonl. No trae código de barras: se cruza por marca + nombre."""
import json, os, re, sys, time, urllib.request

APP, IDX = 'FU5XFX7KNL', 'Product_CatalogueV2'

def clave():
    # la key puede rotar: se relee del HTML (bloque client_keys); si no aparece, la última conocida (16-oct)
    try:
        html = urllib.request.urlopen(urllib.request.Request('https://automercado.cr/', headers={'User-Agent': 'Mozilla/5.0'}), timeout=30).read().decode('utf8', 'ignore')
        m = re.search(r'([0-9a-f]{32})', html[html.find('client_keys'):html.find('client_keys') + 2000]) if 'client_keys' in html else None
        if m: return m.group(1)
    except Exception as e:
        print('aviso: no leí la key del HTML', e, file=sys.stderr)
    return '335287091ff4a66858e0ad021ca45b76'

KEY = clave()

def q(params):
    req = urllib.request.Request(f'https://{APP}-dsn.algolia.net/1/indexes/{IDX}/query', method='POST',
        data=json.dumps({'params': params}).encode(),
        headers={'X-Algolia-Application-Id': APP, 'X-Algolia-API-Key': KEY, 'Content-Type': 'application/json'})
    for intento in range(3):
        try:
            with urllib.request.urlopen(req, timeout=40) as r: return json.loads(r.read())
        except Exception as e:
            print('reintento', e, file=sys.stderr); time.sleep(5 * (intento + 1))
    return None

def main():
    from urllib.parse import quote
    facetas = q('query=&hitsPerPage=0&facets=["catecom"]&maxValuesPerFacet=1000')['facets']['catecom']
    D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data'); os.makedirs(D, exist_ok=True)
    tmp = os.path.join(D, 'automercado.jsonl.tmp'); vistos = set(); n = 0
    attrs = 'productNumber,marca,ecomDescription,productPresentation,especialIngredientes,especialAlergenos,lfGlutemFree,catecom'
    with open(tmp, 'w', encoding='utf8') as f:
        for cat in facetas:
            r = q(f'query=&hitsPerPage=1000&facetFilters={quote(json.dumps([["catecom:" + cat]]))}&attributesToRetrieve={attrs}')
            time.sleep(0.5)
            for h in (r or {}).get('hits', []):
                pn = h.get('productNumber')
                if pn in vistos or not (h.get('especialIngredientes') or h.get('especialAlergenos')): continue
                vistos.add(pn); n += 1
                f.write(json.dumps({'id': pn, 'marca': h.get('marca') or '', 'nombre': h.get('ecomDescription') or '',
                                    'presentacion': h.get('productPresentation') or '', 'ingredientes': h.get('especialIngredientes') or '',
                                    'alergenos': h.get('especialAlergenos') or '', 'gf': h.get('lfGlutemFree'), 'cat': cat}, ensure_ascii=False) + '\n')
    os.replace(tmp, os.path.join(D, 'automercado.jsonl'))
    print(f'Auto Mercado: {n} productos con ingredientes ({len(facetas)} categorías)')

if __name__ == '__main__':
    main()
