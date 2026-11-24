/* =====================================================================
   Sinodal — motor genérico del examen en línea (derivado del piloto LEM537)
   Lógica de la aplicación: registro, render de reactivos, autoguardado,
   registro de integridad y disparo de la generación del PDF.
   ===================================================================== */
(function () {
  'use strict';

  var B = window.EXAMEN_BANCO;
  var V = window.EXAMEN_VAR;
  var PREFIJO = B.meta.prefijoArchivo || (B.meta.clave + '_EX');
  var CARGA = Date.now();   // hora de carga: el tiempo en la portada no cuenta como tiempo fuera
  var CC = B.analisis || [];  // Sección C · Análisis (vacía en bancos anteriores a la 0.4)
  var TEORIA = B.meta.estiloA !== 'criterio';
  var DD = B.opcion_multiple || [];   // Sección D · Opción múltiple (0.5; vacía en bancos anteriores)
  var LETRAS = 'abcdef';
  // Fórmulas (0.5): solo en bancos con notación LaTeX y si cargó assets/matematicas.js.
  var MATE = (B.meta.notacion === 'latex' && window.EXAMEN_MATE) ? window.EXAMEN_MATE : null;
  // Presentación (0.5.1). Sin los campos en banco.js, el examen se ve y se comporta como en la 0.5.0.
  var MEZCLA = B.meta.ordenAleatorio === true;   // orden propio de la matrícula y la sesión dentro de cada sección
  var UNO = B.meta.unoPorVez === true;           // un reactivo a la vez, solo hacia adelante
  /* Listas con las que trabaja el examen (0.6). Sin composición son las del banco, como siempre. Con
     meta.composicion, al iniciar la sesión se reducen a la selección del alumno (aplicaSeleccion) y todo lo demás
     —tarjetas, progreso, pendientes, un reactivo a la vez, PDF— trabaja solo con ella. */
  var AA = B.teoricos, BB = B.numericos;
  var COMPLETO = { teoricos: AA, numericos: BB, analisis: CC, opcion_multiple: DD };   // el banco publicado, entero

  // ------------------------------------------- tipos y composición (0.6)
  /* Paridad con sinodal/composicion.py. El tipo de un reactivo es su campo `tipo` si es uno de los de su lista
     (diseno en numericos, completar en opcion_multiple); si no, el de la lista. Un banco.js sin `tipo`, sin `fijo`
     y sin meta.composicion produce el examen de la 0.5. */
  var TIPOS = ['teorico', 'ensayo', 'numerico', 'diseno', 'caso', 'opcion_multiple', 'completar'];
  var LISTAS = ['teoricos', 'numericos', 'analisis', 'opcion_multiple'];
  var LISTA_DE_TIPO = { teorico: 'teoricos', ensayo: 'teoricos', numerico: 'numericos', diseno: 'numericos',
    caso: 'analisis', opcion_multiple: 'opcion_multiple', completar: 'opcion_multiple' };
  var TIPO_POR_OMISION = { teoricos: 'teorico', numericos: 'numerico', analisis: 'caso',
    opcion_multiple: 'opcion_multiple' };

  function tipoDe(r, lista) {
    var t = String((r && r.tipo) || '').trim().toLowerCase();
    return TIPOS.indexOf(t) >= 0 && LISTA_DE_TIPO[t] === lista ? t : TIPO_POR_OMISION[lista];
  }
  function esCompletar(r) { return tipoDe(r, 'opcion_multiple') === 'completar'; }
  function esEnsayo(r) { return tipoDe(r, 'teoricos') === 'ensayo'; }

  /* Ensayo (0.6.1). Palabras: trozos separados por espacios con al menos una letra o un número (paridad con
     composicion.cuenta_palabras). Extensión pedida: la del reactivo o, si no la trae, de 250 a 600. */
  function cuentaPalabras(t) {
    return String(t || '').split(/\s+/).filter(function (w) {
      return /[0-9A-Za-z\u00AA\u00B2\u00B3\u00B5\u00B9\u00BA\u00BC-\u00BE\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F\u0370-\u03FF\u0400-\u04FF]/.test(w);
    }).length;
  }
  function palabrasDe(r) {
    var p = r && r.palabras, lo = p && parseInt(p.min, 10), hi = p && parseInt(p.max, 10);
    if (!(lo >= 1)) lo = 250;
    if (!(hi >= 1)) hi = 600;
    return lo <= hi ? [lo, hi] : [hi, lo];
  }
  function esDiseno(r) { return tipoDe(r, 'numericos') === 'diseno'; }

  /* Composición saneada, como composicion.leer: tipo conocido y sin repetir, cantidad entera de 1 o más y puntos
     de 0 o más. [] si el examen no se arma por composición. */
  function leeComposicion(meta) {
    var crudo = meta && meta.composicion, out = [], vistos = {};
    function numero(x, entero) {
      if (typeof x === 'boolean') return x ? 1 : 0;
      if (typeof x === 'number') return isFinite(x) ? (entero ? (x < 0 ? Math.ceil(x) : Math.floor(x)) : x) : null;
      if (typeof x !== 'string') return null;
      var t = x.trim();
      if (entero) return /^[-+]?\d+$/.test(t) ? parseInt(t, 10) : null;
      return /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t) ? parseFloat(t) : null;
    }
    (Array.isArray(crudo) ? crudo : []).forEach(function (e) {
      if (!e || typeof e !== 'object' || Array.isArray(e)) return;
      var t = String(e.tipo || '').trim().toLowerCase(), n = numero(e.cantidad, true), p = numero(e.puntos, false);
      if (n === null || p === null || TIPOS.indexOf(t) < 0 || vistos[t] === true || n < 1 || !(p >= 0)) return;
      vistos[t] = true;
      out.push({ tipo: t, cantidad: n, puntos: p });
    });
    return out;
  }
  var COMP = leeComposicion(B.meta);

  // ------------------------------------------------------------------ util
  function $(sel, raiz) { return (raiz || document).querySelector(sel); }
  function $$(sel, raiz) { return Array.prototype.slice.call((raiz || document).querySelectorAll(sel)); }

  /* Decodifica base64 con contenido UTF-8. */
  function b64d(s) {
    var bin = atob(s), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  /* Normaliza texto para comparación de canarios: minúsculas, sin acentos ni
     signos, espacios colapsados. */
  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function dosDig(n) { return (n < 10 ? '0' : '') + n; }

  function hhmmss(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return dosDig(Math.floor(s / 3600)) + ':' + dosDig(Math.floor(s / 60) % 60) + ':' + dosDig(s % 60);
  }

  function fechaLarga(d) {
    var meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
      'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return d.getDate() + ' de ' + meses[d.getMonth()] + ' de ' + d.getFullYear() +
      ', ' + dosDig(d.getHours()) + ':' + dosDig(d.getMinutes()) + ':' + dosDig(d.getSeconds());
  }

  /* Huella determinista del documento (folio de verificación). */
  function folio(txt) {
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < txt.length; i++) {
      h1 ^= txt.charCodeAt(i); h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 = (Math.imul(h2 ^ txt.charCodeAt(i), 0x85ebca6b)) >>> 0;
    }
    var s = (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
    return (s + '00000000000000').slice(0, 16).toUpperCase().replace(/(.{4})(?=.)/g, '$1-');
  }

  /* El enunciado con los datos del alumno: {k} en los bancos de texto, {{k}} en los de LaTeX. */
  function textoVar(l, vars) {
    if (MATE) return MATE.texto(l, vars);
    if (B.meta.notacion === 'latex') {               // matematicas.js no cargó: al menos los datos, sin romper el LaTeX
      return String(l).replace(/\{\{([A-Za-z0-9_]+)\}\}/g, function (m, k) {
        return (k in vars) ? String(vars[k]).replace('.', ',') : m;
      });
    }
    return V.texto(l, vars);
  }

  /* Orden en que este alumno ve las alternativas de un reactivo D: índices canónicos, el primero es la (a).
     Fisher–Yates con la semilla de las variantes (paridad con variantes.orden en Python). */
  /* Finalizador de MurmurHash3: los bits bajos de FNV-1a se mezclan mal (véase variantes.orden). */
  function mezcla(h) {
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0;
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
    return h >>> 0;
  }
  function ordenAlternativas(n, rid, matricula, sesion) {
    var idx = [], base = V.semilla(matricula, sesion) + '|' + rid + ':orden:';
    for (var i = 0; i < n; i++) idx.push(i);
    for (i = n - 1; i > 0; i--) {
      var j = mezcla(V.fnv1a(base + i)) % (i + 1), t = idx[i];
      idx[i] = idx[j]; idx[j] = t;
    }
    return idx;
  }

  /* Selección por composición (0.6), con paridad exacta con composicion.seleccion de Python. De cada tipo de la
     composición entran todos los reactivos fijos y, hasta completar la cantidad, los variables cuyos índices son
     los primeros del mismo Fisher–Yates de las alternativas con la clave «tipo:<tipo>» (que no puede ser id de un
     reactivo). El resultado conserva el orden del banco. */
  function deTipo(banco, tipo) {
    var lista = LISTA_DE_TIPO[tipo];
    return (banco[lista] || []).filter(function (r) { return tipoDe(r, lista) === tipo; });
  }
  function seleccionTipo(banco, tipo, cantidad, matricula, sesion) {
    var todos = deTipo(banco, tipo);
    var variables = todos.filter(function (r) { return r.fijo !== true; });
    var cupo = cantidad - (todos.length - variables.length), elegidos = [];
    if (cupo >= variables.length) elegidos = variables;
    else if (cupo > 0) {
      elegidos = ordenAlternativas(variables.length, 'tipo:' + tipo, matricula, sesion).slice(0, cupo)
        .map(function (i) { return variables[i]; });
    }
    return todos.filter(function (r) { return r.fijo === true || elegidos.indexOf(r) >= 0; });
  }
  /* Ids de los reactivos que ve un alumno, en el orden del banco; null si no hay composición (ve todo el banco). */
  function seleccion(banco, comp, matricula, sesion) {
    if (!comp.length) return null;
    var vistos = {}, ids = [];
    comp.forEach(function (e) {
      seleccionTipo(banco, e.tipo, e.cantidad, matricula, sesion).forEach(function (r) { vistos['#' + r.id] = true; });
    });
    LISTAS.forEach(function (lista) {
      (banco[lista] || []).forEach(function (r) { if (vistos['#' + r.id] === true) ids.push(r.id); });
    });
    return ids;
  }
  /* ¿Algún tipo tiene más reactivos variables que lugares? Entonces la selección cambia de un alumno a otro. */
  function seleccionPropia() {
    return COMP.some(function (e) {
      var todos = deTipo(COMPLETO, e.tipo);
      var variables = todos.filter(function (r) { return r.fijo !== true; }).length;
      var cupo = e.cantidad - (todos.length - variables);
      return cupo > 0 && cupo < variables;
    });
  }
  /* Reduce las listas de trabajo a la selección de esta matrícula y esta sesión. Se llama una vez, ya con ambas
     (sesión nueva o restaurada): la selección solo depende de ellas, así que al recargar es la misma. */
  function aplicaSeleccion() {
    if (!COMP.length || estado.seleccion) return;
    var ids = seleccion(COMPLETO, COMP, estado.alumno.matricula, estado.sesion), en = {};
    ids.forEach(function (id) { en['#' + id] = true; });
    function filtra(lista) { return (lista || []).filter(function (r) { return en['#' + r.id] === true; }); }
    AA = filtra(COMPLETO.teoricos);
    BB = filtra(COMPLETO.numericos);
    CC = filtra(COMPLETO.analisis);
    DD = filtra(COMPLETO.opcion_multiple);
    estado.seleccion = ids;
  }
  /* Lo que recibe el PDF: el banco entero o, con composición, solo los reactivos del alumno. */
  function bancoDelAlumno() {
    if (!COMP.length) return B;
    return { meta: B.meta, teoricos: AA, numericos: BB, analisis: CC, opcion_multiple: DD };
  }

  /* Matrícula y sesión con que se resuelven los datos de un reactivo y el orden de sus alternativas (0.6): las del
     alumno o, en un reactivo fijo, vacías, para que todos reciban lo mismo (composicion.semilla_de). */
  function semillaDe(r) {
    return r.fijo === true ? ['', ''] : [estado.alumno.matricula, estado.sesion];
  }

  /* Etiqueta visible del reactivo. Con composición es su id: la posición en la selección del alumno ya no
     coincide con la del banco. Sin ella, letra y posición, como siempre. */
  function etiqueta(r, letra, idx) {
    return COMP.length ? escapa(String(r.id)) : letra + dosDig(idx + 1);
  }

  /* Orden en que se muestran los reactivos de una sección (0.5.1): el del banco o, con «orden aleatorio», uno propio
     de la matrícula y la sesión, con el mismo Fisher–Yates de las alternativas de la D y la clave «seccionA»…
     «seccionD», que no puede ser id de un reactivo. Es estable al recargar. Las etiquetas, el PDF y la calificación
     siguen el orden del banco. */
  function ordenSeccion(letra, n) {
    if (MEZCLA && n > 1) return ordenAlternativas(n, 'seccion' + letra, estado.alumno.matricula, estado.sesion);
    var idx = [];
    for (var i = 0; i < n; i++) idx.push(i);
    return idx;
  }

  // ------------------------------------------------------ acceso por lista
  /* Acceso solo para las matrículas de la lista del grupo (0.5). assets/acceso.js no trae matrículas: trae los
     primeros bits del SHA-256 con sal de cada una (véase sinodal/acceso.py). */
  /* SHA-256 sincrónico sobre UTF-8 (sin crypto.subtle, que es asíncrono y no existe fuera de HTTPS). Solo
     para el filtro de acceso: el resultado se compara con el que calcula Sinodal en Python (hashlib). */
  function sha256hex(texto) {
    var K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var b = new TextEncoder().encode(String(texto)), n = b.length;
    var largo = ((n + 9 + 63) >> 6) << 6, m = new Uint8Array(largo);
    m.set(b);
    m[n] = 0x80;
    var bits = n * 8;
    m[largo - 4] = (bits >>> 24) & 255; m[largo - 3] = (bits >>> 16) & 255;
    m[largo - 2] = (bits >>> 8) & 255; m[largo - 1] = bits & 255;
    m[largo - 5] = Math.floor(bits / 4294967296) & 255;
    var w = new Array(64);
    function rot(x, k) { return (x >>> k) | (x << (32 - k)); }
    for (var o = 0; o < largo; o += 64) {
      for (var i = 0; i < 16; i++) {
        w[i] = (m[o + 4 * i] << 24) | (m[o + 4 * i + 1] << 16) | (m[o + 4 * i + 2] << 8) | m[o + 4 * i + 3];
      }
      for (i = 16; i < 64; i++) {
        var s0 = rot(w[i - 15], 7) ^ rot(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = rot(w[i - 2], 17) ^ rot(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = H[0], c = H[1], d = H[2], e = H[3], f = H[4], g = H[5], h = H[6], k = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = rot(f, 6) ^ rot(f, 11) ^ rot(f, 25);
        var ch = (f & g) ^ (~f & h);
        var t1 = (k + S1 + ch + K[i] + w[i]) | 0;
        var S0 = rot(a, 2) ^ rot(a, 13) ^ rot(a, 22);
        var mj = (a & c) ^ (a & d) ^ (c & d);
        var t2 = (S0 + mj) | 0;
        k = h; h = g; g = f; f = (e + t1) | 0; e = d; d = c; c = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + c) | 0; H[2] = (H[2] + d) | 0; H[3] = (H[3] + e) | 0;
      H[4] = (H[4] + f) | 0; H[5] = (H[5] + g) | 0; H[6] = (H[6] + h) | 0; H[7] = (H[7] + k) | 0;
    }
    return H.map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
  }

  function canonAcceso(m) {
    return V.normaliza(m).replace(/^([A-Z]*)0+(?=\d)/, '$1');
  }
  /* 'ok', 'fuera' (la matrícula no está en la lista) o 'sin-lista' (falta acceso.js: el examen no se abre). */
  function revisaAcceso(matricula) {
    if (B.meta.accesoLista !== true) return 'ok';
    var A = window.EXAMEN_ACCESO;
    if (!A || !A.h || !A.h.length || typeof A.sal !== 'string') return 'sin-lista';
    var h = sha256hex('sinodal-acceso|' + A.sal + '|' + canonAcceso(matricula)).slice(0, A.hex || 4);
    return A.h.indexOf(h) >= 0 ? 'ok' : 'fuera';
  }
  var RECHAZOS = PREFIJO + '_rechazos';
  function rechazosAcceso() {
    try { return parseInt(localStorage.getItem(RECHAZOS) || '0', 10) || 0; } catch (err) { return 0; }
  }

  // --------------------------------------------------------------- política
  /* La fija el profesor en Sinodal (paso 1) y se imprime en la portada y en el PDF. Un banco.js
     sin estos campos (construido antes de la 0.3) conserva el comportamiento anterior. */
  function entero(x, omision) {
    var n = parseInt(x, 10);
    return isFinite(n) && n >= 0 ? n : omision;
  }
  var POL = {
    sesion: B.meta.sesionAleatoria === true,
    modo: B.meta.alSalir === 'cerrar' ? 'cerrar' : 'registrar',
    salidas: entero(B.meta.salidasPermitidas, 2),          // salidas toleradas; la siguiente cierra
    segundos: entero(B.meta.segundosFueraPermitidos, 60),  // tiempo fuera tolerado; 0 = sin límite
    pantalla: B.meta.pantallaCompleta === true
  };
  function textoPolitica() {
    if (POL.modo !== 'cerrar') return 'registrar';
    return 'cerrar tras ' + POL.salidas + ' salidas' + (POL.segundos ? ' o ' + POL.segundos + ' s fuera' : '');
  }

  /* Clave de sesión: 6 caracteres en base 32 de Crockford (30 bits) con el generador criptográfico
     del navegador. Entra en la semilla de las variantes junto con la matrícula. */
  var ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  function nuevaSesion() {
    var b = new Uint8Array(6), s = '';
    (window.crypto || window.msCrypto).getRandomValues(b);
    for (var i = 0; i < b.length; i++) s += ALFABETO.charAt(b[i] % 32);
    return s;
  }

  // ---------------------------------------------------------------- estado
  var estado = {
    alumno: { nombre: '', matricula: '', grupo: String(B.meta.grupo || ''), correo: '' },
    sesion: '',        // clave aleatoria de esta sesión ('' si la política no la usa)
    inicio: null,
    fin: null,
    resp: {},          // { A01: 'texto', B01: {T:'', r:'', criterio:''} }
    integridad: {
      copias: 0, caracteresCopiados: 0,
      pegados: 0, caracteresPegados: 0,
      salidas: 0, msFuera: 0, fsSalidas: 0, focosBreves: 0,
      canarios: [],    // canarios detectados en texto pegado
      eventos: []      // bitácora breve [{t, tipo, det}]
    },
    entregado: false,
    cierre: null,      // {motivo: 'salidas'|'tiempo', t} si la política cerró el examen
    reinicios: 0,      // sesiones anteriores de esta matrícula en este navegador
    previas: [],       // resumen de esas sesiones: CLAVE:estado@hh:mm
    folio: '',
    archivo: '',
    ultimo: null,      // última actividad con la ventana al frente
    variantes: {},
    pos: 0             // 0.5.1, un reactivo a la vez: posición del reactivo actual (los anteriores quedan cerrados)
  };

  var CANARIOS = [];   // [{id, frase}]
  var claveLS = null;
  var tickReloj = null;
  var pulso = null;
  var salidaDesde = null;
  /* Tipo de la ausencia en curso: 'dialogo' (diálogo propio o cambio de pantalla completa: no cuenta
     si dura poco), 'breve' (perdió el foco sin ocultarse: si vuelve antes de 2 s solo suma el tiempo)
     o 'salida' (cuenta para la política). */
  var tipoSalida = '';
  var timerGracia = null;
  var portadaDesde = null;     // ausencia en curso mientras el alumno está en la portada
  var portadaMs = 0;           // tiempo acumulado fuera de la ventana en la portada
  var timerFuera = null;
  var ignorarFocoHasta = 0;
  var pdfPendiente = false;

  function registraEvento(tipo, det) {
    var e = estado.integridad.eventos;
    if (e.length < 400) {
      e.push({ t: estado.inicio ? Date.now() - estado.inicio : 0, tipo: tipo, det: det || '' });
    }
  }

  /* Con la política «cerrar», entregar o rebasar la tolerancia termina la sesión. */
  function terminado() {
    return POL.modo === 'cerrar' && (estado.entregado || !!estado.cierre);
  }

  /* confirm/alert propios: pueden quitar el foco y sacar de la pantalla completa (Chromium lo hace);
     nada de eso se cuenta. Los eventos llegan con retraso, de ahí el margen después del diálogo. */
  function confirma(msg) {
    ignorarFocoHasta = Infinity;
    try { return window.confirm(msg); } finally { ignorarFocoHasta = Date.now() + 1500; }
  }
  function avisa(msg) {
    ignorarFocoHasta = Infinity;
    try { window.alert(msg); } finally { ignorarFocoHasta = Date.now() + 1500; }
  }

  // ------------------------------------------------------------- persistencia
  function guarda() {
    if (!claveLS || pasiva) return;             // pasiva (0.5.1): otra pestaña lleva la sesión
    if (!salidaDesde && !terminado()) estado.ultimo = Date.now();
    try {
      var guardado = {
        alumno: estado.alumno, sesion: estado.sesion, inicio: estado.inicio, fin: estado.fin,
        resp: estado.resp, integridad: estado.integridad, entregado: estado.entregado,
        cierre: estado.cierre, reinicios: estado.reinicios, previas: estado.previas,
        folio: estado.folio, ultimo: estado.ultimo, fueraDesde: tipoSalida === 'salida' ? salidaDesde : null,
        v: B.meta.version, accesoRechazos: estado.accesoRechazos
      };
      if (UNO) guardado.pos = Math.max(estado.pos, posGuardada());   // 0.5.1: al recargar, en el mismo reactivo
      localStorage.setItem(claveLS, JSON.stringify(guardado));
    } catch (err) { /* cuota o modo privado: el examen continúa en memoria */ }
  }

  /* 0.5.1: posición que guardó otra pestaña de la misma sesión (la mayor gana: no se retrocede). */
  function posGuardada() {
    try {
      var g = JSON.parse(localStorage.getItem(claveLS) || 'null');
      return g && g.inicio === estado.inicio ? (parseInt(g.pos, 10) || 0) : 0;
    } catch (err) { return 0; }
  }

  /* La sesión se guarda por la matrícula normalizada sin ceros a la izquierda del número: teclear
     «080844» encuentra la sesión de «80844», y «A00123456» y «B00123456» siguen siendo distintas. */
  function claveDe(matricula) {
    var m = V.normaliza(matricula).replace(/^([A-Z]*)0+(?=\d)/, '$1');
    return PREFIJO + '_' + (m || V.normaliza(matricula));
  }
  function carga(matricula) {
    try {
      var raw = localStorage.getItem(claveDe(matricula)) ||
                localStorage.getItem(PREFIJO + '_' + V.normaliza(matricula));   // sesiones de la 0.2
      return raw ? JSON.parse(raw) : null;
    } catch (err) { return null; }
  }

  function sesionTerminada(prev) {
    return !!prev.cierre || (POL.modo === 'cerrar' && !!prev.entregado);
  }

  /* Datos de la portada, para no recapturarlos tras recargar la página. Solo se ofrecen si esa
     matrícula tiene una sesión sin terminar y reciente: en un equipo compartido, el siguiente
     alumno no debe encontrar los datos del anterior. */
  var RECUERDO = PREFIJO + '_ultimo';
  function recuerdaAlumno() {
    try { localStorage.setItem(RECUERDO, JSON.stringify(estado.alumno)); } catch (err) { }
  }
  function olvidaAlumno() {
    try { localStorage.removeItem(RECUERDO); } catch (err) { }
  }
  function alumnoRecordado() {
    var a = null;
    try { a = JSON.parse(localStorage.getItem(RECUERDO) || 'null'); } catch (err) { }
    if (!a || !a.matricula) return null;
    var prev = carga(a.matricula);
    var reciente = prev && prev.inicio && CARGA - (prev.ultimo || prev.inicio) < 4 * 3600000;
    if (!reciente || sesionTerminada(prev) || prev.entregado) { olvidaAlumno(); return null; }
    return a;
  }

  // ------------------------------------------------------------------ render
  function parrafos(lineas, vars) {
    return lineas.map(function (l) {
      var t = vars ? textoVar(l, vars) : l;
      var esInciso = /^\((i|ii|iii|iv|v)\)/.test(t.trim());
      return '<p class="' + (esInciso ? 'inciso' : '') + '">' + escapa(t) + '</p>';
    }).join('');
  }

  function escapa(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function trampaHTML(r) {
    if (!r.t) return '';
    // Respaldo pasivo: el mismo bloque queda en el DOM, invisible y fuera del
    // árbol de accesibilidad, de modo que una selección amplia lo arrastre.
    return '<span class="oculto" aria-hidden="true">' + escapa(b64d(r.t)) + '</span>';
  }

  // ----------------------------------------------------------------- figuras
  /* Figura del reactivo (0.4.6): solo PNG o JPEG embebidos como data URI; cualquier otro esquema se
     ignora. Va justo después del enunciado. Un reactivo sin figura se construye igual que antes. */
  var PREFIJOS_FIGURA = ['data:image/png;base64,', 'data:image/jpeg;base64,'];
  var veloFig = null, figOrigen = null;

  function figuraValida(f) {
    if (!f || typeof f.src !== 'string') return false;
    for (var i = 0; i < PREFIJOS_FIGURA.length; i++) {
      if (f.src.indexOf(PREFIJOS_FIGURA[i]) === 0) return true;
    }
    return false;
  }

  function anchoFigura(a) {
    var x = parseFloat(a);
    return isFinite(x) ? Math.min(1, Math.max(0.2, x)) : 0.6;
  }

  function ponFigura(art, r) {
    var enun = $('.enunciado', art);
    if (!enun || !figuraValida(r.figura)) return;
    var fig = document.createElement('figure');
    fig.className = 'figura';
    fig.style.maxWidth = (anchoFigura(r.figura.ancho) * 100) + '%';
    var img = document.createElement('img');
    img.src = r.figura.src;                       // propiedades del DOM: nada se interpreta como HTML
    img.alt = String(r.figura.alt == null ? '' : r.figura.alt);
    img.draggable = false;
    img.tabIndex = 0;
    img.setAttribute('aria-haspopup', 'dialog');
    img.addEventListener('click', function () { ampliaFigura(img); });
    // Sin menú contextual: «abrir imagen en otra pestaña» sería una salida involuntaria.
    img.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    img.addEventListener('keydown', function (e) {
      // stopPropagation: la misma tecla no debe llegar al cierre de la capa (fase de burbuja del documento).
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); ampliaFigura(img); }
    });
    // Imagen que el navegador no puede decodificar: queda el texto alternativo y no se amplía.
    img.addEventListener('error', function () { fig.classList.add('rota'); img.removeAttribute('tabindex'); });
    fig.appendChild(img);
    enun.parentNode.insertBefore(fig, enun.nextSibling);
  }

  /* Ampliación en una capa de la propia página: no abre ventanas ni pestañas, así que no hay blur
     ni cambio de visibilidad y el registro de integridad no se toca. Queda por debajo del velo de
     la política (z-index 900 < 1000). Se crea al primer uso. */
  function ampliaFigura(img) {
    if (img.parentNode && img.parentNode.classList.contains('rota')) return;
    if (veloVisible()) return;                    // el velo de la política manda
    if (!veloFig) {
      veloFig = document.createElement('div');
      veloFig.className = 'velo-figura';
      veloFig.id = 'veloFigura';
      veloFig.setAttribute('role', 'dialog');
      veloFig.setAttribute('aria-modal', 'true');
      veloFig.setAttribute('aria-label', 'Figura ampliada');
      veloFig.tabIndex = -1;
      veloFig.hidden = true;
      veloFig.innerHTML = '<img alt=""><p class="velo-figura-nota"></p>' +
        '<button type="button" class="velo-figura-cerrar">Cerrar</button>';
      // Cualquier clic o toque cierra la capa, incluido el del botón (llega aquí en burbuja).
      veloFig.addEventListener('click', cierraFigura);
      veloFig.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      // Arrastrar la imagen ampliada a la barra de pestañas abriría otra pestaña (Firefox): una salida.
      veloFig.addEventListener('dragstart', function (e) { e.preventDefault(); });
      $('img', veloFig).draggable = false;
      document.addEventListener('keydown', function (e) {
        if (!veloFig || veloFig.hidden) return;
        if (e.key === 'Escape' || e.key === 'Esc' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault(); cierraFigura(e);
        } else if (e.key === 'Tab') {
          e.preventDefault();                     // el foco no se va a los campos ocultos detrás de la capa
        }
      });
      document.body.appendChild(veloFig);
    }
    var grande = $('img', veloFig);
    grande.src = img.src;
    grande.alt = img.alt;
    // Proporción de esta figura; si aún no se conoce, ninguna (no la de la figura anterior).
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      grande.style.setProperty('--r', String(img.naturalWidth / img.naturalHeight));
    } else {
      grande.style.removeProperty('--r');
    }
    // En pantalla completa el navegador usa Esc para salir de ella (y eso se registra). En Chrome y
    // Edge, keyboard.lock lo retiene para la página mientras la capa está abierta; en los demás, aviso.
    if (enPantallaCompleta()) { if (!escBloqueado) bloqueaEsc(); } else if (escBloqueado) sueltaEsc();
    figOrigen = img;
    notaFigura();
    veloFig.hidden = false;
    try { veloFig.focus({ preventScroll: true }); } catch (err) { }
  }

  function notaFigura() {
    if (!veloFig) return;
    $('.velo-figura-nota', veloFig).textContent = enPantallaCompleta() && !escBloqueado
      ? 'Toque o haga clic para cerrarla. No use Esc: saca de la pantalla completa y eso queda registrado.'
      : 'Toque o haga clic para cerrarla, o pulse Esc.';
  }

  /* Keyboard Lock API (Chrome/Edge): solo surte efecto con el documento en pantalla completa. Con la
     tecla retenida, un Esc breve llega a la página (cierra la capa) sin sacar de la pantalla completa;
     mantenerla pulsada sí sale, como avisa el propio navegador. Si la promesa se rechaza, vuelve el aviso.
     Solo cuenta el rechazo de la petición vigente: al abrir, cerrar y abrir rápido, Chromium rechaza
     (AbortError) la primera cuando ya rige la segunda, y esa bandera no debe caer. */
  var escBloqueado = false, timerEsc = null, nLock = 0;
  function bloqueaEsc() {
    clearTimeout(timerEsc);
    timerEsc = null;
    var mia = ++nLock;
    try {
      var k = navigator.keyboard;
      if (!k || typeof k.lock !== 'function') return;
      var pr = k.lock(['Escape']);
      escBloqueado = true;
      if (pr && pr.then) {
        pr.then(null, function () {
          if (mia !== nLock) return;              // la superó otra petición o ya se soltó
          escBloqueado = false;
          if (veloFig && !veloFig.hidden) notaFigura();
        });
      }
    } catch (err) {
      escBloqueado = false;
    }
  }
  /* Suelta siempre: unlock sin un lock vigente no hace nada, y así ninguna bandera desfasada deja Esc
     retenido con la capa cerrada. */
  function sueltaEsc() {
    clearTimeout(timerEsc);
    timerEsc = null;
    nLock++;                                      // un rechazo que llegue después ya no es de la vigente
    escBloqueado = false;
    try {
      var k = navigator.keyboard;
      if (k && typeof k.unlock === 'function') k.unlock();
    } catch (err) { }
  }
  /* Cerrada con Esc: se suelta al levantar la tecla (o en 1,5 s), para que la repetición de una tecla
     sostenida no llegue al navegador ya sin el bloqueo. Si la capa se volvió a abrir, sigue retenida. */
  function sueltaEscAlSoltar() {
    if (!escBloqueado) { sueltaEsc(); return; }
    function listo(e) {
      if (e && e.type === 'keyup' && e.key !== 'Escape' && e.key !== 'Esc') return;
      document.removeEventListener('keyup', listo, true);
      if (veloFig && veloFig.hidden) sueltaEsc();
    }
    document.addEventListener('keyup', listo, true);
    clearTimeout(timerEsc);
    timerEsc = setTimeout(listo, 1500);
  }

  function cierraFigura(e) {
    if (!veloFig || veloFig.hidden) return;
    veloFig.hidden = true;
    if (e && e.type === 'keydown' && (e.key === 'Escape' || e.key === 'Esc')) sueltaEscAlSoltar(); else sueltaEsc();
    if (figOrigen) { try { figOrigen.focus({ preventScroll: true }); } catch (err) { } }
    figOrigen = null;
  }

  function tarjetaTeorico(r, idx) {
    var art = document.createElement('article');
    art.className = 'reactivo';
    art.id = 'r-' + r.id;
    if (r.t) art.setAttribute('data-trampa', r.t);
    art.innerHTML =
      '<div class="reactivo-cab">' +
        '<span class="reactivo-num">' + etiqueta(r, 'A', idx) + '</span>' +
        '<span class="reactivo-tit">' + escapa(r.titulo) + '</span>' +
        '<span class="reactivo-meta">' + r.puntos + ' pts · ' + escapa(r.tema) + '</span>' +
      '</div>' +
      '<div class="enunciado">' + parrafos(r.texto) + trampaHTML(r) + '</div>' +
      '<div class="campo" style="margin-top:12px">' +
        '<label for="ta-' + r.id + '">Respuesta</label>' +
        '<textarea id="ta-' + r.id + '" data-rid="' + r.id + '" maxlength="3000" ' +
        'placeholder="' + (TEORIA ? 'Responda los tres incisos: idea central, explicación y aplicación o condición de validez.'
                                  : 'Redacte su dictamen. Declare hipótesis, criterio y consecuencia; responda los tres incisos.') +
        '"></textarea>' +
        '<div class="contador" id="c-' + r.id + '">0 caracteres</div>' +
      '</div>';
    if (r.figura) ponFigura(art, r);
    return art;
  }

  /* Ensayo (0.6.1): como una pregunta teórica, con la extensión pedida y un contador de palabras. El máximo no
     corta lo que escribe el alumno (un texto pegado no se pierde): el contador avisa y el calificador lo sabe. */
  function tarjetaEnsayo(r, idx) {
    var pal = palabrasDe(r);
    var art = document.createElement('article');
    art.className = 'reactivo ensayo';
    art.id = 'r-' + r.id;
    if (r.t) art.setAttribute('data-trampa', r.t);
    art.innerHTML =
      '<div class="reactivo-cab">' +
        '<span class="reactivo-num">' + etiqueta(r, 'A', idx) + '</span>' +
        '<span class="reactivo-tit">' + escapa(r.titulo) + '</span>' +
        '<span class="reactivo-meta">' + r.puntos + ' pts · ' + escapa(r.tema) + '</span>' +
      '</div>' +
      '<div class="enunciado">' + parrafos(r.texto) + trampaHTML(r) + '</div>' +
      '<div class="campo" style="margin-top:12px">' +
        '<label for="ta-' + r.id + '">Ensayo · de ' + pal[0] + ' a ' + pal[1] + ' palabras</label>' +
        '<textarea id="ta-' + r.id + '" data-rid="' + r.id + '" data-min="' + pal[0] + '" data-max="' + pal[1] + '" ' +
        'class="ensayo-texto" maxlength="' + Math.max(3000, pal[1] * 12) + '" ' +
        'placeholder="Tome una postura y sosténgala con conceptos, modelos, datos o casos del curso."></textarea>' +
        '<div class="contador" id="c-' + r.id + '">0 palabras</div>' +
      '</div>';
    if (r.figura) ponFigura(art, r);
    return art;
  }

  function tarjetaNumerico(r, idx, vars, letra) {
    letra = letra || 'B';
    var art = document.createElement('article');
    art.className = 'reactivo';
    art.id = 'r-' + r.id;
    if (r.t) art.setAttribute('data-trampa', r.t);

    var diseno = letra === 'B' && esDiseno(r);     // 0.6: el alumno propone valores y reporta los resultados
    var campos = r.campos.map(function (c) {
      var prop = diseno && c.rol === 'propuesta';
      return '<div class="campo-num' + (prop ? ' propuesta' : '') + '">' +
        '<label for="n-' + r.id + '-' + c.k + '">' + (prop ? '<span class="marca-propuesta">Su propuesta</span> ' : '') +
        escapa(c.et) +
        (c.u ? ' <span class="u">[' + escapa(c.u) + ']</span>' : '') + '</label>' +
        '<input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" ' +
        'id="n-' + r.id + '-' + c.k + '" data-rid="' + r.id + '" data-campo="' + c.k + '" ' +
        (prop ? 'data-rol="propuesta" data-min="' + escapa(numeroDato(c.min)) + '" data-max="' +
          escapa(numeroDato(c.max)) + '" aria-describedby="ay-' + r.id + '-' + c.k + '" ' : '') +
        'placeholder="' + (prop ? 'el valor que usted propone' : 'valor numérico (coma o punto decimal)') + '">' +
        (prop ? '<div class="ayuda" id="ay-' + r.id + '-' + c.k + '">' + escapa(ayudaRango(c, false)) + '</div>' : '') +
      '</div>';
    }).join('');

    art.innerHTML =
      '<div class="reactivo-cab">' +
        '<span class="reactivo-num">' + etiqueta(r, letra, idx) + '</span>' +
        '<span class="reactivo-tit">' + escapa(r.titulo) + '</span>' +
        '<span class="reactivo-meta">' + r.puntos + ' pts · ' + escapa(r.tema) + '</span>' +
      '</div>' +
      '<div class="enunciado">' + parrafos(r.texto, vars) + trampaHTML(r) + '</div>' +
      (diseno ? requisitosHTML(r, vars) : '') +
      '<div class="campos-num">' + campos + '</div>' +
      (letra === 'C'
        ? '<div class="campo">' +
            '<label for="an-' + r.id + '">Análisis: responda los incisos (i), (ii) y (iii) con base en sus resultados</label>' +
            '<textarea id="an-' + r.id + '" data-rid="' + r.id + '" data-campo="analisis" ' +
            'maxlength="4000" style="min-height:150px" ' +
            'placeholder="(i) Dictamen con sus números · (ii) mecanismo que gobierna el resultado · (iii) medida concreta con su magnitud."></textarea>' +
            '<div class="contador" id="c-' + r.id + '">0 caracteres</div>' +
          '</div>'
        : '<div class="campo">' +
            '<label for="cr-' + r.id + '">Criterio empleado (obligatorio)</label>' +
            '<textarea id="cr-' + r.id + '" data-rid="' + r.id + '" data-campo="criterio" ' +
            'maxlength="700" style="min-height:70px" ' +
            'placeholder="Modelo y ecuación usados, base del esfuerzo nominal o del área, hipótesis, y qué gobierna el resultado."></textarea>' +
          '</div>');
    if (r.figura) ponFigura(art, r);
    return art;
  }

  // ------------------------------------------------- diseño y completar (0.6)
  function numeroDato(x) {
    var n = typeof x === 'number' ? x : parseFloat(x);
    return isFinite(n) ? String(n) : '';
  }
  function fmtDato(x) { return numeroDato(x).replace('.', ','); }

  /* Rango admitido de un valor que propone el alumno, con su unidad. */
  function textoRango(c) {
    var mn = fmtDato(c.min), mx = fmtDato(c.max), u = c.u ? ' ' + c.u : '';
    if (mn && mx) return 'de ' + mn + ' a ' + mx + u;
    if (mn) return mn + u + ' o más';
    if (mx) return 'hasta ' + mx + u;
    return '';
  }
  function ayudaRango(c, fuera) {
    var t = textoRango(c);
    if (fuera) {
      return 'Fuera del rango admitido' + (t ? ' (' + t + ')' : '') + ': con una propuesta fuera de rango el ' +
        'reactivo no se acredita.';
    }
    return t ? 'Usted elige este valor. Rango admitido: ' + t + '.' : 'Usted elige este valor.';
  }

  /* Requisitos que debe cumplir la propuesta del alumno. Solo su texto: las expresiones con que se evalúan no
     están en el sitio. Van después del enunciado (y de la figura, si la hay). */
  function requisitosDe(r) {
    return (Array.isArray(r.requisitos) ? r.requisitos : []).filter(function (q) {
      return typeof q === 'string' && q.trim() !== '';
    });
  }
  function requisitosHTML(r, vars) {
    var q = requisitosDe(r);
    if (!q.length) return '';
    return '<div class="requisitos"><p class="requisitos-tit">Requisitos de diseño</p><ul>' +
      q.map(function (l) { return '<li>' + escapa(textoVar(l, vars)) + '</li>'; }).join('') + '</ul></div>';
  }

  /* Aviso, sin bloquear, cuando el valor propuesto es un número fuera del rango admitido. Lo que no se lee como
     un número solo no se juzga aquí: lo decide la calificación. */
  function revisaRango(el) {
    var h = buscaReactivo(el.dataset.rid), ay = $('.ayuda', el.parentNode);
    if (!h || !ay) return;
    var c = h.r.campos.filter(function (x) { return x.k === el.dataset.campo; })[0];
    if (!c) return;
    var t = String(el.value).trim().replace(',', '.'), fuera = false;
    if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) {
      var x = parseFloat(t), mn = parseFloat(el.dataset.min), mx = parseFloat(el.dataset.max);
      fuera = (isFinite(mn) && x < mn) || (isFinite(mx) && x > mx);
    }
    ay.textContent = ayudaRango(c, fuera);
    ay.classList.toggle('fuera', fuera);
    el.classList.toggle('fuera', fuera);
  }

  /* Completar (0.6): un reactivo de la lista de opción múltiple sin alternativas. El alumno escribe un término, un
     valor o una unidad en un campo de una línea; la respuesta se guarda como texto. */
  function tarjetaCompletar(r, idx) {
    var art = document.createElement('article');
    art.className = 'reactivo completar';
    art.id = 'r-' + r.id;
    if (r.t) art.setAttribute('data-trampa', r.t);
    art.innerHTML =
      '<div class="reactivo-cab">' +
        '<span class="reactivo-num">' + etiqueta(r, 'D', idx) + '</span>' +
        '<span class="reactivo-tit">' + escapa(r.titulo) + '</span>' +
        '<span class="reactivo-meta">' + r.puntos + ' pts · ' + escapa(r.tema) + '</span>' +
      '</div>' +
      '<div class="enunciado">' + parrafos(r.texto) + trampaHTML(r) + '</div>' +
      '<div class="campo completar-campo">' +
        '<label for="co-' + r.id + '">Respuesta</label>' +
        '<input type="text" id="co-' + r.id + '" class="completar-entrada" data-rid="' + r.id + '" maxlength="120" ' +
        'autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" ' +
        'placeholder="Escriba el término, el valor o la unidad que falta">' +
      '</div>';
    if (r.figura) ponFigura(art, r);
    return art;
  }

  /* Sección D (0.5): una alternativa por reactivo, en el orden propio de la matrícula y la sesión. El valor de
     cada opción es el índice canónico de la alternativa; el PDF imprime la letra que vio el alumno. */
  function tarjetaMultiple(r, idx, orden) {
    var art = document.createElement('article');
    art.className = 'reactivo multiple';
    art.id = 'r-' + r.id;
    if (r.t) art.setAttribute('data-trampa', r.t);
    var alts = orden.map(function (canon, i) {
      var a = r.alternativas[canon] || { texto: '' };
      return '<label class="alternativa"><input type="radio" name="d-' + r.id + '" value="' + canon + '" ' +
        'data-rid="' + r.id + '"><span class="letra">' + LETRAS.charAt(i) + ')</span>' +
        '<span class="alt-texto">' + escapa(a.texto) + '</span></label>';
    }).join('');
    art.innerHTML =
      '<div class="reactivo-cab">' +
        '<span class="reactivo-num">' + etiqueta(r, 'D', idx) + '</span>' +
        '<span class="reactivo-tit">' + escapa(r.titulo) + '</span>' +
        '<span class="reactivo-meta">' + r.puntos + ' pts · ' + escapa(r.tema) + '</span>' +
      '</div>' +
      '<div class="enunciado">' + parrafos(r.texto) + trampaHTML(r) + '</div>' +
      '<div class="alternativas" role="radiogroup" aria-label="Alternativas de ' + r.id + '">' + alts + '</div>' +
      '<button type="button" class="enlace quitar-eleccion" data-rid="' + r.id + '">Quitar mi respuesta</button>';
    if (r.figura) ponFigura(art, r);
    return art;
  }

  /* Textos del examen ya con los datos del alumno, para preparar sus fórmulas para el PDF. */
  function textosConFormulas() {
    var t = [];
    AA.forEach(function (r) { t = t.concat(r.texto); });
    BB.concat(CC).forEach(function (r) {
      var vars = estado.variantes[r.id] || {};
      r.texto.forEach(function (l) { t.push(textoVar(l, vars)); });
      requisitosDe(r).forEach(function (l) { t.push(textoVar(l, vars)); });   // 0.6, diseño
    });
    DD.forEach(function (r) {
      t = t.concat(r.texto);
      (r.alternativas || []).forEach(function (a) { t.push(a.texto); });      // completar (0.6) no tiene
    });
    Object.keys(estado.resp).forEach(function (rid) {
      var v = estado.resp[rid];
      if (typeof v === 'string') t.push(v);
      else if (v && typeof v === 'object') { if (v.criterio) t.push(v.criterio); if (v.analisis) t.push(v.analisis); }
    });
    return t;
  }

  function pintaExamen() {
    var lt = $('#listaTeoricos'), ln = $('#listaNumericos'), la = $('#listaAnalisis');
    lt.innerHTML = ''; ln.innerHTML = '';
    if (la) la.innerHTML = '';

    // Canarios genéricos: presentes en todos los payloads. Delatan el uso de un
    // asistente externo pero no atribuyen el copiado a un reactivo concreto.
    (B.meta.canariosGenericos || []).forEach(function (c) {
      CANARIOS.push({ id: 'GEN', frase: norm(b64d(c)) });
    });

    // El índice i es el del banco: da la etiqueta (A01, B04…) aunque el reactivo se muestre en otro lugar.
    ordenSeccion('A', AA.length).forEach(function (i) {
      var r = AA[i];
      lt.appendChild(esEnsayo(r) ? tarjetaEnsayo(r, i) : tarjetaTeorico(r, i));
      if (r.c) r.c.forEach(function (c) { CANARIOS.push({ id: r.id, frase: norm(b64d(c)) }); });
    });

    ordenSeccion('B', BB.length).forEach(function (i) {
      var r = BB[i], s = semillaDe(r);
      var vars = V.resolver(r, s[0], s[1]);
      estado.variantes[r.id] = vars;
      ln.appendChild(tarjetaNumerico(r, i, vars));
      if (r.c) r.c.forEach(function (c) { CANARIOS.push({ id: r.id, frase: norm(b64d(c)) }); });
    });

    ordenSeccion('C', CC.length).forEach(function (i) {
      var r = CC[i], s = semillaDe(r);
      var vars = V.resolver(r, s[0], s[1]);
      estado.variantes[r.id] = vars;
      if (la) la.appendChild(tarjetaNumerico(r, i, vars, 'C'));
      if (r.c) r.c.forEach(function (c) { CANARIOS.push({ id: r.id, frase: norm(b64d(c)) }); });
    });

    var lm = $('#listaMultiple');
    if (lm) lm.innerHTML = '';
    estado.ordenes = {};
    ordenSeccion('D', DD.length).forEach(function (i) {
      var r = DD[i];
      if (esCompletar(r)) {                          // 0.6: sin alternativas, un campo de texto
        if (lm) lm.appendChild(tarjetaCompletar(r, i));
      } else {
        var s = semillaDe(r);
        var orden = ordenAlternativas(r.alternativas.length, r.id, s[0], s[1]);
        estado.ordenes[r.id] = orden;
        if (lm) lm.appendChild(tarjetaMultiple(r, i, orden));
      }
      if (r.c) r.c.forEach(function (c) { CANARIOS.push({ id: r.id, frase: norm(b64d(c)) }); });
    });

    // Restaura respuestas guardadas
    AA.forEach(function (r) {
      var v = estado.resp[r.id];
      if (typeof v === 'string' && v) { $('#ta-' + r.id).value = v; }
    });
    BB.concat(CC).forEach(function (r) {
      var v = estado.resp[r.id] || {};
      r.campos.forEach(function (c) {
        if (v[c.k]) $('#n-' + r.id + '-' + c.k).value = v[c.k];
      });
      if (v.criterio && $('#cr-' + r.id)) $('#cr-' + r.id).value = v.criterio;
      if (v.analisis && $('#an-' + r.id)) $('#an-' + r.id).value = v.analisis;
    });
    DD.forEach(function (r) {
      var v = estado.resp[r.id];
      if (esCompletar(r)) {
        var campo = $('#co-' + r.id);
        if (campo && typeof v === 'string' && v) campo.value = v;
        return;
      }
      if (typeof v === 'number') {
        var op = $('input[name="d-' + r.id + '"][value="' + v + '"]');
        if (op) op.checked = true;
      }
    });


    $('#cabeceraExamen').innerHTML =
      '<b>' + escapa(estado.alumno.nombre) + '</b> · Matrícula ' + escapa(estado.alumno.matricula) +
      ' · Grupo ' + escapa(estado.alumno.grupo) +
      (estado.sesion ? ' · Clave de sesión <b>' + escapa(estado.sesion) + '</b>' : '') + '<br>' +
      'Inicio de la sesión: ' + fechaLarga(new Date(estado.inicio)) +
      ' · Duración de referencia: ' + B.meta.duracionMin + ' minutos.';

    engancharEntradas();
    $$('#listaNumericos input[data-rol="propuesta"]').forEach(revisaRango);   // 0.6: propuestas restauradas
    $$('#listaAnalisis textarea').forEach(function (ta) { ta.dispatchEvent(new Event('input')); });   // contadores
    DD.forEach(function (r) { marcaContestado(r.id); });
    actualizaProgreso();
    if (MATE) {
      $$('#listaTeoricos textarea, #listaNumericos textarea, #listaAnalisis textarea').forEach(function (ta) {
        MATE.editor(ta);
      });
    }
    // Después de los editores (sus botones también se cierran) y antes de tipografiar (las ocultas se miden igual).
    if (UNO) preparaUno();
    if (MATE) MATE.tipografiar($('#pantallaExamen')).then(function () { MATE.precargar(textosConFormulas()); });
  }

  // --------------------------------------------------------------- entradas
  function engancharEntradas() {
    $$('#listaTeoricos textarea').forEach(function (ta) {
      ta.addEventListener('input', function () {
        estado.resp[ta.dataset.rid] = ta.value;
        var c = $('#c-' + ta.dataset.rid);
        if (ta.dataset.min) {                         // 0.6.1: ensayo, en palabras y con la extensión pedida
          var w = cuentaPalabras(ta.value), lo = +ta.dataset.min, hi = +ta.dataset.max;
          c.textContent = w + (w === 1 ? ' palabra' : ' palabras') + ' · se piden de ' + lo + ' a ' + hi +
            (w > hi ? ' · rebasa el máximo' : w > 0 && w < lo ? ' · falta para el mínimo' : '');
          c.className = 'contador' + (w > hi ? ' excede' : w > 0 && w < lo ? ' corto' : '');
          marcaContestado(ta.dataset.rid);
          actualizaProgreso();
          guarda();
          return;
        }
        var n = ta.value.trim().length;
        c.textContent = n + ' caracteres';
        c.className = 'contador' + (n > 0 && n < 220 ? ' corto' : '');
        marcaContestado(ta.dataset.rid);
        actualizaProgreso();
        guarda();
      });
      ta.dispatchEvent(new Event('input'));
    });

    $$('#listaNumericos input, #listaNumericos textarea, #listaAnalisis input, #listaAnalisis textarea').forEach(function (el) {
      el.addEventListener('input', function () {
        var rid = el.dataset.rid;
        estado.resp[rid] = estado.resp[rid] || {};
        estado.resp[rid][el.dataset.campo] = el.value;
        if (el.dataset.rol === 'propuesta') revisaRango(el);
        if (el.dataset.campo === 'analisis') {
          var c = $('#c-' + rid), n = el.value.trim().length;
          if (c) { c.textContent = n + ' caracteres'; c.className = 'contador' + (n > 0 && n < 220 ? ' corto' : ''); }
        }
        marcaContestado(rid);
        actualizaProgreso();
        guarda();
      });
    });

    $$('#listaMultiple input.completar-entrada').forEach(function (el) {
      el.addEventListener('input', function () {
        estado.resp[el.dataset.rid] = el.value;
        marcaContestado(el.dataset.rid);
        actualizaProgreso();
        guarda();
      });
    });

    $$('#listaMultiple input[type="radio"]').forEach(function (op) {
      op.addEventListener('change', function () {
        if (!op.checked || terminado()) return;
        estado.resp[op.dataset.rid] = parseInt(op.value, 10);
        marcaContestado(op.dataset.rid);
        actualizaProgreso();
        guarda();
      });
    });
    $$('#listaMultiple .quitar-eleccion').forEach(function (b) {
      b.addEventListener('click', function () {
        if (terminado()) return;
        var rid = b.dataset.rid;
        delete estado.resp[rid];
        $$('input[name="d-' + rid + '"]').forEach(function (op) { op.checked = false; });
        marcaContestado(rid);
        actualizaProgreso();
        guarda();
      });
    });
  }

  /* letra: 'A' (texto), 'B' (campos + criterio), 'C' (campos + análisis) o 'D' (una alternativa). */
  function completo(r, letra) {
    if (letra === 'D' && esCompletar(r)) {         // 0.6: basta con que haya escrito algo
      return typeof estado.resp[r.id] === 'string' && estado.resp[r.id].trim() !== '';
    }
    if (letra === 'D') return typeof estado.resp[r.id] === 'number';
    // 0.6.1: un ensayo corto se califica igual (su contador avisa que falta para el mínimo); incompleto es vacío
    if (letra === 'A' && esEnsayo(r)) return cuentaPalabras(estado.resp[r.id]) > 0;
    if (letra === 'A') return (estado.resp[r.id] || '').trim().length >= 40;
    var v = estado.resp[r.id] || {};
    var todos = r.campos.every(function (c) { return String(v[c.k] || '').trim() !== ''; });
    if (letra === 'C') return todos && String(v.analisis || '').trim().length >= 60;
    return todos && String(v.criterio || '').trim().length >= 15;
  }

  function buscaReactivo(rid) {
    var listas = { A: AA, B: BB, C: CC, D: DD }, letra = rid.charAt(0);
    var r = (listas[letra] || []).filter(function (x) { return x.id === rid; })[0];
    return r ? { r: r, letra: letra } : null;
  }

  function marcaContestado(rid) {
    var art = $('#r-' + rid), h = buscaReactivo(rid);
    if (!art || !h) return;
    var lleno = completo(h.r, h.letra);
    art.classList.toggle('contestado', lleno);
    if (UNO && lleno && avisoAvance === rid) muestraActual();   // 0.5.1: ya no está incompleto, se quita el aviso
  }

  function pendientes() {
    var p = [];
    function nombre(r, letra, i) { return COMP.length ? String(r.id) : letra + dosDig(i + 1); }
    AA.forEach(function (r, i) { if (!completo(r, 'A')) p.push(nombre(r, 'A', i)); });
    BB.forEach(function (r, i) { if (!completo(r, 'B')) p.push(nombre(r, 'B', i)); });
    CC.forEach(function (r, i) { if (!completo(r, 'C')) p.push(nombre(r, 'C', i)); });
    DD.forEach(function (r, i) { if (!completo(r, 'D')) p.push(nombre(r, 'D', i)); });
    return p;
  }

  function actualizaProgreso() {
    var p = pendientes();
    var total = AA.length + BB.length + CC.length + DD.length;
    $('#chipProgreso').textContent = (total - p.length) + ' / ' + total + ' contestados';
    var av = $('#avisoPendientes');
    av.textContent = p.length
      ? 'Reactivos incompletos: ' + p.join(', ') + '. Puede entregar de todos modos, pero se registrarán como no contestados.'
      : '';
  }

  // ------------------------------------------------ un reactivo a la vez (0.5.1)
  /* Todas las tarjetas siguen en la página: respuestas, guardado, contadores y PDF funcionan como siempre. Solo se ve
     la actual, con el encabezado de su sección, y se avanza hacia adelante: la que queda atrás se cierra. Lo oculto
     usa visibility y altura cero (no display:none) para que MathJax lo mida bien al tipografiar; inert y
     aria-hidden lo sacan del foco y de los lectores de pantalla. */
  var SECUENCIA = [];           // [{art, rid, cab: [p.seccion-desc, h2.seccion-titulo]}] en el orden mostrado
  var avisoAvance = '';         // rid del reactivo incompleto cuyo aviso ya se mostró: el segundo clic avanza

  function cabeceraDe(lista) {
    var cab = [], el = lista.previousElementSibling;
    if (el && el.classList.contains('seccion-desc')) {
      cab.push(el);
      el = el.previousElementSibling;
      if (el && el.classList.contains('seccion-titulo')) cab.push(el);
    }
    return cab;
  }

  function preparaUno() {
    SECUENCIA = [];
    ['#listaTeoricos', '#listaNumericos', '#listaAnalisis', '#listaMultiple'].forEach(function (sel) {
      var lista = $(sel);
      if (!lista) return;
      var cab = cabeceraDe(lista);
      $$('article.reactivo', lista).forEach(function (art) {
        SECUENCIA.push({ art: art, rid: art.id.slice(2), cab: cab });
      });
    });
    if (!SECUENCIA.length) return;
    $('#pantallaExamen').classList.add('uno-por-vez');
    if (!$('#navUno')) {
      var nav = document.createElement('div');
      nav.id = 'navUno';
      nav.className = 'nav-uno';
      nav.innerHTML = '<div class="nav-uno-texto" id="navUnoTexto"></div>' +
        '<div class="nav-uno-aviso" id="navUnoAviso" aria-live="polite"></div>' +
        '<div class="acciones"><button class="primario grande" type="button" id="btnSiguiente">' +
        'Siguiente reactivo</button></div>';
      var cierre = $('#bloqueCierre');
      cierre.parentNode.insertBefore(nav, cierre);
      $('#btnSiguiente').addEventListener('click', avanza);
    }
    estado.pos = Math.max(0, Math.min(SECUENCIA.length - 1, estado.pos || 0));
    muestraActual();
  }

  function cierraReactivo(art) {
    $$('textarea, input', art).forEach(function (el) {
      if (el.type === 'radio') el.disabled = true; else el.readOnly = true;
    });
    $$('button', art).forEach(function (el) { el.disabled = true; });
    art.classList.add('cerrado');
  }

  function muestraActual() {
    var pos = estado.pos, actual = SECUENCIA[pos], ultimo = pos === SECUENCIA.length - 1;
    SECUENCIA.forEach(function (it, k) {
      var ver = k === pos;
      it.art.classList.toggle('oculto-uno', !ver);
      if (ver) it.art.removeAttribute('aria-hidden'); else it.art.setAttribute('aria-hidden', 'true');
      it.art.inert = !ver;
      if (k < pos) cierraReactivo(it.art);
      it.cab.forEach(function (el) { el.classList.add('oculto-uno'); });
    });
    actual.cab.forEach(function (el) { el.classList.remove('oculto-uno'); });
    var num = $('.reactivo-num', actual.art);
    $('#navUnoTexto').textContent = 'Reactivo ' + (pos + 1) + ' de ' + SECUENCIA.length +
      (num ? ' · ' + num.textContent : '');
    var av = $('#navUnoAviso'), b = $('#btnSiguiente');
    av.classList.remove('alerta');
    av.textContent = ultimo ? 'Es el último reactivo. Cuando termine, genere el PDF.'
                            : 'Al avanzar ya no podrá regresar a este reactivo.';
    b.textContent = 'Siguiente reactivo';
    b.classList.remove('peligro');
    b.hidden = ultimo || terminado();
    avisoAvance = '';
  }

  function avanza() {
    if (terminado() || pasiva || estado.pos >= SECUENCIA.length - 1) return;
    if ($('#btnGenerar').disabled) return;      // PDF en preparación: al terminar se liberan los campos abiertos
    var it = SECUENCIA[estado.pos], h = buscaReactivo(it.rid);
    if (h && !completo(h.r, h.letra) && avisoAvance !== it.rid) {
      avisoAvance = it.rid;                     // aviso en la página, sin confirm(): no saca de la pantalla completa
      var num = $('.reactivo-num', it.art), av = $('#navUnoAviso'), b = $('#btnSiguiente');
      av.textContent = 'El reactivo ' + (num ? num.textContent : it.rid) + ' está incompleto. Si avanza, ya no ' +
        'podrá regresar a él para completarlo.';
      av.classList.add('alerta');
      b.textContent = 'Avanzar sin completarlo';
      b.classList.add('peligro');
      return;
    }
    cierraReactivo(it.art);
    estado.pos++;
    guarda();
    muestraActual();
    window.scrollTo(0, 0);
    // El foco pasa a la tarjeta nueva (sin abrir el teclado del celular): el siguiente Tab llega a sus campos.
    var nueva = SECUENCIA[estado.pos].art;
    nueva.setAttribute('tabindex', '-1');
    try { nueva.focus({ preventScroll: true }); } catch (err) { }
  }

  /* Otra pestaña de la misma sesión guardó (0.5.1): sus respuestas y su posición son las vigentes. Esta pestaña deja
     de guardar, de contar salidas y de generar el PDF, y pide recargar; al recargar, la sesión se restaura completa.
     Así no se borra lo que la otra contestó ni se reabre un reactivo que ella ya cerró. */
  var pasiva = false;
  function otraPestana(e) {
    if (!UNO || pasiva || !SECUENCIA.length || !claveLS || e.key !== claveLS || !e.newValue || terminado()) return;
    try {
      if (JSON.parse(e.newValue).inicio !== estado.inicio) return;   // otra sesión de la matrícula
    } catch (err) { return; }
    pasiva = true;
    clearTimeout(timerFuera);
    clearTimeout(timerGracia);
    salidaDesde = null;
    tipoSalida = '';
    SECUENCIA.forEach(function (it) {
      it.art.classList.add('oculto-uno');
      it.art.setAttribute('aria-hidden', 'true');
      it.art.inert = true;
      it.cab.forEach(function (el) { el.classList.add('oculto-uno'); });
    });
    $('#navUnoTexto').textContent = 'El examen siguió en otra pestaña o ventana de este navegador.';
    var av = $('#navUnoAviso');
    av.textContent = 'Recargue esta página para continuar aquí con las respuestas guardadas.';
    av.classList.add('alerta');
    $('#btnSiguiente').hidden = true;
    $('#btnGenerar').disabled = true;
    if (veloVisible()) $('#velo').hidden = true;
  }

  // ------------------------------------------------------------- integridad
  function instalaIntegridad() {
    // 1) Copiado: se antepone el texto seleccionado y se anexan las marcas de
    //    trazabilidad de los reactivos que la selección toca.
    document.addEventListener('copy', function (e) {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;                   // copia dentro de un campo
      var texto = sel.toString();
      if (!texto || texto.length < 3) return;

      estado.integridad.copias++;
      estado.integridad.caracteresCopiados += texto.length;

      var cargas = [], tocados = [];
      try {
        var rango = sel.getRangeAt(0);
        $$('[data-trampa]').forEach(function (el) {
          if (rango.intersectsNode(el)) {
            cargas.push(b64d(el.dataset.trampa));
            tocados.push(el.id.replace('r-', ''));
          }
        });
      } catch (err) { /* selecciones exóticas */ }

      registraEvento('copia', tocados.join(',') + ' (' + texto.length + ' car.)');
      guarda();

      if (!cargas.length || !e.clipboardData) return;
      var salida = texto + '\n\n' + cargas.join('\n\n');
      e.clipboardData.setData('text/plain', salida);
      e.clipboardData.setData('text/html',
        '<div>' + escapa(texto).replace(/\n/g, '<br>') + '</div><div>' +
        escapa(cargas.join('\n\n')).replace(/\n/g, '<br>') + '</div>');
      e.preventDefault();
    }, true);

    // 2) Pegado: se cuenta y se inspecciona en busca de frases canario.
    document.addEventListener('paste', function (e) {
      if (MATE && !e.isTrusted) return;         // eco sintético del editor de ecuaciones (0.5): ya se contó
      var txt = '';
      try { txt = (e.clipboardData || window.clipboardData).getData('text') || ''; } catch (err) { }
      estado.integridad.pegados++;
      estado.integridad.caracteresPegados += txt.length;
      var n = norm(txt), hallados = [];
      CANARIOS.forEach(function (c) {
        if (c.frase && n.indexOf(c.frase) >= 0 && hallados.indexOf(c.id) < 0) hallados.push(c.id);
      });
      if (hallados.length) {
        hallados.forEach(function (h) {
          if (estado.integridad.canarios.indexOf(h) < 0) estado.integridad.canarios.push(h);
        });
      }
      registraEvento('pegado', txt.length + ' car.' + (hallados.length ? ' · CANARIO ' + hallados.join(',') : ''));
      guarda();
    }, true);

    // 3) Foco de la ventana: número de salidas y tiempo acumulado fuera. Con la política
    //    «cerrar», rebasar la tolerancia termina el examen aunque el alumno siga fuera.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (salidaDesde && tipoSalida === 'breve') promover(); else fuera();
      } else { dentro(); mantenerPantalla(); }
    });
    window.addEventListener('blur', fuera);
    window.addEventListener('focus', dentro);
    // Teclear o pulsar dentro del examen prueba que el alumno está en él aunque no llegara el evento focus.
    ['keydown', 'pointerdown', 'input'].forEach(function (ev) {
      document.addEventListener(ev, function () { if (salidaDesde || portadaDesde) dentro(); }, true);
    });

    // 4) Pantalla completa: salir de ella se registra; con «cerrar» se bloquea hasta volver.
    ['fullscreenchange', 'webkitfullscreenchange'].forEach(function (ev) {
      document.addEventListener(ev, function () {
        if (enPantallaCompleta() || !estado.inicio || terminado() || !POL.pantalla) return;
        if (Date.now() >= ignorarFocoHasta) {     // no la provocó un diálogo propio
          estado.integridad.fsSalidas++;
          registraEvento('pantalla', 'salió de la pantalla completa');
          guarda();
        }
        if (POL.modo === 'cerrar' && !veloVisible()) velo('pantalla');
      });
    });

    // El PDF de un cierre ocurrido con la ventana en segundo plano se descarga al volver.
    function alVolver() {
      if (pdfPendiente && !document.hidden) { try { descargarPDF(); } catch (err) { } }
    }
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('focus', alVolver);

    window.addEventListener('pagehide', guarda);
    window.addEventListener('beforeunload', function (ev) {
      if (estado.inicio && !estado.entregado) {
        guarda();
        ev.preventDefault();
        ev.returnValue = '';
        return '';
      }
    });
  }

  function fuera() {
    if (!estado.inicio) {                                 // en la portada: solo se mide
      if (!portadaDesde && Date.now() >= ignorarFocoHasta) portadaDesde = Date.now();
      return;
    }
    if (salidaDesde || terminado() || pasiva) return;
    salidaDesde = Date.now();
    clearTimeout(timerGracia);
    if (document.hidden) {                                // un diálogo propio no oculta la página
      tipoSalida = 'salida';
      contarSalida();
    } else if (Date.now() < ignorarFocoHasta) {
      tipoSalida = 'dialogo';
      timerGracia = setTimeout(revisaGracia, 3000);
    } else {
      tipoSalida = 'breve';
      timerGracia = setTimeout(revisaGracia, 2000);
    }
  }

  /* Vence la gracia: si la página tiene el foco (se perdió el evento focus), es un regreso. */
  function revisaGracia() {
    if (!salidaDesde || tipoSalida === 'salida') return;
    if (presente()) { dentro(); return; }
    promover();
  }

  function promover() {
    clearTimeout(timerGracia);
    tipoSalida = 'salida';
    contarSalida();
  }

  function presente() {
    return !document.hidden && document.hasFocus();
  }

  function contarSalida() {
    estado.integridad.salidas++;
    registraEvento('salida', '');
    guarda();
    if (POL.modo !== 'cerrar') return;
    var m = excedido();
    if (m) cerrarPorPolitica(m); else programaLimite();
  }

  function dentro() {
    if (portadaDesde) { portadaMs += Date.now() - portadaDesde; portadaDesde = null; }
    if (!salidaDesde) return;
    var d = Date.now() - salidaDesde, tipo = tipoSalida;
    salidaDesde = null;
    tipoSalida = '';
    clearTimeout(timerGracia);
    clearTimeout(timerFuera);
    // Diálogo propio o cambio de pantalla completa: sus eventos llegan juntos al cerrarse; si la
    // ausencia dura un segundo o más, el alumno sí dejó la ventana y se registra como pérdida breve.
    if (tipo === 'dialogo' && d < 1000) return;
    estado.integridad.msFuera += d;
    if (tipo !== 'salida') {
      estado.integridad.focosBreves = (estado.integridad.focosBreves || 0) + 1;
      registraEvento('foco', (d / 1000).toFixed(1) + ' s');
    } else {
      registraEvento('regreso', Math.round(d / 1000) + ' s');
    }
    guarda();
    if (POL.modo !== 'cerrar' || terminado()) return;
    var m = excedido();
    if (m) cerrarPorPolitica(m); else if (tipo === 'salida') velo('aviso');
  }

  function msFueraAhora() {
    return estado.integridad.msFuera + (salidaDesde && tipoSalida !== 'dialogo' ? Date.now() - salidaDesde : 0);
  }

  function excedido() {
    if (POL.modo !== 'cerrar' || terminado() || !estado.inicio) return null;
    if (estado.integridad.salidas > POL.salidas) return 'salidas';
    if (POL.segundos && msFueraAhora() > POL.segundos * 1000) return 'tiempo';
    return null;
  }

  /* Mientras el alumno está fuera, el cierre por tiempo ocurre a la hora exacta. */
  function programaLimite() {
    clearTimeout(timerFuera);
    if (POL.modo !== 'cerrar' || !POL.segundos || !salidaDesde) return;
    var resta = POL.segundos * 1000 - msFueraAhora();
    timerFuera = setTimeout(function () {
      if (salidaDesde && presente()) { dentro(); return; }   // volvió sin que llegara el evento focus
      var m = excedido();
      if (m) cerrarPorPolitica(m); else programaLimite();
    }, Math.max(50, resta + 50));
  }

  function cerrarPorPolitica(motivo) {
    if (terminado() || pasiva) return;
    estado.cierre = { motivo: motivo, t: Date.now() };
    registraEvento('cierre', motivo === 'tiempo' ? 'tiempo fuera de la ventana' : 'número de salidas');
    sellar();
    estado.entregado = true;
    guarda();
    bloquear();
    velo('fin');
    if (!presente()) { pdfPendiente = true; return; }
    try { descargarPDF(); } catch (err) { /* el velo ya muestra el error y el botón para reintentar */ }
  }

  // ----------------------------------------------------------- pantalla completa
  function enPantallaCompleta() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }
  function puedePantallaCompleta() {
    var el = document.documentElement;
    return !!(el.requestFullscreen || el.webkitRequestFullscreen);
  }
  function entrarPantallaCompleta() {
    if (!POL.pantalla || enPantallaCompleta() || !puedePantallaCompleta()) return;
    var el = document.documentElement;
    ignorarFocoHasta = Math.max(ignorarFocoHasta, Date.now() + 1500);
    try {
      var pr = (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
      if (pr && pr.catch) pr.catch(function () { });
    } catch (err) { /* sin gesto del usuario o sin permiso */ }
  }
  function salirPantallaCompleta() {
    if (!enPantallaCompleta()) return;
    ignorarFocoHasta = Math.max(ignorarFocoHasta, Date.now() + 1500);
    try {
      var pr = (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      if (pr && pr.catch) pr.catch(function () { });
    } catch (err) { }
  }

  /* Pantalla siempre encendida mientras dura el examen: en celulares, el bloqueo automático por
     inactividad dispararía una salida (y, con «cerrar», el cierre) mientras el alumno piensa. */
  var wakeLock = null;
  function mantenerPantalla() {
    if (!('wakeLock' in navigator) || !estado.inicio || terminado() || document.hidden) return;
    try {
      navigator.wakeLock.request('screen').then(function (w) { wakeLock = w; }).catch(function () { });
    } catch (err) { }
  }
  function soltarPantalla() {
    if (wakeLock) { try { wakeLock.release(); } catch (err) { } wakeLock = null; }
  }

  // --------------------------------------------------------------------- velo
  /* Capa que cubre el examen: aviso tras una salida tolerada, regreso a pantalla completa
     y pantalla final (entregado o cerrado por la política). */
  function velo(tipo) {
    var v = $('#velo'), t = $('#veloTitulo'), x = $('#veloTexto'), b = $('#veloBoton');
    if (!v || !t || !x || !b) return;          // index.html de una versión anterior (caché)
    cierraFigura();                            // la figura ampliada no queda detrás del aviso
    var ig = estado.integridad;
    v.className = 'velo ' + tipo;
    if (tipo === 'aviso') {
      var quedan = POL.salidas - ig.salidas;
      t.textContent = 'Salió de la ventana del examen';
      x.innerHTML = '<p>Salida <b>' + ig.salidas + '</b> de ' + POL.salidas + ' permitidas' +
        (POL.segundos ? ' · tiempo fuera acumulado <b>' + Math.round(ig.msFuera / 1000) + ' s</b> de ' +
          POL.segundos + ' s' : '') + '.</p><p>' +
        (quedan <= 0 ? '<b>La próxima salida cierra el examen.</b>'
          : 'Le ' + (quedan === 1 ? 'queda 1 salida' : 'quedan ' + quedan + ' salidas') + ' antes del cierre.') +
        ' Al cerrarse, el PDF se genera con lo que haya contestado hasta ese momento.</p>' +
        '<p class="tenue">Cambiar a otra ventana, pestaña o aplicación, o recargar la página, cuenta como salida.</p>';
      b.textContent = 'Volver al examen';
    } else if (tipo === 'pantalla') {
      t.textContent = 'El examen se resuelve en pantalla completa';
      x.innerHTML = '<p>Salir de la pantalla completa queda registrado en el PDF. Para continuar, vuelva a ella.</p>';
      b.textContent = 'Volver a pantalla completa';
    } else {
      var c = estado.cierre;
      t.textContent = c ? 'Examen cerrado por la política de salidas' : 'Examen terminado';
      x.innerHTML = (c ? '<p>' + (c.motivo === 'tiempo'
          ? 'Acumuló ' + Math.round(ig.msFuera / 1000) + ' s fuera de la ventana; se permitían ' + POL.segundos + ' s.'
          : 'Salió de la ventana ' + ig.salidas + ' veces; se permitían ' + POL.salidas + '.') +
          ' El PDF contiene lo que había contestado hasta ese momento.</p>' : '') +
        '<p>Archivo: <b>' + escapa(estado.archivo) + '</b><br>Folio: <code>' + estado.folio + '</code>' +
        (estado.sesion ? ' · Clave de sesión: <code>' + estado.sesion + '</code>' : '') +
        ' · Duración: ' + hhmmss(estado.fin - estado.inicio) + '</p>' +
        '<p>Suba este archivo, sin modificarlo ni renombrarlo, a la tarea de ' +
        escapa(B.meta.plataforma || 'la plataforma del curso') + ' «' + escapa(B.meta.evaluacion) + ' — ' +
        escapa(B.meta.clave) + '». Si la descarga no comenzó, use el botón.</p>';
      b.textContent = 'Descargar el PDF';
      salirPantallaCompleta();
    }
    v.hidden = false;
    b.focus();
  }

  function veloVisible() {
    var v = $('#velo');
    return !!(v && !v.hidden);
  }

  function botonVelo() {
    var v = $('#velo');
    if (v.classList.contains('fin')) { try { descargarPDF(); } catch (err) { } return; }
    v.hidden = true;
    entrarPantallaCompleta();
  }

  /* Rastro de canarios en el texto final de las respuestas: si el alumno pegó
     la respuesta de un asistente, es probable que arrastre la frase exigida. */
  function canariosEnRespuestas() {
    var out = [];
    Object.keys(estado.resp).forEach(function (rid) {
      var v = estado.resp[rid];
      var txt = (typeof v === 'string') ? v : Object.keys(v).map(function (k) { return v[k]; }).join(' ');
      var n = norm(txt);
      CANARIOS.forEach(function (c) {
        if (c.frase && n.indexOf(c.frase) >= 0 && out.indexOf(rid) < 0) out.push(rid);
      });
      if (n.indexOf('fe de erratas') >= 0 && out.indexOf(rid) < 0) out.push(rid);
    });
    return out;
  }

  // ------------------------------------------------------------------ reloj
  function arrancaReloj() {
    function pinta() {
      var fin = estado.fin && terminado() ? estado.fin : Date.now();
      var ms = fin - estado.inicio;
      var chip = $('#chipReloj');
      chip.textContent = hhmmss(ms);
      chip.classList.toggle('alerta', ms > B.meta.duracionMin * 60000);
      if (salidaDesde && presente()) dentro();                        // se perdió el evento focus
      else if (salidaDesde && excedido()) cerrarPorPolitica(excedido());   // respaldo del temporizador
    }
    pinta();
    clearInterval(tickReloj);
    tickReloj = setInterval(pinta, 1000);
    clearInterval(pulso);
    pulso = setInterval(function () { if (!salidaDesde && !terminado()) guarda(); }, 5000);
  }

  // ------------------------------------------------------------------ flujo
  function validaPortada() {
    var nombre = $('#fNombre').value.trim();
    var mat = $('#fMatricula').value.trim();
    var ok = nombre.length >= 6 && V.normaliza(mat).length >= 4 && $('#fDeclaro').checked;
    $('#btnIniciar').disabled = !ok;
    return ok;
  }

  function horaCorta(t) {
    var d = new Date(t);
    return dosDig(d.getHours()) + ':' + dosDig(d.getMinutes());
  }
  function describeSesion(prev) {
    return ' (clave de sesión ' + (prev.sesion || '—') + ', iniciada el ' + fechaLarga(new Date(prev.inicio)) + ')';
  }
  function resumenSesion(prev) {
    return (prev.sesion || 'SINCLAVE') + ':' +
      (prev.cierre ? 'cerrada' : prev.entregado ? 'entregada' : 'abandonada') + '@' + horaCorta(prev.inicio);
  }

  function restaura(prev) {
    if (prev.alumno && prev.alumno.matricula) estado.alumno = prev.alumno;   // la semilla es la de esa sesión
    claveLS = claveDe(estado.alumno.matricula);
    estado.sesion = prev.sesion || '';
    estado.inicio = prev.inicio;
    estado.fin = prev.fin || null;
    estado.resp = prev.resp || {};
    if (prev.integridad) estado.integridad = prev.integridad;
    var ig = estado.integridad;
    if (!ig.eventos) ig.eventos = [];
    if (!ig.fsSalidas) ig.fsSalidas = 0;
    if (!ig.focosBreves) ig.focosBreves = 0;
    if (UNO) estado.pos = Math.max(0, parseInt(prev.pos, 10) || 0);   // 0.5.1: no se regresa al recargar
    estado.entregado = POL.modo === 'cerrar' && !!prev.entregado;   // en «registrar» se sigue editando
    if (!estado.entregado && !prev.cierre) estado.fin = null;
    estado.cierre = prev.cierre || null;
    estado.reinicios = prev.reinicios || 0;
    estado.previas = prev.previas || [];
    estado.folio = prev.folio || '';
    if (prev.accesoRechazos) estado.accesoRechazos = prev.accesoRechazos;
    estado.archivo = nombreArchivo();
  }

  /* Tiempo entre la última actividad de la sesión guardada y su reanudación: cuenta como salida. */
  function cuentaRecarga(prev) {
    var ig = estado.integridad;
    // Tiempo fuera de la ventana con la portada abierta: el alumno ya había visto el examen.
    var enPortada = portadaMs + (portadaDesde ? Date.now() - portadaDesde : 0);
    portadaMs = 0;
    portadaDesde = null;
    if (prev.fueraDesde) {                       // la página se cerró estando fuera: la salida ya contaba
      var d = Math.max(0, CARGA - prev.fueraDesde) + enPortada;
      ig.msFuera += d;
      registraEvento('regreso', 'recarga de la página, ' + Math.round(d / 1000) + ' s');
      return true;
    }
    if (!prev.ultimo) return false;              // sesión guardada por la 0.2: no hay con qué medir
    var hueco = CARGA - prev.ultimo + enPortada;
    if (hueco < 4000) return false;
    ig.salidas++;
    ig.msFuera += hueco;
    registraEvento('salida', 'recarga de la página, ' + Math.round(hueco / 1000) + ' s');
    return true;
  }

  function iniciar() {
    if (!validaPortada()) return;
    var acceso = revisaAcceso($('#fMatricula').value.trim());
    if (acceso !== 'ok') {
      var av = $('#avisoPortada');
      if (acceso === 'fuera') {
        var n = rechazosAcceso() + 1;
        try { localStorage.setItem(RECHAZOS, String(n)); } catch (err) { }
        av.textContent = 'La matrícula «' + $('#fMatricula').value.trim() + '» no está en la lista del grupo. ' +
          'Revísela (tal como aparece en su credencial); si es correcta, avise al profesor antes de continuar.';
      } else {
        av.textContent = 'Este examen solo admite a los alumnos de la lista del grupo, pero la página no trae la ' +
          'lista (assets/acceso.js). Avise al profesor.';
      }
      av.classList.add('error-acceso');
      try { $('#fMatricula').focus(); } catch (err) { }
      return;
    }
    $('#avisoPortada').textContent = '';
    // Los rechazos anteriores son de este intento: pasan a la sesión que empieza y el contador vuelve a cero, para
    // que el siguiente alumno del mismo equipo no herede un indicio que no es suyo.
    var rechazos = rechazosAcceso();
    try { localStorage.removeItem(RECHAZOS); } catch (err) { }
    entrarPantallaCompleta();                   // dentro del clic: el navegador exige un gesto del usuario
    estado.alumno = {
      nombre: $('#fNombre').value.trim(),
      matricula: $('#fMatricula').value.trim().toUpperCase(),
      grupo: $('#fGrupo').value.trim() || String(B.meta.grupo || ''),
      correo: $('#fCorreo').value.trim()
    };
    claveLS = claveDe(estado.alumno.matricula);

    var prev = carga(estado.alumno.matricula), reanuda = false, previas = [];
    if (prev && prev.inicio) {
      if (sesionTerminada(prev)) {
        if (confirma('Esta matrícula ya terminó un examen en este navegador' + describeSesion(prev) + '.\n\n' +
                     'Aceptar: ver esa sesión y volver a descargar su PDF.\n' +
                     'Cancelar: iniciar una sesión nueva. ' + (POL.sesion ? 'Los datos numéricos cambian y el ' : 'El ') +
                     'reinicio queda registrado en el PDF.')) {
          // Solo vuelve a descargar el PDF de una sesión terminada (sus datos no cambian): los rechazos de este
          // intento regresan al contador y pasan a la siguiente sesión que se abra.
          if (rechazos) { try { localStorage.setItem(RECHAZOS, String(rechazos)); } catch (err) { } }
          restaura(prev);
          mostrarExamen();
          velo('fin');
          return;
        }
        previas = (prev.previas || []).concat([resumenSesion(prev)]);
      } else if (confirma('Se encontró una sesión sin terminar de esta matrícula en este navegador' +
                          describeSesion(prev) + '.\n\n' +
                          'Aceptar: continuar esa sesión, con sus datos y respuestas. El tiempo transcurrido ' +
                          'desde que dejó la página queda registrado como salida de la ventana.\n' +
                          'Cancelar: iniciar una sesión nueva' + (POL.sesion ? ' con datos distintos' : '') +
                          '; se pierden las respuestas guardadas y el reinicio queda registrado.')) {
        restaura(prev);
        reanuda = cuentaRecarga(prev);
      } else {
        previas = (prev.previas || []).concat([resumenSesion(prev)]);
      }
    }
    recuerdaAlumno();
    if (!estado.inicio) {
      estado.inicio = Date.now();
      estado.sesion = POL.sesion ? nuevaSesion() : '';
      estado.previas = previas;
      estado.reinicios = previas.length;
      if (previas.length) registraEvento('sesión nueva', 'sesiones anteriores: ' + previas.join(', '));
    }
    // Intentos rechazados antes de entrar: se suman a los de la sesión (también a una sesión que se reanuda).
    if (B.meta.accesoLista === true && rechazos) estado.accesoRechazos = (estado.accesoRechazos || 0) + rechazos;
    estado.archivo = nombreArchivo();

    mostrarExamen();
    if (terminado()) { velo('fin'); return; }
    if (POL.modo === 'cerrar') {
      var m = excedido();
      if (m) { cerrarPorPolitica(m); return; }
      if (reanuda) { velo('aviso'); return; }
      // Si el navegador no concedió la pantalla completa (o la soltó al mostrar un diálogo), se pide con un botón.
      if (POL.pantalla && puedePantallaCompleta()) {
        setTimeout(function () {
          if (!enPantallaCompleta() && !veloVisible() && !terminado()) velo('pantalla');
        }, 700);
      }
    }
  }

  function mostrarExamen() {
    $('#pantallaPortada').hidden = true;
    $('#pantallaExamen').hidden = false;
    $('#barra').hidden = false;
    $('#barraQuien').textContent = estado.alumno.matricula + (estado.sesion ? ' · sesión ' + estado.sesion : '');
    aplicaSeleccion();                          // 0.6: con composición, solo los reactivos de este alumno
    pintaExamen();
    arrancaReloj();
    if (terminado()) bloquear(); else mantenerPantalla();
    guarda();
    window.scrollTo(0, 0);
  }

  function nombreArchivo() {
    var apellido = estado.alumno.nombre.split(/[ ,]+/)[0] || 'ALUMNO';
    apellido = apellido.normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    return PREFIJO + '_' + V.normaliza(estado.alumno.matricula) + '_' + (apellido || 'ALUMNO') + '.pdf';
  }

  /* Fija la hora de término, el folio y el nombre del archivo. No bloquea: quien llama decide. */
  function sellar() {
    estado.fin = Date.now();
    if (salidaDesde) {
      if (tipoSalida !== 'dialogo') estado.integridad.msFuera += Date.now() - salidaDesde;
      salidaDesde = null;
      tipoSalida = '';
    }
    clearTimeout(timerFuera);
    clearTimeout(timerGracia);
    canariosEnRespuestas().forEach(function (a) {
      if (estado.integridad.canarios.indexOf(a) < 0) estado.integridad.canarios.push(a);
    });
    // Sin clave de sesión, el folio se calcula exactamente como en la versión anterior.
    var base = estado.alumno.matricula + '|' + (estado.sesion ? estado.sesion + '|' : '') +
      estado.inicio + '|' + estado.fin + '|' + JSON.stringify(estado.resp);
    estado.folio = folio(base);
    estado.archivo = nombreArchivo();
  }

  function bloquear() {
    $$('#pantallaExamen textarea, #pantallaExamen input').forEach(function (el) { el.readOnly = true; });
    $$('#listaMultiple input[type="radio"], #listaMultiple .quitar-eleccion').forEach(function (el) { el.disabled = true; });
    if (MATE) MATE.bloquear();
    if ($('#btnSiguiente')) $('#btnSiguiente').hidden = true;   // 0.5.1: terminado, ya no se avanza
    $('#btnGenerar').textContent = 'Descargar de nuevo el PDF';
    clearInterval(pulso);
    clearInterval(tickReloj);
    soltarPantalla();
    olvidaAlumno();
    var ms = (estado.fin || Date.now()) - estado.inicio;
    $('#chipReloj').textContent = hhmmss(ms);
  }

  function descargarPDF() {
    pdfPendiente = false;
    try {
      window.EXAMEN_PDF.generar({
        meta: B.meta, banco: bancoDelAlumno(), estado: estado, folio: estado.folio,
        archivo: estado.archivo, composicion: COMP, seleccionPropia: seleccionPropia(),
        util: { hhmmss: hhmmss, fechaLarga: fechaLarga, politica: textoPolitica }
      });
    } catch (err) {
      pdfPendiente = false;
      if (veloVisible()) {
        var previo = $('#veloTexto .error-pdf');
        if (previo) previo.parentNode.removeChild(previo);
        $('#veloTexto').innerHTML += '<p class="error-pdf" style="color:#b42318"><b>No se pudo generar el PDF:</b> ' +
          escapa(err.message) + '. Avise al profesor de inmediato; sus respuestas están guardadas en este ' +
          'navegador. Puede reintentar con el botón.</p>';
      } else {
        avisa('Ocurrió un error al generar el PDF:\n\n' + err.message +
              '\n\nAvise al profesor de inmediato. Sus respuestas siguen guardadas en este navegador.');
      }
      throw err;
    }
    var av = $('#avisoDescarga');
    av.hidden = false;
    av.innerHTML = '<b>PDF generado: ' + escapa(estado.archivo) + '</b><br>' +
      'Folio de verificación: <code>' + estado.folio + '</code>' +
      (estado.sesion ? ' · Clave de sesión: <code>' + estado.sesion + '</code>' : '') +
      ' · Duración de la sesión: ' + hhmmss(estado.fin - estado.inicio) + '<br>' +
      'Suba este archivo, sin modificarlo ni renombrarlo, a la tarea de ' + escapa(B.meta.plataforma || 'la plataforma del curso') + ' ' +
      '«' + escapa(B.meta.evaluacion) + ' — ' + escapa(B.meta.clave) + '». ' +
      (POL.modo === 'cerrar' ? 'El examen quedó cerrado: ya no se pueden modificar las respuestas.'
        : UNO ? 'Puede seguir con el reactivo actual y los siguientes y volver a generar el PDF: entregue únicamente la última versión.'
        : 'Si necesita corregir una respuesta puede hacerlo y volver a generar el PDF: entregue únicamente la última versión.');
    if (!veloVisible()) av.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function generarPDF() {
    if (pasiva) return;                         // 0.5.1: otra pestaña lleva la sesión
    if (terminado()) { descargarPDF(); return; }
    var p = pendientes();
    var aviso = p.length ? 'Quedan ' + p.length + ' reactivo(s) incompleto(s): ' + p.join(', ') + '.\n\n' : '';
    if (POL.modo === 'cerrar') {
      if (!confirma(aviso + 'Al generar el PDF el examen termina: se registra la hora de término y ya no podrá ' +
                    'modificar las respuestas.\n\n¿Terminar el examen y generar el PDF?')) return;
      if (terminado()) return;                  // la política lo cerró mientras el diálogo estaba abierto
    } else if (p.length && !confirma(aviso + '¿Generar el PDF de todos modos?')) {
      return;
    }
    // Fórmulas (0.5): el PDF las toma ya dibujadas; se espera a que terminen (como mucho unos segundos).
    if (MATE && MATE.pendientes()) {
      var b = $('#btnGenerar'), t = b.textContent;
      // Lo que entra al PDF es lo que se confirmó: mientras tanto no se escribe ni se cambia una elección.
      var campos = $$('#pantallaExamen textarea, #pantallaExamen input').filter(function (el) { return !el.readOnly; });
      var botones = $$('#listaMultiple input[type="radio"], #listaMultiple .quitar-eleccion')
        .filter(function (el) { return !el.disabled; });
      var libera = function () {
        // 0.5.1: lo que «uno a la vez» cerró mientras tanto (otra pestaña) sigue cerrado
        campos.forEach(function (el) { if (!el.closest('.cerrado')) el.readOnly = false; });
        botones.forEach(function (el) { if (!el.closest('.cerrado')) el.disabled = false; });
      };
      campos.forEach(function (el) { el.readOnly = true; });
      botones.forEach(function (el) { el.disabled = true; });
      b.disabled = true;
      b.textContent = 'Preparando las fórmulas del PDF…';
      MATE.esperar(6000).then(function () {
        b.disabled = false;
        if (terminado()) return;                // la política lo cerró mientras tanto: bloquear() ya dejó el botón
        b.textContent = t;
        if (POL.modo !== 'cerrar') libera();
        entregar();
        if (!terminado() && POL.modo === 'cerrar') libera();   // el PDF falló: el examen sigue abierto
      });
      return;
    }
    entregar();
  }

  function entregar() {
    var antes = { fin: estado.fin, folio: estado.folio };
    // 0.5.1: un PDF antes del último reactivo trae los enunciados que aún no se mostraban; queda en la bitácora.
    var anotado = false;
    if (UNO && SECUENCIA.length && estado.pos < SECUENCIA.length - 1) {
      var n = estado.integridad.eventos.length;
      registraEvento('pdf', (POL.modo === 'cerrar' ? 'examen terminado en el reactivo ' : 'generado en el reactivo ') +
        (estado.pos + 1) + ' de ' + SECUENCIA.length);
      anotado = estado.integridad.eventos.length > n;
    }
    sellar();
    try {
      descargarPDF();                           // primero el PDF: si falla, el examen sigue abierto
    } catch (err) {
      if (anotado) estado.integridad.eventos.pop();   // no se generó: no se anota
      estado.fin = antes.fin;
      estado.folio = antes.folio;
      guarda();
      return;
    }
    estado.entregado = true;
    guarda();
    olvidaAlumno();                             // equipo compartido: el siguiente alumno no ve estos datos
    if (POL.modo === 'cerrar') { bloquear(); velo('fin'); }
  }

  // -------------------------------------------------------------- arranque
  document.addEventListener('DOMContentLoaded', function () {
    $('#logo').src = window.EXAMEN_LOGO;
    $('#verInstrumento').textContent = B.meta.version + ' · ' + B.meta.periodo;

    var a = alumnoRecordado();                 // solo si esa matrícula tiene una sesión sin terminar
    if (a) {
      if (a.nombre) $('#fNombre').value = a.nombre;
      if (a.matricula) $('#fMatricula').value = a.matricula;
      if (a.grupo) $('#fGrupo').value = a.grupo;
      if (a.correo) $('#fCorreo').value = a.correo;
    }
    ['#fNombre', '#fMatricula', '#fDeclaro', '#fGrupo'].forEach(function (s) {
      $(s).addEventListener('input', validaPortada);
      $(s).addEventListener('change', validaPortada);
    });
    $('#btnIniciar').addEventListener('click', iniciar);
    $('#btnGenerar').addEventListener('click', generarPDF);
    if ($('#veloBoton')) $('#veloBoton').addEventListener('click', botonVelo);
    $('#btnIrCierre').addEventListener('click', function () {
      $('#bloqueCierre').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    instalaIntegridad();
    validaPortada();

    // Diagnóstico para el profesor: copia de solo lectura del estado (modificarla no altera la sesión).
    window.EXAMEN_DIAG = function () {
      return JSON.parse(JSON.stringify({ estado: estado, politica: POL }));
    };
    window.EXAMEN_ORDEN = ordenAlternativas;     // para las pruebas de paridad con Python
    window.EXAMEN_SELECCION = function (matricula, sesion) {   // 0.6: paridad con composicion.seleccion
      return seleccion(COMPLETO, COMP, matricula, sesion);
    };
    window.addEventListener('storage', otraPestana);   // 0.5.1, un reactivo a la vez
    window.EXAMEN_HUELLA_ACCESO = function (m, sal, hex) {
      return sha256hex('sinodal-acceso|' + sal + '|' + canonAcceso(m)).slice(0, hex || 4);
    };
  });
})();
