// ¿La lectura de la foto de etiqueta confirma o contradice el nivel que da el texto de la tienda?
//
// Compara tres niveles por producto, todos con la MISMA regla (clasificar_ de apps-script/Code.gs):
//   web    = texto de MaxiPalí (ingredientes + alérgenos del catálogo)
//   foto   = lectura de la foto, regla cruda
//   final  = lectura de la foto con la política de construir_indice.js (una foto "parcial" solo puede
//            subir el riesgo: un B o C parcial baja a E)
// Caso PELIGROSO: `final` tiene MENOS riesgo que `web`. Es el número que bloquea escalar.
// Comparar contra web/datos/indice.json no sirve: el índice ya incorporó estas mismas lecturas.
// Cada caso peligroso se adjudica mirando la foto: el modelo puede no haber visto el dorso.
//
// Uso: node indexer/validar_fotos.js [--json salida.json]
const fs = require('fs'), path = require('path');
global.Logger = { log: () => {} };
const ORDEN = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 };   // riesgo creciente

eval(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8') + `
const T = TERMINOS_INICIALES.map(r => ({ termino: plano_(r[0]), nivel: r[2] }));
const crudo = {};
for (const l of fs.readFileSync(path.join(__dirname, 'data/crudo.jsonl'), 'utf8').trim().split('\\n'))
  if (l) { const o = JSON.parse(l); crudo[o.ean] = o; }

const lecturas = [];
try { for (const o of JSON.parse(fs.readFileSync(path.join(__dirname, 'data/fotos-lecturas.json'), 'utf8')))
  lecturas.push({ ean: o.ean, lectura: o, origen: 'piloto' }); } catch {}
try { for (const l of fs.readFileSync(path.join(__dirname, 'data/lecturas-fotos.jsonl'), 'utf8').trim().split('\\n')) {
  if (!l) continue; const o = JSON.parse(l);
  if (o.lectura) lecturas.push({ ean: o.ean, lectura: o.lectura, origen: o.modelo || 'modelo' });
} } catch {}

const nivelWeb = x => {
  let t = (x.ingredientes || '').trim();
  if (x.alergenos && !/^(si|sí|no|n\\/a)$/i.test(x.alergenos.trim())) t = (t ? t + '. ' : '') + 'Alérgenos: ' + x.alergenos;
  return clasificar_({ ingredientes: t, nombre: x.nombre }, T);
};
const nivelFoto = (fo, nombre) => {
  let t = (fo.ingredientes || '').trim();
  if ((fo.alergenos || '').trim()) t += (t ? '. ' : '') + 'Alérgenos: ' + fo.alergenos.trim();
  return clasificar_({ ingredientes: t, nombre: nombre }, T);
};

const filas = [];
const c = { igual: 0, llena_hueco: 0, sube_riesgo: 0, peligroso: 0, foto_sin_dato: 0, sin_crudo: 0 };
for (const { ean, lectura, origen } of lecturas) {
  const x = crudo[ean];
  if (!x) { c.sin_crudo++; continue; }
  const cw = nivelWeb(x), cf = nivelFoto(lectura, x.nombre);
  if (cf.motivo === 'Sin información suficiente') { c.foto_sin_dato++; continue; }
  // política de construir_indice.js: completa vale como etiqueta; parcial solo sube el riesgo
  let fin = cf;
  if (lectura.legibilidad !== 'completa' && !['F', 'D', 'E'].includes(cf.nivel))
    fin = { nivel: 'E', motivo: 'Foto de etiqueta parcial sin ingredientes con gluten; confirmar en el empaque' };
  const hueco = cw.motivo === 'Sin información suficiente';
  let caso;
  if (hueco) caso = 'llena_hueco';
  else if (fin.nivel === cw.nivel) caso = 'igual';
  else caso = ORDEN[fin.nivel] < ORDEN[cw.nivel] ? 'peligroso' : 'sube_riesgo';
  c[caso]++;
  if (caso === 'igual') continue;
  filas.push({ ean, caso, nombre: x.nombre, web: hueco ? '-' : cw.nivel, motivo_web: cw.motivo,
               foto: cf.nivel, final: fin.nivel, motivo_final: fin.motivo, legibilidad: lectura.legibilidad, origen,
               ingredientes_web: (x.ingredientes || '').slice(0, 160), alergenos_web: x.alergenos || '',
               ingredientes_foto: (lectura.ingredientes || '').slice(0, 200), alergenos_foto: lectura.alergenos || '' });
}
const porNivel = {};
for (const f of filas.filter(f => f.caso === 'llena_hueco')) porNivel[f.final] = (porNivel[f.final] || 0) + 1;
console.log('lecturas con crudo ' + (lecturas.length - c.sin_crudo) + ' · ' + JSON.stringify(c));
console.log('huecos llenados por nivel: ' + JSON.stringify(porNivel));
const legib = {};
for (const { lectura } of lecturas) legib[lectura.legibilidad] = (legib[lectura.legibilidad] || 0) + 1;
console.log('legibilidad declarada: ' + JSON.stringify(legib));
for (const f of filas.filter(f => f.caso === 'peligroso'))
  console.log('\\nPELIGROSO ' + f.ean + ' ' + f.nombre +
              '\\n  web   ' + f.web + ': ' + f.motivo_web + ' | ' + f.ingredientes_web + ' / ' + f.alergenos_web +
              '\\n  foto  ' + f.foto + ' -> final ' + f.final + ' [' + f.legibilidad + '] ' + f.alergenos_foto);
const arg = process.argv.indexOf('--json');
if (arg > -1) { fs.writeFileSync(process.argv[arg + 1], JSON.stringify({ resumen: c, filas }, null, 1)); console.log('\\nescrito ' + process.argv[arg + 1]); }
`);
