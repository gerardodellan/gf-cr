// Clasifica el crudo con la MISMA regla de la API (apps-script/Code.gs) y actualiza web/datos/indice.json.
// - Solo entra lo que la regla puede clasificar con el texto de la tienda; "sin información" queda para la API.
// - Nunca borra: un producto que MaxiPalí deja de listar se conserva con su fecha de última vez visto
//   (puede estar en otro súper). Formato: p[ean] = [nombre, nivel, motivo, '' si MaxiPalí lo lista | AAAA-MM-DD desde que no lo lista].
// - El archivo solo cambia si cambia el contenido: una noche sin novedades no genera commit.
const fs = require('fs'), path = require('path');
global.Logger = { log: () => {} };
eval(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8') + `
const T = TERMINOS_INICIALES.map(r => ({ termino: plano_(r[0]), nivel: r[2] }));
const crudo = fs.readFileSync(path.join(__dirname, 'data/crudo.jsonl'), 'utf8').trim().split('\\n').map(JSON.parse);
const salida = path.join(__dirname, '../web/datos/indice.json');
let previo = { p: {} }, estado = { recorrido: 0 };
const fEstado = path.join(__dirname, 'data/estado.json');
try { previo = JSON.parse(fs.readFileSync(salida, 'utf8')); } catch {}
try { estado = JSON.parse(fs.readFileSync(fEstado, 'utf8')); } catch {}
// freno: un recorrido que trae menos del 70 % del anterior es una falla de la tienda o de su API, no se publica
if (estado.recorrido && crudo.length < estado.recorrido * 0.7) {
  console.error('ABORTO: recorrido de ' + crudo.length + ' vs ' + estado.recorrido + ' anterior'); process.exit(2);
}
const hoy = new Date().toISOString().slice(0, 10);
const p = Object.assign({}, previo.p);
let nuevos = 0, cambiados = 0, fuera = 0, vueltos = 0;
const listados = new Set();
for (const x of crudo) {
  let txt = x.ingredientes.trim();
  if (x.alergenos && !/^(si|sí|no|n\\/a)$/i.test(x.alergenos.trim())) txt = (txt ? txt + '. ' : '') + 'Alérgenos: ' + x.alergenos;
  const c = clasificar_({ ingredientes: txt, nombre: x.nombre }, T);
  let ean = x.ean;
  if (ean.length === 13 && ean[0] === '0') ean = ean.slice(1);   // misma forma canónica que normalizarCodigo_
  if (c.motivo === 'Sin información suficiente') { fuera++; delete p[ean]; continue; }
  const antes = p[ean];
  if (!antes) nuevos++; else if (antes[1] !== c.nivel || antes[2] !== c.motivo) cambiados++;
  if (antes && antes[3]) vueltos++;
  p[ean] = [x.nombre, c.nivel, c.motivo, ''];
  listados.add(ean);
}
let bajas = 0;
for (const [ean, x] of Object.entries(p)) if (!listados.has(ean) && !x[3]) { x[3] = hoy; bajas++; }
const n = Object.keys(p).length, noListados = Object.values(p).filter(x => x[3]).length;
const sinCambios = !nuevos && !cambiados && !bajas && !vueltos && Object.keys(previo.p).length === n;
fs.writeFileSync(salida, JSON.stringify({ v: sinCambios ? previo.v : hoy, fuente: 'MaxiPalí', p }));
fs.writeFileSync(fEstado, JSON.stringify({ recorrido: crudo.length, fecha: hoy }));
console.log('indice ' + n + ' productos · nuevos ' + nuevos + ' · cambiados ' + cambiados + ' · bajas hoy ' + bajas + ' · vueltos ' + vueltos + ' · ya no listados ' + noListados +
            ' · sin información (quedan para la API) ' + fuera + ' · ' + Math.round(fs.statSync(salida).size / 1024) + ' KB');
`);
