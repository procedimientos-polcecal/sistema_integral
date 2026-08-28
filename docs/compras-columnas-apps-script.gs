/**
 * Deja todas las comparativas de proveedores con las mismas 19 columnas.
 *
 * EL PROBLEMA
 *
 * Las comparativas viven en planillas de Drive, una por artículo, y no todas
 * tienen las mismas columnas: algunas se armaron antes de que el modelo tuviera
 * 19, otras tienen los encabezados escritos distinto —FLETE en vez de ENVÍO,
 * TOTAL en vez de PRECIO TOTAL— y a algunas les falta una columna entera.
 *
 * La app las tolera: ubica cada columna por nombre y funciona con cualquier
 * orden. Lo que no puede hacer es completar una que no existe. En "ESPIRA
 * SINFIN", sin columna de ENVÍO, la fórmula del total salía "...+@1001" y Excel
 * la marcaba como error.
 *
 * QUÉ HACE CON CADA PLANILLA
 *
 *   1. Saca una copia de respaldo. Si la copia falla, no la toca.
 *   2. Reconoce los encabezados por nombre, tolerando acentos y variantes.
 *   3. Corrige los nombres de las que están escritas distinto.
 *   4. Mueve cada una a su posición del modelo, con moveColumns, que ajusta las
 *      fórmulas igual que si arrastraras la columna a mano.
 *   5. Inserta las que faltan EN SU LUGAR, no al final.
 *   6. Conserva las que no reconoce, corridas después de la S.
 *
 * CÓMO SE USA
 *
 *   1. Completar CARPETA_COMPARATIVAS con el ID de la carpeta de Drive donde
 *      están (es lo que va en la URL de la carpeta, después de /folders/).
 *   2. Extensiones -> Apps Script en cualquier planilla, y pegar este archivo.
 *   3. Dejar SOLO_INFORMAR en true y ejecutar `ponerLasComparativasAlDia`.
 *      No escribe nada: dice qué haría con cada planilla.
 *   4. Leer el informe (Ver -> Registros). Si está bien, poner SOLO_INFORMAR
 *      en false y volver a ejecutar.
 *   5. Al aplicar trabaja cuatro minutos por corrida y corta solo, siempre
 *      ENTRE planillas. Si dice que se cortó, ejecutar de nuevo: sigue donde
 *      quedó. Repetir hasta que diga "Terminó el recorrido completo".
 *
 * LOS RESPALDOS
 *
 * Antes de tocar una planilla se saca una copia en una carpeta
 * "RESPALDO COMPARATIVAS <fecha>", al lado de la carpeta de comparativas. Si la
 * copia falla, esa planilla no se modifica.
 *
 * LO QUE NO PUEDE ARREGLAR
 *
 * moveColumns ajusta las fórmulas DE ESA PLANILLA. Si otra planilla la lee con
 * IMPORTRANGE apuntando a una letra de columna, esa referencia va a quedar
 * mirando otra cosa. Lo mismo con rangos protegidos por letra. Si sabés que
 * alguna comparativa está referenciada desde afuera, ponela en EXCLUIDAS.
 */

// ⬇️ El ID de la carpeta de Drive con las comparativas.
var CARPETA_COMPARATIVAS = "";

// En true no escribe nada: sólo dice qué haría. Correr así la primera vez.
var SOLO_INFORMAR = true;

// Nombres de planillas que no hay que tocar, si alguna está referenciada
// desde afuera. Ej: ["CORREAS", "RODAMIENTOS"]
var EXCLUIDAS = [];

// El modelo. Es COLUMNAS_COMPARATIVA de lib/compras/comparativa.ts: si allá
// cambia, acá también.
var MODELO = [
  "NRO RI", "FECHA", "ÁREA", "DESCRIPCION", "PROVEEDOR", "MARCA",
  "UNIDAD DE MEDIDA", "PRECIO UNITARIO", "CANTIDAD", "ENVÍO", "DESCUENTO",
  "IVA", "PRECIO TOTAL", "PRECIO HASTA", "PLAZOS", "CONDICIONES DE PAGO",
  "DISPONIBILIDAD", "COMENTARIO", "ELECCIÓN"
];

// Cómo puede venir escrito cada encabezado. El primero es el nombre canónico y
// es el que queda. Misma tabla que ALIAS en lib/compras/comparativa.ts.
var ALIAS = [
  ["NRO RI", "N RI", "NUMERO RI", "N DE RI"],
  ["FECHA"],
  ["ÁREA", "AREA", "SECTOR"],
  ["DESCRIPCION", "DESCRIPCIÓN", "DETALLE"],
  ["PROVEEDOR", "PROVEEDORES"],
  ["MARCA"],
  ["UNIDAD DE MEDIDA", "UNIDAD", "U MEDIDA", "UM"],
  ["PRECIO UNITARIO", "PRECIO UNIT", "P UNITARIO", "UNITARIO"],
  ["CANTIDAD", "CAN", "CANT"],
  ["ENVÍO", "ENVIO", "FLETE"],
  ["DESCUENTO", "DESC"],
  ["IVA"],
  ["PRECIO TOTAL", "TOTAL"],
  ["PRECIO HASTA", "VALIDO HASTA", "VÁLIDO HASTA"],
  ["PLAZOS", "PLAZO", "PLAZO DE PAGO"],
  ["CONDICIONES DE PAGO", "CONDICIONES"],
  ["DISPONIBILIDAD", "ENTREGA"],
  ["COMENTARIO", "COMENTARIOS", "OBSERVACIONES"],
  ["ELECCIÓN", "ELECCION", "ELEGIDO"]
];

// Cuántos minutos se trabaja por corrida antes de cortar solo. El límite de
// Apps Script son 6 (30 en Workspace), así que 4 deja margen para terminar la
// planilla que esté en curso.
var MINUTOS_POR_CORRIDA = 4;

var SALTO = String.fromCharCode(10);

function ponerLasComparativasAlDia() {
  if (!CARPETA_COMPARATIVAS) {
    throw new Error("Falta completar CARPETA_COMPARATIVAS con el ID de la carpeta de Drive.");
  }

  var carpeta = DriveApp.getFolderById(CARPETA_COMPARATIVAS);
  var archivos = carpeta.getFilesByType(MimeType.GOOGLE_SHEETS);

  var informe = [];
  var cuantas = 0;
  var tocadas = 0;
  var salteadas = 0;

  // Apps Script corta la ejecución a los 6 minutos (30 en Workspace). Con
  // setenta planillas, cada una con su copia de respaldo, eso puede pasar —y
  // cortarse en el medio de una dejaría las columnas a mitad de camino.
  //
  // Así que se corta antes, por decisión propia y sólo ENTRE planillas: nunca
  // dentro de una. Lo hecho queda anotado y la próxima corrida sigue de ahí.
  var comenzo = new Date().getTime();
  var yaHechas = _yaHechas();
  var corto = false;

  informe.push(SOLO_INFORMAR
    ? "=== MODO INFORME: no se escribe nada ==="
    : "=== APLICANDO CAMBIOS ===");

  if (!SOLO_INFORMAR && yaHechas.length > 0) {
    informe.push("Retomando: " + yaHechas.length + " planillas ya hechas en corridas anteriores.");
  }

  while (archivos.hasNext()) {
    var archivo = archivos.next();
    var nombre = archivo.getName();
    cuantas++;

    // Sólo al aplicar: en modo informe se recorre todo, que es el punto.
    if (!SOLO_INFORMAR && yaHechas.indexOf(nombre) >= 0) continue;

    if (!SOLO_INFORMAR && new Date().getTime() - comenzo > MINUTOS_POR_CORRIDA * 60 * 1000) {
      corto = true;
      break;
    }

    informe.push("");
    informe.push("--------------------------------------");
    informe.push(nombre);

    if (EXCLUIDAS.indexOf(nombre) >= 0) {
      informe.push("  EXCLUIDA a mano: no se toca.");
      salteadas++;
      continue;
    }

    try {
      var pasos = _ponerAlDia(archivo, informe);
      if (pasos > 0) tocadas++;
      else if (pasos === 0) informe.push("  ya estaba al día.");
      else salteadas++;

      // Se anota recién acá: si algo falló, no queda marcada como hecha y la
      // próxima corrida la vuelve a intentar.
      if (!SOLO_INFORMAR) _anotarHecha(nombre);
    } catch (err) {
      informe.push("  ERROR: " + err.message + " — no se modificó.");
      salteadas++;
    }
  }

  informe.push("");
  informe.push("======================================");
  informe.push("planillas encontradas: " + cuantas);
  informe.push(SOLO_INFORMAR ? "necesitan cambios: " + tocadas : "modificadas: " + tocadas);
  informe.push("salteadas o con error: " + salteadas);
  if (SOLO_INFORMAR) {
    informe.push("");
    informe.push("Para aplicarlo: poner SOLO_INFORMAR en false y ejecutar de nuevo.");
  } else if (corto) {
    informe.push("");
    informe.push("SE CORTÓ POR TIEMPO, entre planillas y no dentro de una.");
    informe.push("Ninguna quedó a medio hacer. Ejecutar de nuevo para seguir:");
    informe.push("arranca donde quedó, no repite lo hecho.");
  } else {
    informe.push("");
    informe.push("Terminó el recorrido completo.");
    informe.push("Para volver a empezar de cero, ejecutar `olvidarLoHecho`.");
  }

  var texto = informe.join(SALTO);
  Logger.log(texto);
  return texto;
}

/** Pone una planilla al día. Devuelve cuántos cambios hicieron falta. */
function _ponerAlDia(archivo, informe) {
  var planilla = SpreadsheetApp.openById(archivo.getId());
  var hoja = planilla.getSheets()[0];

  var ancho = hoja.getLastColumn();
  if (ancho < 1) {
    informe.push("  está vacía: no se toca.");
    return 0;
  }

  var encabezado = hoja.getRange(1, 1, 1, ancho).getValues()[0];

  // `actual[i]` = a qué columna del modelo corresponde la que hoy está en la
  // posición i, o -1 si no se reconoce. Se mantiene en paralelo a la hoja para
  // no releerla después de cada movimiento.
  var actual = [];
  for (var c = 0; c < encabezado.length; c++) {
    actual.push(_cual(encabezado[c]));
  }

  // Sin estas tres no es una comparativa: no se toca.
  var imprescindibles = [0, 4, 7]; // NRO RI, PROVEEDOR, PRECIO UNITARIO
  for (var k = 0; k < imprescindibles.length; k++) {
    if (actual.indexOf(imprescindibles[k]) < 0) {
      informe.push("  no parece una comparativa (falta " + MODELO[imprescindibles[k]] + "): no se toca.");
      // -1 y no 0: el llamador distingue "no hacía falta" de "no se pudo", que
      // antes salían las dos como "ya estaba al día".
      return -1;
    }
  }

  // Qué hay que hacer, antes de tocar nada.
  var renombrar = [];
  for (var i = 0; i < actual.length; i++) {
    if (actual[i] >= 0) {
      var comoEsta = String(encabezado[i] || "").trim();
      var canonico = MODELO[actual[i]];
      if (comoEsta !== canonico) renombrar.push([i, comoEsta, canonico]);
    } else if (String(encabezado[i] || "").trim() !== "") {
      informe.push("  no reconocida, se conserva: \"" + String(encabezado[i]).trim() + "\"");
    }
  }

  for (var r = 0; r < renombrar.length; r++) {
    informe.push("  renombrar: \"" + renombrar[r][1] + "\" -> \"" + renombrar[r][2] + "\"");
  }

  var cambios = renombrar.length;

  // El respaldo va antes del primer cambio, y sólo si hay algo que cambiar.
  var necesitaMover = _necesitaMover(actual);
  if ((cambios > 0 || necesitaMover) && !SOLO_INFORMAR) {
    // A una carpeta y no a la raíz: son setenta planillas, y setenta copias
    // sueltas en "Mi unidad" son peor que no tener respaldo, porque nadie las
    // encuentra cuando las necesita.
    archivo.makeCopy(archivo.getName(), _carpetaDeRespaldos());
    informe.push("  respaldo hecho");
  }

  // 1) Los nombres.
  if (!SOLO_INFORMAR) {
    for (var r2 = 0; r2 < renombrar.length; r2++) {
      hoja.getRange(1, renombrar[r2][0] + 1).setValue(renombrar[r2][2]);
    }
  }

  // 2) Cada columna a su lugar, de izquierda a derecha.
  //
  // Siempre se trae desde la derecha: moveColumns interpreta el destino con las
  // coordenadas de antes de mover, así que mover hacia la derecha exige
  // compensar el corrimiento. Trayendo hacia la izquierda, lo ya resuelto no se
  // vuelve a mover.
  for (var destino = 0; destino < MODELO.length; destino++) {
    var donde = actual.indexOf(destino);

    if (donde < 0) {
      informe.push("  insertar en " + _letra(destino + 1) + ": " + MODELO[destino]);
      cambios++;
      if (!SOLO_INFORMAR) {
        hoja.insertColumnBefore(destino + 1);
        hoja.getRange(1, destino + 1).setValue(MODELO[destino]);
      }
      actual.splice(destino, 0, destino);
      continue;
    }

    if (donde === destino) continue;

    informe.push("  mover " + MODELO[destino] + ": " + _letra(donde + 1) + " -> " + _letra(destino + 1));
    cambios++;
    if (!SOLO_INFORMAR) {
      hoja.moveColumns(hoja.getRange(1, donde + 1, 1, 1), destino + 1);
    }
    // El mismo movimiento, en el arreglo que sigue a la hoja.
    var clave = actual.splice(donde, 1)[0];
    actual.splice(destino, 0, clave);
  }

  return cambios;
}

/** Si alguna columna del modelo no está en su posición. */
function _necesitaMover(actual) {
  for (var destino = 0; destino < MODELO.length; destino++) {
    if (actual.indexOf(destino) !== destino) return true;
  }
  return false;
}

/**
 * A qué columna del modelo corresponde este encabezado. -1 si a ninguna.
 *
 * Compara normalizado: sin acentos, sin grados ni puntos, en mayúsculas. Así
 * "N° RI", "Nº RI" y "N. RI" son el mismo.
 */
function _cual(texto) {
  var buscado = _norm(texto);
  if (!buscado) return -1;

  for (var i = 0; i < ALIAS.length; i++) {
    for (var a = 0; a < ALIAS[i].length; a++) {
      if (_norm(ALIAS[i][a]) === buscado) return i;
    }
  }
  return -1;
}

function _norm(texto) {
  // NFD separa los acentos en caracteres aparte, y después se saca todo lo que
  // no sea letra, número o espacio: los acentos sueltos, el grado de "N°" y los
  // puntos de "N. RI" se van de una. Así "ÁREA" y "AREA" son el mismo, y
  // "N° RI", "Nº RI" y "N. RI" también.
  return String(texto == null ? "" : texto)
    .normalize("NFD")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Número de columna a letra: 1 -> A, 27 -> AA. */
function _letra(n) {
  var s = "";
  while (n > 0) {
    var resto = (n - 1) % 26;
    s = String.fromCharCode(65 + resto) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function _hoy() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
}

/**
 * La carpeta donde van los respaldos, creada una sola vez por día.
 *
 * Setenta copias sueltas en "Mi unidad" son peor que no tener respaldo: nadie
 * las encuentra el día que las necesita.
 */
function _carpetaDeRespaldos() {
  var nombre = "RESPALDO COMPARATIVAS " + _hoy();
  var padre = DriveApp.getFolderById(CARPETA_COMPARATIVAS).getParents();
  var donde = padre.hasNext() ? padre.next() : DriveApp.getRootFolder();

  var existentes = donde.getFoldersByName(nombre);
  return existentes.hasNext() ? existentes.next() : donde.createFolder(nombre);
}

/** Qué planillas ya se hicieron, para no repetirlas si la corrida se cortó. */
function _yaHechas() {
  var guardado = PropertiesService.getScriptProperties().getProperty("comparativas_hechas");
  return guardado ? JSON.parse(guardado) : [];
}

function _anotarHecha(nombre) {
  var hechas = _yaHechas();
  if (hechas.indexOf(nombre) < 0) hechas.push(nombre);
  PropertiesService.getScriptProperties()
    .setProperty("comparativas_hechas", JSON.stringify(hechas));
}

/**
 * Borra la memoria de lo hecho, para volver a recorrer todo.
 *
 * Hace falta sólo si se quiere reprocesar planillas que ya se pusieron al día.
 * Ejecutarla no modifica ninguna planilla.
 */
function olvidarLoHecho() {
  PropertiesService.getScriptProperties().deleteProperty("comparativas_hechas");
  Logger.log("Listo: la próxima corrida vuelve a recorrer todas las planillas.");
}
