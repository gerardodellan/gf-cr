// Lista los EANs que la foto clasifica en C ("sin ingredientes con gluten"). Un EAN por línea.
// C apoyado en UNA sola lectura es el punto ciego peligroso: si el modelo no vio el trigo, el
// producto queda 🟡 con un motivo que tranquiliza. Se releen con un segundo modelo y, donde el
// segundo lea algo distinto, el producto baja a E "confirmar en el empaque".
const fs = require('fs'), path = require('path');
const { textoLectura_ } = require('./lectura');
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
  if (!r || r.legibilidad !== 'completa') continue;   // una foto parcial ya baja a E por la regla del índice
  const x = crudo[o.ean];
  if (!x) continue;
  // solo interesa cuando la foto es la fuente del nivel: si el catálogo ya clasificaba, no es punto ciego
  let tw = (x.ingredientes || '').trim();
  if (x.alergenos && !/^(si|sí|no|n\\/a)$/i.test(x.alergenos.trim())) tw = (tw ? tw + '. ' : '') + 'Alérgenos: ' + x.alergenos;
  if (clasificar_({ ingredientes: tw, nombre: x.nombre }, T).motivo !== 'Sin información suficiente') continue;
  if (clasificar_({ ingredientes: textoLectura_(r), nombre: x.nombre }, T).nivel === 'C') out.push(o.ean);
}
console.error('productos en C por foto, sin respaldo del catálogo: ' + out.length);
console.log(out.join('\\n'));
`);
