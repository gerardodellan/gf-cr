// Compara la lectura de Qwen contra la del segundo modelo para los productos en C por foto.
// Regla: C es el nivel que dice "leí la lista entera y no hay gluten". Si el segundo modelo lee
// algo que da OTRO nivel, la afirmación no se sostiene con una sola fuente y el producto baja a E.
// Uso: node indexer/comparar_c.js [--json salida.json]
const fs = require('fs'), path = require('path');
const { texto_, textoLectura_ } = require('./lectura');
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
const niv = (r, n) => clasificar_({ ingredientes: textoLectura_(r), nombre: n }, T);
const cuenta = {}; const filas = [];
for (const ean of Object.keys(g)) {
  const x = crudo[ean]; if (!x || !q[ean]) continue;
  const a = niv(q[ean], x.nombre), b = niv(g[ean], x.nombre);
  if (a.nivel !== 'C') continue;
  const k = b.nivel === 'C' ? 'confirma' : (b.motivo === 'Sin información suficiente' ? 'no_leyo' : 'discrepa:' + b.nivel);
  cuenta[k] = (cuenta[k] || 0) + 1;
  if (b.nivel !== 'C') filas.push({ ean, nombre: x.nombre, segundo: b.nivel, motivo: b.motivo,
    ing_qwen: texto_(q[ean].ingredientes).slice(0, 110), ing_2do: texto_(g[ean].ingredientes).slice(0, 110),
    al_2do: texto_(g[ean].alergenos).slice(0, 80), legib_2do: String(g[ean].legibilidad) });
}
console.log('C por foto verificados: ' + Object.keys(g).length + ' · ' + JSON.stringify(cuenta));
for (const f of filas.filter(f => ['F', 'D'].includes(f.segundo)).slice(0, 14))
  console.log('\\n' + f.segundo + ' ' + f.ean + ' ' + f.nombre.slice(0, 55) + '\\n  ' + f.motivo +
              '\\n  qwen: ' + f.ing_qwen + '\\n  2do : ' + f.ing_2do + ' | ' + f.al_2do);
const i = process.argv.indexOf('--json');
if (i > -1) { fs.writeFileSync(process.argv[i + 1], JSON.stringify({ cuenta, filas }, null, 1)); console.log('\\nescrito ' + process.argv[i + 1]); }
`);
