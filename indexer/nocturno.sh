#!/bin/bash
# Índice nocturno de alimentos MaxiPalí -> web/datos/indice.json -> GitHub Pages.
# Lo corre el timer de usuario gf-cr-indice.timer. Log: journalctl --user -u gf-cr-indice
set -euo pipefail
cd "$(dirname "$0")/.."
python3 indexer/crawl_maxipali.py
# Auto Mercado (texto de ingredientes, sin EAN): se exporta los domingos o si falta; el cruce corre cada noche
if [ "$(date +%u)" = 7 ] || [ ! -f indexer/data/automercado.jsonl ]; then python3 indexer/export_automercado.py || echo "aviso: export Auto Mercado falló; se usa el anterior"; fi
[ -f indexer/data/automercado.jsonl ] && python3 indexer/cruce_automercado.py
node indexer/construir_indice.js
if git diff --quiet -- web/datos/indice.json; then echo "índice sin cambios"; exit 0; fi
git add web/datos/indice.json
git -c user.name="Gerardo Dellan" -c user.email=gerry.dellan@gmail.com commit -qm "Índice MaxiPalí $(date +%F)"
git push -q origin master
git subtree push --prefix web origin gh-pages
echo "índice publicado"
