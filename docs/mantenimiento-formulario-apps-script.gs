/**
 * Apps Script de la planilla de respuestas del formulario de OT
 * ("Respuestas ORDEN DE TRABAJO", hoja "Respuestas de formulario").
 *
 * NUMERA las órdenes que entran por el formulario, para que el N° de OT deje de
 * salir de una fórmula por fila.
 *
 * ── POR QUÉ ─────────────────────────────────────────────────────────────────
 *
 * Hoy la columna A tiene, en cada fila, `=IF(B{n}:B<>"",A{n-1}+1,"")`: "el
 * número de arriba más uno". Medido el 14/10/2026: 2.198 fórmulas y **un solo
 * literal**, el 622 de la fila 2, que es la semilla de toda la serie.
 *
 * Funciona mientras nadie inserte filas, y **Google Forms inserta una por cada
 * respuesta** — justo después de su propia última respuesta, no después de la
 * última fila con datos. En el momento en que el SdG también escriba acá, las
 * dos numeraciones se pelean: el sistema numera por `max + 1` y la fórmula
 * numera por posición, y la fórmula gana en la fila que Forms inserte encima.
 *
 * No es teórico. Compras tenía esto mismo y el 09/09/2026 costó un pedido: el
 * sistema escribió un alta, entraron dos respuestas del formulario, la
 * referencia "la de arriba" se quedó apuntando a la misma celda y quedaron
 * **dos RI 1954**. La sincronización hace `upsert` por número, así que colapsó
 * los dos en uno y el pedido que había entrado por el formulario desapareció.
 * Con las OT pasaría igual: `ordenes_trabajo` tiene `ot_number` único y la
 * sincronización ya falló una vez por dos filas con el mismo número.
 *
 * Una referencia absoluta no puede significar "la de arriba" en una hoja donde
 * alguien inserta filas. Con este script el número lo decide **quien escribe la
 * fila**, contando lo que ya hay:
 *
 *   - una respuesta del formulario la numera esta función, con `max(A) + 1`;
 *   - una OT cargada en el sistema la numera el SdG, que ya lleva la serie, y
 *     la escribe como valor.
 *
 * Los dos cuentan lo mismo sobre la misma columna y ninguno tiene que adivinar
 * dónde va a insertar el otro. La serie sigue siendo una sola, y da igual en
 * qué fila física termine cada uno: el master ordena por número.
 *
 * ── INSTALACIÓN ─────────────────────────────────────────────────────────────
 *
 *   1. **CONGELAR LA COLUMNA A PRIMERO.** Seleccionar `A2:A` -> Copiar ->
 *      Pegado especial -> **Pegar sólo los valores**.
 *
 *      Sin esto el script no alcanza: las 2.198 fórmulas que quedan siguen
 *      recalculando por posición, así que la primera fila que Forms inserte en
 *      el medio recorre la cadena y renumera todo lo que haya debajo. El
 *      script le pone un valor a la fila nueva; las viejas se lo cambian solas.
 *
 *      Conviene verificar después que A2 siga diciendo 622 y la última 2783:
 *      si el pegado corrió algo, se ve ahí.
 *
 *   2. Extensiones -> Apps Script, y pegar este archivo en uno nuevo. **No
 *      reemplaza al que avisa a la app**: convive con él.
 *
 *   3. **UN SOLO ACTIVADOR, y la numeración va primero.** En
 *      `mantenimiento-apps-script.gs` ya existe `alEnviarFormulario`. Hay que
 *      agregarle la primera línea:
 *
 *        function alEnviarFormulario(e) {
 *          numerarAlEnviarElFormulario(e);   // <- ESTA, antes de avisar
 *          avisarAlaApp();
 *        }
 *
 *      Por qué así y no con un activador propio: **Google no garantiza en qué
 *      orden corren dos activadores del mismo evento**, y pueden correr en
 *      paralelo. Si el aviso saliera antes que la numeración, el SdG
 *      sincronizaría una fila sin N° de OT — y `filaDeOrden` descarta la fila
 *      que no tiene número, así que esa orden no entraría y nada lo diría.
 *
 *   4. Probar con `numerarLaUltima()` antes de confiar. Deja un número donde
 *      había una fórmula; si no corre, el problema es de autorización y no de
 *      la lógica.
 *
 * ── LO QUE ESTE SCRIPT NO HACE ──────────────────────────────────────────────
 *
 * No toca el orden físico de las filas ni intenta que el sistema escriba en un
 * lugar "correcto". No hace falta: el master apila la pestaña y ordena por N°
 * de OT, así que una fila escrita al final y una respuesta insertada en el
 * medio terminan las dos donde corresponde. Lo único que no puede desordenarse
 * es el número, y de eso se ocupa esto.
 */

/** La pestaña donde caen las respuestas y donde el SdG agrega sus altas. */
var HOJA = 'Respuestas de formulario';

/** La columna del N° de OT. A = 1. */
var COL_NRO = 1;

/**
 * La columna de la marca temporal. B = 2.
 *
 * Es lo que distingue una respuesta de verdad de una fila vacía con formato:
 * la pone Google al recibir el formulario y no se puede escribir desde afuera.
 */
var COL_MARCA = 2;

/**
 * Desde qué fila hay datos.
 *
 * La 1 es el encabezado. La 2 es la OT 622 y es **la semilla de la serie**: no
 * tiene marca temporal ni equipo, así que no nació del formulario, pero su
 * número cuenta para el máximo.
 */
var PRIMERA_FILA = 2;

function numerarAlEnviarElFormulario(e) {
  if (!e || !e.range) { return; }

  var lock = LockService.getScriptLock();
  // Treinta segundos: si otra respuesta está numerando, esperar es correcto;
  // numerar sin esperar es duplicar.
  if (!lock.tryLock(30 * 1000)) {
    throw new Error('No se pudo tomar el lock para numerar: la fila quedó sin N° de OT.');
  }

  try {
    var hoja = e.range.getSheet();
    var fila = e.range.getRow();
    if (hoja.getName() !== HOJA || fila < PRIMERA_FILA) { return; }

    hoja.getRange(fila, COL_NRO).setValue(siguienteNumero_(hoja, fila));
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

/**
 * El siguiente de la serie.
 *
 * Se **excluye la fila que se está numerando**: Sheets suele autocompletar en
 * la fila nueva la fórmula de la de arriba, así que esa celda ya trae un número
 * calculado. Contarlo daría el siguiente del siguiente y dejaría un hueco en la
 * serie en cada respuesta.
 */
function siguienteNumero_(hoja, filaQueSeEstaNumerando) {
  var ultima = hoja.getLastRow();
  if (ultima < PRIMERA_FILA) { return 1; }

  var valores = hoja
    .getRange(PRIMERA_FILA, COL_NRO, ultima - PRIMERA_FILA + 1, 1)
    .getValues();

  var maximo = 0;
  for (var i = 0; i < valores.length; i++) {
    if (PRIMERA_FILA + i === filaQueSeEstaNumerando) { continue; }

    var n = Number(valores[i][0]);
    if (!isNaN(n) && n > maximo) { maximo = n; }
  }
  return maximo + 1;
}

/**
 * Numera **todas** las filas que tengan marca temporal y no tengan número.
 *
 * Es la red cuando el activador no corrió, y hace falta más de lo que parece:
 * el 14/10/2026 quedaron **seis respuestas seguidas sin número** —las filas
 * 2166 a 2171, de 10:43 a 10:45— y ninguna existía para el sistema. El master
 * las descarta con su `WHERE Col1 IS NOT NULL` y el importador descarta la fila
 * cuyo N° de OT no es un número, así que seis órdenes de trabajo estaban sólo
 * acá y nada lo decía.
 *
 * Por qué puede pasar aunque la fórmula siga viva: **una fila que Forms agrega
 * debajo de un literal no hereda ninguna fórmula.** En cuanto el sistema (o
 * esta función) escribe un número, la cadena `A{n-1}+1` queda cortada ahí y
 * todas las respuestas siguientes nacen vacías. O sea que apenas se numera una
 * fila a mano, el activador deja de ser opcional.
 *
 * Numera en orden de fila, que en esta hoja es el orden de llegada, y cada una
 * cuenta a la anterior: así la serie no deja huecos ni repite.
 */
function numerarLasQueFaltan() {
  var hoja = SpreadsheetApp.getActive().getSheetByName(HOJA);
  if (!hoja) { throw new Error('No existe la pestaña "' + HOJA + '".'); }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    throw new Error('No se pudo tomar el lock: hay otra numeración en curso.');
  }

  try {
    var ultima = hoja.getLastRow();
    if (ultima < PRIMERA_FILA) { return; }

    var filas = ultima - PRIMERA_FILA + 1;
    var nros = hoja.getRange(PRIMERA_FILA, COL_NRO, filas, 1).getValues();
    var marcas = hoja.getRange(PRIMERA_FILA, COL_MARCA, filas, 1).getValues();

    var maximo = 0;
    for (var i = 0; i < nros.length; i++) {
      var n = Number(nros[i][0]);
      if (!isNaN(n) && n > maximo) { maximo = n; }
    }

    var numeradas = 0;
    for (var j = 0; j < nros.length; j++) {
      var tieneNumero = String(nros[j][0]).trim() !== "";
      var tieneMarca = String(marcas[j][0]).trim() !== "";
      if (tieneNumero || !tieneMarca) { continue; }

      maximo = maximo + 1;
      hoja.getRange(PRIMERA_FILA + j, COL_NRO).setValue(maximo);
      numeradas++;
    }

    SpreadsheetApp.flush();
    Logger.log(numeradas + ' fila(s) numerada(s). La serie va por ' + maximo + '.');
  } finally {
    lock.releaseLock();
  }
}

/**
 * Numera a mano la última fila que tenga marca temporal. **Para probar.**
 *
 * Separa dos preguntas que se confunden fácil cuando el número "sale bien"
 * igual:
 *
 *   - ¿está el archivo en este proyecto y la cuenta autorizada? → si esta
 *     función corre y deja un **número** donde había una fórmula, sí;
 *   - ¿está bien enganchado el activador? → eso sólo lo dice enviar el
 *     formulario de verdad.
 */
function numerarLaUltima() {
  var hoja = SpreadsheetApp.getActive().getSheetByName(HOJA);
  if (!hoja) { throw new Error('No existe la pestaña "' + HOJA + '".'); }

  var ultima = hoja.getLastRow();
  if (ultima < PRIMERA_FILA) { throw new Error('No hay filas para numerar.'); }

  var numero = siguienteNumero_(hoja, ultima);
  hoja.getRange(ultima, COL_NRO).setValue(numero);
  SpreadsheetApp.flush();
  Logger.log('Fila ' + ultima + ' numerada como ' + numero);
}
