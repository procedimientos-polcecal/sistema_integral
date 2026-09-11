/**
 * Apps Script de la planilla de respuestas del formulario
 * ("FORM PEDIDO DE COMPRA POLCECAL - POLYSAN", hoja "Respuestas de formulario 1").
 *
 * NUMERA los pedidos que entran por el formulario, para que el N° de RI deje de
 * salir de una fórmula por fila.
 *
 * ── POR QUÉ ─────────────────────────────────────────────────────────────────
 *
 * Hasta ahora la columna A tenía, en cada fila, `=IF(B{n}:B<>"",A{n-1}+1,"")`:
 * "el número de arriba más uno". Funciona mientras nadie inserte filas, y
 * **Google Forms inserta una por cada respuesta** — justo después de su propia
 * última respuesta, no después de la última fila con datos.
 *
 * El 09/09/2026 eso costó un pedido. El sistema escribió un alta en la fila
 * 1957; entraron dos respuestas del formulario y su fila quedó en la 1959. La
 * referencia `B` bajó con ella; la referencia `A1956` —que quería decir "la de
 * arriba"— se quedó apuntando a la misma celda. Volvió a calcular `A1956+1` y
 * quedaron **dos RI 1954**. La sincronización hace `upsert` por N° de RI, así
 * que colapsó los dos en uno y el pedido que había entrado por el formulario
 * —"Buje de goma de acoplamiento eje molino calera"— desapareció del sistema.
 *
 * Una referencia absoluta no puede significar "la de arriba" en una hoja donde
 * alguien inserta filas. Con este script el número lo decide **quien escribe la
 * fila**, contando lo que ya hay:
 *
 *   - una respuesta del formulario la numera esta función, con `max(A) + 1`;
 *   - un pedido cargado en el sistema la numera el SdG, que ya lleva la serie,
 *     y la escribe como valor.
 *
 * Los dos cuentan lo mismo y ninguno tiene que adivinar dónde va a insertar el
 * otro. La serie sigue siendo una sola.
 *
 * ── INSTALACIÓN ─────────────────────────────────────────────────────────────
 *
 *   1. En la planilla de respuestas: Extensiones -> Apps Script, y pegar esto
 *      en un archivo nuevo. No reemplaza al notificador de mails: convive.
 *
 *   2. **UN SOLO ACTIVADOR, y la numeración va primero.** En el script del
 *      notificador, agregar la primera línea de `triggerSolicitudForm`:
 *
 *        function triggerSolicitudForm(e) {
 *          if (!e || !e.values) { return; }
 *          numerarAlEnviarElFormulario(e);   // <- ESTA, antes de notificar
 *          const tr = new NotificadorSolicitud(e);
 *          tr.notificarArea();
 *        }
 *
 *      **Las llaves del `return` no son decoración: ya fallaron sin ellas.** La
 *      instrucción decía "agregá esta línea" y la línea terminó pegada entre el
 *      `if (!e || !e.values)` y el `return;`. Con el `if` sin llaves, la
 *      llamada a numerar pasó a ser su cuerpo —corría sólo con el evento
 *      vacío, o sea nunca— y el `return` quedó incondicional, cortando la
 *      función antes de `notificarArea()`. Resultado: dejó de numerar **y**
 *      dejaron de salir los mails, sin un solo error en el registro de
 *      ejecuciones, porque la función terminaba bien; nada más que terminaba
 *      enseguida. Con las llaves, la línea mal ubicada no puede hacer eso.
 *
 *      Por qué así y no con un activador propio: **Google no garantiza en qué
 *      orden corren dos activadores del mismo evento**, y pueden correr en
 *      paralelo. El notificador lee el N° de RI de la columna A para el asunto
 *      del mail ("Solicitud de compra: N°RI 1956"), así que si corriera antes
 *      que la numeración el mail saldría con el número equivocado o vacío.
 *      Llamándola desde adentro, el orden es el que se lee.
 *
 *      Si el notificador falla —`mailPorArea` lanza cuando el área no tiene
 *      dirección cargada—, el número ya está escrito: numerar primero también
 *      protege de eso.
 *
 *   3. Si NO tenés el notificador instalado en esa planilla, entonces sí hace
 *      falta un activador propio: Activadores -> Añadir activador,
 *        numerarAlEnviarElFormulario | De la hoja de cálculo -> Al enviarse el formulario
 *      Tiene que ser **instalable** (creado desde ese menú). Un activador simple
 *      no existe para el envío de formulario.
 *
 *   4. Probarlo: mandar una respuesta por el formulario y confirmar que la
 *      columna A de la fila nueva quedó con un **número**, no con una fórmula
 *      —se ve en la barra de fórmulas—, y que es el siguiente de la serie.
 *
 * ── QUÉ NO HACE ─────────────────────────────────────────────────────────────
 *
 * No toca las filas que ya están: sus fórmulas siguen ahí y siguen dando el
 * número correcto. Si algún día alguien inserta una fila **en el medio** del
 * bloque de respuestas, esas fórmulas se corren igual que se corrió la del
 * alta; `congelarNumeracion()`, al final de este archivo, las convierte en
 * valores de una vez. Es opcional y se corre **una sola vez**.
 */

/** Cuál es la hoja de las respuestas. Si le cambian el nombre, cambiarlo acá. */
var HOJA = 'Respuestas de formulario 1';

/** En qué fila arrancan los pedidos. Las 2 y 3 ceban la vieja numeración. */
var PRIMERA_FILA = 4;

/** Columna del N° de RI (A) y de la marca temporal (B), en número. */
var COL_NRO = 1;
var COL_MARCA = 2;

/**
 * Activador de "Al enviarse el formulario": le pone el número a la fila nueva.
 *
 * Va con `LockService` porque dos respuestas simultáneas leerían el mismo
 * máximo y se llevarían el mismo número — que es exactamente el problema que
 * este script viene a resolver, y sería absurdo reintroducirlo acá.
 */
function numerarAlEnviarElFormulario(e) {
  if (!e || !e.range) return;

  var lock = LockService.getScriptLock();
  // Treinta segundos: si otra respuesta está numerando, esperar es correcto;
  // numerar sin esperar es duplicar.
  if (!lock.tryLock(30 * 1000)) {
    throw new Error('No se pudo tomar el lock para numerar: la fila quedó sin N° de RI.');
  }

  try {
    var hoja = e.range.getSheet();
    var fila = e.range.getRow();
    if (hoja.getName() !== HOJA || fila < PRIMERA_FILA) return;

    var celda = hoja.getRange(fila, COL_NRO);
    celda.setValue(siguienteNumero_(hoja, fila));
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

/**
 * El siguiente número de la serie, mirando la columna entera.
 *
 * Se **excluye la fila que se está numerando**: Sheets suele autocompletar en
 * la fila nueva la fórmula de la de arriba, así que esa celda ya trae un número
 * calculado. Contarlo daría el siguiente del siguiente y dejaría un hueco en la
 * serie en cada respuesta.
 */
function siguienteNumero_(hoja, filaQueSeEstaNumerando) {
  var ultima = hoja.getLastRow();
  if (ultima < PRIMERA_FILA) return 1;

  var valores = hoja
    .getRange(PRIMERA_FILA, COL_NRO, ultima - PRIMERA_FILA + 1, 1)
    .getValues();

  var maximo = 0;
  for (var i = 0; i < valores.length; i++) {
    var fila = PRIMERA_FILA + i;
    if (fila === filaQueSeEstaNumerando) continue;

    var n = Number(valores[i][0]);
    if (!isNaN(n) && n > maximo) maximo = n;
  }
  return maximo + 1;
}

/**
 * Numera a mano la última fila que tenga marca temporal. **Para probar.**
 *
 * Sirve para separar dos preguntas que se confunden fácil cuando el número
 * "sale bien" igual:
 *
 *   - ¿está el archivo en este proyecto y la cuenta autorizada? → si esta
 *     función corre y deja un **número** donde había una fórmula, sí;
 *   - ¿está enganchada al envío del formulario? → eso sólo lo prueba una
 *     respuesta de verdad, mirando si la celda quedó con un número.
 *
 * Que la columna A muestre el número correcto no alcanza como prueba: la
 * fórmula vieja también lo muestra, y es justamente la que se quiere reemplazar.
 * Lo que hay que mirar es la barra de fórmulas.
 *
 * Se puede correr las veces que se quiera: escribe el mismo número que ya
 * estaba, sólo que como valor.
 */
function numerarUltimaFila() {
  var hoja = SpreadsheetApp.getActive().getSheetByName(HOJA);
  if (!hoja) throw new Error('No encontré la hoja "' + HOJA + '".');

  var ultima = hoja.getLastRow();
  var marcas = hoja
    .getRange(PRIMERA_FILA, COL_MARCA, ultima - PRIMERA_FILA + 1, 1)
    .getValues();

  var fila = 0;
  for (var i = marcas.length - 1; i >= 0; i--) {
    if (String(marcas[i][0]).trim() !== '') { fila = PRIMERA_FILA + i; break; }
  }
  if (!fila) throw new Error('No encontré ninguna fila con marca temporal.');

  var antes = hoja.getRange(fila, COL_NRO).getFormula();
  var n = siguienteNumero_(hoja, fila);
  hoja.getRange(fila, COL_NRO).setValue(n);
  SpreadsheetApp.flush();

  Logger.log(
    'Fila ' + fila + ': ' + (antes ? 'tenía la fórmula ' + antes : 'no tenía fórmula') +
    ' y ahora tiene el valor ' + n + '.'
  );
}

/**
 * Convierte en valores las fórmulas de la columna A que todavía queden.
 *
 * OPCIONAL y **de una sola vez**. Deja la numeración existente inmune a que
 * alguien inserte una fila en el medio: hoy, una inserción ahí corre las
 * fórmulas de abajo y las hace calcular contra la celda equivocada, que es cómo
 * se perdió un pedido el 09/09/2026.
 *
 * No cambia ningún número: escribe el que la fórmula ya está mostrando. Aun
 * así, conviene sacarle una copia a la planilla antes (Archivo -> Hacer una
 * copia): son ~1.955 celdas de producción y no hay vuelta atrás.
 */
function congelarNumeracion() {
  var hoja = SpreadsheetApp.getActive().getSheetByName(HOJA);
  if (!hoja) throw new Error('No encontré la hoja "' + HOJA + '".');

  var ultima = hoja.getLastRow();
  var rango = hoja.getRange(PRIMERA_FILA, COL_NRO, ultima - PRIMERA_FILA + 1, 1);

  var formulas = rango.getFormulas();
  var mostrados = rango.getValues();
  var marcas = hoja
    .getRange(PRIMERA_FILA, COL_MARCA, ultima - PRIMERA_FILA + 1, 1)
    .getValues();

  var congeladas = 0;
  for (var i = 0; i < formulas.length; i++) {
    if (!formulas[i][0]) continue;

    // Una fila sin marca temporal no es un pedido: su fórmula da "" y ahí se
    // deja la fórmula, que es lo que va a numerar cuando llegue la respuesta.
    if (String(marcas[i][0]).trim() === '') continue;

    var n = Number(mostrados[i][0]);
    if (isNaN(n) || n <= 0) continue;

    hoja.getRange(PRIMERA_FILA + i, COL_NRO).setValue(n);
    congeladas++;
  }

  SpreadsheetApp.flush();
  Logger.log('Números congelados: ' + congeladas);
}
