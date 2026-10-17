// Clasifica el crudo con la MISMA regla de la API (apps-script/Code.gs) y actualiza web/datos/indice.json.
// - Solo entra lo que la regla puede clasificar con el texto de la tienda; "sin información" queda para la API.
// - Nunca borra: un producto que MaxiPalí deja de listar se conserva con su fecha de última vez visto
//   (puede estar en otro súper). Formato: p[ean] = [nombre, nivel, motivo, '' si MaxiPalí lo lista | AAAA-MM-DD desde que no lo lista].
// - El archivo solo cambia si cambia el contenido: una noche sin novedades no genera commit.
const fs = require('fs'), path = require('path');
const { texto_, textoLectura_ } = require('./lectura');
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
let nuevos = 0, cambiados = 0, fuera = 0, vueltos = 0, cruzados = 0;
const cruce = {};
try { for (const l of fs.readFileSync(path.join(__dirname, 'data/cruce.jsonl'), 'utf8').trim().split('\\n')) { if (l) { const o = JSON.parse(l); cruce[o.ean] = o.texto; } } } catch {}
const listados = new Set();
// lecturas de fotos de etiqueta de la propia tienda. Dos fuentes, misma forma:
//   data/fotos-lecturas.json   referencia del piloto del 16-oct (100 productos, leídos por agentes)
//   data/lecturas-fotos.jsonl  corridas del modelo de visión (indexer/leer_fotos.py), append-only
// El piloto se carga último: su lectura gana sobre la del modelo para el mismo EAN.
const fotos = {};
try { for (const l of fs.readFileSync(path.join(__dirname, 'data/lecturas-fotos.jsonl'), 'utf8').trim().split('\\n')) {
  if (!l) continue; const o = JSON.parse(l); const r = o.lectura;
  if (r && (r.encontrado || texto_(r.alergenos).trim())) fotos[o.ean] = r;
} } catch {}
try { for (const o of JSON.parse(fs.readFileSync(path.join(__dirname, 'data/fotos-lecturas.json'), 'utf8')))
  if (o.encontrado || texto_(o.alergenos).trim()) fotos[o.ean] = o; } catch {}
// Verificación de los B: un B es el único nivel que le dice a Yin "comelo". Un segundo modelo
// (data/verificacion-b.jsonl, indexer/candidatos_b.js) releyó las mismas fotos; el B se mantiene
// solo si los dos leyeron la frase. Si no coinciden, baja a E "confirmar en el empaque".
const verifB = {};
try { for (const l of fs.readFileSync(path.join(__dirname, 'data/verificacion-b.jsonl'), 'utf8').trim().split('\\n')) {
  if (!l) continue; const o = JSON.parse(l); if (o.lectura) verifB[o.ean] = o.lectura;
} } catch {}
// Segunda lectura de los productos que la foto deja en C (data/verificacion-c.jsonl, otro modelo).
// C afirma "leí la lista entera y no hay gluten": apoyado en una sola lectura es el punto ciego
// peligroso. Donde el segundo modelo lee gluten o trazas, gana el MAYOR riesgo de las dos lecturas.
// Nunca al revés: el segundo modelo no puede bajar el nivel ni subir el producto a verde.
const leerJsonl_ = f => { const m = {};
  try { for (const l of fs.readFileSync(path.join(__dirname, f), 'utf8').trim().split('\\n')) {
    if (!l) continue; const o = JSON.parse(l); if (o.lectura) m[o.ean] = o.lectura; } } catch {}
  return m; };
const segunda = leerJsonl_('data/verificacion-c.jsonl');
// Desempate: el segundo modelo SOLO no alcanza. De 48 desacuerdos medidos el 17-oct, un tercer
// modelo apoyó al segundo en 7; los otros 41 eran lectura inventada (en unos vegetales en lata el
// segundo leyó "Contiene: gluten" y la etiqueta, mirada a mano, no trae ninguna declaración).
const tercera = leerJsonl_('data/desempate.jsonl');
let porSegunda = 0, enDuda = 0;

const confirmaB = (ean, nombre) => {
  const r = verifB[ean];
  if (!r) return false;
  return clasificar_({ ingredientes: textoLectura_(r), nombre: nombre }, T).nivel === 'B';
};
let porFoto = 0, bSinConfirmar = 0;
for (const x of crudo) {
  let txt = x.ingredientes.trim();
  if (x.alergenos && !/^(si|sí|no|n\\/a)$/i.test(x.alergenos.trim())) txt = (txt ? txt + '. ' : '') + 'Alérgenos: ' + x.alergenos;
  let c = clasificar_({ ingredientes: txt, nombre: x.nombre }, T);
  let ean = x.ean;
  if (ean.length === 13 && ean[0] === '0') ean = ean.slice(1);   // misma forma canónica que normalizarCodigo_
  const fo = fotos[x.ean];
  if (fo && (fo.legibilidad === 'completa' || c.nivel === 'E')) {
    // la foto es la etiqueta del mismo producto: completa vale como etiqueta; parcial solo puede subir el riesgo
    const cf = clasificar_({ ingredientes: textoLectura_(fo), nombre: x.nombre }, T);
    if (cf.motivo !== 'Sin información suficiente') {
      let cn;
      if (fo.legibilidad === 'completa' || ['F', 'D', 'E'].includes(cf.nivel)) cn = { nivel: cf.nivel, motivo: cf.motivo + ' (foto de etiqueta)' };
      else cn = { nivel: 'E', motivo: 'Foto de etiqueta parcial sin ingredientes con gluten; confirmar en el empaque' };
      // el B solo sobrevive con la confirmación del segundo modelo
      if (cn.nivel === 'B' && !confirmaB(x.ean, x.nombre)) {
        cn = { nivel: 'E', motivo: 'La foto dice "sin gluten" pero un segundo modelo no lo confirmó; revisar el empaque' };
        bSinConfirmar++;
      }
      // Cuando el catálogo DECLARA gluten o trazas (F o D), la foto no puede bajar el riesgo (16-oct).
      // Los 3 casos del piloto donde pasaba (achiote, tortilla de maíz, yuquitas) eran errores del
      // catálogo —verificados mirando la foto—, pero la foto puede ser de un empaque viejo y la ficha
      // del proveedor nueva. Solo una revisión con el empaque en la mano lo baja (revisado en la Sheet).
      // Un C o E del catálogo no declara nada: ahí la foto sí puede dar B, y además pasa por confirmaB.
      const R = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 };
      // segunda lectura de la misma foto: solo puede subir el riesgo
      const s2 = segunda[x.ean];
      if (s2) {
        const c2 = clasificar_({ ingredientes: textoLectura_(s2), nombre: x.nombre }, T);
        if (c2.motivo !== 'Sin información suficiente' && R[c2.nivel] > R[cn.nivel]) {
          // dos de tres: el nivel sube solo si un tercer modelo lee lo mismo
          const s3 = tercera[x.ean];
          const c3 = s3 ? clasificar_({ ingredientes: textoLectura_(s3), nombre: x.nombre }, T) : null;
          if (c3 && c3.nivel === c2.nivel) {
            cn = { nivel: c2.nivel, motivo: c2.motivo + ' (2 de 3 lecturas de la foto)' };
            porSegunda++;
          } else if (R[cn.nivel] < R['E']) {
            // sin apoyo del tercero no se afirma el riesgo, pero tampoco se sostiene un "sin
            // ingredientes con gluten": una de las lecturas vio algo. Queda en duda declarada.
            cn = { nivel: 'E', motivo: 'Las lecturas de la foto no coinciden; confirmar en el empaque' };
            enDuda++;
          }
        }
      }
      if (['F', 'D'].includes(c.nivel) && R[cn.nivel] < R[c.nivel])
        cn = { nivel: c.nivel, motivo: c.motivo + ' (la foto no lo declara; gana el mayor riesgo)' };
      c = cn;
      porFoto++;
    }
  }
  if (c.motivo === 'Sin información suficiente' && cruce[x.ean]) {
    // texto de Auto Mercado cruzado por nombre: solo puede SUBIR el riesgo (F, D, E). Un C/B por cruce baja a E.
    const ca = clasificar_({ ingredientes: cruce[x.ean], nombre: x.nombre }, T);
    if (ca.motivo !== 'Sin información suficiente') {
      c = ['F', 'D', 'E'].includes(ca.nivel) ? { nivel: ca.nivel, motivo: ca.motivo + ' (Auto Mercado)' }
        : { nivel: 'E', motivo: 'Auto Mercado no lista ingredientes con gluten; confirmar en el empaque' };
      cruzados++;
    }
  }
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
console.log('indice ' + n + ' productos · nuevos ' + nuevos + ' · cambiados ' + cambiados + ' · por foto ' + porFoto + ' · B sin confirmar ' + bSinConfirmar + ' · subidos por 2 de 3 ' + porSegunda + ' · en duda por desacuerdo ' + enDuda + ' · por Auto Mercado ' + cruzados + ' · bajas hoy ' + bajas + ' · vueltos ' + vueltos + ' · ya no listados ' + noListados +
            ' · sin información (quedan para la API) ' + fuera + ' · ' + Math.round(fs.statSync(salida).size / 1024) + ' KB');
`);
