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
const CACHE_SEG = 3600;
const MAX_FOTO_BYTES = 1500000;
const MAX_ALTAS_DIA = 50;
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
  ['levadura de cerveza', 'es', 'ROJO', ''], ['cerveza', 'es', 'ROJO', ''], ['beer', 'en', 'ROJO', ''],
  ['pan rallado', 'es', 'ROJO', ''], ['galleta', 'es', 'AMARILLO', 'sin especie; "galleta de arroz" no cuenta'],
  ['fideos', 'es', 'AMARILLO', 'sin especie; "fideos de arroz" no cuenta'], ['fideo', 'es', 'AMARILLO', ''],
  ['almidon', 'es', 'AMARILLO', 'sin origen; "almidón de maíz/papa/yuca" no cuenta'], ['starch', 'en', 'AMARILLO', 'sin origen'],
  ['farro', 'es', 'ROJO', ''], ['einkorn', 'en', 'ROJO', ''], ['emmer', 'en', 'ROJO', ''], ['durum', 'en', 'ROJO', ''],
  ['salsa de soya', 'es', 'AMARILLO', 'suele llevar trigo'], ['soy sauce', 'en', 'AMARILLO', ''],
  ['hydrolyzed vegetable protein', 'en', 'AMARILLO', 'sin origen'], ['modified food starch', 'en', 'AMARILLO', 'sin origen'],
  ['almidon alimenticio modificado', 'es', 'AMARILLO', 'sin origen'],
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
    // caché en memoria: abrir la Sheet cuesta ~4 s; un acierto acá responde sin tocarla.
    // Costo aceptado: un acierto no suma al contador `escaneos`, y una revisión a mano tarda hasta CACHE_SEG en verse.
    const cache = CacheService.getScriptCache();
    const hit = cache.get('p:' + codigo);
    if (hit) return json_(JSON.parse(hit));
    const r = consultar_(codigo);
    cache.put('p:' + codigo, JSON.stringify(Object.assign({}, r, { nuevo: false })), r.encontrado ? CACHE_SEG : 900);
    return json_(r);
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
  // una sola forma por producto: EAN-13 con 0 inicial = UPC-A de 12
  return c.length === 13 && c[0] === '0' ? c.slice(1) : c;
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
    if (r.revisado === true || !['OFF', 'MP'].includes(r.fuente) || fresco) return salida_(r, false);
  }
  // Orden de fuentes (decisión de Gerardo, 16-oct): la tienda local primero; Open Food Facts solo si la tienda
  // no tiene el producto o su texto no alcanza para clasificar (nivel E por falta de información).
  const T = terminos_();
  let fuente = 'MP', prod = consultarMaxiPali_(codigo), c = prod && clasificar_(prod, T);
  if (!prod || (c.nivel === 'E' && c.motivo === 'Sin información suficiente')) {
    let off = null;
    try { off = consultarOFF_(codigo); } catch (err) { if (!prod) throw err; }
    if (off) {
      const cOff = clasificar_(off, T);
      // con texto de la tienda, OFF solo reemplaza si da más información (no un "sin información" igual)
      if (!prod || cOff.motivo !== 'Sin información suficiente') {
        prod = { ...off, nombre: (prod && prod.nombre) || off.nombre, marca: (prod && prod.marca) || off.marca };
        c = cOff; fuente = 'OFF';
      }
    }
  }
  if (!prod) {
    if (fila) return salida_(filaAObj_(sh, fila), false);
    return { codigo: codigo, encontrado: false };
  }
  const off = prod;
  const r = {
    codigo: codigo, nombre: off.nombre, marca: off.marca, nivel: c.nivel, estado: NIVEL_ESTADO[c.nivel],
    motivo: c.motivo, ingredientes: off.ingredientes, fuente: fuente, fecha_consulta: ahora,
    revisado: false, url_foto: '', escaneos: 1,
  };
  if (fila) {
    const prev = filaAObj_(sh, fila);
    r.escaneos = Number(prev.escaneos) || 1;
    r.url_foto = prev.url_foto || '';
    sh.getRange(fila, 1, 1, HOJAS.productos.length).setValues([HOJAS.productos.map(k => celda_(r[k]))]);
  } else {
    sh.appendRow(HOJAS.productos.map(k => celda_(r[k])));
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

/** MaxiPalí (VTEX público, Walmart CR). Los UPC-A se guardan con 0 inicial (13 dígitos). */
function consultarMaxiPali_(codigo) {
  const variantes = codigo.length === 12 ? ['0' + codigo, codigo] : [codigo];
  for (const ean of variantes) {
    const url = 'https://www.maxipali.co.cr/api/catalog_system/pub/products/search?fq=alternateIds_Ean:' + ean + '&sc=3';
    let res;
    try { res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'User-Agent': UA } }); } catch (e) { return null; }
    if (res.getResponseCode() !== 200 && res.getResponseCode() !== 206) return null;
    const d = JSON.parse(res.getContentText());
    if (!d.length) continue;
    const p = d[0];
    const campo = k => (Array.isArray(p[k]) ? p[k].join('; ') : p[k] || '').trim();
    let txt = campo('Listado de ingredientes');
    const alerg = campo('Productos alérgenos');
    if (alerg && !/^(si|sí|no|n\/a)$/i.test(alerg)) txt = (txt ? txt + '. ' : '') + 'Alérgenos: ' + alerg;
    return { nombre: p.productName || '', marca: p.brand || '', ingredientes: txt };
  }
  return null;
}

function consultarOFF_(codigo) {
  const campos = 'product_name,product_name_es,brands,ingredients_text_es,ingredients_text_en,ingredients_text,lang,ingredients_tags,allergens_tags,traces_tags,labels_tags';
  const url = 'https://world.openfoodfacts.org/api/v2/product/' + codigo + '.json?fields=' + campos;
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'User-Agent': UA } });
  const http = res.getResponseCode();
  // 404 = no existe. Cualquier otro error (429, 5xx) NO es "no encontrado": se avisa como falla de la fuente
  if (http === 404) return null;
  if (http !== 200) throw new Error('off');
  const j = JSON.parse(res.getContentText());
  if (j.status !== 1 || !j.product) return null;
  const p = j.product;
  return {
    nombre: p.product_name_es || p.product_name || '',
    marca: (p.brands || '').split(',')[0].trim(),
    // texto en otro idioma (fr, de…) sin traducción: no se lee como lista completa; los tags sí valen
    ingredientes: p.ingredients_text_es || p.ingredients_text_en ||
      (['es', 'en'].includes(p.lang) ? p.ingredients_text || '' : ''),
    ingredientes_tags: p.ingredients_tags || [],
    alergenos: p.allergens_tags || [], trazas: p.traces_tags || [], etiquetas: p.labels_tags || [],
  };
}

// ---------- regla (spec §1) ----------

function terminos_() {
  // la lista del código siempre aplica; la Sheet solo suma términos (borrar una fila de la Sheet no apaga uno base)
  const base = TERMINOS_INICIALES.map(r => [r[0], r[1], r[2]]);
  const sh = hoja_('prohibidos');
  const extra = sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
  const vistos = {};
  return base.concat(extra).filter(r => r[0]).map(r => ({ termino: plano_(r[0]), nivel: String(r[2]).toUpperCase().trim() }))
    .filter(t => !vistos[t.termino + t.nivel] && (vistos[t.termino + t.nivel] = true));
}

/** Sin tildes, minúsculas. */
function plano_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`´]/g, "'").toLowerCase().trim();
}

const FRASES_SIN_GLUTEN = ['sin gluten', 'libre de gluten', 'exento de gluten', 'no contiene gluten', 'gluten free', 'gluten-free',
  'glutenfree', 'free from gluten', 'libres de gluten', 'libre de gluten', 'exentos de gluten'];
const NEGACIONES = /sin trigo|no contiene trigo|wheat free|wheat-free/g;
// placeholders que OFF guarda como si fueran la lista de ingredientes
const PLACEHOLDER = /ver (la )?etiqueta|see (the )?package|^ingredientes?:?$|^ingredients?:?$|por cada 100 ?g|energia total|valor energetico|nutrition facts/;
// lista cortada ("…; entre otros", "etc."): no es completa, nunca puede dar C
const CORTADA = /entre otros|\betc\b|y otros ingredientes|among others/;
const FRASES_TRAZAS = ['trazas', 'puede contener',
  '(fabricado|elaborado|procesado|envasado|producido) en (una |la |las |los )?(planta|plantas|fabrica|linea|lineas|equipo|equipos|instalaciones)',
  '(equipo|equipos|linea|lineas|planta) que (tambien )?procesa', 'may contain', 'processed in a facility', 'manufactured in a facility', 'made in a facility', 'shared equipment'];
const HARINAS_SIN_GLUTEN = ['alforfon', 'sorgo', 'amaranto', 'teff', 'buckwheat', 'sorghum', 'amaranth', 'maiz', 'arroz', 'yuca', 'papa', 'almendra', 'coco', 'garbanzo', 'soya', 'soja', 'platano', 'quinoa',
  'corn', 'rice', 'almond', 'coconut', 'potato', 'tapioca', 'chickpea'];

function clasificar_(p, terminos) {
  const txt = plano_(p.ingredientes);
  // se borran las frases "sin gluten" para que "gluten" no dispare ROJO sobre ellas
  // "gluten friendly" no es declaración reconocida (Salud, jun-2026): se ignora
  let txtLimpio = [...FRASES_SIN_GLUTEN, 'gluten friendly'].reduce((t, f) => t.split(f).join(' '), txt)
    .replace(/trigo sarraceno|buckwheat/g, 'alforfon').replace(/semola de maiz|corn semolina/g, ' ').replace(NEGACIONES, ' ');
  // la cláusula de trazas ("puede contener trazas de trigo.") no es ingrediente: se evalúa en la fila 3
  FRASES_TRAZAS.forEach(f => { txtLimpio = txtLimpio.replace(new RegExp(f + '[^.;]*', 'g'), ' '); });
  const tags = a => (a || []).map(plano_);
  const alerg = tags(p.alergenos), trazas = tags(p.trazas), etiq = tags(p.etiquetas);
  // la línea "Alérgenos: …" no es lista de ingredientes: sin lista real no hay C
  const lista = txt.replace(/(alergenos|allergens|contiene)\s*:[^]*$/, '').replace(/[.;:\s]+$/, '');
  const completo = !PLACEHOLDER.test(txt) && !CORTADA.test(txt) && lista.length >= 3;

  // fila 2 — ROJO. Los tags de OFF valen aunque el texto venga en otro idioma
  const TAGS_ROJO = ['en:wheat', 'en:wheat-flour', 'en:whole-wheat', 'en:barley', 'en:rye', 'en:malt', 'en:spelt', 'en:kamut',
    'en:triticale', 'en:seitan', 'en:gluten', 'en:durum-wheat', 'en:wheat-starch', 'en:barley-malt', 'en:wheat-gluten'];
  const tagRojo = tags(p.ingredientes_tags).find(t => TAGS_ROJO.includes(t));
  if (tagRojo) return { nivel: 'F', motivo: 'Ingrediente: ' + tagRojo.replace('en:', '') };
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
      const clausula = m[0].replace(/trigo sarraceno|buckwheat/g, 'alforfon').replace(NEGACIONES, ' ');
      // OCR sin puntos: la cláusula se come los ingredientes que siguen ("trazas de maní, harina de trigo")
      if (/(harina|almidon|jarabe|extracto|semola|proteina|salvado|germen) de (trigo|cebada|centeno|malta)|(wheat|barley|rye|malt) (flour|starch|extract|syrup|protein)|contiene:? (trigo|gluten|cebada|centeno)|contains:? (wheat|gluten|barley|rye)/.test(clausula))
        return { nivel: 'F', motivo: 'Contiene: ' + clausula.trim().slice(0, 60) };
      if (rojos.some(t => palabra_(clausula, t.termino))) return { nivel: 'D', motivo: 'Etiqueta: "' + m[0].trim() + '"' };
    }
  }
  // fila 4 — ingrediente de riesgo
  // la declaración vale también en el nombre del producto ("… Libre de Gluten")
  const nombre = plano_(p.nombre);
  const dicenSinGluten = FRASES_SIN_GLUTEN.some(f => txt.includes(f) || nombre.includes(f));
  for (const t of terminos.filter(t => t.nivel === 'AMARILLO')) {
    if (!palabra_(txtLimpio, t.termino)) continue;
    if ((t.termino === 'avena' || t.termino.startsWith('oat')) && dicenSinGluten) continue;
    if (['harina', 'flour', 'almidon', 'starch', 'galleta', 'fideos', 'fideo'].includes(t.termino) && harinaConEspecie_(txtLimpio, t.termino)) continue;
    return { nivel: 'E', motivo: 'Ingrediente de riesgo: ' + t.termino };
  }
  // fila 5 — sello o frase legal, con ingredientes completos
  const certificado = etiq.some(e => e.includes('certified-gluten-free'));
  const etiquetaGF = etiq.includes('en:gluten-free') || etiq.includes('en:no-gluten') || dicenSinGluten;
  if (completo && certificado) return { nivel: 'A', motivo: 'Sello sin gluten certificado' };
  // B no exige lista completa: la declaración "sin gluten" (RTCR 457) es del fabricante; solo exige que no haya ROJO ni trazas
  if (etiquetaGF && !PLACEHOLDER.test(txt)) return { nivel: 'B', motivo: 'Etiquetado "sin gluten"' };
  // fila 6
  if (completo) return { nivel: 'C', motivo: 'Sin ingredientes con gluten' };
  return { nivel: 'E', motivo: 'Sin información suficiente' };
}

function palabra_(txt, termino) {
  const esc = termino.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^a-z])' + esc + '(e?s)?($|[^a-z])').test(txt);
}

/** true si TODAS las apariciones de "harina"/"flour" llevan una especie sin gluten. */
function harinaConEspecie_(txt, termino) {
  const enIngles = termino === 'flour' || termino === 'starch';
  const re = enIngles ? new RegExp('([a-z]+) ' + termino, 'g') : new RegExp(termino + '(e?s)?( modificado)?( de| integral de)? ([a-z]+)', 'g');
  let m, alguna = false;
  while ((m = re.exec(txt)) !== null) {
    alguna = true;
    const especie = enIngles ? m[1] : m[4];
    if (!HARINAS_SIN_GLUTEN.includes(especie) && !HARINAS_SIN_GLUTEN.includes(especie.replace(/e?s$/, ''))) return false;
  }
  return alguna;
}

// ---------- alta manual ----------

function altaManual_(codigo, b) {
  CacheService.getScriptCache().remove('p:' + codigo);
  const cache = CacheService.getScriptCache();
  const kDia = 'altas:' + Utilities.formatDate(new Date(), 'America/Costa_Rica', 'yyyyMMdd');
  const altas = Number(cache.get(kDia) || 0);
  if (altas >= MAX_ALTAS_DIA) throw new Error('limite');
  cache.put(kDia, String(altas + 1), 86400);
  if (b.foto_base64 && String(b.foto_base64).length > MAX_FOTO_BYTES * 1.4) throw new Error('foto');
  let url = '';
  if (b.foto_base64) {
    const bytes = Utilities.base64Decode(String(b.foto_base64).replace(/^data:[^,]+,/, ''));
    if (bytes.length > MAX_FOTO_BYTES) throw new Error('foto');
    const carpeta = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('FOLDER_ID'));
    const f = carpeta.createFile(Utilities.newBlob(bytes, 'image/jpeg', codigo + '-' + Date.now() + '.jpg'));
    url = f.getUrl();
  }
  const corto = (s, n) => celda_(String(s || '').slice(0, n));
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

/** Un texto que empieza con = + - @ se escribiría como fórmula: se fuerza a texto. */
function celda_(v) {
  return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v;
}

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
    // revisión Fable 16-oct
    [{ ingredientes: '', ingredientes_tags: ['en:wheat-flour'] }, 'F'],
    [{ ingredientes: 'Puede contener trazas de maní, harina de trigo, azúcar' }, 'F'],
    [{ ingredientes: 'Harina de trigos, sal' }, 'F'],
    [{ ingredientes: 'Maltas tostadas, lúpulo' }, 'F'],
    [{ ingredientes: 'Levadura de cerveza, sal' }, 'F'],
    [{ ingredientes: 'Pan rallado, sal' }, 'F'],
    [{ ingredientes: 'Rice, brewer’s yeast' }, 'F'],
    [{ ingredientes: 'Arroz, maíz. No contiene gluten' }, 'B'],
    [{ ingredientes: 'Arroz, maíz. Sin trigo' }, 'C'],
    [{ ingredientes: 'Sémola de maíz, sal' }, 'C'],
    [{ ingredientes: 'Ver etiqueta del empaque' }, 'E'],
    [{ ingredientes: 'Arroz, sal. Fabricado en una fábrica que procesa trigo' }, 'D'],
    [{ ingredientes: 'Harina de trigo sarraceno, agua. Sin gluten' }, 'B'],
    [{ ingredientes: 'Harina de garbanzos, sal' }, 'C'],
    [{ ingredientes: 'Salsa de soya, azúcar' }, 'E'],
    [{ ingredientes: 'Rice, salt. May contain soy, contains wheat' }, 'F'],
    [{ ingredientes: 'Azúcar, agua, aceite vegetal, mora; entre otros' }, 'E'],
    [{ ingredientes: 'Harina de trigo, cacao, azúcar; entre otros' }, 'F'],
    [{ ingredientes: 'Maíz, sal; entre otros. Sin gluten' }, 'B'],
    [{ ingredientes: 'Alérgenos: Contiene huevo; puede contener soya' }, 'E'],
    [{ ingredientes: 'Tomate, agua, azúcar, almidón, sal' }, 'E'],
    [{ ingredientes: 'Tomate, agua, almidón de maíz, sal' }, 'C'],
    [{ ingredientes: 'Arroz' }, 'C'],
    [{ ingredientes: 'Por cada 100g, energía total 550 kJ' }, 'E'],
    [{ ingredientes: 'Gelatina, color. Hecho en equipo que procesa gluten' }, 'D'],
    [{ ingredientes: 'Fideos de arroz, sal, cebolla' }, 'C'],
    [{ ingredientes: 'Harina de maíz, almidón de maíz', nombre: 'Palitos de maíz libres de gluten' }, 'B'],
    [{ ingredientes: 'Cacao, azúcar', alergenos: ['en:gluten'] }, 'F'],
  ];
  casos.forEach(([p, esperado]) => {
    const r = clasificar_(p, T);
    Logger.log((r.nivel === esperado ? 'OK   ' : 'FALLA') + ' ' + esperado + '→' + r.nivel + '  ' + p.ingredientes + '  (' + r.motivo + ')');
  });
}
