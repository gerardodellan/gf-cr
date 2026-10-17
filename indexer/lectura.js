// Normaliza lo que devuelve el modelo de visión. Pese al prompt, en 5 de 6.486 productos
// (multipacks de varios sabores) devolvió `ingredientes` o `alergenos` como lista u objeto.
// Se aplana todo a un texto: si un sabor del paquete lleva trigo, el término sigue apareciendo.
function texto_(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(texto_).filter(Boolean).join('. ');
  if (typeof v === 'object') return Object.values(v).map(texto_).filter(Boolean).join('. ');
  return String(v);
}

// El modelo a veces contesta la ausencia en prosa ("No se encontraron declaraciones de alérgenos o
// gluten") en vez de dejar el campo vacío. Esa frase contiene la palabra "gluten" y la regla la leía
// como declaración: Malvaviscos Guandy y Jet kolita salieron 🔴 por eso (17-oct). Se descarta.
const NIEGA = /^(no |sin |ninguna |ningun )|no (se |hay |contiene|aparec|present|figur|observ|encontr|identific|menciona|se observa)|^(vacio|vacía|n\/a|ninguno|nada)$/i;
// Una frase que empieza con "No" pero declara la ausencia de gluten SÍ sirve: "No contiene ningún
// alérgeno. Naturalmente libre de gluten" es lo que hace verde a la Jalea Tricopilia.
const DECLARA_GF = /(libre|exento)s? de gluten|sin gluten|gluten[ -]?free/i;
function esNegacion_(t) {
  const s = t.trim();
  if (!s) return true;
  if (DECLARA_GF.test(s) || /contiene\s*:/i.test(s)) return false;
  return NIEGA.test(s);
}

// Texto de etiqueta de una lectura: ingredientes + declaración de alérgenos, como lo espera clasificar_.
function textoLectura_(r) {
  let t = texto_(r.ingredientes).trim();
  const a = texto_(r.alergenos).trim();
  if (a && !esNegacion_(a)) t += (t ? '. ' : '') + 'Alérgenos: ' + a;
  return t;
}

module.exports = { texto_, textoLectura_, esNegacion_ };
