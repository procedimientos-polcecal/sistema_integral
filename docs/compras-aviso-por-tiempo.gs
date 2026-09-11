/**
 * Apps Script de la planilla de respuestas del formulario
 * ("FORM PEDIDO DE COMPRA POLCECAL - POLYSAN", hoja "Respuestas de formulario 1").
 *
 * AVISA POR MAIL de los pedidos a los que nadie les avisó: el que carga el
 * sistema, y también la respuesta del formulario cuyo aviso falló.
 *
 * Va en el MISMO proyecto que el notificador y que la numeración, porque llama
 * a `NotificadorSolicitud` por su nombre.
 *
 * ── POR QUÉ HACE FALTA ──────────────────────────────────────────────────────
 *
 * El aviso lo manda `triggerSolicitudForm`, que es un activador de **envío de
 * formulario**. Un pedido cargado en el SdG llega a esta hoja por la API de
 * Sheets, y la documentación de Apps Script es explícita: *"Script executions
 * and API requests don't cause triggers to run"*. Ni `onEdit`, ni un instalable
 * de edición, ni el de envío de formulario — la única excepción es
 * `Form.submitGrades()`. Así que la fila aparece y nadie se entera.
 *
 * Tampoco sirve que el sistema **envíe el formulario de verdad**: tiene una
 * pregunta de subida de archivo y correo verificado, y las dos obligan a
 * iniciar sesión, así que un envío desde el servidor se rechaza.
 *
 * Queda un activador **por tiempo** que barra las filas sin avisar. Y el
 * criterio de "sin avisar" no hay que inventarlo: la columna `M` ("DIRECCIÓN
 * EMAIL ENVIADA") la escribe el propio notificador justo antes de mandar el
 * mail, así que `M` vacía es exactamente "a esta fila nunca se le avisó". Por
 * eso el barrido sirve para las dos cosas: para el alta del sistema y para una
 * respuesta del formulario cuyo aviso se cayó.
 *
 * ── LO QUE REUSA, Y EL EVENTO QUE LE FABRICA ────────────────────────────────
 *
 * No duplica el armado del mensaje: instancia el mismo `NotificadorSolicitud`.
 * Para eso le fabrica el evento que esa clase espera.
 *
 * `Biblioteca.Hoja` lee cada campo así: primero `e.namedValues[<nombre>][0]` y,
 * si no está, va a la hoja —`e.range.getSheet()`— y busca la columna por su
 * encabezado con `createTextFinder`. Entonces el evento va **sin
 * `namedValues`**, para que caiga en la lectura por encabezado, que es la que
 * funciona sobre una fila que ya está escrita; con `values` para pasar la
 * guarda `if (!e || !e.values) return;`; y con `range` para que `getHoja()` y
 * `getFila()` resuelvan la fila correcta.
 *
 * NO llama a `triggerSolicitudForm`, que sería lo cómodo: esa función numera
 * primero, y estas filas **ya tienen su número**. Renumerarlas con `max + 1`
 * les cambiaría el N° de RI por uno nuevo, que es justo el desastre del
 * 09/09/2026 al revés.
 *
 * ── LAS TRES PRECAUCIONES ───────────────────────────────────────────────────
 *
 *   1. **Acotado por fecha.** Sin límite, la primera corrida le mandaría a
 *      Mantenimiento el aviso de un pedido de agosto de 2025. Medido el
 *      11/09/2026: de 1.968 filas hay 5 con `M` vacía, y tres son viejas —la 4
 *      (RI 1, del arranque), la 330 (RI 327, de diciembre de 2025) y la 3, que
 *      ni siquiera es una respuesta—. Se procesan sólo las de los últimos
 *      `DIAS` días.
 *
 *   2. **Cada fila en su propio `try/catch`, y el que falla no reintenta.**
 *      `mailPorArea` **lanza** si el área no está en la planilla de mails, así
 *      que un área sin dirección cargada cortaría la corrida y ninguna de las
 *      siguientes se avisaría. Y como el barrido vuelve cada diez minutos, un
 *      fallo que no deja rastro se reintenta para siempre. Por eso el motivo se
 *      escribe en `M`: queda a la vista de quien mira la planilla y la fila deja
 *      de entrar al barrido. Es la misma forma que `sheets_pendiente` del lado
 *      del sistema.
 *
 *   3. **Si el notificador vuelve sin escribir `M`, la marca la escribe esto.**
 *      Es la precaución más importante de todo el archivo. La idempotencia de
 *      este barrido descansa en que `M` quede escrita; si por cualquier camino
 *      el notificador manda el mail y no la escribe, la fila sigue "sin avisar"
 *      y le llega un mail **cada diez minutos, para siempre, a gente de verdad**.
 *      Un error que manda mails de más no se descubre leyendo el código: se
 *      descubre cuando alguien se queja.
 *
 * ── INSTALACIÓN ─────────────────────────────────────────────────────────────
 *
 *   1. Pegar este archivo en el proyecto de Apps Script de la planilla de
 *      respuestas (Extensiones -> Apps Script), el mismo donde están
 *      `triggerSolicitudForm` y `numerarAlEnviarElFormulario`.
 *
 *   2. **Correr `revisarPendientesDeAviso()` ANTES de crear el activador.** No
 *      manda nada: escribe en el registro (Ver -> Registros) qué filas entrarían
 *      y cuáles quedan afuera por viejas, con la antigüedad de cada una. Es la
 *      única forma de saber a quién le va a llegar un mail antes de que llegue.
 *
 *   3. Activadores (el reloj, barra izquierda) -> Añadir activador:
 *        avisarPendientesDeAviso | Head | Según el tiempo | Temporizador por minutos | Cada 10 minutos
 *      En notificaciones de error, *Notificarme inmediatamente*.
 *      Tiene que crearlo **la cuenta dueña de la planilla**: el mail sale de esa
 *      cuenta y es la que tiene acceso a la planilla de direcciones.
 *
 *   4. Al 11/09/2026 hay dos filas que el barrido tiene pendientes y que NO son
 *      viejas: la 1961 (RI 1958, "Correa B-60", de ayer) y la 1969 (RI 1959,
 *      "Modulo llave punto Kalop", el que cargó el sistema). Con `DIAS = 2` la
 *      primera entra sola en la primera corrida; la segunda queda justo al
 *      borde. Para mandar una puntual sin tocar la ventana está
 *      `avisarUnaFila(1969)`, que se corre a mano una vez.
 */

/** Cuál es la hoja de las respuestas. Si le cambian el nombre, cambiarlo acá. */
var HOJA = 'Respuestas de formulario 1';

/** En qué fila arrancan los pedidos. Las 2 y 3 ceban la vieja numeración. */
var PRIMERA_FILA = 4;

/** Marca temporal (B) y "DIRECCIÓN EMAIL ENVIADA" (M), en número de columna. */
var COL_MARCA = 2;
var COL_AVISO = 13;

/**
 * Hasta qué antigüedad se avisa, en días.
 *
 * Es el freno de mano de todo esto. Subirlo no es gratis: cada día que se suma
 * puede despertar un pedido viejo sin avisar y mandarle el mail a un área que
 * ya no lo espera. Antes de tocarlo, correr `revisarPendientesDeAviso()`.
 */
var DIAS = 2;

/**
 * El activador por tiempo: avisa de las filas recientes que nadie avisó.
 */
function avisarPendientesDeAviso() {
  var lock = LockService.getScriptLock();
  // Sin lock, dos corridas que se pisan leen las dos la misma `M` vacía y
  // mandan el mismo mail dos veces. Si otra está corriendo, esta se va: la
  // próxima pasa en diez minutos y no hay nada que apurar.
  if (!lock.tryLock(5 * 1000)) return;

  try {
    var hoja = SpreadsheetApp.getActive().getSheetByName(HOJA);
    if (!hoja) throw new Error('No encontré la hoja "' + HOJA + '".');

    var pendientes = filasSinAviso_(hoja, DIAS);
    for (var i = 0; i < pendientes.length; i++) {
      avisarFila_(hoja, pendientes[i].fila);
    }
    if (pendientes.length) Logger.log('Filas avisadas: ' + pendientes.length);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Qué filas entrarían, sin mandar nada. **Para correr antes de instalar.**
 *
 * Muestra también las que quedan afuera por viejas: son las que revelan si la
 * ventana está bien elegida, y no se ven de ninguna otra forma.
 */
function revisarPendientesDeAviso() {
  var hoja = SpreadsheetApp.getActive().getSheetByName(HOJA);
  if (!hoja) throw new Error('No encontré la hoja "' + HOJA + '".');

  var dentro = filasSinAviso_(hoja, DIAS);
  var todas = filasSinAviso_(hoja, 1e6);

  Logger.log('ENTRARÍAN (' + dentro.length + ', ventana de ' + DIAS + ' días):');
  for (var i = 0; i < dentro.length; i++) Logger.log('   ' + describir_(dentro[i]));

  Logger.log('QUEDAN AFUERA POR VIEJAS (' + (todas.length - dentro.length) + '):');
  for (var j = 0; j < todas.length; j++) {
    if (todas[j].horas <= DIAS * 24) continue;
    Logger.log('   ' + describir_(todas[j]));
  }
}

/**
 * Avisa de UNA fila, sin mirar la ventana. **Manda un mail de verdad.**
 *
 * Para las filas viejas que sí hay que avisar —una que se pasó de la ventana
 * mientras se instalaba esto, por ejemplo—. Se corre a mano desde el editor,
 * cambiando el número acá abajo.
 */
function avisarUnaFila(fila) {
  var hoja = SpreadsheetApp.getActive().getSheetByName(HOJA);
  if (!hoja) throw new Error('No encontré la hoja "' + HOJA + '".');
  if (!fila) throw new Error('Decime qué fila: avisarUnaFila(1969).');

  var yaAvisada = String(hoja.getRange(fila, COL_AVISO).getValue()).trim();
  if (yaAvisada) {
    Logger.log('La fila ' + fila + ' ya tiene aviso: ' + yaAvisada + '. No se toca.');
    return;
  }
  avisarFila_(hoja, fila);
  Logger.log('Fila ' + fila + ': ' + hoja.getRange(fila, COL_AVISO).getValue());
}

/** Las filas con marca temporal, sin `M`, de los últimos `dias` días. */
function filasSinAviso_(hoja, dias) {
  var ultima = hoja.getLastRow();
  if (ultima < PRIMERA_FILA) return [];

  var alto = ultima - PRIMERA_FILA + 1;
  var marcas = hoja.getRange(PRIMERA_FILA, COL_MARCA, alto, 1).getValues();
  var avisos = hoja.getRange(PRIMERA_FILA, COL_AVISO, alto, 1).getValues();
  var numeros = hoja.getRange(PRIMERA_FILA, 1, alto, 1).getValues();

  var ahora = new Date().getTime();
  var pendientes = [];

  for (var i = 0; i < alto; i++) {
    // `instanceof Date` y no "la celda no está vacía": la fila 3 tiene un
    // guión en la marca temporal, y una fila que no es una respuesta no puede
    // recibir un aviso.
    var marca = marcas[i][0];
    if (!(marca instanceof Date)) continue;
    if (String(avisos[i][0]).trim() !== '') continue;

    var horas = (ahora - marca.getTime()) / 36e5;
    if (horas > dias * 24) continue;

    pendientes.push({
      fila: PRIMERA_FILA + i,
      ri: numeros[i][0],
      marca: marca,
      horas: Math.round(horas),
    });
  }
  return pendientes;
}

/** Le manda el aviso a una fila y deja escrito qué pasó. */
function avisarFila_(hoja, fila) {
  var rango = hoja.getRange(fila, 1, 1, hoja.getLastColumn());
  var evento = { values: rango.getValues()[0], range: rango };

  try {
    var tr = new NotificadorSolicitud(evento);
    tr.notificarArea();
  } catch (err) {
    // El motivo va a `M` para que la fila deje de entrar al barrido. Sin esto,
    // un área sin dirección cargada se reintenta cada diez minutos para
    // siempre. Con el prefijo se distingue de una dirección de verdad, que es
    // lo que normalmente hay en esa celda.
    hoja.getRange(fila, COL_AVISO).setValue('SIN AVISO: ' + err.message);
    SpreadsheetApp.flush();
    Logger.log('Fila ' + fila + ' falló: ' + err.message);
    return;
  }

  // La red de seguridad. El notificador escribe `M` él mismo; si por algún
  // camino no lo hizo, la fila seguiría contando como "sin avisar" y le
  // llegaría un mail cada diez minutos a gente de verdad.
  if (String(hoja.getRange(fila, COL_AVISO).getValue()).trim() === '') {
    hoja.getRange(fila, COL_AVISO).setValue('AVISADO POR BARRIDO ' + new Date());
  }
  SpreadsheetApp.flush();
}

/** Una línea legible para el registro. */
function describir_(p) {
  return 'fila ' + p.fila + ' | RI ' + p.ri + ' | ' +
    Utilities.formatDate(p.marca, Session.getScriptTimeZone(), 'd/M/yyyy HH:mm') +
    ' | hace ' + p.horas + ' h';
}
