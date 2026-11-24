/* =====================================================================
   Sinodal — generación del PDF de entrega (jsPDF), derivado del piloto LEM537
   Produce un documento con encabezado institucional, identificación del
   sustentante, enunciados con la variante del alumno, respuestas
   delimitadas para el postproceso y registro de integridad de la sesión.
   ===================================================================== */
window.EXAMEN_PDF = (function () {
  'use strict';

  var AZUL = [27, 42, 99];
  var ROJO = [200, 16, 46];
  var GRIS = [110, 118, 135];
  var GRIS_CLARO = [232, 235, 242];

  // Geometría de página (carta, milímetros)
  var ANCHO = 215.9, ALTO = 279.4;
  var MI = 18, MD = 18, MSUP = 16, MINF = 16;
  var ANCHO_TXT = ANCHO - MI - MD;

  /* Rangos Unicode incluidos en el subconjunto tipográfico embebido. */
  var RANGOS = [[0x09, 0x0A], [0x20, 0x7E], [0xA0, 0xFF], [0x100, 0x17F], [0x192, 0x192],
    [0x370, 0x3FF], [0x2000, 0x206F], [0x2070, 0x209F], [0x20A0, 0x20BF],
    [0x2190, 0x21FF], [0x2200, 0x22FF], [0x2300, 0x2317], [0x25A0, 0x25FF],
    [0x2610, 0x2612], [0xFB00, 0xFB06]];

  function sanea(s) {
    var out = '';
    s = String(s == null ? '' : s);
    for (var i = 0; i < s.length; i++) {
      var c = s.codePointAt(i);
      if (c > 0xFFFF) { i++; out += '?'; continue; }
      var ok = false;
      for (var j = 0; j < RANGOS.length; j++) {
        if (c >= RANGOS[j][0] && c <= RANGOS[j][1]) { ok = true; break; }
      }
      out += ok ? s[i] : '?';
    }
    return out;
  }

  function fmtNum(x) {
    if (typeof x !== 'number') return String(x);
    return String(x).replace('.', ',');
  }

  function iso(ms) { return new Date(ms).toISOString(); }

  // -------------------------------------------------------------- documento
  function Doc(jsPDF, fuentes) {
    this.d = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait', compress: true });
    this.d.addFileToVFS('DejaVuSans.ttf', fuentes.regular);
    this.d.addFont('DejaVuSans.ttf', 'DJV', 'normal');
    this.d.addFileToVFS('DejaVuSans-Bold.ttf', fuentes.bold);
    this.d.addFont('DejaVuSans-Bold.ttf', 'DJV', 'bold');
    this.d.setFont('DJV', 'normal');
    this.y = MSUP;
    this.pagina = 1;
  }

  Doc.prototype.fuente = function (estilo, tam, color) {
    this.d.setFont('DJV', estilo || 'normal');
    this.d.setFontSize(tam || 10);
    var c = color || [40, 45, 60];
    this.d.setTextColor(c[0], c[1], c[2]);
    return this;
  };

  Doc.prototype.espacio = function (mm) { this.y += mm; return this; };

  Doc.prototype.necesita = function (mm) {
    if (this.y + mm > ALTO - MINF) this.nuevaPagina();
    return this;
  };

  Doc.prototype.nuevaPagina = function () {
    this.d.addPage();
    this.pagina++;
    this.y = MSUP;
    return this;
  };

  /* Escribe un bloque de texto con salto de línea automático. */
  Doc.prototype.parrafo = function (txt, opc) {
    opc = opc || {};
    var tam = opc.tam || 9.5;
    var estilo = opc.estilo || 'normal';
    var sangria = opc.sangria || 0;
    var interlinea = opc.interlinea || tam * 0.42;
    var ancho = ANCHO_TXT - sangria - (opc.margenDer || 0);
    this.fuente(estilo, tam, opc.color);
    var lineas = this.d.splitTextToSize(sanea(txt), ancho);
    for (var i = 0; i < lineas.length; i++) {
      this.necesita(interlinea + 2);
      this.d.text(lineas[i], MI + sangria, this.y);
      this.y += interlinea;
    }
    if (opc.despues) this.y += opc.despues;
    return this;
  };

  /* Fórmulas (0.5). Un texto con \( … \) o \[ … \] se arma pieza por pieza: el texto con la fuente del PDF y
     cada fórmula como la imagen que preparó matematicas.js, sobre la línea base; debajo de cada imagen va su LaTeX
     como texto invisible, para que el extractor (y el calificador) lea la fórmula. Una fórmula que no alcanzó a
     dibujarse se escribe en LaTeX, visible. Sin fórmulas, es parrafo(), igual que antes. */
  var PT_MM = 25.4 / 72;

  Doc.prototype.mixto = function (txt, opc) {
    var M = this.mate;
    if (!M || !M.tieneFormulas(txt)) return this.parrafo(txt, opc);
    opc = opc || {};
    var d = this.d, self = this;
    var tam = opc.tam || 9.5, estilo = opc.estilo || 'normal';
    var sangria = opc.sangria || 0;
    var interlinea = opc.interlinea || tam * 0.42;
    var ancho = ANCHO_TXT - sangria - (opc.margenDer || 0);
    // MathJax: 1 ex = 0,5 em. La letra de las fórmulas es más chica que la de DejaVu Sans a igual tamaño: se
    // agranda un 10 % para que una «V» de la fórmula y una del texto se vean iguales.
    var exMm = tam * 0.5 * PT_MM * 1.1;
    var subeTxt = tam * PT_MM * 0.72, bajaTxt = tam * PT_MM * 0.22;
    this.fuente(estilo, tam, opc.color);
    var espacio = d.getTextWidth(' ');
    var piezas = [];
    M.segmentos(txt).forEach(function (sg) {
      if (sg.t === 'texto') {
        sanea(sg.v).split(/(\s+)/).forEach(function (w) {
          if (!w) return;
          piezas.push(/^\s+$/.test(w) ? { t: 'esp' } : { t: 'pal', v: w, w: d.getTextWidth(w) });
        });
        return;
      }
      var fuente = sanea(sg.t === 'F' ? '\\[' + sg.v + '\\]' : '\\(' + sg.v + '\\)');
      var im = M.imagen(sg.v, sg.t === 'F');
      if (!im) {                                 // sin imagen: el LaTeX como texto visible
        fuente.split(/(\s+)/).forEach(function (w) {
          if (w && !/^\s+$/.test(w)) piezas.push({ t: 'pal', v: w, w: d.getTextWidth(w) });
          else if (w) piezas.push({ t: 'esp' });
        });
        return;
      }
      var w = im.wEx * exMm, h = im.hEx * exMm, abajo = -im.vaEx * exMm;
      var lim = sg.t === 'F' ? ancho : ancho * 0.98;
      if (w > lim) { var f = lim / w; w *= f; h *= f; abajo *= f; }
      piezas.push({ t: sg.t === 'F' ? 'bloque' : 'f', png: im.png, w: w, h: h, abajo: abajo, fuente: fuente });
    });

    function invisible(t, x, base, w) {
      var w0 = d.getTextWidth(t);
      if (w0 > 0) d.setFontSize(Math.max(0.5, Math.min(40, tam * w / w0)));
      d.text(t, x, base, { renderingMode: 'invisible' });
      d.setFontSize(tam);
    }

    var linea = [], anchoLinea = 0;
    function cerrar() {
      while (linea.length && linea[linea.length - 1].t === 'esp') linea.pop();
      if (!linea.length) return;
      var sube = subeTxt, baja = bajaTxt;
      linea.forEach(function (p) {
        if (p.t === 'f') { sube = Math.max(sube, p.h - p.abajo); baja = Math.max(baja, p.abajo); }
      });
      var extraArriba = sube - subeTxt, extraAbajo = Math.max(0, baja - bajaTxt);
      self.necesita(interlinea + extraArriba + extraAbajo + 2);
      var base = self.y + extraArriba, x0 = MI + sangria, x = x0;
      // Primero las imágenes de la línea y después todo su texto seguido: una imagen entre dos textos hace que el
      // lector del PDF (pypdf) parta la línea. El LaTeX invisible ocupa justo el ancho de su imagen, para que el
      // espacio que sigue se lea como espacio.
      linea.forEach(function (p) {
        if (p.t === 'f') d.addImage(p.png, 'PNG', x, base - (p.h - p.abajo), p.w, p.h, undefined, 'FAST');
        x += p.t === 'esp' ? espacio : p.w;
      });
      x = x0;
      self.fuente(estilo, tam, opc.color);
      linea.forEach(function (p) {
        if (p.t === 'esp') { x += espacio; return; }
        if (p.t === 'pal') { d.text(p.v, x, base); x += p.w; return; }
        invisible(p.fuente, x, base, p.w);
        x += p.w;
      });
      self.y = base + interlinea + extraAbajo;
      linea = [];
      anchoLinea = 0;
    }
    piezas.forEach(function (p) {
      if (p.t === 'bloque') {
        cerrar();
        self.necesita(p.h + 3);
        var x = MI + sangria + (ancho - p.w) / 2, arriba = self.y - subeTxt + 0.8;
        d.addImage(p.png, 'PNG', x, arriba, p.w, p.h, undefined, 'FAST');
        self.fuente(estilo, tam, opc.color);
        invisible(p.fuente, x, arriba + p.h - p.abajo, p.w);
        self.y = arriba + p.h + subeTxt + 1.2;
        return;
      }
      if (p.t === 'esp') {
        if (linea.length) { linea.push(p); anchoLinea += espacio; }
        return;
      }
      if (anchoLinea + p.w > ancho && linea.length) cerrar();
      linea.push(p);
      anchoLinea += p.w;
    });
    cerrar();
    if (opc.despues) this.y += opc.despues;
    return this;
  };

  Doc.prototype.linea = function (grosor, color) {
    var c = color || GRIS_CLARO;
    this.d.setDrawColor(c[0], c[1], c[2]);
    this.d.setLineWidth(grosor || 0.2);
    this.d.line(MI, this.y, ANCHO - MD, this.y);
    this.y += 1.2;
    return this;
  };

  Doc.prototype.barraTitulo = function (etiqueta, titulo, derecha) {
    this.necesita(14);
    var alto = 7;
    this.d.setFillColor(AZUL[0], AZUL[1], AZUL[2]);
    this.d.rect(MI, this.y, 13, alto, 'F');
    this.d.setFillColor(GRIS_CLARO[0], GRIS_CLARO[1], GRIS_CLARO[2]);
    this.d.rect(MI + 13, this.y, ANCHO_TXT - 13, alto, 'F');

    this.fuente('bold', 9, [255, 255, 255]);
    this.d.text(sanea(etiqueta), MI + 6.5, this.y + 4.9, { align: 'center' });
    this.fuente('bold', 9.5, AZUL);
    this.d.text(sanea(titulo), MI + 16, this.y + 4.9);
    if (derecha) {
      this.fuente('normal', 7.8, GRIS);
      this.d.text(sanea(derecha), ANCHO - MD - 2, this.y + 4.8, { align: 'right' });
    }
    this.y += alto + 3.4;
    return this;
  };

  Doc.prototype.marcador = function (txt) {
    this.necesita(5);
    this.fuente('normal', 6.5, [170, 176, 190]);
    this.d.text(sanea(txt), MI, this.y);
    this.y += 3.1;
    return this;
  };

  /* Marcador con texto del alumno (0.6, completar): siempre en una sola línea, que es lo que lee el extractor. Si
     no cabe en el ancho de la página, se reduce la letra en lugar de partirlo. */
  Doc.prototype.marcadorEnLinea = function (txt) {
    this.necesita(5);
    this.fuente('normal', 6.5, [170, 176, 190]);
    var t = sanea(txt), w = this.d.getTextWidth(t);
    if (w > ANCHO_TXT) this.d.setFontSize(Math.max(1, 6.5 * ANCHO_TXT / w));
    this.d.text(t, MI, this.y);
    this.y += 3.1;
    return this;
  };

  Doc.prototype.piePaginas = function (ctx) {
    var total = this.d.getNumberOfPages();
    for (var p = 1; p <= total; p++) {
      this.d.setPage(p);
      this.d.setDrawColor(GRIS_CLARO[0], GRIS_CLARO[1], GRIS_CLARO[2]);
      this.d.setLineWidth(0.3);
      this.d.line(MI, ALTO - MINF + 4, ANCHO - MD, ALTO - MINF + 4);
      this.d.setFont('DJV', 'normal');
      this.d.setFontSize(7.2);
      this.d.setTextColor(GRIS[0], GRIS[1], GRIS[2]);
      this.d.text(sanea(ctx.meta.clave + ' · ' + (ctx.meta.evaluacionCorta || ctx.meta.evaluacion) + ' · ' + ctx.estado.alumno.matricula +
        (ctx.estado.sesion ? ' · Sesión ' + ctx.estado.sesion : '') + ' · Folio ' + ctx.folio), MI, ALTO - MINF + 8);
      this.d.text(sanea('Página ' + p + ' de ' + total), ANCHO - MD, ALTO - MINF + 8, { align: 'right' });
      if (p > 1) {
        this.d.setFontSize(7.2);
        this.d.setTextColor(GRIS[0], GRIS[1], GRIS[2]);
        this.d.text(sanea(ctx.estado.alumno.nombre), MI, MSUP - 6);
        this.d.text(sanea(ctx.meta.materia + ' · ' + ctx.meta.clave), ANCHO - MD, MSUP - 6, { align: 'right' });
        this.d.setDrawColor(GRIS_CLARO[0], GRIS_CLARO[1], GRIS_CLARO[2]);
        this.d.line(MI, MSUP - 4, ANCHO - MD, MSUP - 4);
      }
    }
    return this;
  };

  function textoCierre(e) {
    var c = e.cierre;
    if (!c) return '';
    var ig = e.integridad;
    return c.motivo === 'tiempo'
      ? 'Cerrada por la política de salidas: ' + Math.round(ig.msFuera / 1000) + ' s acumulados fuera de la ventana'
      : 'Cerrada por la política de salidas: ' + ig.salidas + ' salidas de la ventana';
  }

  // ------------------------------------------- tipos y composición (0.6)
  /* El tipo de un reactivo es su campo `tipo` si es el otro tipo de su lista (diseno en numericos, completar en
     opcion_multiple); si no, el de la lista (como composicion.tipo_de). Sin tipos nuevos ni composición, el PDF
     es el de la 0.5. */
  var TIPOS = ['teorico', 'ensayo', 'numerico', 'diseno', 'caso', 'opcion_multiple', 'completar'];
  var TIPO_DE_LISTA = { teoricos: 'teorico', numericos: 'numerico', analisis: 'caso', opcion_multiple: 'opcion_multiple' };
  var OTRO_TIPO = { teoricos: 'ensayo', numericos: 'diseno', opcion_multiple: 'completar' };
  var LISTA_DE_LETRA = { A: 'teoricos', B: 'numericos', C: 'analisis', D: 'opcion_multiple' };
  var LETRA_DE_TIPO = { teorico: 'A', ensayo: 'A', numerico: 'B', diseno: 'B', caso: 'C', opcion_multiple: 'D',
    completar: 'D' };
  var CONTADO = {   // [uno, varios]
    teorico: ['pregunta de teoría', 'preguntas de teoría'],
    ensayo: ['ensayo', 'ensayos'],
    numerico: ['problema numérico', 'problemas numéricos'],
    diseno: ['problema de diseño', 'problemas de diseño'],
    caso: ['caso de análisis', 'casos de análisis'],
    opcion_multiple: ['reactivo de opción múltiple', 'reactivos de opción múltiple'],
    completar: ['reactivo de completar', 'reactivos de completar']
  };

  function tipoDe(r, lista) {
    var t = String((r && r.tipo) || '').trim().toLowerCase();
    return t && t === OTRO_TIPO[lista] ? t : TIPO_DE_LISTA[lista];
  }
  function composicion(ctx) { return ctx.composicion || []; }
  function listaDe(ctx, letra) { return ctx.banco[LISTA_DE_LETRA[letra]] || []; }
  function pts(x) { return fmtNum(+(+x || 0).toFixed(2)); }
  function puntos(x) { return pts(x) + (+(+x || 0).toFixed(2) === 1 ? ' punto' : ' puntos'); }
  /* Forma de un sustantivo contado (0.6.3): formas = [uno, varios]. Regla del español y del inglés: singular solo
     con 1. La copia en francés cambia la regla (singular con 0 y 1). */
  function plural(n, formas) { return formas[+n === 1 ? 0 : 1]; }
  function contado(ctx, tipo, n) {
    if (tipo === 'teorico' && ctx.meta.estiloA === 'criterio') return plural(n, ['reactivo de criterio', 'reactivos de criterio']);
    return plural(n, CONTADO[tipo]);
  }

  /* Etiqueta del reactivo: con composición es su id (la posición en la selección del alumno no es la del banco);
     sin ella, letra y posición, como siempre. */
  function etiqueta(ctx, r, letra, i) {
    return composicion(ctx).length ? String(r.id) : letra + (i + 1 < 10 ? '0' : '') + (i + 1);
  }

  /* Reactivos de una sección que hay en este PDF, por tipo: [{tipo, n, cada}], con los puntos de cada reactivo. */
  function gruposDe(ctx, letra) {
    var nombre = LISTA_DE_LETRA[letra], out = [], por = {};
    listaDe(ctx, letra).forEach(function (r) {
      var t = tipoDe(r, nombre);
      if (!por[t]) { por[t] = { tipo: t, n: 0, cada: +r.puntos || 0 }; out.push(por[t]); }
      por[t].n++;
    });
    return out.sort(function (a, b) { return TIPOS.indexOf(a.tipo) - TIPOS.indexOf(b.tipo); });
  }
  function hayTipo(ctx, letra, tipo) {
    return gruposDe(ctx, letra).some(function (g) { return g.tipo === tipo; });
  }
  /* Puntos de la sección: con composición, los de sus tipos; sin ella, los de la meta. */
  function puntosSeccion(ctx, letra) {
    var comp = composicion(ctx);
    if (!comp.length) return +ctx.meta['puntos' + letra] || 0;
    return comp.reduce(function (a, e) { return a + (LETRA_DE_TIPO[e.tipo] === letra ? +e.puntos || 0 : 0); }, 0);
  }
  /* «3 problemas numéricos (5 puntos cada uno) y 1 problema de diseño (15 puntos)» */
  function cuenta(ctx, grupos) {
    var partes = grupos.map(function (g) {
      return g.n + ' ' + contado(ctx, g.tipo, g.n) + ' (' + puntos(g.cada) + (g.n === 1 ? '' :
        (g.tipo === 'teorico' && ctx.meta.estiloA !== 'criterio' ? ' cada una' : ' cada uno')) + ')';
    });
    return partes.length > 1 ? partes.slice(0, -1).join(', ') + ' y ' + partes[partes.length - 1] : partes.join('');
  }
  /* ¿El PDF lleva algo de la 0.6 (composición, diseño o completar)? Si no, portada y secciones son las de antes. */
  function conNovedades(ctx) {
    return composicion(ctx).length > 0 || hayTipo(ctx, 'B', 'diseno') || hayTipo(ctx, 'D', 'completar') ||
      hayTipo(ctx, 'A', 'ensayo');
  }
  /* Ensayo (0.6.1): palabras como composicion.cuenta_palabras y extensión pedida (de 250 a 600 si no la trae). */
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
  /* De quién son los datos de los reactivos de una lista: individuales, comunes (reactivos fijos) o de ambos. */
  function datosDe(ctx, lista) {
    var conDatos = lista.filter(function (r) { return r.opciones && Object.keys(r.opciones).length; });
    var fijos = conDatos.filter(function (r) { return r.fijo === true; }).length;
    var propios = 'con datos individualizados por matrícula' + (ctx.estado.sesion ? ' y sesión' : '');
    if (!fijos) return propios;
    if (fijos === conDatos.length) return 'con los mismos datos para todo el grupo';
    return propios + ', salvo los reactivos comunes a todo el grupo';
  }

  /* Estructura del examen en la portada cuando hay composición o tipos nuevos. Con composición, por tipo y con
     sus puntos; sin ella, por sección. */
  function estructuraNueva(ctx, cierre) {
    var comp = composicion(ctx), partes = [], total = 0;
    if (comp.length) {
      TIPOS.forEach(function (t) {
        comp.forEach(function (e) {
          if (e.tipo !== t) return;
          var n = listaDe(ctx, LETRA_DE_TIPO[t]).filter(function (r) {
            return tipoDe(r, LISTA_DE_LETRA[LETRA_DE_TIPO[t]]) === t;
          }).length;
          partes.push(n + ' ' + contado(ctx, t, n) + ', ' + puntos(e.puntos) + '.');
          total += +e.puntos || 0;
        });
      });
      return partes.join(' ') + ' Total: ' + puntos(total) + '. ' + (ctx.seleccionPropia
        ? 'Cada sustentante recibe una selección propia de reactivos del banco, determinada por su matrícula' +
          (ctx.estado.sesion ? ' y su sesión' : '') + '; este documento contiene los de esta sesión. ' : '') + cierre;
    }
    ['A', 'B', 'C', 'D'].forEach(function (letra) {
      var g = gruposDe(ctx, letra);
      if (!g.length) return;
      var nombres = g.map(function (x) { return x.n + ' ' + contado(ctx, x.tipo, x.n); });
      partes.push('Sección ' + letra + ' — ' + (nombres.length > 1 ? nombres.join(' y ') : nombres[0]) +
        (letra === 'B' || letra === 'C' ? ' ' + datosDe(ctx, listaDe(ctx, letra)) : '') + ', ' +
        puntos(puntosSeccion(ctx, letra)) + '.');
      total += puntosSeccion(ctx, letra);
    });
    return partes.join(' ') + ' Total: ' + puntos(total) + '. ' + cierre;
  }

  // ---------------------------------------------------------------- portada
  function portada(doc, ctx) {
    var d = doc.d, e = ctx.estado, m = ctx.meta;

    // Logotipo
    try {
      var anchoLogo = 78;
      d.addImage(window.EXAMEN_LOGO, 'PNG', MI, doc.y, anchoLogo, anchoLogo * (window.EXAMEN_LOGO_ASPECTO || 159 / 760));
      doc.y += anchoLogo * (window.EXAMEN_LOGO_ASPECTO || 159 / 760) + 6;
    } catch (err) { doc.y += 4; }

    d.setDrawColor(AZUL[0], AZUL[1], AZUL[2]);
    d.setLineWidth(0.8);
    d.line(MI, doc.y, ANCHO - MD, doc.y);
    doc.y += 6.5;

    doc.fuente('bold', 16, AZUL);
    d.text(sanea(m.materia), MI, doc.y); doc.y += 6.5;
    doc.fuente('bold', 11.5, ROJO);
    d.text(sanea(m.evaluacion + ' — ' + m.clave), MI, doc.y); doc.y += 5.5;
    doc.fuente('normal', 9.5, GRIS);
    d.text(sanea(m.universidad + ' · ' + m.facultad), MI, doc.y); doc.y += 4.4;
    d.text(sanea(m.programa + ' · ' + m.semestre + ' semestre · Grupo ' + e.alumno.grupo +
      ' · ' + m.periodo), MI, doc.y);
    doc.y += 8;

    // Identificación
    var filas = [
      ['Alumno', e.alumno.nombre],
      ['Matrícula', e.alumno.matricula],
      ['Clave de sesión', e.sesion || '—'],
      ['Correo institucional', e.alumno.correo || '—'],
      ['Profesor', m.profesor],
      ['Alcance evaluado', m.alcance],
      ['Inicio de la sesión', ctx.util.fechaLarga(new Date(e.inicio))],
      ['Término de la sesión', ctx.util.fechaLarga(new Date(e.fin))],
      ['Duración efectiva', ctx.util.hhmmss(e.fin - e.inicio) + '  (referencia: ' + m.duracionMin + ' min)'],
      ['Folio de verificación', ctx.folio],
      ['Versión del instrumento', m.version]
    ];
    if (e.cierre) filas.splice(8, 0, ['Cierre de la sesión', textoCierre(e)]);
    doc.fuente('normal', 8.6);
    var envueltas = filas.map(function (f) {
      return [f[0], d.splitTextToSize(sanea(String(f[1])), ANCHO_TXT - 62)];
    });
    var nLineas = envueltas.reduce(function (a, f) { return a + f[1].length; }, 0);
    var altoTabla = nLineas * 5.0 + (filas.length - 1) * 0.6 + 5;
    d.setFillColor(247, 248, 252);
    d.setDrawColor(GRIS_CLARO[0], GRIS_CLARO[1], GRIS_CLARO[2]);
    d.setLineWidth(0.3);
    d.rect(MI, doc.y, ANCHO_TXT, altoTabla, 'FD');
    doc.y += 5.2;
    envueltas.forEach(function (f) {
      doc.fuente('bold', 8.6, AZUL);
      d.text(sanea(f[0]), MI + 4, doc.y);
      doc.fuente('normal', 8.6, [40, 45, 60]);
      f[1].forEach(function (ln, k) {
        d.text(ln, MI + 54, doc.y + k * 5.0);
      });
      doc.y += f[1].length * 5.0 + 0.6;
    });
    doc.y += 4;

    // Estructura y declaración
    doc.fuente('bold', 9.5, AZUL);
    doc.d.text('Estructura del instrumento', MI, doc.y); doc.y += 4.6;
    var nC = (ctx.banco.analisis || []).length, nD = (ctx.banco.opcion_multiple || []).length;
    var cierreEstructura = 'Este documento reproduce íntegramente los enunciados aplicados y las respuestas capturadas por el ' +
      'sustentante; es el único comprobante válido de entrega.';
    if (conNovedades(ctx)) {                            // 0.6: por tipo de reactivo
      doc.parrafo(estructuraNueva(ctx, cierreEstructura), { tam: 8.6, despues: 3 });
    } else if (m.estiloA === 'criterio' && !nC && !nD) {        // el texto de siempre para los bancos de la 0.3
      doc.parrafo('Sección A — ' + ctx.banco.teoricos.length + ' reactivos de criterio, ' + m.puntosA + ' puntos. Sección B — ' + ctx.banco.numericos.length + ' reactivos ' +
        'numéricos con datos individualizados por matrícula, ' + m.puntosB + ' puntos. Total: ' + (m.puntosA + m.puntosB) + ' puntos. ' +
        cierreEstructura, { tam: 8.6, despues: 3 });
    } else {
      var pts = function (x) { return fmtNum(+(+x || 0).toFixed(2)); };
      var partes = [];
      if (ctx.banco.teoricos.length) {
        partes.push('Sección A — ' + ctx.banco.teoricos.length + (m.estiloA === 'criterio' ? ' reactivos de criterio, '
          : ' preguntas de teoría, ') + pts(m.puntosA) + ' puntos.');
      }
      if (ctx.banco.numericos.length) {
        partes.push('Sección B — ' + ctx.banco.numericos.length + ' reactivos numéricos con datos individualizados por ' +
          'matrícula, ' + pts(m.puntosB) + ' puntos.');
      }
      if (nC) partes.push('Sección C — ' + nC + ' ' + plural(nC, ['caso de análisis', 'casos de análisis']) + ' con datos individualizados, ' + pts(m.puntosC) + ' puntos.');
      if (nD) partes.push('Sección D — ' + nD + ' reactivos de opción múltiple, ' + pts(m.puntosD) + ' puntos.');
      var total = (+m.puntosA || 0) + (+m.puntosB || 0) + (nC ? +m.puntosC || 0 : 0) + (nD ? +m.puntosD || 0 : 0);
      doc.parrafo(partes.join(' ') + ' Total: ' + pts(total) + ' puntos. ' + cierreEstructura, { tam: 8.6, despues: 3 });
    }

    doc.fuente('bold', 9.5, AZUL);
    doc.d.text('Declaración de integridad académica', MI, doc.y); doc.y += 4.6;
    doc.parrafo('☑ El sustentante declaró, antes de iniciar, que resolvería este examen de manera ' +
      'individual, sin asistencia de terceros ni de herramientas de inteligencia artificial, y aceptó ' +
      'el registro de integridad que se documenta al final de este archivo.', { tam: 8.6, despues: 2 });

    doc.espacio(2).linea(0.4, AZUL).espacio(3);
    doc.parrafo('Firma del sustentante: ______________________________________     ' +
      'Fecha: ' + new Date(e.fin).toLocaleDateString('es-MX'), { tam: 8.6, color: GRIS });
  }

  // ---------------------------------------------------------------- figuras
  /* Figura del reactivo (0.4.6), después de las líneas del enunciado y antes de cualquier marcador.
     Solo PNG o JPEG en data URI. No escribe texto: el extractor ve el mismo contenido con o sin
     figura. Si algo falla, se deshace lo hecho (página nueva incluida) y el PDF sigue sin ella. */
  var ALTO_FIG = 110;   // mm; una figura más alta se reduce en proporción

  function u16(s, i) { return (s.charCodeAt(i) << 8) | s.charCodeAt(i + 1); }
  function u32(s, i) { return u16(s, i) * 65536 + u16(s, i + 2); }

  /* Ancho y alto en píxeles leídos del encabezado, sin decodificar la imagen: getImageProperties la
     descomprime y la vuelve a comprimir completa (≈0,3 s por figura de 1400 px; ×4 en un equipo
     lento), y addImage lo hace otra vez. PNG: IHDR (bytes 16–23). JPEG: el primer marcador SOFn.
     null si el encabezado no se reconoce; entonces se usa getImageProperties. */
  function medidasFigura(src, tipo) {
    var ini = src.indexOf(',') + 1, largo = src.length - ini;
    function bytes(n) {                         // los primeros n bytes (o todos), como cadena binaria
      return atob(src.substr(ini, Math.min(largo, Math.ceil(n / 3) * 4)));
    }
    try {
      var b, i, m, p = null;
      if (tipo === 'PNG') {
        b = bytes(24);
        if (b.length >= 24 && b.slice(0, 8) === '\x89PNG\r\n\x1a\n' && b.slice(12, 16) === 'IHDR') {
          p = { width: u32(b, 16), height: u32(b, 20) };
        }
      } else {
        b = bytes(4096);
        i = 2;
        if (u16(b, 0) !== 0xFFD8) return null;
        while (!p) {
          if (i + 9 > b.length) {                 // segmento más allá de lo decodificado: se pide más
            var antes = b.length;
            b = bytes(Math.max(2 * antes, i + 4105));
            if (b.length <= antes) return null;   // terminó la imagen sin SOF
            continue;
          }
          if (b.charCodeAt(i) !== 0xFF) return null;
          m = b.charCodeAt(i + 1);
          if (m === 0xFF) { i++; continue; }                                    // relleno
          if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }  // sin longitud
          if (m === 0xD9 || m === 0xDA) return null;                            // fin o datos antes del SOF
          if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
            p = { width: u16(b, i + 7), height: u16(b, i + 5) };                // SOF0, SOF2, …
          } else {
            i += 2 + u16(b, i + 2);
          }
        }
      }
      return p && p.width > 0 && p.height > 0 ? p : null;
    } catch (err) {
      return null;
    }
  }

  /* Un PNG en el PDF cuesta caro: addImage descomprime los píxeles y los vuelve a comprimir con deflate
     escrito en JavaScript (≈0,25 s por figura de 1400 px en un equipo de escritorio, ×3 o ×4 en uno
     lento), y la página se congela mientras tanto. La imagen que ya pintó la página se pasa por un
     canvas a JPEG de calidad 0,92 con el codificador del navegador (≈0,05 s): solo para el PDF, la
     página sigue mostrando el PNG. null si esa imagen no está lista, el canvas falla o su lectura no es
     fiel; entonces va el PNG con FAST (deflate de nivel 1), y también si addImage rechaza el JPEG. Una
     figura JPEG va siempre tal cual: no se recomprime. */
  var CALIDAD_JPEG = 0.92;

  /* Navegadores que falsean la lectura del canvas para impedir la huella digital (resistFingerprinting
     de Firefox, LibreWolf, Tor Browser) devuelven blanco o ruido sin error: el PDF llevaría un rectángulo
     blanco. Se prueba una vez por página con un patrón conocido de dos colores (16×16: un ruido de
     unos cuantos bits no pasa inadvertido) y, si la lectura no es exacta, va el PNG. */
  var canvasFiel = null;

  function lecturaCanvasFiel() {
    if (canvasFiel !== null) return canvasFiel;
    canvasFiel = false;
    try {
      var c = document.createElement('canvas');
      c.width = 16;
      c.height = 16;
      var g = c.getContext('2d');
      if (!g) return canvasFiel;
      g.fillStyle = 'rgb(200,30,60)';
      g.fillRect(0, 0, 8, 16);
      g.fillStyle = 'rgb(20,90,240)';
      g.fillRect(8, 0, 8, 16);
      var px = g.getImageData(0, 0, 16, 16).data, ok = px.length === 16 * 16 * 4;
      for (var i = 0; ok && i < px.length; i += 4) {
        var izq = (i >> 2) % 16 < 8;
        ok = px[i] === (izq ? 200 : 20) && px[i + 1] === (izq ? 30 : 90) &&
          px[i + 2] === (izq ? 60 : 240) && px[i + 3] === 255;
      }
      canvasFiel = ok;
    } catch (err) {
      canvasFiel = false;
    }
    return canvasFiel;
  }

  function jpegDesdePagina(rid, src) {
    try {
      if (!lecturaCanvasFiel()) return null;
      var art = document.getElementById('r-' + rid);
      var img = art && art.querySelector('figure.figura img');
      if (!img || img.getAttribute('src') !== src || !img.complete ||
          !(img.naturalWidth > 0) || !(img.naturalHeight > 0)) return null;
      var c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      var g = c.getContext('2d');
      if (!g) return null;
      g.fillStyle = '#fff';                       // la transparencia queda sobre blanco, como en la hoja
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0);
      var out = c.toDataURL('image/jpeg', CALIDAD_JPEG);
      c.width = c.height = 0;                     // libera el mapa de bits
      return out.indexOf('data:image/jpeg;base64,') === 0 ? out : null;
    } catch (err) {
      return null;
    }
  }

  function figura(doc, f, rid) {
    if (!f || typeof f.src !== 'string') return;
    var tipo = f.src.indexOf('data:image/png;base64,') === 0 ? 'PNG'
      : f.src.indexOf('data:image/jpeg;base64,') === 0 ? 'JPEG' : '';
    if (!tipo) return;
    var d = doc.d, y0 = doc.y, pag0 = doc.pagina, n0 = d.getNumberOfPages();
    try {
      var p = medidasFigura(f.src, tipo) || d.getImageProperties(f.src);
      if (!p || !(p.width > 0) || !(p.height > 0)) return;
      var fr = parseFloat(f.ancho);
      fr = isFinite(fr) ? Math.min(1, Math.max(0.2, fr)) : 0.6;
      var w = fr * ANCHO_TXT, h = w * p.height / p.width;
      if (h > ALTO_FIG) { w = w * ALTO_FIG / h; h = ALTO_FIG; }
      var datos = f.src, formato = tipo;
      if (tipo === 'PNG') {
        var jpg = jpegDesdePagina(rid, f.src);
        if (jpg) { datos = jpg; formato = 'JPEG'; }
      }
      doc.necesita(h + 4);
      var arriba = doc.y - 1, x = MI + (ANCHO_TXT - w) / 2;
      // FAST solo pesa en el respaldo PNG: con compress:true jsPDF usaría SLOW. Un JPEG no se recomprime.
      try {
        d.addImage(datos, formato, x, arriba, w, h, undefined, 'FAST');
      } catch (errJpeg) {
        if (datos === f.src) throw errJpeg;
        d.addImage(f.src, 'PNG', x, arriba, w, h, undefined, 'FAST');   // el JPEG del canvas falló: el PNG
      }
      doc.y = arriba + h + 4;
    } catch (err) {
      try {
        while (d.getNumberOfPages() > n0) d.deletePage(d.getNumberOfPages());
        d.setPage(n0);
      } catch (err2) { }
      doc.y = y0;
      doc.pagina = pag0;
    }
  }

  // -------------------------------------------------------------- reactivos
  function seccion(doc, titulo, descripcion) {
    doc.necesita(28);
    doc.espacio(4);
    doc.fuente('bold', 12.5, AZUL);
    doc.d.text(sanea(titulo), MI, doc.y);
    doc.y += 2;
    doc.linea(0.6, AZUL);
    doc.espacio(2.6);
    doc.parrafo(descripcion, { tam: 8.4, color: GRIS, despues: 3 });
  }

  function bloqueRespuesta(doc, texto, vacio) {
    var t = (texto || '').trim();
    doc.fuente('bold', 8.4, AZUL);
    doc.necesita(6);
    doc.d.text('Respuesta del sustentante', MI, doc.y);
    doc.y += 4.2;
    if (!t) {
      doc.parrafo('[SIN RESPUESTA]', { tam: 9, estilo: 'bold', color: ROJO, despues: 1 });
      return;
    }
    // Se respetan los saltos de línea capturados por el alumno
    t.split(/\r?\n/).forEach(function (p) {
      if (!p.trim()) { doc.espacio(1.6); return; }
      doc.mixto(p, { tam: 9, interlinea: 4.2 });
    });
    doc.espacio(1);
  }

  function reactivosTeoricos(doc, ctx) {
    ctx.banco.teoricos.forEach(function (r, i) {
      var num = etiqueta(ctx, r, 'A', i);
      doc.necesita(40);
      doc.barraTitulo(num, r.titulo, r.puntos + ' pts · ' + r.tema);
      r.texto.forEach(function (l) {
        var esInciso = /^\((i|ii|iii|iv|v)\)/.test(l.trim());
        doc.mixto(l, { tam: 8.8, sangria: esInciso ? 6 : 0, interlinea: 4.0 });
      });
      if (r.figura) figura(doc, r.figura, r.id);
      doc.espacio(2);
      doc.marcador('[[R:' + r.id + ']]');
      bloqueRespuesta(doc, ctx.estado.resp[r.id]);
      doc.marcador('[[/R:' + r.id + ']]');
      if (tipoDe(r, 'teoricos') === 'ensayo') {      // 0.6.1: fuera de los marcadores, para el profesor
        var pal = palabrasDe(r), w = cuentaPalabras(ctx.estado.resp[r.id]);
        doc.parrafo('Extensión: ' + w + (w === 1 ? ' palabra' : ' palabras') + ' (se pedían de ' + pal[0] + ' a ' +
          pal[1] + ').', { tam: 8.2, color: w > pal[1] || (w > 0 && w < pal[0]) ? ROJO : GRIS, despues: 1 });
      }
      doc.espacio(3.5);
    });
  }

  function reactivosNumericos(doc, ctx, letra) {
    var V = window.EXAMEN_VAR;
    letra = letra || 'B';
    var lista = letra === 'C' ? (ctx.banco.analisis || []) : ctx.banco.numericos;
    lista.forEach(function (r, i) {
      var num = etiqueta(ctx, r, letra, i);
      // 0.6: un reactivo fijo se resuelve con matrícula y sesión vacías (los mismos datos para todos)
      var vars = ctx.estado.variantes[r.id] || (r.fijo === true ? V.resolver(r, '', '')
        : V.resolver(r, ctx.estado.alumno.matricula, ctx.estado.sesion));
      var diseno = letra === 'B' && tipoDe(r, 'numericos') === 'diseno';
      var enLinea = function (l) {
        return doc.mate ? doc.mate.texto(l, vars) : ctx.meta.notacion === 'latex'
          ? String(l).replace(/\{\{([A-Za-z0-9_]+)\}\}/g, function (m, k) {
              return (k in vars) ? String(vars[k]).replace('.', ',') : m;
            })
          : V.texto(l, vars);
      };
      var resp = ctx.estado.resp[r.id] || {};

      doc.necesita(48);
      doc.barraTitulo(num, r.titulo, r.puntos + ' pts · ' + r.tema);
      r.texto.forEach(function (l) { doc.mixto(enLinea(l), { tam: 8.8, interlinea: 4.0 }); });
      if (r.figura) figura(doc, r.figura, r.id);
      if (diseno) requisitos(doc, r, enLinea);     // 0.6: junto al enunciado y antes de cualquier marcador
      doc.espacio(1.5);

      // Datos de la variante (auditoría)
      var datos = Object.keys(vars).filter(function (k) { return !/\d$/.test(k) || !(k.replace(/\d$/, '') in vars); })
        .map(function (k) { return k + '=' + (Array.isArray(vars[k]) ? vars[k].join('/') : fmtNum(vars[k])); })
        .join('; ');
      doc.marcador('[[V:' + r.id + ']] ' + datos + ' [[/V:' + r.id + ']]');

      // Valores reportados
      doc.fuente('bold', 8.4, AZUL);
      doc.necesita(6);
      doc.d.text('Valores reportados', MI, doc.y);
      doc.y += 4.2;
      doc.marcador('[[R:' + r.id + ']]');
      r.campos.forEach(function (c) {
        var v = String(resp[c.k] == null ? '' : resp[c.k]).trim();
        doc.fuente('normal', 9, v ? [40, 45, 60] : ROJO);
        doc.necesita(5);
        doc.d.text(sanea(c.k + ' = ' + (v || '[VACÍO]') + '   ' + c.u + '   (' + c.et + ')'), MI + 4, doc.y);
        doc.y += 4.4;
      });
      var esC = letra === 'C';
      var cr = String((esC ? resp.analisis : resp.criterio) || '').trim();
      doc.fuente('bold', 8.4, AZUL);
      doc.necesita(6);
      doc.d.text(esC ? 'ANÁLISIS:' : 'CRITERIO:', MI + 4, doc.y);
      doc.y += 4.2;
      if (cr) {
        if (doc.mate) {
          cr.split(/\r?\n/).forEach(function (p) {
            if (!p.trim()) { doc.espacio(1.2); return; }
            doc.mixto(p, { tam: 8.8, sangria: 4, interlinea: 4.0 });
          });
        } else {
          doc.parrafo(cr, { tam: 8.8, sangria: 4, interlinea: 4.0 });
        }
      } else {
        doc.parrafo(esC ? '[SIN ANÁLISIS]' : '[SIN CRITERIO DECLARADO]', { tam: 8.8, estilo: 'bold', color: ROJO, sangria: 4 });
      }
      doc.marcador('[[/R:' + r.id + ']]');
      doc.espacio(3.5);
    });
  }

  /* Diseño (0.6): los requisitos que debía cumplir la propuesta y qué valores proponía el sustentante. Va fuera de
     los marcadores: el bloque [[R:]] de un reactivo de diseño es el de cualquier reactivo numérico. */
  function requisitos(doc, r, enLinea) {
    var q = (Array.isArray(r.requisitos) ? r.requisitos : []).filter(function (x) {
      return typeof x === 'string' && x.trim() !== '';
    });
    var prop = (r.campos || []).filter(function (c) { return c.rol === 'propuesta'; });
    if (!q.length && !prop.length) return;
    doc.espacio(1);
    if (q.length) {
      doc.parrafo('Requisitos de diseño', { tam: 8.8, estilo: 'bold', color: AZUL, interlinea: 4.0 });
      q.forEach(function (l) { doc.mixto('• ' + enLinea(l), { tam: 8.8, sangria: 4, interlinea: 4.0 }); });
    }
    if (prop.length) {
      var n = function (x) { x = typeof x === 'number' ? x : parseFloat(x); return isFinite(x) ? fmtNum(x) : ''; };
      doc.parrafo((prop.length === 1 ? 'Valor que propone el sustentante: ' : 'Valores que propone el sustentante: ') +
        prop.map(function (c) {
          var mn = n(c.min), mx = n(c.max), u = c.u ? ' ' + c.u : '';
          var rango = mn && mx ? 'de ' + mn + ' a ' + mx + u : mn ? mn + u + ' o más' : mx ? 'hasta ' + mx + u : '';
          return c.et + (rango ? ' [' + rango + ']' : '');
        }).join('; ') + '.', { tam: 8.8, interlinea: 4.0, color: GRIS });
    }
  }

  /* Sección D (0.5): las alternativas en el orden que vio el alumno, la elegida marcada, y la letra entre
     marcadores para el extractor. */
  var LETRAS = 'abcdef';

  function mezcla(h) {
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0;
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
    return h >>> 0;
  }
  function huellaTexto(t) {
    var h = window.EXAMEN_VAR.fnv1a(String(t == null ? '' : t).replace(/\s+/g, ' ').trim());
    return ('00000000' + h.toString(16)).slice(-8);
  }

  function ordenDe(ctx, r) {
    var o = ctx.estado.ordenes && ctx.estado.ordenes[r.id];
    if (o && o.length === r.alternativas.length) return o;
    // 0.6: en un reactivo fijo el orden es el mismo para todos (matrícula y sesión vacías)
    var V = window.EXAMEN_VAR, idx = [], base = (r.fijo === true ? V.semilla('', '')
      : V.semilla(ctx.estado.alumno.matricula, ctx.estado.sesion)) + '|' + r.id + ':orden:';
    for (var i = 0; i < r.alternativas.length; i++) idx.push(i);
    for (i = idx.length - 1; i > 0; i--) {
      var j = mezcla(V.fnv1a(base + i)) % (i + 1), t = idx[i];
      idx[i] = idx[j]; idx[j] = t;
    }
    return idx;
  }

  function reactivosMultiple(doc, ctx) {
    (ctx.banco.opcion_multiple || []).forEach(function (r, i) {
      var num = etiqueta(ctx, r, 'D', i);
      if (tipoDe(r, 'opcion_multiple') === 'completar') { reactivoCompletar(doc, ctx, r, num); return; }
      var orden = ordenDe(ctx, r), resp = ctx.estado.resp[r.id], letra = '';
      doc.necesita(36);
      doc.barraTitulo(num, r.titulo, r.puntos + ' pts · ' + r.tema);
      r.texto.forEach(function (l) { doc.mixto(l, { tam: 8.8, interlinea: 4.0 }); });
      if (r.figura) figura(doc, r.figura, r.id);
      doc.espacio(1);
      orden.forEach(function (canon, k) {
        var elegida = typeof resp === 'number' && resp === canon;
        if (elegida) letra = LETRAS.charAt(k);
        var a = r.alternativas[canon] || { texto: '' };
        doc.mixto((elegida ? '● ' : '○ ') + LETRAS.charAt(k) + ') ' + a.texto,
          { tam: 8.8, sangria: 4, interlinea: 4.2, estilo: elegida ? 'bold' : 'normal', color: elegida ? AZUL : undefined });
      });
      if (!letra) doc.parrafo('[SIN RESPUESTA]', { tam: 8.8, estilo: 'bold', color: ROJO, sangria: 4 });
      doc.espacio(1);
      // alt: huella del texto de la alternativa elegida, para que la calificación note si el banco cambió después.
      var alt = letra ? huellaTexto((r.alternativas[resp] || {}).texto) : '';
      doc.marcador('[[R:' + r.id + ']] eleccion=' + letra + (alt ? ' alt=' + alt : '') + ' [[/R:' + r.id + ']]');
      doc.espacio(3);
    });
  }

  /* Completar (0.6). La respuesta en una línea: espacios y saltos colapsados y, para que no pueda imitar un
     marcador, «[[» y «]]» separados. */
  function enUnaLinea(t) {
    return String(t == null ? '' : t).replace(/\s+/g, ' ').trim()
      .replace(/\[(?=\[)/g, '[ ').replace(/\](?=\])/g, '] ');
  }

  /* El enunciado, la respuesta a la vista y, entre marcadores, la misma respuesta para el extractor:
     [[R:D09]] respuesta=<texto> [[/R:D09]] */
  function reactivoCompletar(doc, ctx, r, num) {
    var resp = ctx.estado.resp[r.id];
    var t = enUnaLinea(typeof resp === 'string' ? resp : '');
    doc.necesita(32);
    doc.barraTitulo(num, r.titulo, r.puntos + ' pts · ' + r.tema);
    r.texto.forEach(function (l) { doc.mixto(l, { tam: 8.8, interlinea: 4.0 }); });
    if (r.figura) figura(doc, r.figura, r.id);
    doc.espacio(1.5);
    doc.fuente('bold', 8.4, AZUL);
    doc.necesita(6);
    doc.d.text('Respuesta del sustentante', MI, doc.y);
    doc.y += 4.2;
    if (t) doc.parrafo(t, { tam: 9, estilo: 'bold', color: AZUL, sangria: 4, interlinea: 4.2 });
    else doc.parrafo('[SIN RESPUESTA]', { tam: 8.8, estilo: 'bold', color: ROJO, sangria: 4 });
    doc.espacio(1);
    doc.marcadorEnLinea('[[R:' + r.id + ']] respuesta=' + (t || '[SIN RESPUESTA]') + ' [[/R:' + r.id + ']]');
    doc.espacio(3);
  }

  // ------------------------------------------------------------- integridad
  function registroIntegridad(doc, ctx) {
    var e = ctx.estado, ig = e.integridad;
    doc.nuevaPagina();
    doc.fuente('bold', 12.5, AZUL);
    doc.d.text('Registro de integridad de la sesión', MI, doc.y);
    doc.y += 2; doc.linea(0.6, AZUL); doc.espacio(3);

    doc.parrafo('Registro automático generado por la aplicación del examen y aceptado por el sustentante ' +
      'en la declaración inicial. Los indicadores no constituyen por sí mismos una imputación: son datos ' +
      'de sesión que el profesor contrasta con el contenido técnico de las respuestas.',
      { tam: 8.2, color: GRIS, despues: 3 });

    var filas = [
      ['Duración efectiva de la sesión', ctx.util.hhmmss(e.fin - e.inicio)],
      ['Eventos de copiado al portapapeles', String(ig.copias) + '  (' + ig.caracteresCopiados + ' caracteres)'],
      ['Eventos de pegado en campos de respuesta', String(ig.pegados) + '  (' + ig.caracteresPegados + ' caracteres)'],
      ['Salidas de la ventana del examen', String(ig.salidas)],
      ['Tiempo acumulado fuera de la ventana', ctx.util.hhmmss(ig.msFuera)],
      ['Pérdidas breves de foco (menos de 2 s)', String(ig.focosBreves || 0)],
      ['Salidas de la pantalla completa', String(ig.fsSalidas || 0)],
      ['Política al salir de la ventana', ctx.util.politica()],
      ['Sesiones anteriores en este navegador', String(e.reinicios || 0) +
        (e.previas && e.previas.length ? '  (' + e.previas.slice(-3).join(', ') + (e.previas.length > 3 ? ', …' : '') + ')' : '')],
      ['Cierre de la sesión', e.cierre ? textoCierre(e) : 'por el sustentante'],
      ['Marcas de trazabilidad detectadas', ig.canarios.length ? ig.canarios.join(', ') : 'ninguna']
    ];
    var alto = filas.length * 5.6 + 4;
    doc.d.setFillColor(247, 248, 252);
    doc.d.setDrawColor(GRIS_CLARO[0], GRIS_CLARO[1], GRIS_CLARO[2]);
    doc.d.rect(MI, doc.y, ANCHO_TXT, alto, 'FD');
    doc.y += 5.4;
    filas.forEach(function (f) {
      doc.fuente('bold', 8.6, AZUL);
      doc.d.text(sanea(f[0]), MI + 4, doc.y);
      doc.fuente('normal', 8.6, f[1] === 'ninguna' || f[0].indexOf('Marcas') < 0 ? [40, 45, 60] : ROJO);
      doc.d.text(sanea(f[1]), MI + 96, doc.y);
      doc.y += 5.6;
    });
    doc.espacio(5);

    if (ig.eventos && ig.eventos.length) {
      doc.fuente('bold', 9.5, AZUL);
      doc.necesita(8);
      doc.d.text('Bitácora cronológica (t = tiempo desde el inicio)', MI, doc.y);
      doc.y += 4.6;
      var lineas = ig.eventos.slice(0, 120).map(function (ev) {
        return ctx.util.hhmmss(ev.t) + '  ' + ev.tipo + (ev.det ? '  ' + ev.det : '');
      });
      lineas.forEach(function (l) {
        doc.fuente('normal', 7.4, GRIS);
        doc.necesita(4);
        doc.d.text(sanea(l), MI + 3, doc.y);
        doc.y += 3.4;
      });
      if (ig.eventos.length > 120) {
        doc.parrafo('… y ' + (ig.eventos.length - 120) + ' eventos adicionales.', { tam: 7.4, color: GRIS });
      }
      doc.espacio(4);
    }

    // Bloque legible por máquina para el postproceso
    doc.necesita(50);
    doc.fuente('bold', 9.5, AZUL);
    doc.d.text('Bloque de datos para el procesamiento automático', MI, doc.y);
    doc.y += 4.6;
    var meta = [
      'matricula=' + e.alumno.matricula,
      'nombre=' + e.alumno.nombre,
      'grupo=' + e.alumno.grupo,
      'correo=' + (e.alumno.correo || ''),
      'sesion=' + (e.sesion || ''),
      'reinicios=' + (e.reinicios || 0),
      'previas=' + ((e.previas || []).slice(-6).join(',')),
      'cierre=' + (e.cierre ? e.cierre.motivo : 'ninguno'),
      'politica_salida=' + ctx.util.politica(),
      'inicio=' + iso(e.inicio),
      'fin=' + iso(e.fin),
      'duracion_s=' + Math.round((e.fin - e.inicio) / 1000),
      'copias=' + ig.copias,
      'car_copiados=' + ig.caracteresCopiados,
      'pegados=' + ig.pegados,
      'car_pegados=' + ig.caracteresPegados,
      'salidas=' + ig.salidas,
      'seg_fuera=' + Math.round(ig.msFuera / 1000),
      'fs_salidas=' + (ig.fsSalidas || 0),
      'focos_breves=' + (ig.focosBreves || 0),
      'canarios=' + (ig.canarios.join(',') || 'ninguno'),
    ];
    if (ctx.meta.accesoLista === true) {               // 0.5: acceso por la lista del grupo
      meta.push('acceso=lista', 'acceso_rechazos=' + (e.accesoRechazos || 0));
    }
    meta = meta.concat([
      'folio=' + ctx.folio,
      'version=' + ctx.meta.version,
      'agente=' + (navigator.userAgent || '').slice(0, 90)
    ]);
    doc.marcador('[[META]]');
    meta.forEach(function (l) {
      doc.fuente('normal', 7.4, [90, 96, 112]);
      doc.necesita(4);
      doc.d.text(sanea(l), MI + 3, doc.y);
      doc.y += 3.5;
    });
    doc.marcador('[[/META]]');

    doc.espacio(4);
    doc.parrafo('Fin del documento. Entregue este archivo, sin modificarlo ni renombrarlo, en la tarea ' +
      'correspondiente de ' + (ctx.meta.plataforma || 'la plataforma del curso') + '.', { tam: 8.2, estilo: 'bold', color: AZUL });
  }

  // ------------------------------------------------------------------ API
  function generar(ctx) {
    var jsPDFctor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (!jsPDFctor) throw new Error('No se cargó la biblioteca de generación de PDF (vendor/jspdf.umd.min.js).');
    if (!window.EXAMEN_FUENTES) throw new Error('No se cargaron las fuentes tipográficas (assets/fuentes.js).');

    var doc = new Doc(jsPDFctor, window.EXAMEN_FUENTES);
    doc.mate = ctx.meta.notacion === 'latex' && window.EXAMEN_MATE ? window.EXAMEN_MATE : null;   // fórmulas (0.5)
    var e = ctx.estado;

    doc.d.setProperties({
      title: ctx.meta.clave + ' ' + (ctx.meta.evaluacionCorta || ctx.meta.evaluacion) + ' — ' + e.alumno.matricula,
      subject: ctx.meta.materia + ' · ' + ctx.meta.evaluacion + ' · Folio ' + ctx.folio,
      author: e.alumno.nombre,
      keywords: [ctx.meta.clave, e.alumno.matricula, e.alumno.grupo, ctx.folio, 'sesion:' + (e.sesion || ''),
        'canarios:' + (e.integridad.canarios.join('|') || 'ninguno'),
        'duracion_s:' + Math.round((e.fin - e.inicio) / 1000)].join(', '),
      creator: 'Sinodal · ' + ctx.meta.clave + ' v' + ctx.meta.version
    });

    portada(doc, ctx);

    // 0.6: con composición, los puntos de cada sección son los de sus tipos; sin ella, los de la meta, como antes.
    var comp = composicion(ctx);
    var teoria = ctx.meta.estiloA !== 'criterio';
    var ptsA = fmtNum(+((comp.length ? puntosSeccion(ctx, 'A') : ctx.meta.puntosA) / Math.max(1, ctx.banco.teoricos.length)).toFixed(2));
    if (ctx.banco.teoricos.length === 1 && comp.length) {      // 0.6: la composición puede pedir una sola
      doc.nuevaPagina();
      seccion(doc, teoria ? 'Sección A · Teoría' : 'Sección A · Reactivos de criterio', teoria
        ? '1 pregunta conceptual de respuesta breve, ' + puntos(puntosSeccion(ctx, 'A')) + '. Se evalúan la idea ' +
          'central, su explicación y su aplicación o condición de validez.'
        : '1 reactivo de redacción libre, ' + puntos(puntosSeccion(ctx, 'A')) + '. Se evalúa la decisión de ' +
          'ingeniería y su justificación: hipótesis declaradas, criterio seleccionado con argumento, coherencia ' +
          'física y consecuencias de la decisión.');
      reactivosTeoricos(doc, ctx);
    } else if (ctx.banco.teoricos.length) {
      doc.nuevaPagina();
      seccion(doc, teoria ? 'Sección A · Teoría' : 'Sección A · Reactivos de criterio', teoria
        ? ctx.banco.teoricos.length + ' preguntas conceptuales de respuesta breve, ' + ptsA + ' puntos cada una. Se ' +
          'evalúan la idea central, su explicación y su aplicación o condición de validez.'
        : ctx.banco.teoricos.length + ' reactivos de redacción libre, ' + ptsA + ' puntos cada uno. Se evalúa la decisión de ingeniería ' +
          'y su justificación: hipótesis declaradas, criterio seleccionado con argumento, coherencia física y ' +
          'consecuencias de la decisión.');
      reactivosTeoricos(doc, ctx);
    }

    if (ctx.banco.numericos.length && (comp.length || hayTipo(ctx, 'B', 'diseno'))) {
      // 0.6: la sección nombra lo que tiene (problemas numéricos, de diseño o ambos), con los puntos de cada tipo
      var gB = gruposDe(ctx, 'B'), hayNum = hayTipo(ctx, 'B', 'numerico'), hayDis = hayTipo(ctx, 'B', 'diseno');
      doc.nuevaPagina();
      seccion(doc, hayNum && hayDis ? 'Sección B · Problemas numéricos y de diseño'
        : hayDis ? 'Sección B · Diseño con restricciones'
        : teoria ? 'Sección B · Numérico' : 'Sección B · Reactivos numéricos',
        cuenta(ctx, gB) + ', ' + datosDe(ctx, ctx.banco.numericos) + '. Se registran los valores reportados, el ' +
        'criterio declarado y los datos de la variante aplicada para su verificación.' +
        (hayDis ? ' En los problemas de diseño el sustentante propone los valores señalados y reporta los ' +
          'resultados que corresponden a su propuesta; se califican esos resultados y el cumplimiento de cada ' +
          'requisito.' : ''));
      reactivosNumericos(doc, ctx, 'B');
    } else if (ctx.banco.numericos.length) {
    doc.nuevaPagina();
    seccion(doc, teoria ? 'Sección B · Numérico' : 'Sección B · Reactivos numéricos',
      ctx.banco.numericos.length + ' reactivos con datos individualizados por matrícula' + (e.sesion ? ' y sesión' : '') + ', ' + fmtNum(+(ctx.meta.puntosB / Math.max(1, ctx.banco.numericos.length)).toFixed(2)) + ' puntos cada uno. Se registran los ' +
      'valores reportados, el criterio declarado y los datos de la variante aplicada para su verificación.');
    reactivosNumericos(doc, ctx, 'B');
    }

    var nC = (ctx.banco.analisis || []).length;
    if (nC && comp.length) {
      doc.nuevaPagina();
      seccion(doc, 'Sección C · Análisis',
        cuenta(ctx, gruposDe(ctx, 'C')) + ', ' + datosDe(ctx, ctx.banco.analisis) + '. Se califican los valores ' +
        'calculados y el análisis: el dictamen con base en los propios resultados, el mecanismo que los gobierna y ' +
        'la medida propuesta.');
      reactivosNumericos(doc, ctx, 'C');
    } else if (nC) {
      doc.nuevaPagina();
      seccion(doc, 'Sección C · Análisis',
        nC + ' ' + plural(nC, ['caso', 'casos']) + ' con datos individualizados, ' + fmtNum(+((ctx.meta.puntosC || 0) / nC).toFixed(2)) + ' puntos cada ' +
        'uno. Se califican los valores calculados y el análisis: el dictamen con base en los propios resultados, ' +
        'el mecanismo que los gobierna y la medida propuesta.');
      reactivosNumericos(doc, ctx, 'C');
    }

    var nD = (ctx.banco.opcion_multiple || []).length;
    if (nD && (comp.length || hayTipo(ctx, 'D', 'completar'))) {
      // 0.6: opción múltiple, completar o ambos
      var hayOM = hayTipo(ctx, 'D', 'opcion_multiple'), hayCo = hayTipo(ctx, 'D', 'completar');
      doc.nuevaPagina();
      seccion(doc, hayOM && hayCo ? 'Sección D · Opción múltiple y completar'
        : hayCo ? 'Sección D · Completar' : 'Sección D · Opción múltiple',
        cuenta(ctx, gruposDe(ctx, 'D')) + '.' +
        (hayOM ? ' Las alternativas aparecen en el orden en que las vio el sustentante; la elegida va marcada con ●.' : '') +
        (hayCo ? ' En los reactivos de completar se imprime la respuesta tal como la escribió el sustentante.' : ''));
      reactivosMultiple(doc, ctx);
    } else if (nD) {
      doc.nuevaPagina();
      seccion(doc, 'Sección D · Opción múltiple',
        nD + ' reactivos de opción múltiple, ' + fmtNum(+((ctx.meta.puntosD || 0) / nD).toFixed(2)) + ' puntos cada ' +
        'uno. Las alternativas aparecen en el orden en que las vio el sustentante; la elegida va marcada con ●.');
      reactivosMultiple(doc, ctx);
    }

    registroIntegridad(doc, ctx);
    doc.piePaginas(ctx);

    doc.d.save(ctx.archivo);
    return ctx.archivo;
  }

  return { generar: generar, sanea: sanea };
})();
