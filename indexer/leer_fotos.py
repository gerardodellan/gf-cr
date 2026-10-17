#!/usr/bin/env python3
"""Lee las fotos de etiqueta con un modelo de visión y guarda la transcripción.

Modelo por defecto: qwen/qwen3.7-flash por Alibaba, ganador de la comparación del 16-oct
(0 casos peligrosos, 96/100 mismo nivel, USD 0,29 por 1.000 productos). Proveedor fijo y
`allow_fallbacks: false`: la cuantización fp4 de otros proveedores falla en la letra chica.

Entrada: indexer/data/fotos/<ean>/*.jpg (los baja descargar_fotos.py).
Salida: indexer/data/lecturas-fotos.jsonl, append-only y reanudable (un producto ya leído no se repite).
La transcripción NO clasifica: la regla la aplica clasificar_ en construir_indice.js.

Uso: python3 indexer/leer_fotos.py [--n 100] [--paralelo 8] [--eans archivo] [--modelo m] [--proveedor p]
"""
import argparse
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
SALIDA = os.path.join(RAIZ, 'indexer/data/lecturas-fotos.jsonl')
REF_PILOTO = os.path.join(RAIZ, 'indexer/data/fotos-lecturas.json')

# Mismo prompt que la comparación de modelos (tests/comparar_modelos.py): los números medidos
# valen solo si el pedido es idéntico.
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
    im.thumbnail((1600, 1600))   # las de MaxiPalí son 1000x1000: el tope no las agranda. Mismo tamaño que la comparación
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
        'max_tokens': 6000,
        'temperature': 0,
        'reasoning': {'enabled': False},
        'provider': {'order': [proveedor], 'allow_fallbacks': False},
        'usage': {'include': True},
    }
    r = subprocess.run(['openrouter-call', 'chat'], input=json.dumps(pedido), capture_output=True, text=True)
    fila = {'ean': ean, 'fotos': len(fotos), 'modelo': modelo}
    try:
        d = json.loads(r.stdout)
    except json.JSONDecodeError:
        fila['error'] = (r.stderr or r.stdout)[:300]
        return fila
    u = d.get('usage') or {}
    fila.update({'segundos': d.get('_segundos'), 'proveedor': d.get('provider'), 'costo': u.get('cost'),
                 'tokens_in': u.get('prompt_tokens'), 'tokens_out': u.get('completion_tokens')})
    if d.get('error'):
        fila['error'] = str(d['error'])[:300]
        return fila
    texto = (d['choices'][0]['message'].get('content') or '').strip()
    # algunos modelos devuelven el JSON dentro de ```json ... ``` y a veces sin cerrar el bloque
    texto = re.sub(r'^```(?:json)?\s*', '', texto)
    texto = re.sub(r'\s*```$', '', texto).strip()
    m = re.search(r'\{.*\}', texto, re.S)
    try:
        fila['lectura'] = json.loads(m.group(0)) if m else None
    except json.JSONDecodeError:
        fila['lectura'] = None
    if not fila['lectura']:
        fila['error'] = 'sin JSON: ' + texto[:200]
    return fila


def ya_leidos(salida):
    hechos = set()
    if os.path.exists(salida):
        for l in open(salida, encoding='utf-8'):
            try:
                o = json.loads(l)
            except json.JSONDecodeError:
                continue
            if o.get('lectura'):
                hechos.add(o['ean'])
    if salida == SALIDA:
        try:   # el piloto del 16-oct ya tiene estos 100: no se vuelven a pagar
            for o in json.load(open(REF_PILOTO, encoding='utf-8')):
                hechos.add(o['ean'])
        except Exception:
            pass
    return hechos


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--modelo', default='qwen/qwen3.7-flash')
    ap.add_argument('--proveedor', default='Alibaba')
    ap.add_argument('--n', type=int, default=0, help='tope de productos (0 = sin tope)')
    ap.add_argument('--paralelo', type=int, default=8)
    ap.add_argument('--eans', help='archivo con un EAN por línea; sin esto, toda carpeta de fotos sin lectura')
    ap.add_argument('--salida', default=SALIDA, help='otro jsonl de salida (ej. la verificación de los B)')
    a = ap.parse_args()

    hechos = ya_leidos(a.salida)
    con_fotos = sorted(e for e in os.listdir(FOTOS) if os.path.isdir(os.path.join(FOTOS, e)))
    if a.eans:
        quiero = {l.strip() for l in open(a.eans) if l.strip()}
        con_fotos = [e for e in con_fotos if e in quiero]
    pendientes = [e for e in con_fotos if e not in hechos]
    if a.n:
        pendientes = pendientes[:a.n]
    print(f'a leer {len(pendientes)} productos · modelo {a.modelo} ({a.proveedor})', flush=True)
    costo, errores = 0.0, 0
    with open(a.salida, 'a', encoding='utf-8') as f, ThreadPoolExecutor(a.paralelo) as ex:
        for i, fila in enumerate(ex.map(lambda e: leer(e, a.modelo, a.proveedor), pendientes)):
            f.write(json.dumps(fila, ensure_ascii=False) + '\n')
            f.flush()
            costo += fila.get('costo') or 0
            if fila.get('error'):
                errores += 1
                print('ERROR', fila['ean'], fila['error'][:120], file=sys.stderr, flush=True)
            if (i + 1) % 25 == 0:
                print(f'{i + 1}/{len(pendientes)} · USD {costo:.4f} · errores {errores}', flush=True)
    print(f'listo · {len(pendientes)} productos · USD {costo:.4f} · errores {errores}')


if __name__ == '__main__':
    main()
