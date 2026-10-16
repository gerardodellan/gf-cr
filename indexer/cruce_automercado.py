"""Cruza los alimentos de MaxiPalí SIN ingredientes contra Auto Mercado (marca + tamaño + nombre).
Salida: indexer/data/cruce.jsonl {ean, am, score, texto}. Conservador: ante duda, no cruza."""
import json, os, re, unicodedata, collections
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')

def plano(s): return unicodedata.normalize('NFD', (s or '').lower()).encode('ascii', 'ignore').decode()
STOP = set('de con sin y en el la los las para tipo sabor paquete bolsa caja botella lata frasco unidad unidades uds und pack gr g kg ml l lt oz'.split())

def tamano(s):
    s = plano(s).replace(',', '.')
    m = re.search(r'(\d+(?:\.\d+)?)\s*(kg|kgs|g|gr|grs|gramos|ml|l|lt|litro|litros|oz)\b', s)
    if not m: return None
    v, u = float(m.group(1)), m.group(2)
    if u in ('kg', 'kgs'): v, u = v * 1000, 'g'
    elif u in ('l', 'lt', 'litro', 'litros'): v, u = v * 1000, 'ml'
    elif u == 'oz': v, u = v * 28.35, 'g'
    else: u = 'ml' if u == 'ml' else 'g'
    return (round(v), u)

def tokens(s, marca):
    t = re.findall(r'[a-z]+', plano(s))
    mt = set(re.findall(r'[a-z]+', plano(marca)))
    return {w for w in t if len(w) > 2 and w not in STOP and w not in mt}

def misma_marca(a, b):
    a, b = plano(a).replace(' ', ''), plano(b).replace(' ', '')
    return bool(a) and bool(b) and (a in b or b in a)

def main():
    mp = [json.loads(l) for l in open(os.path.join(D, 'crudo.jsonl'))]
    sin = [x for x in mp if not x['ingredientes'].strip()]
    am = [json.loads(l) for l in open(os.path.join(D, 'automercado.jsonl'))]
    por_tam = collections.defaultdict(list)
    for a in am:
        tz = tamano(a['nombre'] + ' ' + a['presentacion'])
        if tz: por_tam[tz].append(a)
    out, amb = [], 0
    for x in sin:
        tz = tamano(x['nombre'])
        if not tz: continue
        tx = tokens(x['nombre'], x['marca'])
        cands = []
        for a in por_tam.get(tz, []):
            marca_ok = misma_marca(x['marca'], a['marca']) or plano(a['marca']) in plano(x['nombre'])
            if not marca_ok: continue
            ta = tokens(a['nombre'], a['marca'])
            if not tx or not ta: continue
            j = len(tx & ta) / len(tx | ta)
            cands.append((j, a))
        # los números que no son el tamaño distinguen variantes ("7 años" vs "N12"): tienen que coincidir
        def nums(s): return set(re.findall(r'\d+', re.sub(r'\d+(?:[.,]\d+)?\s*(kg|kgs|g|gr|grs|gramos|ml|l|lt|oz)\b', ' ', plano(s))))
        nx = nums(x['nombre'])
        cands = [c for c in cands if nums(c[1]['nombre']) == nx]
        cands.sort(key=lambda c: -c[0])
        if not cands or cands[0][0] < 0.6: continue
        if len(cands) > 1 and cands[1][0] >= cands[0][0] - 0.1 and cands[1][1]['ingredientes'] != cands[0][1]['ingredientes']:
            amb += 1; continue
        j, a = cands[0]
        texto = a['ingredientes'].strip()
        if a['alergenos'].strip(): texto += ('. ' if texto else '') + 'Alérgenos: ' + a['alergenos'].strip()
        out.append({'ean': x['ean'], 'mp': x['nombre'], 'am': a['nombre'], 'am_id': a['id'], 'score': round(j, 2), 'texto': texto})
    with open(os.path.join(D, 'cruce.jsonl'), 'w', encoding='utf8') as f:
        for o in out: f.write(json.dumps(o, ensure_ascii=False) + '\n')
    print(f'MaxiPalí sin ingredientes: {len(sin)} · cruzados: {len(out)} · descartados por ambiguos: {amb}')

if __name__ == '__main__':
    main()
