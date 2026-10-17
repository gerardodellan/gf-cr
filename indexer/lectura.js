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

// Texto de etiqueta de una lectura: ingredientes + declaración de alérgenos, como lo espera clasificar_.
function textoLectura_(r) {
  let t = texto_(r.ingredientes).trim();
  const a = texto_(r.alergenos).trim();
  if (a) t += (t ? '. ' : '') + 'Alérgenos: ' + a;
  return t;
}

module.exports = { texto_, textoLectura_ };
