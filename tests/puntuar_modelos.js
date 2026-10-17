// Puntúa las lecturas de tests/data/modelos/*.jsonl contra la referencia (indexer/data/fotos-lecturas.json).
// Cada lectura pasa por la MISMA lógica que construir_indice.js (texto de la tienda + foto) y se compara el nivel A–F.
// Peligroso = el modelo da un color de menos riesgo que la referencia (rojo > amarillo > verde).
// Uso: node tests/puntuar_modelos.js   (escribe tests/data/modelos/_puntaje.json con los casos a revisar)
const fs = require('fs'), path = require('path');
global.Logger = { log: () => {} };
eval(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8') + `
const T = TERMINOS_INICIALES.map(r => ({ termino: plano_(r[0]), nivel: r[2] }));
const D = path.join(__dirname, 'data/modelos');
const crudo = {};
for (const l of fs.readFileSync(path.join(__dirname, '../indexer/data/crudo.jsonl'), 'utf8').trim().split('\\n')) {
  const x = JSON.parse(l); crudo[x.ean] = x;
}
const ref = {};
for (const o of JSON.parse(fs.readFileSync(path.join(__dirname, '../indexer/data/fotos-lecturas.json'), 'utf8'))) ref[o.ean] = o;

// misma lógica que construir_indice.js
function nivelFinal(ean, fo) {
  const x = crudo[ean] || { ingredientes: '', alergenos: '', nombre: '' };
  let txt = (x.ingredientes || '').trim();
  if (x.alergenos && !/^(si|sí|no|n\\/a)$/i.test(x.alergenos.trim())) txt = (txt ? txt + '. ' : '') + 'Alérgenos: ' + x.alergenos;
  let c = clasificar_({ ingredientes: txt, nombre: x.nombre }, T);
  if (fo && (fo.encontrado || (fo.alergenos || '').trim()) && (fo.legibilidad === 'completa' || c.nivel === 'E')) {
    let tf = (fo.ingredientes || '').trim();
    if ((fo.alergenos || '').trim()) tf += (tf ? '. ' : '') + 'Alérgenos: ' + fo.alergenos.trim();
    const cf = clasificar_({ ingredientes: tf, nombre: x.nombre }, T);
    if (cf.motivo !== 'Sin información suficiente') {
      if (fo.legibilidad === 'completa' || ['F', 'D', 'E'].includes(cf.nivel)) c = { nivel: cf.nivel, motivo: cf.motivo };
      else c = { nivel: 'E', motivo: 'Foto parcial sin ingredientes con gluten' };
    }
  }
  return c;
}
const COLOR = { A: 0, B: 0, C: 1, D: 1, E: 1, F: 2 };
// precio de lista (USD por millón) para estimar cuando OpenRouter devuelve costo 0
const LISTA = { 'anthropic/claude-haiku-5.5': [0.10, 0.50] };

const resumen = {}, casos = {};
for (const f of fs.readdirSync(D).filter(f => f.endsWith('.jsonl'))) {
  const et = f.replace('.jsonl', '');
  const filas = {};
  for (const l of fs.readFileSync(path.join(D, f), 'utf8').trim().split('\\n')) { const o = JSON.parse(l); if (o.lectura || !filas[o.ean]) filas[o.ean] = o; }
  const r = { modelo: '', productos: 0, errores: 0, encontrados: 0, iguales: 0, mismo_color: 0, peligrosos: 0, mas_cautos: 0,
              costo_usd: 0, segundos: [], tokens_in: 0 };
  casos[et] = [];
  for (const ean of Object.keys(ref)) {
    const o = filas[ean];
    if (!o) continue;
    r.modelo = o.modelo; r.productos++;
    if (!o.lectura) { r.errores++; continue; }
    if (o.lectura.encontrado) r.encontrados++;
    let costo = Number(o.costo) || 0;
    if (!costo && LISTA[o.modelo]) costo = (o.tokens_in * LISTA[o.modelo][0] + o.tokens_out * LISTA[o.modelo][1]) / 1e6;
    r.costo_usd += costo; r.segundos.push(o.segundos); r.tokens_in += o.tokens_in || 0;
    const a = nivelFinal(ean, ref[ean]), b = nivelFinal(ean, o.lectura);
    if (a.nivel === b.nivel) r.iguales++;
    if (COLOR[a.nivel] === COLOR[b.nivel]) r.mismo_color++;
    else if (COLOR[b.nivel] < COLOR[a.nivel]) { r.peligrosos++; casos[et].push({ tipo: 'PELIGROSO', ean, nombre: (crudo[ean] || {}).nombre, ref: a, modelo: b, lectura: o.lectura }); }
    else { r.mas_cautos++; casos[et].push({ tipo: 'más cauto', ean, nombre: (crudo[ean] || {}).nombre, ref: a, modelo: b }); }
  }
  const s = r.segundos.sort((x, y) => x - y);
  r.mediana_seg = s[Math.floor(s.length / 2)];
  r.costo_por_1000 = r.productos ? +(r.costo_usd / (r.productos - r.errores) * 1000).toFixed(2) : 0;
  r.costo_usd = +r.costo_usd.toFixed(4);
  delete r.segundos;
  resumen[et] = r;
}
console.table(resumen);
fs.writeFileSync(path.join(D, '_puntaje.json'), JSON.stringify({ resumen, casos }, null, 1));
`);
