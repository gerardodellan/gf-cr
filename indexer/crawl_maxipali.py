"""Recorre las categorías de ALIMENTOS de MaxiPalí (VTEX público) y guarda el crudo en indexer/data/crudo.jsonl.
Solo alimentos: hogar, limpieza, higiene, ropa, electrónica, mascotas, autos quedan fuera. ≈1 petición/s."""
import gzip, json, os, sys, time, urllib.request

H = 'https://www.maxipali.co.cr'
# departamentos de alimentos (árbol /api/catalog_system/pub/category/tree, 16-oct-2026)
DEPTOS = [1, 2, 3, 9, 10, 11, 15, 16, 952, 953, 954, 955, 957, 958]
SUBCATS_SUELTAS = {8: [67], 14: [852]}   # Bebés: comida; Farmacia: nutrición deportiva
UA = {'User-Agent': 'GF-CR indexador (gerry.dellan@gmail.com)', 'Accept-Encoding': 'gzip'}

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
        b = r.read()
        return json.loads(gzip.decompress(b) if r.headers.get('Content-Encoding') == 'gzip' else b)

def rutas():
    arbol = {d['id']: d for d in get(f'{H}/api/catalog_system/pub/category/tree/2?sc=3')}
    out = []
    for dep in DEPTOS:
        d = arbol.get(dep)
        if not d: continue
        hijos = d.get('children') or []
        out += [f'/{dep}/{c["id"]}/' for c in hijos] or [f'/{dep}/']
    for dep, subs in SUBCATS_SUELTAS.items():
        out += [f'/{dep}/{s}/' for s in subs]
    return out

def campo(p, k):
    v = p.get(k)
    return '; '.join(v) if isinstance(v, list) else (v or '')

def main():
    D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
    os.makedirs(D, exist_ok=True)
    tmp = os.path.join(D, 'crudo.jsonl.tmp')
    vistos, errores = set(), 0
    with open(tmp, 'w', encoding='utf-8') as f:
        for ruta in rutas():
            desde = 0
            while desde < 2500:   # tope de VTEX por consulta
                prods = None
                for intento in range(4):   # MaxiPalí devuelve 500 sueltos: se reintenta con espera creciente
                    try:
                        prods = get(f'{H}/api/catalog_system/pub/products/search?fq=C:{ruta}&_from={desde}&_to={desde + 49}&sc=3')
                        break
                    except Exception as e:
                        print('reintento', intento + 1, ruta, desde, e, file=sys.stderr); time.sleep(5 * (intento + 1))
                if prods is None:
                    errores += 1; break
                time.sleep(1)
                for p in prods:
                    for it in p.get('items', []):
                        ean = (it.get('ean') or '').strip()
                        if not ean.isdigit() or ean in vistos: continue
                        vistos.add(ean)
                        # URLs de la galería del producto: las usa descargar_fotos.py. La URL sin sufijo de
                        # tamaño trae el original (1000x1000, medido 16-oct); el sufijo -1600-1600 solo escala.
                        imgs = [i['imageUrl'] for i in (it.get('images') or []) if i.get('imageUrl')]
                        f.write(json.dumps({'ean': ean, 'nombre': p.get('productName', ''), 'marca': p.get('brand', ''),
                                            'categoria': ruta, 'ingredientes': campo(p, 'Listado de ingredientes'),
                                            'alergenos': campo(p, 'Productos alérgenos'),
                                            'imagenes': imgs}, ensure_ascii=False) + '\n')
                if len(prods) < 50: break
                desde += 50
    os.replace(tmp, os.path.join(D, 'crudo.jsonl'))
    print(f'productos {len(vistos)} · errores {errores}')
    if errores > 10: sys.exit(1)

if __name__ == '__main__':
    main()
