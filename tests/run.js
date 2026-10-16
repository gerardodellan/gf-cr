// Pruebas de la regla: node tests/run.js
// 1) casos unitarios de probarRegla()  2) si existe tests/data/, comparación contra el etiquetado ciego (Fable, 250 productos MaxiPalí)
const fs = require('fs'), path = require('path');
const out = []; global.Logger = { log: s => out.push(s) };
eval(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8') + `
probarRegla();
const fallas = out.filter(l => !l.startsWith('OK'));
console.log('Unitarios: ' + (out.length - fallas.length) + '/' + out.length); fallas.forEach(l => console.log('  ' + l));
const D = path.join(__dirname, 'data');
let peligro = 0;
if (fs.existsSync(path.join(D, 'etiquetas-fable.jsonl'))) {
  const T = TERMINOS_INICIALES.map(r => ({ termino: plano_(r[0]), nivel: r[2] }));
  const M = fs.readFileSync(path.join(D, 'muestra.jsonl'), 'utf8').trim().split('\\n').map(JSON.parse);
  const E = Object.fromEntries(fs.readFileSync(path.join(D, 'etiquetas-fable.jsonl'), 'utf8').trim().split('\\n').map(JSON.parse).map(e => [e.id, e]));
  const verde = n => n === 'A' || n === 'B';
  let igual = 0;
  for (const p of M) {
    const r = clasificar_({ ingredientes: p.texto, nombre: p.nombre }, T).nivel, e = E[p.id].nivel;
    if (r === e) igual++;
    // peligro = la regla da verde y el etiquetado no, o la regla no da rojo y el etiquetado sí
    if ((verde(r) && !verde(e)) || (e === 'F' && r !== 'F')) { peligro++; console.log('  PELIGRO', p.id, e, '->', r, p.nombre); }
  }
  console.log('Ciego MaxiPalí: nivel igual ' + igual + '/' + M.length + ' · casos peligrosos ' + peligro);
}
process.exitCode = fallas.length || peligro ? 1 : 0;
`);
