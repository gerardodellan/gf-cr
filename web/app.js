/* Escáner Sin Gluten — PWA. Spec: escaner-sin-gluten-spec-v1.md */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const CFG = window.GF_CONFIG || {};

  // Niveles (spec §1). Textos en el orden y la forma de la app de referencia.
  const NIVELES = {
    A: { color: 'verde', icono: 'i-ok', titulo: 'SIN GLUTEN CERTIFICADO',
         expl: 'El producto tiene sello de certificación sin gluten.' },
    B: { color: 'verde', icono: 'i-ok', titulo: 'SIN GLUTEN',
         expl: 'El empaque dice "sin gluten" (RTCR 457: máximo 20 ppm). Revisá la etiqueta para confirmar.' },
    C: { color: 'amarillo', icono: 'i-warn', titulo: 'Sin ingredientes con gluten',
         expl: 'Revisá la etiqueta para confirmar. No hay información del fabricante sobre contaminación cruzada (por ejemplo, alimentos procesados en equipos compartidos con gluten).' },
    D: { color: 'amarillo', icono: 'i-warn', titulo: 'Puede contener trazas de gluten',
         expl: 'La etiqueta advierte trazas o fabricación en equipos compartidos con trigo o gluten.' },
    E: { color: 'amarillo', icono: 'i-warn', titulo: 'PUEDE CONTENER GLUTEN',
         expl: 'Tiene un ingrediente de riesgo o falta información para clasificarlo. Revisá la etiqueta o agregá una foto de los ingredientes.' },
    F: { color: 'rojo', icono: 'i-no', titulo: 'CONTIENE GLUTEN', expl: '' },
  };

  // ---------- navegación ----------
  const pila = [];
  let actual = null;
  let producto = null;   // último resultado mostrado
  let codigoActual = '';

  function mostrar(v, { push = true } = {}) {
    if (v === 'scan') return abrirEscaner();
    if (push && actual && actual !== v && actual !== 'loading') { pila.push(actual); history.pushState({ v }, ''); }
    document.querySelectorAll('.view').forEach(e => e.classList.toggle('on', e.id === 'v-' + v));
    actual = v;
    document.querySelectorAll('.bottom button').forEach(b => b.classList.toggle('on', b.dataset.tab === v));
    if (v === 'history') pintarHistorial();
    window.scrollTo(0, 0);
  }
  function volverAlInicio() {
    const n = pila.length;
    pila.length = 0;
    if (n) history.go(-n);
    mostrar('history', { push: false });
  }
  function atras() {
    const v = pila.pop();
    mostrar(v || 'history', { push: false });
  }

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-tab],[data-go]');
    if (!t) return;
    cerrarMenu();
    const v = t.dataset.tab || t.dataset.go;
    if (v === 'form') prepararForm();
    mostrar(v);
  });
  // la flecha usa la misma pila que el gesto; si quedan entradas de más en history, el gesto solo muestra el historial
  $('#btn-back').onclick = atras;
  // gesto "atrás" del teléfono: vuelve a la pantalla anterior en vez de cerrar la app
  window.addEventListener('popstate', () => {
    if (!$('#v-scan').hidden) return cerrarEscaner();
    if ($('#drawer').classList.contains('on')) return cerrarMenu();
    atras();
  });
  $('#btn-menu').onclick = () => $('#drawer').classList.add('on');
  $('#scrim').onclick = cerrarMenu;
  function cerrarMenu() { $('#drawer').classList.remove('on'); }
  $('#btn-share').onclick = () => compartir(actual === 'result' ? producto : null);

  // ---------- historial (local, por teléfono) ----------
  const HKEY = 'gf-historial';
  function leerHist() { try { return JSON.parse(localStorage.getItem(HKEY)) || []; } catch { return []; } }
  function guardarHist(h) { try { localStorage.setItem(HKEY, JSON.stringify(h.slice(0, 200))); } catch {} }
  function agregarHist(p) {
    guardarHist([{ codigo: p.codigo, nombre: p.nombre, marca: p.marca, nivel: p.nivel, motivo: p.motivo,
                   fuente: p.fuente, fecha_consulta: p.fecha_consulta, revisado: p.revisado, ts: Date.now() },
                 ...leerHist().filter(x => x.codigo !== p.codigo)]);
  }
  function pintarHistorial() {
    const h = leerHist();
    $('#hist-vacio').style.display = h.length ? 'none' : 'block';
    $('#hist').innerHTML = '';
    h.forEach(p => {
      const n = NIVELES[p.nivel] || NIVELES.E;
      const li = document.createElement('li');
      li.innerHTML = `<svg class="hi v-${n.color}"><use href="#${n.icono}"/></svg><span class="hn"></span><svg class="hc"><use href="#i-chev"/></svg>`;
      li.querySelector('.hi').style.color = getComputedStyle(document.documentElement).getPropertyValue('--' + (n.color === 'verde' ? 'verde-icono' : n.color));
      li.querySelector('.hn').textContent = p.nombre || p.codigo;
      li.onclick = () => { codigoActual = p.codigo; pintarResultado(p); mostrar('result'); consultar(p.codigo, { silencioso: true }); };
      $('#hist').appendChild(li);
    });
  }

  // ---------- índice local (alimentos de MaxiPalí, se regenera cada noche) ----------
  let indice = null;
  fetch('datos/indice.json').then(r => r.ok ? r.json() : null).then(j => { indice = j; }).catch(() => {});
  const canon = c => (c.length === 13 && c[0] === '0' ? c.slice(1) : c);
  function buscarIndice(codigo) {
    const x = indice && indice.p[canon(codigo)];
    if (!x) return null;
    const fecha = f => f.split('-').reverse().join('-');
    // x[3] = '' si MaxiPalí lo lista hoy; si no, la fecha desde la que no lo lista (el dato de gluten sigue valiendo)
    return { codigo: canon(codigo), encontrado: true, nombre: x[0], marca: '', nivel: x[1], motivo: x[2],
             fuente: x[3] ? 'MP-baja' : 'MP', fecha_consulta: x[3] ? 'ya no lo lista desde ' + fecha(x[3]) : fecha(indice.v), revisado: false };
  }

  // ---------- correcciones hechas en este teléfono (ganan sobre el índice y la API; sirven sin señal) ----------
  const CKEY = 'gf-correcciones';
  function leerCorr() { try { return JSON.parse(localStorage.getItem(CKEY)) || {}; } catch { return {}; } }
  function guardarCorr(p) {
    const c = leerCorr();
    c[canon(p.codigo)] = p;
    try { localStorage.setItem(CKEY, JSON.stringify(c)); } catch {}
  }

  // ---------- API ----------
  async function consultar(codigo, { silencioso = false } = {}) {
    codigoActual = codigo;
    const corr = leerCorr()[canon(codigo)];
    if (corr) {
      if (silencioso) return;
      agregarHist(corr);
      pintarResultado(corr);
      return mostrar('result');
    }
    // índice primero: respuesta instantánea y sin señal; después la API refresca en silencio
    // (trae una revisión manual o un dato más nuevo si lo hay)
    const local = !silencioso && buscarIndice(codigo);
    if (local) {
      agregarHist(local);
      pintarResultado(local);
      mostrar('result');
      if (navigator.onLine) consultar(codigo, { silencioso: true });
      return;
    }
    if (!silencioso) mostrar('loading');
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 20000);
      const r = await fetch(`${CFG.API}?codigo=${encodeURIComponent(codigo)}&t=${encodeURIComponent(CFG.TOKEN)}`, { signal: ctl.signal });
      clearTimeout(to);
      const j = await r.json();
      if (j.error) throw new Error({ codigo: 'Código no válido', off: 'La fuente de datos no respondió. Probá de nuevo en un minuto.' }[j.error] || j.error);
      if (!j.encontrado) {
        if (silencioso) return;
        $('#nf-codigo').textContent = codigo;
        return mostrar('notfound');
      }
      agregarHist(j);
      // en silencio solo se repinta si el usuario sigue mirando ese producto
      if (!silencioso || (actual === 'result' && producto && canon(producto.codigo) === canon(j.codigo))) pintarResultado(j);
      if (!silencioso) mostrar('result');
    } catch (err) {
      if (silencioso) return;
      alert(err.name === 'AbortError' ? 'Sin respuesta del servidor. Revisá la conexión.' :
            (navigator.onLine ? err.message : 'Sin conexión.'));
      mostrar('history');
    }
  }

  function pintarResultado(p) {
    producto = p;
    const n = NIVELES[p.nivel] || NIVELES.E;
    const v = $('#v-result');
    v.classList.remove('v-verde', 'v-amarillo', 'v-rojo');
    v.classList.add('v-' + n.color);
    $('#r-nombre').textContent = p.nombre || 'Producto sin nombre';
    $('#r-icon').innerHTML = `<use href="#${n.icono}"/>`;
    $('#r-nivel').textContent = n.titulo;
    $('#r-expl').textContent = n.expl;
    $('#r-expl').style.display = n.expl ? 'block' : 'none';
    $('#r-motivo').textContent = p.motivo || '—';
    const fuente = { MP: 'MaxiPalí', 'MP-baja': 'MaxiPalí', OFF: 'Open Food Facts', manual: 'Agregado a mano', sello: 'Lista de sello' }[p.fuente] || p.fuente || '—';
    $('#r-fuente').textContent = fuente + (p.por ? ' por ' + p.por : '') + (p.fecha_correccion ? ' · ' + p.fecha_correccion : p.fecha_consulta ? ' · ' + p.fecha_consulta : '') + (p.revisado ? ' · revisado' : ' · sin revisar');
    $('#r-codigo').textContent = p.codigo;
  }

  $('#r-del').onclick = () => {
    if (!producto) return;
    guardarHist(leerHist().filter(x => x.codigo !== producto.codigo));
    volverAlInicio();
  };
  $('#r-share').onclick = () => compartir(producto);
  function compartir(p) {
    const text = p ? `Consulté ${p.nombre} — ${p.marca || ''}\n\n${(NIVELES[p.nivel] || NIVELES.E).titulo}.\n\nFuente: Escáner Sin Gluten`
                   : 'Escáner Sin Gluten';
    if (navigator.share) navigator.share({ title: 'Escáner Sin Gluten', text, url: p ? undefined : location.href }).catch(() => {});
  }

  // ---------- alta / corrección ----------
  let fotoB64 = '';
  function prepararForm() {
    const f = $('#form');
    f.reset();
    fotoB64 = '';
    $('#f-prev').style.display = 'none';
    $('#f-msg').textContent = '';
    $('#f-send').disabled = false;
    $('#f-codigo').textContent = codigoActual;
    f.aplicar.checked = true;
    try { f.por.value = localStorage.getItem('gf-nombre') || ''; } catch {}
    if (producto && producto.codigo === codigoActual) {
      f.nombre.value = producto.nombre || '';
      f.marca.value = producto.marca || '';
    }
  }
  $('#form').foto.onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    $('#f-send').disabled = true;
    $('#f-msg').textContent = 'Preparando la foto…';
    try { fotoB64 = await achicar(file, 1600, 0.8); } catch { fotoB64 = ''; $('#f-msg').textContent = 'No se pudo leer la foto.'; }
    $('#f-send').disabled = false;
    if (fotoB64) $('#f-msg').textContent = '';
    $('#f-prev').src = fotoB64;
    $('#f-prev').style.display = 'block';
  };
  // modelo del teléfono (ej. "Pixel 6a", "SM-S931B"); Chrome lo da solo a pedido
  async function modelo() {
    try { return (await navigator.userAgentData.getHighEntropyValues(['model'])).model || ''; } catch { return ''; }
  }
  function achicar(file, lado, q) {
    return new Promise((ok, mal) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, lado / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        ok(c.toDataURL('image/jpeg', q));
      };
      img.onerror = mal;
      img.src = URL.createObjectURL(file);
    });
  }
  $('#form').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    try { localStorage.setItem('gf-nombre', f.por.value.trim()); } catch {}
    $('#f-send').disabled = true;
    $('#f-msg').textContent = 'Enviando…';
    try {
      // text/plain a propósito: application/json dispara preflight y Apps Script no lo contesta
      const r = await fetch(CFG.API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ t: CFG.TOKEN, codigo: codigoActual, nombre: f.nombre.value, marca: f.marca.value,
                               etiqueta: f.etiqueta.value, mensaje: f.mensaje.value, foto_base64: fotoB64,
                               aplicar: f.aplicar.checked, por: f.por.value.trim(), dispositivo: await modelo() }) });
      const j = await r.json();
      if (!j.ok) throw new Error({ limite: 'se alcanzó el límite de altas de hoy', foto: 'la foto es muy grande' }[j.error] || j.error || 'error');
      if (j.aplicado) {
        guardarCorr(j.aplicado);
        agregarHist(j.aplicado);
        $('#f-msg').textContent = 'Listo. Desde ahora sale: ' + (NIVELES[j.aplicado.nivel] || NIVELES.E).titulo + '.';
        setTimeout(() => { volverAlInicio(); codigoActual = j.aplicado.codigo; pintarResultado(j.aplicado); mostrar('result'); }, 1400);
        return;
      }
      $('#f-msg').textContent = '¡Gracias! Queda en ALERTA hasta que se revise.';
      setTimeout(volverAlInicio, 1600);
    } catch (err) {
      $('#f-msg').textContent = 'No se pudo enviar: ' + err.message;
      $('#f-send').disabled = false;
    }
  };

  // ---------- escáner ----------
  let stream = null, detector = null, corriendo = false, sonido = true;
  try { sonido = localStorage.getItem('gf-sonido') !== '0'; } catch {}
  $('#btn-sound').classList.toggle('off', !sonido);

  async function abrirEscaner() {
    cerrarMenu();
    if ($('#v-scan').hidden) history.pushState({ scan: 1 }, '');  // "atrás" cierra el escáner, no la app
    $('#v-scan').hidden = false;
    $('#sc-err').textContent = '';
    if (!('BarcodeDetector' in window)) {
      $('#sc-err').textContent = 'Este navegador no lee códigos de barras. Usá "Escribir código".';
      return;
    }
    try {
      detector = detector || new BarcodeDetector({ formats: ['ean_13', 'upc_a', 'ean_8', 'upc_e'] });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      const v = $('#video');
      v.srcObject = stream;
      await v.play();
      const track = stream.getVideoTracks()[0];
      const cap = track.getCapabilities ? track.getCapabilities() : {};
      $('#btn-flash').style.display = cap.torch ? 'grid' : 'none';
      corriendo = true;
      buscar();
    } catch (err) {
      $('#sc-err').textContent = err.name === 'NotAllowedError' ? 'Sin permiso para la cámara.' : 'No se pudo abrir la cámara: ' + err.message;
    }
  }
  async function buscar() {
    if (!corriendo) return;
    try {
      const r = await detector.detect($('#video'));
      if (r.length) {
        const codigo = r[0].rawValue;
        if (sonido) beep();
        if (navigator.vibrate) navigator.vibrate(60);
        cerrarEscaner();
        return consultar(upcAEan(codigo, r[0].format));
      }
    } catch {}
    setTimeout(buscar, 120);
  }
  // UPC-E se expande a UPC-A para que coincida con la base
  function upcAEan(c, fmt) {
    if (fmt !== 'upc_e' || c.length !== 8) return c;
    const [s, a, b, cc, d, e, f, chk] = c.split('');
    const m = { 0: a + b + '00000' + cc + d + e, 1: a + b + '10000' + cc + d + e, 2: a + b + '20000' + cc + d + e,
                3: a + b + cc + '00000' + d + e, 4: a + b + cc + d + '00000' + e }[f] || a + b + cc + d + e + '0000' + f;
    return s + m + chk;
  }
  function cerrarEscaner() {
    corriendo = false;
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    $('#v-scan').hidden = true;
  }
  $('#btn-cancel').onclick = () => history.back();  // popstate cierra el escáner
  $('#btn-manual').onclick = () => {
    const f = $('#sc-manual');
    f.hidden = !f.hidden;
    if (!f.hidden) $('#sc-input').focus();
  };
  $('#sc-manual').onsubmit = e => {
    e.preventDefault();
    const c = $('#sc-input').value.replace(/\D/g, '');
    if (!c) return;
    $('#sc-input').value = '';
    $('#sc-manual').hidden = true;
    cerrarEscaner();
    consultar(c);
  };
  $('#btn-sound').onclick = () => {
    sonido = !sonido;
    $('#btn-sound').classList.toggle('off', !sonido);
    try { localStorage.setItem('gf-sonido', sonido ? '1' : '0'); } catch {}
  };
  let linterna = false;
  $('#btn-flash').onclick = async () => {
    if (!stream) return;
    linterna = !linterna;
    try { await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: linterna }] }); } catch {}
    $('#btn-flash').classList.toggle('off', !linterna);
  };
  function beep() {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = 1800; g.gain.value = 0.15;
      o.connect(g); g.connect(ac.destination);
      o.start(); o.stop(ac.currentTime + 0.09);
    } catch {}
  }

  // al salir de la app la cámara se apaga; al volver, se reabre si estaba escaneando
  let reabrir = false;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && corriendo) { reabrir = true; cerrarEscaner(); }
    else if (!document.hidden && reabrir) { reabrir = false; abrirEscaner(); }
  });

  // ---------- arranque: como la referencia, abre directo en el escáner ----------
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  mostrar('history', { push: false });
  if (!CFG.API) { alert('Falta configurar la API (config.js).'); return; }
  // ?codigo=… abre directo el resultado (pruebas y enlaces compartidos)
  const directo = new URLSearchParams(location.search).get('codigo');
  if (directo) consultar(directo.replace(/\D/g, ''));
  else abrirEscaner();
})();
