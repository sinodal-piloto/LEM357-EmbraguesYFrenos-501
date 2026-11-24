/* =====================================================================
   Sinodal — fórmulas en el examen (0.5). Solo se carga en los exámenes con notación LaTeX.

   - Enunciados: LaTeX entre \( … \) (en línea) y \[ … \] (en bloque). El dato por alumno se marca {{k}};
     dentro de una fórmula, su coma decimal se escribe {,}.
   - Página: MathJax 4 (salida SVG), incluido en el sitio (vendor/mathjax).
   - PDF: cada fórmula se dibuja desde su SVG a PNG en segundo plano y queda en memoria; pdf.js la coloca en la
     línea con su línea base y escribe el LaTeX como texto invisible, para que el calificador lo lea.
   - Respuestas: «Insertar ecuación» abre un editor de ecuaciones (MathLive, vendor/mathlive, se carga al primer
     uso) y escribe la fórmula en LaTeX entre \( … \) donde estaba el cursor.
   ===================================================================== */
(function () {
  'use strict';

  // Configuración de MathJax: tiene que existir antes de cargar vendor/mathjax/tex-svg.js.
  window.MathJax = {
    loader: { load: [], paths: { fonts: 'vendor/mathjax/fonts' } },
    tex: { inlineMath: [['\\(', '\\)']], displayMath: [['\\[', '\\]']] },
    // fontCache local: cada SVG lleva sus glifos y se puede dibujar suelto (PDF). Una sola pieza por fórmula.
    svg: { fontCache: 'local', linebreaks: { inline: false } },
    options: {
      enableMenu: false, enableEnrichment: false, enableSpeech: false, enableBraille: false, enableExplorer: false,
      menuOptions: { settings: { enrich: false, speech: false, braille: false, assistiveMml: false, collapsible: false } }
    },
    startup: { typeset: false }
  };

  var FORMULA = /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g;

  /* [{t: 'texto' | 'f' (en línea) | 'F' (en bloque), v}] */
  function segmentos(texto) {
    var out = [], i = 0, m;
    texto = String(texto == null ? '' : texto);
    FORMULA.lastIndex = 0;
    while ((m = FORMULA.exec(texto))) {
      if (m.index > i) out.push({ t: 'texto', v: texto.slice(i, m.index) });
      out.push(m[1] !== undefined ? { t: 'f', v: m[1] } : { t: 'F', v: m[2] });
      i = FORMULA.lastIndex;
    }
    if (i < texto.length) out.push({ t: 'texto', v: texto.slice(i) });
    return out;
  }

  function tieneFormulas(texto) {
    FORMULA.lastIndex = 0;
    var r = FORMULA.test(String(texto == null ? '' : texto));
    FORMULA.lastIndex = 0;
    return r;
  }

  function numero(x, enFormula) {
    if (typeof x !== 'number') return String(x);
    return String(x).replace('.', enFormula ? '{,}' : ',');
  }

  /* El enunciado con los datos del alumno (paridad con banco.texto_variante en Python). */
  function texto(plantilla, v) {
    v = v || {};
    return segmentos(plantilla).map(function (s) {
      var dentro = s.t !== 'texto';
      var t = s.v.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, function (m, k) {
        return (k in v) ? numero(v[k], dentro) : m;
      });
      return s.t === 'texto' ? t : (s.t === 'f' ? '\\(' + t + '\\)' : '\\[' + t + '\\]');
    }).join('');
  }

  // ------------------------------------------------------------- MathJax
  function mjListo() {
    var mj = window.MathJax;
    if (mj && mj.startup && mj.startup.promise) return mj.startup.promise;
    return Promise.reject(new Error('MathJax no cargó'));
  }

  function tipografiar(el) {
    return mjListo().then(function () {
      if (MathJax.typesetClear) MathJax.typesetClear([el]);
      return MathJax.typesetPromise([el]);
    }).catch(function () { /* sin MathJax: queda el LaTeX como texto */ });
  }

  // --------------------------------------------- fórmulas como imagen (PDF)
  /* Navegadores que falsean la lectura del canvas (resistFingerprinting) devolverían un PNG en blanco: entonces
     el PDF lleva el LaTeX como texto. Misma prueba que pdf.js hace con las figuras. */
  var canvasFiel = null;
  function lecturaFiel() {
    if (canvasFiel !== null) return canvasFiel;
    canvasFiel = false;
    try {
      var c = document.createElement('canvas');
      c.width = 16; c.height = 16;
      var g = c.getContext('2d');
      g.fillStyle = 'rgb(200,30,60)'; g.fillRect(0, 0, 8, 16);
      g.fillStyle = 'rgb(20,90,240)'; g.fillRect(8, 0, 8, 16);
      var px = g.getImageData(0, 0, 16, 16).data, ok = px.length === 1024;
      for (var i = 0; ok && i < px.length; i += 4) {
        var izq = (i >> 2) % 16 < 8;
        ok = px[i] === (izq ? 200 : 20) && px[i + 1] === (izq ? 30 : 90) && px[i + 2] === (izq ? 60 : 240);
      }
      canvasFiel = ok;
    } catch (err) { canvasFiel = false; }
    return canvasFiel;
  }

  var PX_EX = 14;          // píxeles por ex: con texto de 9 pt (1 ex ≈ 1,6 mm) son unos 220 ppp en la hoja
  var cache = {};
  var cadena = Promise.resolve();
  var enCurso = 0;
  var alTerminar = [];

  function clave(tex, bloque) { return (bloque ? 'D|' : 'I|') + tex; }

  /* {png, wEx, hEx, vaEx} si ya está lista, o null. */
  function imagen(tex, bloque) {
    var e = cache[clave(tex, bloque)];
    return e && e.png ? e : null;
  }

  function cargarImagen(src) {
    return new Promise(function (ok, mal) {
      var img = new Image();
      img.onload = function () { ok(img); };
      img.onerror = function () { mal(new Error('no se pudo dibujar la fórmula')); };
      img.src = src;
    });
  }

  function dibujar(tex, bloque, e) {
    if (!lecturaFiel()) return Promise.resolve(e);
    return mjListo().then(function () {
      return MathJax.tex2svgPromise(tex, { display: !!bloque });
    }).then(function (nodo) {
      var svg = nodo && nodo.querySelector('svg');
      if (!svg || nodo.querySelector('[data-mjx-error], mjx-merror')) { e.error = true; return e; }
      var wEx = parseFloat(svg.getAttribute('width')), hEx = parseFloat(svg.getAttribute('height'));
      var va = /vertical-align:\s*(-?[\d.]+)ex/.exec(svg.getAttribute('style') || '');
      if (!(wEx > 0) || !(hEx > 0)) { e.error = true; return e; }
      var wPx = Math.max(1, Math.ceil(wEx * PX_EX)), hPx = Math.max(1, Math.ceil(hEx * PX_EX));
      var c = svg.cloneNode(true);
      c.setAttribute('width', String(wPx));
      c.setAttribute('height', String(hPx));
      c.removeAttribute('style');
      c.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      var xml = new XMLSerializer().serializeToString(c).replace(/currentColor/g, '#141824');
      return cargarImagen('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml)).then(function (img) {
        var cv = document.createElement('canvas');
        cv.width = wPx; cv.height = hPx;
        var g = cv.getContext('2d');
        g.drawImage(img, 0, 0, wPx, hPx);
        e.png = cv.toDataURL('image/png');
        cv.width = cv.height = 0;
        e.wEx = wEx; e.hEx = hEx; e.vaEx = va ? parseFloat(va[1]) : 0;
        return e;
      });
    });
  }

  /* Una a la vez: MathJax carga glifos bajo demanda y no conviene pedirle cien fórmulas a la vez. */
  function encolar(tex, bloque) {
    var k = clave(tex, bloque);
    if (cache[k]) return cache[k].promesa;
    var e = {};
    cache[k] = e;
    enCurso++;
    function fin() {
      enCurso--;
      if (!enCurso) {
        var l = alTerminar; alTerminar = [];
        l.forEach(function (f) { try { f(); } catch (err) { } });
      }
      return e;
    }
    e.promesa = cadena = cadena.then(function () { return dibujar(tex, bloque, e); })
      .then(fin, function (err) { e.error = String((err && err.message) || err); return fin(); });
    return e.promesa;
  }

  /* Prepara para el PDF las fórmulas de una lista de textos (ya con los datos del alumno). */
  function precargar(textos) {
    (textos || []).forEach(function (t) {
      segmentos(t).forEach(function (s) { if (s.t !== 'texto' && s.v.trim()) encolar(s.v, s.t === 'F'); });
    });
    return cadena;
  }

  /* Promesa que se cumple cuando no quedan fórmulas por dibujar (true) o al vencer el plazo (false). */
  function esperar(ms) {
    return new Promise(function (ok) {
      if (!enCurso) { ok(true); return; }
      var t = setTimeout(function () { ok(false); }, ms || 4000);
      alTerminar.push(function () { clearTimeout(t); ok(true); });
    });
  }

  // ----------------------------------------------------- editor del alumno
  var mlPromesa = null;
  function cargarEditor() {
    if (window.MathfieldElement) return Promise.resolve();
    if (!mlPromesa) {
      mlPromesa = new Promise(function (ok, mal) {
        var s = document.createElement('script');
        s.src = 'vendor/mathlive/mathlive.min.js';
        s.onload = function () { ok(); };
        s.onerror = function () { mlPromesa = null; mal(new Error('no cargó el editor de ecuaciones')); };
        document.head.appendChild(s);
      }).then(function () {
        if (window.MathfieldElement) {
          MathfieldElement.soundsDirectory = null;       // sin sonidos: no hay nada más que descargar
        }
        // Sin la barra Cortar/Copiar/Pegar del teclado matemático.
        try { if (window.mathVirtualKeyboard) window.mathVirtualKeyboard.editToolbar = 'none'; } catch (err) { }
      });
    }
    return mlPromesa;
  }

  function escapa(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  var editores = [];

  /* Agrega a un textarea el botón «Insertar ecuación», el panel del editor y la vista previa de la respuesta. */
  function editor(ta) {
    if (!ta || ta.dataset.ecuaciones) return;
    ta.dataset.ecuaciones = '1';
    var sel = [ta.value.length, ta.value.length];
    function recuerda() { sel = [ta.selectionStart || 0, ta.selectionEnd || 0]; }
    ['select', 'keyup', 'click', 'input', 'blur'].forEach(function (ev) { ta.addEventListener(ev, recuerda); });

    var caja = document.createElement('div');
    caja.className = 'ecuacion';
    caja.innerHTML =
      '<div class="ecuacion-barra mathjax_ignore"><button type="button" class="secundario chico ecuacion-abrir">Insertar ecuación</button>' +
      '<span class="ayuda ecuacion-nota">Las fórmulas quedan en el texto entre \\( y \\); la vista previa muestra cómo se leerán.</span></div>' +
      '<div class="ecuacion-panel mathjax_ignore" hidden>' +
        '<div class="ecuacion-campo"></div>' +
        '<div class="acciones ecuacion-acciones"><button type="button" class="primario chico ecuacion-poner">Insertar en la respuesta</button>' +
        '<button type="button" class="secundario chico ecuacion-cerrar">Cancelar</button></div>' +
        '<p class="ayuda">Escriba con el teclado (/ hace una fracción, ^ un exponente, _ un subíndice; \\theta, \\int, \\sum…) ' +
        'o con el teclado matemático. En el celular aparece al tocar el campo.</p>' +
      '</div>' +
      '<div class="ecuacion-previa" hidden aria-live="polite"></div>';
    ta.parentNode.insertBefore(caja, ta.nextSibling);
    var abrir = caja.querySelector('.ecuacion-abrir'), panel = caja.querySelector('.ecuacion-panel');
    var lugar = caja.querySelector('.ecuacion-campo'), previa = caja.querySelector('.ecuacion-previa');
    var mf = null;

    function cerrar() { panel.hidden = true; abrir.disabled = ta.readOnly; }
    abrir.addEventListener('click', function () {
      abrir.disabled = true;
      cargarEditor().then(function () {
        if (!mf) {
          mf = new window.MathfieldElement();
          mf.setAttribute('aria-label', 'Ecuación para insertar');
          mf.smartFence = true;
          // La tecla Intro (también la ↵ del teclado matemático del celular) inserta la ecuación.
          mf.addEventListener('input', function (ev) { if (ev.inputType === 'insertLineBreak') poner(); });
          lugar.appendChild(mf);
          // Sin «Cortar», «Copiar» ni «Pegar» en el menú del campo (ya montado: antes, MathLive lo repone).
          try {
            mf.menuItems = (mf.menuItems || []).filter(function (it) {
              return !/^(cut|copy|paste|copy-latex|copy-ascii-math|copy-math-ml)$/.test(String(it && it.id));
            });
          } catch (err) { }
          // Ni los atajos de ese comando (la tecla [Paste], Ctrl/Cmd+V en iOS): queda el pegado normal del navegador.
          try {
            mf.keybindings = (mf.keybindings || []).filter(function (k) {
              return String(k && k.command).indexOf('pasteFromClipboard') < 0;
            });
          } catch (err) { }
        }
        mf.value = '';
        panel.hidden = false;
        try { mf.focus(); } catch (err) { }
      }).catch(function () {
        lugar.innerHTML = '<p class="ayuda" style="color:var(--rojo)">El editor de ecuaciones no cargó. Escriba la fórmula ' +
          'en LaTeX entre \\( y \\), por ejemplo \\(\\theta = 56\\,^{\\circ}\\mathrm{C}\\).</p>';
        panel.hidden = false;
      }).then(function () { abrir.disabled = ta.readOnly; });
    });
    caja.querySelector('.ecuacion-cerrar').addEventListener('click', cerrar);
    caja.querySelector('.ecuacion-poner').addEventListener('click', function () { poner(); });
    function poner() {
      var tex = mf ? String(mf.value || '').trim() : '';
      if (!tex) { cerrar(); return; }
      if (ta.readOnly) return;                  // respuesta bloqueada un momento (PDF en preparación): la fórmula se queda
      var v = ta.value, a = Math.min(sel[0], v.length), b = Math.min(Math.max(sel[1], a), v.length);
      var antes = v.slice(0, a), despues = v.slice(b);
      var trozo = (antes && !/\s$/.test(antes) ? ' ' : '') + '\\(' + tex + '\\)' + (despues && !/^\s/.test(despues) ? ' ' : '');
      var max = parseInt(ta.getAttribute('maxlength'), 10);
      if (max && (antes + trozo + despues).length > max) {
        lugar.insertAdjacentHTML('beforeend', '<p class="ayuda ecuacion-error" style="color:var(--rojo)">La respuesta ' +
          'rebasaría el máximo de ' + max + ' caracteres.</p>');
        return;
      }
      ta.value = antes + trozo + despues;
      sel = [a + trozo.length, a + trozo.length];
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      var err = lugar.querySelector('.ecuacion-error');
      if (err) err.parentNode.removeChild(err);
      cerrar();
      try { ta.focus(); ta.setSelectionRange(sel[0], sel[1]); } catch (e) { }
    }

    var t = null;
    function pintaPrevia() {
      var v = ta.value;
      if (!tieneFormulas(v)) { previa.hidden = true; previa.innerHTML = ''; return; }
      previa.hidden = false;
      previa.innerHTML = escapa(v).replace(/\n/g, '<br>');
      tipografiar(previa);
      precargar([v]);
    }
    ta.addEventListener('input', function () { clearTimeout(t); t = setTimeout(pintaPrevia, 400); });
    pintaPrevia();
    editores.push({ ta: ta, abrir: abrir, panel: panel });
  }

  /* Examen terminado: sin editor. */
  function bloquear() {
    editores.forEach(function (e) { e.abrir.disabled = true; e.panel.hidden = true; });
  }

  window.EXAMEN_MATE = {
    segmentos: segmentos, tieneFormulas: tieneFormulas, texto: texto, numero: numero,
    listo: mjListo, tipografiar: tipografiar,
    precargar: precargar, imagen: imagen, esperar: esperar, pendientes: function () { return enCurso; },
    editor: editor, bloquear: bloquear
  };
})();
