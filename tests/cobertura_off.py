"""Cobertura de Open Food Facts sobre la base de prueba. Salida: tests/data/off.jsonl (≈1 consulta/s)."""
import json, os, time, urllib.request
D = os.path.join(os.path.dirname(__file__), 'data')
CAMPOS = 'code,product_name,brands,lang,ingredients_text_es,ingredients_text_en,ingredients_text,ingredients_tags,allergens_tags,traces_tags,labels_tags'
UA = {'User-Agent': 'GF-CR/0.1 (gerry.dellan@gmail.com)'}
hechos = set()
salida = os.path.join(D, 'off.jsonl')
if os.path.exists(salida):
    hechos = {json.loads(l)['ean'] for l in open(salida)}
with open(salida, 'a', encoding='utf-8') as f:
    for l in open(os.path.join(D, 'maxipali.jsonl')):
        ean = json.loads(l)['ean']
        if ean in hechos: continue
        url = f'https://world.openfoodfacts.org/api/v2/product/{ean}.json?fields={CAMPOS}'
        for intento in range(3):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                    j = json.loads(r.read()); http = r.status
                break
            except urllib.error.HTTPError as e:
                http = e.code; j = {}
                if e.code == 404: break
                time.sleep(20)
            except Exception:
                http = 0; j = {}; time.sleep(10)
        f.write(json.dumps({'ean': ean, 'http': http, 'encontrado': j.get('status') == 1, 'producto': j.get('product')}, ensure_ascii=False) + '\n')
        f.flush()
        time.sleep(1)
print('listo')
