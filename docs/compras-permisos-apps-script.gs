/**
 * Herramientas para que la app pueda escribir en "PEDIDOS DE COMPRA".
 *
 * EL PROBLEMA
 *
 * La app escribe en la planilla lo que se gestiona desde el sistema: el estado
 * de la compra, el link de la comparativa, el proveedor y los costos. Algunas
 * de esas escrituras vuelven rechazadas, el cambio queda sólo en el sistema, y
 * los dos lados terminan diciendo cosas distintas. El sistema lo avisa en
 * Compras -> Configuración, pero no puede resolverlo solo.
 *
 * LO QUE YA SABEMOS (27/08/2026)
 *
 * La primera sospecha era que a la cuenta de servicio le faltaba permiso sobre
 * los rangos protegidos. Correr `darPermisoALaCuentaDeServicio` mostró que no:
 * la cuenta ya figuraba en 946 protecciones y no hubo ninguna que agregar. Las
 * 8 que no se pudieron tocar son de filas que no son las que fallan.
 *
 * Así que el permiso no es lo que falta, y hay que averiguar qué es. Para eso
 * está `diagnosticarLosPendientes`.
 *
 * LAS DOS FUNCIONES
 *
 *   darPermisoALaCuentaDeServicio
 *     Recorre las protecciones de las pestañas que le importan a la app y
 *     agrega la cuenta como editor. No quita a nadie, no cambia qué está
 *     protegido, no toca datos, y correrla de nuevo no hace nada. Sirve para
 *     descartar el permiso como causa, y para las protecciones nuevas.
 *
 *   diagnosticarLosPendientes
 *     No cambia nada: sólo mira. Para cada fila que falla dice qué
 *     protecciones la tocan, quién puede editarlas, y si la hoja entera está
 *     protegida. Es lo que hay que correr ahora.
 *
 * CÓMO SE USA
 *
 *   1. Poner abajo el mail de la cuenta de servicio. Está en el JSON que
 *      cargaste en Vercel (GOOGLE_SERVICE_ACCOUNT_JSON), en el campo
 *      "client_email", y termina en ".iam.gserviceaccount.com". También
 *      aparece en la lista de "Compartir" de la planilla.
 *   2. En la planilla: Extensiones -> Apps Script, y pegar este archivo.
 *   3. Arriba, en el selector, elegir la función que se quiere correr y recién
 *      ahí Ejecutar. Las que empiezan con guión bajo son auxiliares y no
 *      aparecen: no hay que correrlas.
 *   4. El resultado va al registro (Ver -> Registros).
 *
 * OJO CON LAS PROTECCIONES NUEVAS
 *
 * Si un script de la planilla crea una protección cada vez que se aprueba un
 * RI, las que se creen de ahora en más van a excluir a la cuenta de servicio y
 * el problema reaparece de a poco. La solución de fondo es que ese script
 * agregue la cuenta al crear la protección:
 *
 *     proteccion.addEditor(CUENTA_DE_SERVICIO);
 */

// ⬇️ El mail de la cuenta de servicio, entre las comillas.
var CUENTA_DE_SERVICIO = "";

// El salto de línea, aparte, para armar los textos de varias líneas sin
// pelearse con los escapes.
var SALTO = String.fromCharCode(10);

function darPermisoALaCuentaDeServicio() {
  if (!CUENTA_DE_SERVICIO) {
    throw new Error(
      "Falta completar CUENTA_DE_SERVICIO arriba con el mail de la cuenta " +
      "(termina en .iam.gserviceaccount.com)."
    );
  }

  var planilla = SpreadsheetApp.getActiveSpreadsheet();
  var hojas = planilla.getSheets();

  var agregadas = 0;
  var yaEstaba = 0;
  var soloAviso = 0;
  var fallaron = [];

  for (var h = 0; h < hojas.length; h++) {
    var hoja = hojas[h];
    var nombre = hoja.getName();
    if (!_leInteresaALaApp(nombre)) continue;

    var protecciones = []
      .concat(hoja.getProtections(SpreadsheetApp.ProtectionType.SHEET))
      .concat(hoja.getProtections(SpreadsheetApp.ProtectionType.RANGE));

    for (var p = 0; p < protecciones.length; p++) {
      var proteccion = protecciones[p];

      // Las de "sólo advertencia" no tienen lista de editores: avisan y dejan
      // escribir igual, así que no son las que frenan a la app.
      if (proteccion.isWarningOnly()) {
        soloAviso++;
        continue;
      }

      // Sin permiso sobre la protección no se la puede modificar. Pasa si la
      // creó otra cuenta: hay que correr esto desde el dueño de la planilla.
      if (!proteccion.canEdit()) {
        fallaron.push(nombre + " -> " + proteccion.getDescription());
        continue;
      }

      try {
        var editores = proteccion.getEditors();
        var estaba = false;
        for (var e = 0; e < editores.length; e++) {
          if (editores[e].getEmail() === CUENTA_DE_SERVICIO) { estaba = true; break; }
        }

        if (estaba) {
          yaEstaba++;
        } else {
          proteccion.addEditor(CUENTA_DE_SERVICIO);
          agregadas++;
        }
      } catch (err) {
        fallaron.push(nombre + " -> " + proteccion.getDescription() + ": " + err.message);
      }
    }
  }

  var resumen =
    "Protecciones donde se agregó la cuenta: " + agregadas + "\n" +
    "Ya la tenían: " + yaEstaba + "\n" +
    "De sólo advertencia (no hacía falta): " + soloAviso + "\n" +
    "No se pudieron tocar: " + fallaron.length;

  Logger.log(resumen);
  if (fallaron.length > 0) {
    Logger.log("Las que fallaron:\n" + fallaron.join("\n"));
  }

  // También en pantalla, para no tener que abrir el registro. Va en try
  // porque getUi() no está disponible en todos los contextos, y si falla acá
  // el trabajo ya está hecho: un error después de haber agregado los permisos
  // haría pensar que no funcionó.
  try {
    var ui = SpreadsheetApp.getUi();
    ui.alert(
      "Permisos de la cuenta de servicio",
      fallaron.length > 0 ? resumen + SALTO + SALTO + "Ver el registro para el detalle." : resumen,
      ui.ButtonSet.OK
    );
  } catch (err) {
    Logger.log("(no se pudo mostrar el cartel: " + err.message + ")");
  }

  return resumen;
}

/**
 * Las pestañas donde la app escribe: el master y las de cada área.
 *
 * Empieza con guión bajo a propósito: Apps Script no ofrece esas funciones en
 * el selector de "Ejecutar", y así nadie la corre sin argumentos por accidente
 * —que es lo que pasa si queda como la primera función del archivo—.
 */
function _leInteresaALaApp(nombre) {
  if (!nombre) return false;
  return nombre === "Requerimientos internos" || nombre.indexOf("RI ") === 0;
}

/**
 * Dice por qué la app no puede escribir en las celdas de un RI.
 *
 * Correr `darPermisoALaCuentaDeServicio` mostró que la cuenta ya figuraba en
 * 946 protecciones y las escrituras seguían fallando. Así que el problema no es
 * "falta el permiso" sino algo más específico, y esto lo busca: para cada fila
 * que falla, qué protecciones la tocan, quién puede editarlas, y si la hoja
 * entera está protegida.
 *
 * Los casos vienen de la tabla de pendientes de Compras -> Configuración.
 * Cambiar la lista de abajo si son otros.
 *
 * Elegir `diagnosticarLosPendientes` en el selector y Ejecutar. El resultado
 * va al registro (Ver -> Registros).
 */
var PENDIENTES = [
  ["RI ALMACÉN", 513],
  ["RI ALMACÉN", 514],
  ["RI MANTENIMIENTO", 375],
  ["RI MANTENIMIENTO", 909],
  ["RI TALLER VIAL", 162],
  ["RI PRODUCCIÓN", 3]
];

function diagnosticarLosPendientes() {
  if (!CUENTA_DE_SERVICIO) {
    throw new Error("Falta completar CUENTA_DE_SERVICIO arriba.");
  }

  var planilla = SpreadsheetApp.getActiveSpreadsheet();
  var salida = [];

  for (var i = 0; i < PENDIENTES.length; i++) {
    var nombreHoja = PENDIENTES[i][0];
    var fila = PENDIENTES[i][1];
    var hoja = planilla.getSheetByName(nombreHoja);

    salida.push("=====================================");
    salida.push(nombreHoja + " fila " + fila);

    if (!hoja) {
      salida.push("  LA HOJA NO EXISTE con ese nombre exacto.");
      continue;
    }

    // Qué columna es cada cosa que la app escribe.
    var encabezado = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
    var buscadas = ["ESTADO", "COMPARATIVA PROVEEDORES", "PROVEEDOR ELEGIDO", "PROVEEDOR"];
    for (var b = 0; b < buscadas.length; b++) {
      for (var c = 0; c < encabezado.length; c++) {
        var texto = String(encabezado[c] || "").toUpperCase().trim();
        if (texto === buscadas[b]) {
          salida.push("  columna " + buscadas[b] + " = " + _letra(c + 1));
        }
      }
    }

    // La hoja entera protegida frena todo, aunque las de rango estén bien.
    var deHoja = hoja.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    for (var s = 0; s < deHoja.length; s++) {
      salida.push("  HOJA PROTEGIDA: " + _describir(deHoja[s]));
      var libres = deHoja[s].getUnprotectedRanges();
      for (var u = 0; u < libres.length; u++) {
        salida.push("     rango libre: " + libres[u].getA1Notation());
      }
    }

    // Las de rango que tocan esta fila.
    var deRango = hoja.getProtections(SpreadsheetApp.ProtectionType.RANGE);
    var tocan = 0;
    for (var r = 0; r < deRango.length; r++) {
      var rango = deRango[r].getRange();
      if (!rango) continue;
      if (fila < rango.getRow() || fila > rango.getLastRow()) continue;
      tocan++;
      salida.push("  protege " + rango.getA1Notation() + ": " + _describir(deRango[r]));
    }
    if (tocan === 0) {
      salida.push("  ninguna protección de rango toca esta fila.");
    }
  }

  var texto = salida.join(SALTO);
  Logger.log(texto);
  return texto;
}

/** Resume una protección: si la cuenta puede escribir ahí y quién más puede. */
function _describir(proteccion) {
  var puedeLaCuenta = false;
  var editores = [];
  try {
    var lista = proteccion.getEditors();
    for (var e = 0; e < lista.length; e++) {
      var mail = lista[e].getEmail();
      editores.push(mail);
      if (mail === CUENTA_DE_SERVICIO) puedeLaCuenta = true;
    }
  } catch (err) {
    editores.push("(no se pudieron leer: " + err.message + ")");
  }

  return (
    '"' + (proteccion.getDescription() || "(sin nombre)") + '"' +
    " | la cuenta puede: " + (puedeLaCuenta ? "SI" : "NO") +
    " | yo puedo editar la protección: " + (proteccion.canEdit() ? "si" : "no") +
    " | sólo aviso: " + (proteccion.isWarningOnly() ? "si" : "no") +
    " | editores (" + editores.length + "): " + editores.join(", ")
  );
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
