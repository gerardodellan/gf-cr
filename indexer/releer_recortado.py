#!/usr/bin/env python3
"""Relee las fotos recortando el empaque, para los productos donde la etiqueta no se leyó.

Las fotos del catálogo son 1000x1000 con el producto sobre fondo blanco: un envoltorio alargado
puede ocupar una franja y el resto es blanco. Al recortar el contenido y escalar al tope de 1600 px,
el texto llega al modelo con más píxeles sin pagar más tokens. Técnica del cookbook de zoom de
Claude anotado en 04-Aprendizaje/base-links.md (24-jul).

Salida: indexer/data/lecturas-recorte.jsonl (mismo formato que leer_fotos.py).
Uso: python3 indexer/releer_recortado.py --n 50 [--paralelo 8]
"""
import argparse
import json
import os
import subprocess
import sys

from PIL import Image, ImageChops, ImageOps

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, 'indexer'))
import leer_fotos as LF   # reusa PROMPT, foto_b64 y el parseo

FOTOS = os.path.join(RAIZ, 'indexer/data/fotos')
SALIDA = os.path.join(RAIZ, 'indexer/data/lecturas-recorte.jsonl')
RECORTES = os.path.join(RAIZ, 'indexer/data/fotos-recorte')


def recortar(origen, destino):
    """Recorta el fondo blanco y escala a 1600 px de lado mayor. False si no hay nada que ganar."""
    im = Image.open(origen).convert('RGB')
    fondo = Image.new('RGB', im.size, (255, 255, 255))
    caja = ImageChops.difference(im, fondo).convert('L').point(lambda p: 255 if p > 12 else 0).getbbox()
    if not caja:
        return False
    ancho, alto = caja[2] - caja[0], caja[3] - caja[1]
    if ancho * alto > 0.72 * im.size[0] * im.size[1]:
        return False   # el producto ya llena el cuadro: recortar no agrega píxeles
    margen = 8
    caja = (max(0, caja[0] - margen), max(0, caja[1] - margen),
            min(im.size[0], caja[2] + margen), min(im.size[1], caja[3] + margen))
    im = im.crop(caja)
    escala = 1600 / max(im.size)
    if escala > 1:
        im = im.resize((int(im.size[0] * escala), int(im.size[1] * escala)), Image.LANCZOS)
    im.save(destino, 'JPEG', quality=90)
    return True


def preparar(ean):
    orig = os.path.join(FOTOS, ean)
    dest = os.path.join(RECORTES, ean)
    os.makedirs(dest, exist_ok=True)
    n = 0
    for f in sorted(os.listdir(orig)):
        if not f.lower().endswith('.jpg'):
            continue
        if recortar(os.path.join(orig, f), os.path.join(dest, f)):
            n += 1
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--n', type=int, default=50)
    ap.add_argument('--paralelo', type=int, default=8)
    ap.add_argument('--modelo', default='qwen/qwen3.7-flash')
    ap.add_argument('--proveedor', default='Alibaba')
    a = ap.parse_args()

    # candidatos: la lectura normal no encontró la etiqueta
    sin = []
    for l in open(os.path.join(RAIZ, 'indexer/data/lecturas-fotos.jsonl'), encoding='utf-8'):
        o = json.loads(l)
        r = o.get('lectura')
        if r and not r.get('encontrado') and r.get('legibilidad') == 'ninguna':
            sin.append(o['ean'])
    hechos = LF.ya_leidos(SALIDA)
    sin = [e for e in sin if e not in hechos][:a.n]
    os.makedirs(RECORTES, exist_ok=True)
    utiles = [e for e in sin if preparar(e)]
    print(f'candidatos {len(sin)} · con recorte que agrega píxeles {len(utiles)}', flush=True)

    LF.FOTOS = RECORTES   # leer() lee de la carpeta de recortes
    costo, recuperados = 0.0, 0
    from concurrent.futures import ThreadPoolExecutor
    with open(SALIDA, 'a', encoding='utf-8') as f, ThreadPoolExecutor(a.paralelo) as ex:
        for fila in ex.map(lambda e: LF.leer(e, a.modelo, a.proveedor), utiles):
            fila['recorte'] = True
            f.write(json.dumps(fila, ensure_ascii=False) + '\n')
            f.flush()
            costo += fila.get('costo') or 0
            if (fila.get('lectura') or {}).get('encontrado'):
                recuperados += 1
    print(f'leídos {len(utiles)} · recuperados {recuperados} · USD {costo:.4f}')


if __name__ == '__main__':
    main()
