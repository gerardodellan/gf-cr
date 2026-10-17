#!/usr/bin/env python3
"""Baja la galería de fotos de MaxiPalí a indexer/data/fotos/<ean>/NN.jpg.

Las URLs vienen de crudo.jsonl (campo `imagenes`, que llena crawl_maxipali.py). La URL sin sufijo
de tamaño trae el original: 1000x1000, byte por byte igual a las fotos del piloto (md5 verificado
el 16-oct). Reanudable: una carpeta que ya tiene fotos no se vuelve a bajar.

Uso: python3 indexer/descargar_fotos.py [--eans archivo] [--n 100] [--paralelo 4]
"""
import argparse
import json
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CRUDO = os.path.join(RAIZ, 'indexer/data/crudo.jsonl')
FOTOS = os.path.join(RAIZ, 'indexer/data/fotos')
UA = {'User-Agent': 'GF-CR indexador (gerry.dellan@gmail.com)'}
MAX_FOTOS = 10   # galerías largas son variantes de sabor: las primeras traen frente y dorso


def bajar(url, destino):
    for intento in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                datos = r.read()
            if len(datos) < 2000:
                return False   # placeholder de VTEX
            with open(destino, 'wb') as f:
                f.write(datos)
            return True
        except Exception as e:
            print('reintento', intento + 1, url[:80], e, file=sys.stderr)
            time.sleep(2 * (intento + 1))
    return False


def producto(x):
    carpeta = os.path.join(FOTOS, x['ean'])
    if os.path.isdir(carpeta) and any(f.endswith('.jpg') for f in os.listdir(carpeta)):
        return 0   # ya está
    urls = x.get('imagenes') or []
    if not urls:
        return 0
    os.makedirs(carpeta, exist_ok=True)
    n = 0
    for i, u in enumerate(urls[:MAX_FOTOS]):
        if bajar(u, os.path.join(carpeta, f'{i:02d}.jpg')):
            n += 1
        time.sleep(0.25)
    if not n:
        os.rmdir(carpeta)
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--eans', help='archivo con un EAN por línea; sin esto, todo el crudo')
    ap.add_argument('--n', type=int, default=0, help='tope de productos (0 = sin tope)')
    ap.add_argument('--paralelo', type=int, default=4)
    a = ap.parse_args()

    crudo = [json.loads(l) for l in open(CRUDO, encoding='utf-8') if l.strip()]
    if a.eans:
        quiero = {l.strip() for l in open(a.eans) if l.strip()}
        crudo = [x for x in crudo if x['ean'] in quiero]
    pendientes = [x for x in crudo if not os.path.isdir(os.path.join(FOTOS, x['ean']))]
    if a.n:
        pendientes = pendientes[:a.n]
    print(f'productos a bajar {len(pendientes)}', flush=True)
    total = 0
    with ThreadPoolExecutor(a.paralelo) as ex:
        for i, n in enumerate(ex.map(producto, pendientes)):
            total += n
            if (i + 1) % 25 == 0:
                print(f'{i + 1}/{len(pendientes)} · {total} fotos', flush=True)
    print(f'listo · {total} fotos nuevas')


if __name__ == '__main__':
    main()
