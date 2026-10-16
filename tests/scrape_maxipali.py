"""Base de prueba: productos reales de MaxiPalí (VTEX público, sin login).
Salida: tests/data/maxipali.jsonl (fuera de git: datos de terceros, uso privado de prueba).
Uso: python3 tests/scrape_maxipali.py   (≈1 petición/s)"""
import json, time, urllib.parse, urllib.request, gzip, os

BASE = 'https://www.maxipali.co.cr/api/catalog_system/pub/products/search/{}?_from={}&_to={}&sc=3'
TERMINOS = [
    # alto riesgo de gluten
    'pan', 'pan cuadrado', 'galleta', 'pasta', 'espagueti', 'fideos', 'harina', 'cereal', 'avena', 'granola',
    'cerveza', 'malta', 'tortilla', 'empanizador', 'pan rallado', 'queque', 'pizza', 'sopa', 'consome', 'salsa de soya',
    'salsa inglesa', 'aderezo', 'embutido', 'salchicha', 'jamon', 'nuggets', 'snack', 'papas tostadas', 'barra cereal',
    'chocolate', 'confite', 'helado', 'yogurt', 'natilla', 'mayonesa', 'salsa', 'condimento', 'cubito', 'bebida avena',
    # verdes esperados / controles
    'sin gluten', 'gluten free', 'arroz', 'frijoles', 'maiz', 'harina de maiz', 'tostadas maiz', 'azucar', 'cafe', 'leche', 'queso',
]
UA = {'User-Agent': 'Mozilla/5.0 (GF-CR pruebas; gerry.dellan@gmail.com)', 'Accept-Encoding': 'gzip'}

def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read()
        if r.headers.get('Content-Encoding') == 'gzip':
            data = gzip.decompress(data)
    return json.loads(data)

def campo(p, k):
    v = p.get(k)
    return '; '.join(v) if isinstance(v, list) else (v or '')

def main():
    out = os.path.join(os.path.dirname(__file__), 'data', 'maxipali.jsonl')
    vistos, n = set(), 0
    with open(out, 'w', encoding='utf-8') as f:
        for t in TERMINOS:
            for desde in (0, 50):
                try:
                    prods = get(BASE.format(urllib.parse.quote(t), desde, desde + 49))
                except Exception as e:
                    print('error', t, desde, e); time.sleep(3); continue
                time.sleep(1)
                for p in prods:
                    for it in p.get('items', []):
                        ean = (it.get('ean') or '').strip()
                        if not ean.isdigit() or ean in vistos:
                            continue
                        vistos.add(ean)
                        f.write(json.dumps({
                            'ean': ean, 'nombre': p.get('productName', ''), 'marca': p.get('brand', ''),
                            'categoria': (p.get('categories') or [''])[0], 'termino': t,
                            'ingredientes': campo(p, 'Listado de ingredientes'),
                            'alergenos': campo(p, 'Productos alérgenos'),
                            'contiene_alergenos': campo(p, 'Contiene Alérgenos'),
                            'libre_gluten_tienda': campo(p, 'Artículo Libre Gluten'),
                            'pais': campo(p, 'País de Origen - Ensamblaje') or campo(p, 'Origen del Producto ( país)'),
                        }, ensure_ascii=False) + '\n')
                        n += 1
                if len(prods) < 50:
                    break
            print(f'{t}: {n} acumulados', flush=True)
    print('total', n, '->', out)

if __name__ == '__main__':
    main()
