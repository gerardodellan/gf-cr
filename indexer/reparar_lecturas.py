#!/usr/bin/env python3
"""Borra de lecturas-fotos.jsonl las lecturas hechas con la carpeta a medio bajar.

La descarga y la lectura corrieron a la vez: un producto pudo leerse con 2 de 5 fotos y sin el dorso.
Cada fila guarda cuántas fotos vio (`fotos`); si en disco hay más, la lectura se descarta y
leer_fotos.py la vuelve a hacer. Sin argumentos solo informa; con --aplicar reescribe el archivo.
"""
import json
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FOTOS = os.path.join(RAIZ, 'indexer/data/fotos')
ARCH = os.path.join(RAIZ, 'indexer/data/lecturas-fotos.jsonl')

filas = [json.loads(l) for l in open(ARCH, encoding='utf-8') if l.strip()]
malas, buenas = [], []
for f in filas:
    carpeta = os.path.join(FOTOS, f['ean'])
    en_disco = len([x for x in os.listdir(carpeta) if x.lower().endswith('.jpg')]) if os.path.isdir(carpeta) else 0
    (malas if en_disco > (f.get('fotos') or 0) else buenas).append(f)
print(f'filas {len(filas)} · incompletas {len(malas)}')
for f in malas[:10]:
    print('  ', f['ean'], 'leyó', f.get('fotos'), 'hay', len(os.listdir(os.path.join(FOTOS, f['ean']))))
if '--aplicar' in sys.argv and malas:
    with open(ARCH, 'w', encoding='utf-8') as h:
        for f in buenas:
            h.write(json.dumps(f, ensure_ascii=False) + '\n')
    print(f'reescrito: quedan {len(buenas)}; {len(malas)} se vuelven a leer')
