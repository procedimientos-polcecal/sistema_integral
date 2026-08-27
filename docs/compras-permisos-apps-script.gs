/**
 * Le da permiso a la cuenta de servicio sobre los rangos protegidos de
 * "PEDIDOS DE COMPRA".
 *
 * POR QUÉ HACE FALTA
 *
 * La app escribe en la planilla lo que se gestiona desde el sistema: el estado
 * de la compra, el link de la comparativa, el proveedor y los costos. Pero la
 * planilla tiene cientos de rangos protegidos —la columna de aprobación, y una
 * protección por fila que se crea al aprobar cada RI—, y la cuenta de servicio
 * no figura entre quienes pueden editarlos.
 *
 * El resultado es que el cambio queda guardado en el sistema, la planilla lo
 * rechaza, y los dos lados dicen cosas distintas. El sistema lo avisa en
 * Configuración de Compras, pero no puede resolverlo solo.
 *
 * Agregar la cuenta a mano no es opción: son cientos de protecciones.
 *
 * QUÉ HACE
 *
 * Recorre las protecciones de hoja y de rango de las pestañas que le importan
 * a la app y agrega la cuenta de servicio como editor. No quita a nadie, no
 * cambia qué está protegido, y no toca los datos. Se puede correr las veces
 * que haga falta: agregar a alguien que ya está no hace nada.
 *
 * CÓMO SE USA
 *
 *   1. Poner abajo el mail de la cuenta de servicio. Está en el JSON que
 *      cargaste en Vercel (GOOGLE_SERVICE_ACCOUNT_JSON), en el campo
 *      "client_email", y termina en ".iam.gserviceaccount.com". También
 *      aparece en la lista de "Compartir" de la planilla.
 *   2. En la planilla: Extensiones -> Apps Script, y pegar este archivo.
 *   3. Elegir la función `darPermisoALaCuentaDeServicio` y Ejecutar.
 *   4. Mirar el registro: dice cuántas protecciones tocó y cuáles no pudo.
 *
 * Después, en el sistema: Compras -> Configuración -> Reintentar. Los
 * pendientes se van a escribir de a cinco por vez.
 *
 * OJO CON LAS PROTECCIONES NUEVAS
 *
 * Si un script de la planilla crea una protección cada vez que se aprueba un
 * RI, las que se creen de ahora en más van a volver a excluir a la cuenta de
 * servicio y el problema reaparece de a poco. La solución de fondo es que ese
 * script agregue la cuenta al crear la protección:
 *
 *     proteccion.addEditor(CUENTA_DE_SERVICIO);
 *
 * Mientras eso no esté, se puede volver a correr esta función cada tanto.
 */

// ⬇️ El mail de la cuenta de servicio, entre las comillas.
var CUENTA_DE_SERVICIO = "";

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

  // También en pantalla, para no tener que abrir el registro.
  SpreadsheetApp.getUi().alert(
    "Permisos de la cuenta de servicio",
    resumen + (fallaron.length > 0 ? "\n\nVer el registro para el detalle." : ""),
    SpreadsheetApp.getUi().ButtonSet.OK
  );

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
