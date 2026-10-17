// Lista los EANs que conviene leer por foto, en orden de prioridad. Un EAN por línea.
//   1 (hueco)  la regla no puede clasificar el texto de la tienda: el producto no entra al índice
//   2 (pobre)  entra, pero en C o E: dato débil que la etiqueta puede precisar
//   3 (firme)  ya tiene B, D o F por texto: solo para validar por muestra
// Uso: node indexer/objetivo_fotos.js [hueco|pobre|firme] [n]
const fs = require('fs'), path = require('path');
global.Logger = { log: () => {} };
eval(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8') + `
const T = TERMINOS_INICIALES.map(r => ({ termino: plano_(r[0]), nivel: r[2] }));
const grupo = process.argv[2] || 'hueco', n = parseInt(process.argv[3] || '0', 10);
const out = [];
const cuenta = { hueco: 0, pobre: 0, firme: 0, sin_fotos: 0 };
for (const l of fs.readFileSync(path.join(__dirname, 'data/crudo.jsonl'), 'utf8').trim().split('\\n')) {
  if (!l) continue;
  const x = JSON.parse(l);
  if (!(x.imagenes || []).length) { cuenta.sin_fotos++; continue; }
  let t = (x.ingredientes || '').trim();
  if (x.alergenos && !/^(si|sí|no|n\\/a)$/i.test(x.alergenos.trim())) t = (t ? t + '. ' : '') + 'Alérgenos: ' + x.alergenos;
  const c = clasificar_({ ingredientes: t, nombre: x.nombre }, T);
  const g = c.motivo === 'Sin información suficiente' ? 'hueco' : (['C', 'E'].includes(c.nivel) ? 'pobre' : 'firme');
  cuenta[g]++;
  if (g === grupo) out.push(x.ean);
}
console.error(JSON.stringify(cuenta));
console.log((n ? out.slice(0, n) : out).join('\\n'));
`);
