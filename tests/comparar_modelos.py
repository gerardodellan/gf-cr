#!/usr/bin/env python3
"""Compara modelos leyendo las fotos de etiqueta del piloto (100 productos, indexer/data/fotos/).

Cada modelo recibe todas las fotos de un producto en UNA llamada y devuelve lo mismo que la referencia
(indexer/data/fotos-lecturas.json): encontrado, ingredientes, alergenos, legibilidad, nota.
La llamada pasa por `openrouter-call` (la clave nunca toca este script).

Uso: [RAZON=low] python3 tests/comparar_modelos.py <etiqueta> <modelo> <proveedor> [n_productos] [paralelo]
Salida: tests/data/modelos/<etiqueta>.jsonl (una línea por producto; se reanuda si se corta)
Puntaje: node tests/puntuar_modelos.js
"""
import base64
import io
import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FOTOS = os.path.join(RAIZ, 'indexer/data/fotos')
REF = os.path.join(RAIZ, 'indexer/data/fotos-lecturas.json')
SALIDA = os.path.join(RAIZ, 'tests/data/modelos')

PROMPT = """Estas son fotos del empaque de UN producto de supermercado de Costa Rica (puede haber fotos del frente, dorso y costados).
Transcribí, tal como aparece en el empaque y en su idioma original:
- "ingredientes": la lista de ingredientes completa. Vacío si no se ve en ninguna foto.
- "alergenos": toda declaración de alérgenos o gluten: "Contiene: …", "Puede contener …", "trazas", "fabricado en planta/equipo que procesa …", "sin gluten", "libre de gluten", sellos. Vacío si no hay.
- "legibilidad": "completa" si leíste la lista de ingredientes entera; "parcial" si está cortada, borrosa o tapada; "ninguna" si no aparece.
- "encontrado": true si encontraste la lista de ingredientes.
- "nota": una frase corta (en qué foto está, qué no se pudo leer).
No inventes ni completes texto que no se lee. Respondé SOLO con un objeto JSON con esas cinco claves."""


def foto_b64(ruta):
    im = Image.open(ruta).convert('RGB')
    im.thumbnail((1600, 1600))
    buf = io.BytesIO()
    im.save(buf, 'JPEG', quality=88)
    return 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()


def leer(ean, modelo, proveedor):
    carpeta = os.path.join(FOTOS, ean)
    fotos = sorted(f for f in os.listdir(carpeta) if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')))
    contenido = [{'type': 'text', 'text': PROMPT}] + [
        {'type': 'image_url', 'image_url': {'url': foto_b64(os.path.join(carpeta, f))}} for f in fotos]
    pedido = {
        'model': modelo,
        'messages': [{'role': 'user', 'content': contenido}],
        'max_tokens': 3000,
        'temperature': 0,
        # RAZON=low para modelos que exigen razonamiento (GLM); por defecto apagado: más rápido y barato
        'reasoning': {'effort': os.environ['RAZON']} if os.environ.get('RAZON') else {'enabled': False},
        'provider': {'order': [proveedor], 'allow_fallbacks': False},
        'usage': {'include': True},
    }
    r = subprocess.run(['openrouter-call', 'chat'], input=json.dumps(pedido), capture_output=True, text=True)
    try:
        d = json.loads(r.stdout)
    except json.JSONDecodeError:
        return {'ean': ean, 'error': (r.stderr or r.stdout)[:500]}
    fila = {'ean': ean, 'fotos': len(fotos), 'segundos': d.get('_segundos'), 'proveedor': d.get('provider'),
            'costo': (d.get('usage') or {}).get('cost'), 'tokens_in': (d.get('usage') or {}).get('prompt_tokens'),
            'tokens_out': (d.get('usage') or {}).get('completion_tokens')}
    if d.get('error'):
        fila['error'] = str(d['error'])[:500]
        return fila
    texto = (d['choices'][0]['message'].get('content') or '').strip()
    m = re.search(r'\{.*\}', texto, re.S)
    try:
        fila['lectura'] = json.loads(m.group(0)) if m else None
    except json.JSONDecodeError:
        fila['lectura'] = None
    if not fila['lectura']:
        fila['error'] = 'sin JSON: ' + texto[:300]
    return fila


def main():
    etiqueta, modelo, proveedor = sys.argv[1:4]
    n = int(sys.argv[4]) if len(sys.argv) > 4 else 100
    paralelo = int(sys.argv[5]) if len(sys.argv) > 5 else 8
    eans = [o['ean'] for o in json.load(open(REF))][:n]
    os.makedirs(SALIDA, exist_ok=True)
    archivo = os.path.join(SALIDA, etiqueta + '.jsonl')
    hechos = set()
    if os.path.exists(archivo):
        for l in open(archivo):
            o = json.loads(l)
            if 'lectura' in o and o.get('lectura'):
                hechos.add(o['ean'])
    pendientes = [e for e in eans if e not in hechos and os.path.isdir(os.path.join(FOTOS, e))]
    with open(archivo, 'a') as f, ThreadPoolExecutor(paralelo) as ex:
        for fila in ex.map(lambda e: leer(e, modelo, proveedor), pendientes):
            fila['modelo'] = modelo
            f.write(json.dumps(fila, ensure_ascii=False) + '\n')
            f.flush()
            print(fila['ean'], fila.get('segundos'), fila.get('proveedor'), fila.get('costo'), fila.get('error', '')[:80], flush=True)


if __name__ == '__main__':
    main()
