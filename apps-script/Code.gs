/**
 * GF-CR — API del escáner sin gluten (Apps Script, standalone).
 * Spec: vault-personal/04-Aprendizaje/Proyectos/escaner-sin-gluten-spec-v1.md
 *
 * Despliegue: web app, "ejecutar como yo", acceso "cualquier persona".
 * GET  ?codigo=…&t=…            -> resultado
 * POST text/plain {t, codigo, …} -> alta manual (la PWA nunca manda application/json: dispara preflight)
 */

// Token fijo: viaja en la PWA (repo público), no es secreto; solo frena el ruido (spec §3)
const TOKEN = 'IKtImWFs97m3';
const UA = 'GF-CR/0.1 (gerry.dellan@gmail.com)';
const TTL_DIAS = 30;
const MAX_FOTO_BYTES = 1500000;
const HOJAS = {
  productos: ['codigo', 'nombre', 'marca', 'nivel', 'estado', 'motivo', 'ingredientes', 'fuente',
              'fecha_consulta', 'revisado', 'url_foto', 'escaneos'],
  prohibidos: ['termino', 'idioma', 'nivel', 'nota'],
  registro: ['fecha', 'codigo', 'nombre', 'marca', 'etiqueta', 'mensaje', 'url_foto', 'estado_revision'],
};
const NOMBRE_HOJA = { productos: 'Productos_CR', prohibidos: 'Ingredientes_Prohibidos', registro: 'Registro_Manual' };

// Niveles (spec §1). La letra viaja a la PWA; el color se deriva.
const NIVEL_ESTADO = { A: 'VERDE', B: 'VERDE', C: 'AMARILLO', D: 'AMARILLO', E: 'AMARILLO', F: 'ROJO' };

// ---------- instalación ----------

/** Correr una vez desde el editor. Crea la Sheet, la carpeta de fotos y el token. */
function setup() {
  const props = PropertiesService.getScriptProperties();
  let ss;
  if (props.getProperty('SHEET_ID')) {
    ss = SpreadsheetApp.openById(props.getProperty('SHEET_ID'));
  } else {
    ss = SpreadsheetApp.create('GF-CR datos');
    props.setProperty('SHEET_ID', ss.getId());
  }
  Object.keys(HOJAS).forEach(k => {
    let sh = ss.getSheetByName(NOMBRE_HOJA[k]);
    if (!sh) sh = ss.insertSheet(NOMBRE_HOJA[k]);
    if (sh.getLastRow() === 0) {
      sh.appendRow(HOJAS[k]);
      sh.setFrozenRows(1);
    }
  });
  const hoja1 = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (hoja1 && ss.getSheets().length > 1) ss.deleteSheet(hoja1);
  // código como texto: sin esto Sheets borra el 0 inicial de un UPC
  ss.getSheetByName(NOMBRE_HOJA.productos).getRange('A:A').setNumberFormat('@');
  ss.getSheetByName(NOMBRE_HOJA.registro).getRange('B:B').setNumberFormat('@');

  const proh = ss.getSheetByName(NOMBRE_HOJA.prohibidos);
  if (proh.getLastRow() === 1) proh.getRange(2, 1, TERMINOS_INICIALES.length, 4).setValues(TERMINOS_INICIALES);

  if (!props.getProperty('FOLDER_ID')) {
    props.setProperty('FOLDER_ID', DriveApp.createFolder('GF-CR fotos').getId());
  }
  Logger.log('Sheet: ' + ss.getUrl());
}

const TERMINOS_INICIALES = [
  ['trigo', 'es', 'ROJO', 'excluye "trigo sarraceno" (no tiene gluten)'],
  ['wheat', 'en', 'ROJO', 'excluye "buckwheat"'],
  ['cebada', 'es', 'ROJO', ''], ['barley', 'en', 'ROJO', ''],
  ['centeno', 'es', 'ROJO', ''], ['rye', 'en', 'ROJO', ''],
  ['malta', 'es', 'ROJO', 'palabra entera: no toca maltodextrina ni maltitol'],
  ['malt', 'en', 'ROJO', 'palabra entera'],
  ['extracto de malta', 'es', 'ROJO', ''], ['jarabe de malta', 'es', 'ROJO', ''],
  ['espelta', 'es', 'ROJO', ''], ['spelt', 'en', 'ROJO', ''],
  ['kamut', 'es', 'ROJO', ''], ['triticale', 'es', 'ROJO', ''],
  ['semola', 'es', 'ROJO', 'sémola de trigo; revisar casos de sémola de maíz'],
  ['semolina', 'en', 'ROJO', ''], ['cuscus', 'es', 'ROJO', ''], ['couscous', 'en', 'ROJO', ''],
  ['seitan', 'es', 'ROJO', ''], ['gluten', 'es', 'ROJO', 'salvo dentro de "sin gluten" / "gluten free"'],
  ['bulgur', 'es', 'ROJO', ''], ['brewer\'s yeast', 'en', 'ROJO', ''],
  ['avena', 'es', 'AMARILLO', 'sin la frase "sin gluten"'], ['oats', 'en', 'AMARILLO', ''], ['oat', 'en', 'AMARILLO', ''],
  ['harina', 'es', 'AMARILLO', 'sin especie; "harina de maíz/arroz/…" no cuenta'],
  ['flour', 'en', 'AMARILLO', 'sin especie'],
  ['almidon modificado', 'es', 'AMARILLO', 'sin origen'], ['modified starch', 'en', 'AMARILLO', 'sin origen'],
  ['proteina vegetal hidrolizada', 'es', 'AMARILLO', 'sin origen'],
];

// ---------- entrada HTTP ----------

function doGet(e) {
  try {
    const p = e.parameter || {};
    checkToken_(p.t);
    const codigo = normalizarCodigo_(p.codigo);
    return json_(consultar_(codigo));
  } catch (err) {
    return json_({ error: String(err.message || err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    checkToken_(body.t);
    const codigo = normalizarCodigo_(body.codigo);
    return json_(altaManual_(codigo, body));
  } catch (err) {
    return json_({ error: String(err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function checkToken_(t) {
  if (t !== TOKEN) throw new Error('token');
}

/** Acepta EAN-13, UPC-A, EAN-8. Valida el dígito de control. Devuelve el código tal como se leyó. */
function normalizarCodigo_(c) {
  c = String(c || '').replace(/\D/g, '');
  if (![8, 12, 13].includes(c.length)) throw new Error('codigo');
  const d = c.split('').map(Number);
  const cuerpo = d.slice(0, -1).reverse();
  const suma = cuerpo.reduce((s, v, i) => s + v * (i % 2 === 0 ? 3 : 1), 0);
  if ((10 - (suma % 10)) % 10 !== d[d.length - 1]) throw new Error('codigo');
  return c;
}

// ---------- consulta ----------

function consultar_(codigo) {
  const sh = hoja_('productos');
  const fila = buscarFila_(sh, codigo);
  const ahora = new Date();
  if (fila) {
    const r = filaAObj_(sh, fila);
    sh.getRange(fila, HOJAS.productos.indexOf('escaneos') + 1).setValue((Number(r.escaneos) || 0) + 1);
    const fresco = r.fecha_consulta && (ahora - new Date(r.fecha_consulta)) / 864e5 < TTL_DIAS;
    if (r.revisado === true || r.fuente !== 'OFF' || fresco) return salida_(r, false);
  }
  const off = consultarOFF_(codigo);
  if (!off) {
    if (fila) return salida_(filaAObj_(sh, fila), false);
    return { codigo: codigo, encontrado: false };
  }
  const c = clasificar_(off, terminos_());
  const r = {
    codigo: codigo, nombre: off.nombre, marca: off.marca, nivel: c.nivel, estado: NIVEL_ESTADO[c.nivel],
    motivo: c.motivo, ingredientes: off.ingredientes, fuente: 'OFF', fecha_consulta: ahora,
    revisado: false, url_foto: '', escaneos: 1,
  };
  if (fila) {
    const prev = filaAObj_(sh, fila);
    r.escaneos = (Number(prev.escaneos) || 0) + 1;
    r.url_foto = prev.url_foto || '';
    sh.getRange(fila, 1, 1, HOJAS.productos.length).setValues([HOJAS.productos.map(k => r[k])]);
  } else {
    sh.appendRow(HOJAS.productos.map(k => r[k]));
  }
  return salida_(r, true);
}

function salida_(r, recienConsultado) {
  return {
    codigo: String(r.codigo), encontrado: true, nombre: r.nombre, marca: r.marca, nivel: r.nivel,
    estado: r.estado, motivo: r.motivo, fuente: r.fuente, revisado: r.revisado === true,
    fecha_consulta: r.fecha_consulta ? Utilities.formatDate(new Date(r.fecha_consulta), 'America/Costa_Rica', 'dd-MM-yyyy') : '',
    nuevo: recienConsultado,
  };
}

function consultarOFF_(codigo) {
  const campos = 'product_name,product_name_es,brands,ingredients_text_es,ingredients_text,allergens_tags,traces_tags,labels_tags';
  const url = 'https://world.openfoodfacts.org/api/v2/product/' + codigo + '.json?fields=' + campos;
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'User-Agent': UA } });
  if (res.getResponseCode() !== 200) return null;
  const j = JSON.parse(res.getContentText());
  if (j.status !== 1 || !j.product) return null;
  const p = j.product;
  return {
    nombre: p.product_name_es || p.product_name || '',
    marca: (p.brands || '').split(',')[0].trim(),
    ingredientes: p.ingredients_text_es || p.ingredients_text || '',
    alergenos: p.allergens_tags || [], trazas: p.traces_tags || [], etiquetas: p.labels_tags || [],
  };
}

// ---------- regla (spec §1) ----------

function terminos_() {
  const sh = hoja_('prohibidos');
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues()
    .filter(r => r[0]).map(r => ({ termino: plano_(r[0]), nivel: String(r[2]).toUpperCase() }));
}

/** Sin tildes, minúsculas. */
function plano_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const FRASES_SIN_GLUTEN = ['sin gluten', 'libre de gluten', 'exento de gluten', 'gluten free', 'gluten-free'];
const FRASES_TRAZAS = ['trazas', 'puede contener', 'fabricado en plantas', 'fabricado en una planta', 'fabricado en lineas',
  'elaborado en equipos', 'may contain', 'processed in a facility', 'manufactured in a facility', 'shared equipment'];
const HARINAS_SIN_GLUTEN = ['maiz', 'arroz', 'yuca', 'papa', 'almendra', 'coco', 'garbanzo', 'soya', 'soja', 'platano', 'quinoa',
  'corn', 'rice', 'almond', 'coconut', 'potato', 'tapioca', 'chickpea'];

function clasificar_(p, terminos) {
  const txt = plano_(p.ingredientes);
  // se borran las frases "sin gluten" para que "gluten" no dispare ROJO sobre ellas
  // "gluten friendly" no es declaración reconocida (Salud, jun-2026): se ignora
  let txtLimpio = [...FRASES_SIN_GLUTEN, 'gluten friendly'].reduce((t, f) => t.split(f).join(' '), txt)
    .replace(/trigo sarraceno|buckwheat/g, ' ');
  // la cláusula de trazas ("puede contener trazas de trigo.") no es ingrediente: se evalúa en la fila 3
  FRASES_TRAZAS.forEach(f => { txtLimpio = txtLimpio.replace(new RegExp(f + '[^.;]*', 'g'), ' '); });
  const tags = a => (a || []).map(plano_);
  const alerg = tags(p.alergenos), trazas = tags(p.trazas), etiq = tags(p.etiquetas);
  const completo = txt.length >= 10;

  // fila 2 — ROJO
  if (alerg.includes('en:gluten')) return { nivel: 'F', motivo: 'Alérgeno declarado: gluten' };
  for (const t of terminos.filter(t => t.nivel === 'ROJO')) {
    if (palabra_(txtLimpio, t.termino)) return { nivel: 'F', motivo: 'Contiene: ' + t.termino };
  }
  // fila 3 — trazas
  if (trazas.includes('en:gluten')) return { nivel: 'D', motivo: 'Trazas declaradas: gluten' };
  // la cláusula cuenta solo si nombra gluten o un cereal ROJO ("trazas de soya" no es aviso de gluten)
  const rojos = terminos.filter(t => t.nivel === 'ROJO');
  for (const f of FRASES_TRAZAS) {
    const re = new RegExp(f + '[^.;]*', 'g');
    let m;
    while ((m = re.exec(txt)) !== null) {
      const clausula = m[0].replace(/trigo sarraceno|buckwheat/g, ' ');
      if (rojos.some(t => palabra_(clausula, t.termino))) return { nivel: 'D', motivo: 'Etiqueta: "' + m[0].trim() + '"' };
    }
  }
  // fila 4 — ingrediente de riesgo
  const dicenSinGluten = FRASES_SIN_GLUTEN.some(f => txt.includes(f));
  for (const t of terminos.filter(t => t.nivel === 'AMARILLO')) {
    if (!palabra_(txtLimpio, t.termino)) continue;
    if ((t.termino === 'avena' || t.termino.startsWith('oat')) && dicenSinGluten) continue;
    if ((t.termino === 'harina' || t.termino === 'flour') && harinaConEspecie_(txtLimpio, t.termino)) continue;
    return { nivel: 'E', motivo: 'Ingrediente de riesgo: ' + t.termino };
  }
  // fila 5 — sello o frase legal, con ingredientes completos
  const certificado = etiq.some(e => e.includes('certified-gluten-free'));
  const etiquetaGF = etiq.includes('en:gluten-free') || etiq.includes('en:no-gluten') || dicenSinGluten;
  if (completo && certificado) return { nivel: 'A', motivo: 'Sello sin gluten certificado' };
  if (completo && etiquetaGF) return { nivel: 'B', motivo: 'Etiquetado "sin gluten"' };
  // fila 6
  if (completo) return { nivel: 'C', motivo: 'Sin ingredientes con gluten' };
  return { nivel: 'E', motivo: 'Sin información suficiente' };
}

function palabra_(txt, termino) {
  const esc = termino.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^a-z])' + esc + '($|[^a-z])').test(txt);
}

/** true si TODAS las apariciones de "harina"/"flour" llevan una especie sin gluten. */
function harinaConEspecie_(txt, termino) {
  const re = termino === 'harina' ? /harina(s)?( de| integral de)? ([a-z]+)/g : /([a-z]+) flour/g;
  let m, alguna = false;
  while ((m = re.exec(txt)) !== null) {
    alguna = true;
    const especie = termino === 'harina' ? m[3] : m[1];
    if (!HARINAS_SIN_GLUTEN.includes(especie)) return false;
  }
  return alguna;
}

// ---------- alta manual ----------

function altaManual_(codigo, b) {
  let url = '';
  if (b.foto_base64) {
    const bytes = Utilities.base64Decode(String(b.foto_base64).replace(/^data:[^,]+,/, ''));
    if (bytes.length > MAX_FOTO_BYTES) throw new Error('foto');
    const carpeta = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('FOLDER_ID'));
    const f = carpeta.createFile(Utilities.newBlob(bytes, 'image/jpeg', codigo + '-' + Date.now() + '.jpg'));
    url = f.getUrl();
  }
  const corto = (s, n) => String(s || '').slice(0, n);
  const reg = hoja_('registro');
  reg.appendRow([new Date(), codigo, corto(b.nombre, 120), corto(b.marca, 80), corto(b.etiqueta, 60),
                 corto(b.mensaje, 1000), url, 'pendiente']);
  // un producto nuevo entra como E (sin revisar): nunca cambia de color sin revisión
  const sh = hoja_('productos');
  if (!buscarFila_(sh, codigo)) {
    sh.appendRow(HOJAS.productos.map(k => ({
      codigo: codigo, nombre: corto(b.nombre, 120), marca: corto(b.marca, 80), nivel: 'E', estado: 'AMARILLO',
      motivo: 'Agregado a mano, sin revisar', ingredientes: '', fuente: 'manual', fecha_consulta: new Date(),
      revisado: false, url_foto: url, escaneos: 0,
    })[k]));
  }
  return { ok: true };
}

// ---------- utilidades de hoja ----------

function hoja_(k) {
  return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'))
    .getSheetByName(NOMBRE_HOJA[k]);
}

function buscarFila_(sh, codigo) {
  if (sh.getLastRow() < 2) return 0;
  const hit = sh.getRange(2, 1, sh.getLastRow() - 1, 1).createTextFinder(codigo).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

function filaAObj_(sh, fila) {
  const v = sh.getRange(fila, 1, 1, HOJAS.productos.length).getValues()[0];
  return HOJAS.productos.reduce((o, k, i) => (o[k] = v[i], o), {});
}

// ---------- pruebas (correr desde el editor) ----------

function probarRegla() {
  const T = TERMINOS_INICIALES.map(r => ({ termino: plano_(r[0]), nivel: r[2] }));
  const casos = [
    [{ ingredientes: 'Azúcar, harina de trigo, sal' }, 'F'],
    [{ ingredientes: 'Harina de maíz, sal, cal' }, 'C'],
    [{ ingredientes: 'Arroz, sal. Puede contener trazas de trigo' }, 'D'],
    [{ ingredientes: 'Arroz, sal. Elaborado en equipos que procesan trigo.' }, 'D'],
    [{ ingredientes: 'Arroz, sal. Contiene gluten.' }, 'F'],
    [{ ingredientes: 'Arroz, sal. Puede contener trazas de soya' }, 'C'],
    [{ ingredientes: 'Arroz, sal. May contain wheat.' }, 'D'],
    [{ ingredientes: 'Arroz, sal', trazas: ['en:gluten'] }, 'D'],
    [{ ingredientes: 'Maltodextrina, maltitol, cacao, azúcar' }, 'C'],
    [{ ingredientes: 'Trigo sarraceno, agua, sal' }, 'C'],
    [{ ingredientes: 'Avena, miel' }, 'E'],
    [{ ingredientes: 'Avena sin gluten, miel' }, 'B'],
    [{ ingredientes: 'Arroz, azúcar. Producto sin gluten' }, 'B'],
    [{ ingredientes: 'Arroz, azúcar', etiquetas: ['en:certified-gluten-free'] }, 'A'],
    [{ ingredientes: '' }, 'E'],
    [{ ingredientes: 'Arroz, azúcar. Gluten friendly' }, 'C'],
    [{ ingredientes: 'Harina de arroz, harina de trigo' }, 'F'],
    [{ ingredientes: 'Harina, azúcar' }, 'E'],
    [{ ingredientes: 'Cacao, azúcar', alergenos: ['en:gluten'] }, 'F'],
  ];
  casos.forEach(([p, esperado]) => {
    const r = clasificar_(p, T);
    Logger.log((r.nivel === esperado ? 'OK   ' : 'FALLA') + ' ' + esperado + '→' + r.nivel + '  ' + p.ingredientes + '  (' + r.motivo + ')');
  });
}
