// Lista los EANs donde la 1.ª y la 2.ª lectura de la misma foto dan distinto nivel. Un EAN por línea.
// Un desacuerdo no decide nada por sí solo: el 17-oct se verificó mirando la lata que el segundo
// modelo puede INVENTAR una declaración ("Contiene: gluten" en unos vegetales que no la traen).
// Por eso el desacuerdo va a un tercer modelo y solo gana el riesgo si dos de tres lo leen.
const fs = require('fs'), path = require('path');
const { textoLectura_ } = require('./lectura');
global.Logger = { log: () => {} };
eval(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8') + `
const T = TERMINOS_INICIALES.map(r => ({ termino: plano_(r[0]), nivel: r[2] }));
const crudo = {};
for (const l of fs.readFileSync(path.join(__dirname, 'data/crudo.jsonl'), 'utf8').trim().split('\\n'))
  if (l) { const o = JSON.parse(l); crudo[o.ean] = o; }
const lee = f => { const m = {}; try {
  for (const l of fs.readFileSync(path.join(__dirname, f), 'utf8').trim().split('\\n')) {
    if (!l) continue; const o = JSON.parse(l); if (o.lectura) m[o.ean] = o.lectura; } } catch {} return m; };
const q = lee('data/lecturas-fotos.jsonl'), g = lee('data/verificacion-c.jsonl');
const out = [];
for (const ean of Object.keys(g)) {
  const x = crudo[ean]; if (!x || !q[ean]) continue;
  const a = clasificar_({ ingredientes: textoLectura_(q[ean]), nombre: x.nombre }, T);
  const b = clasificar_({ ingredientes: textoLectura_(g[ean]), nombre: x.nombre }, T);
  if (a.nivel !== b.nivel && b.motivo !== 'Sin información suficiente') out.push(ean);
}
console.error('desacuerdos entre la 1.ª y la 2.ª lectura: ' + out.length);
console.log(out.join('\\n'));
`);
