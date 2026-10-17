// Lista los EANs que la foto clasifica en B (verde por frase RTCR 457 o sello). Un EAN por línea.
// Un B es el único nivel que le dice a Yin "comelo": antes de publicarlo, la frase se confirma con
// un segundo modelo (indexer/leer_fotos.py --salida data/verificacion-b.jsonl) y el índice solo
// mantiene el B si los dos lo leyeron. Ver proyecto-escaner-sin-gluten §Llenado y validación.
const fs = require('fs'), path = require('path');
global.Logger = { log: () => {} };
eval(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8') + `
const T = TERMINOS_INICIALES.map(r => ({ termino: plano_(r[0]), nivel: r[2] }));
const crudo = {};
for (const l of fs.readFileSync(path.join(__dirname, 'data/crudo.jsonl'), 'utf8').trim().split('\\n'))
  if (l) { const o = JSON.parse(l); crudo[o.ean] = o; }
const out = [];
for (const l of fs.readFileSync(path.join(__dirname, 'data/lecturas-fotos.jsonl'), 'utf8').trim().split('\\n')) {
  if (!l) continue;
  const o = JSON.parse(l), r = o.lectura;
  if (!r || r.legibilidad !== 'completa') continue;   // un B parcial ya baja a E por la regla del índice
  let t = (r.ingredientes || '').trim();
  if ((r.alergenos || '').trim()) t += (t ? '. ' : '') + 'Alérgenos: ' + r.alergenos.trim();
  const c = clasificar_({ ingredientes: t, nombre: (crudo[o.ean] || {}).nombre || '' }, T);
  if (c.nivel === 'B') out.push(o.ean);
}
console.error('candidatos a B: ' + out.length);
console.log(out.join('\\n'));
`);
