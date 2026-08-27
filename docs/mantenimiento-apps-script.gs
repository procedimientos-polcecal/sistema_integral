/**
 * Apps Script de las planillas de Mantenimiento.
 *
 * Avisa a la app cuando cambia la planilla, para que lo nuevo aparezca sin
 * esperar al cron de los quince minutos.
 *
 * Es el **mismo archivo para las cuatro planillas**: lo único que cambia es la
 * propiedad RECURSO, que le dice a la app cuál se editó.
 *
 * Instalación, en cada planilla:
 *
 *   1. Extensiones -> Apps Script y pegar este archivo.
 *
 *   2. Configuración del proyecto -> Propiedades del script:
 *        URL_APP  = https://TU-DOMINIO/api/mantenimiento/sheets/webhook
 *        SECRETO  = el mismo valor que SHEETS_WEBHOOK_SECRET en Vercel
 *        RECURSO  = según la planilla:
 *                     AVISOS                              -> avisos
 *                     ORDEN DE TRABAJO                    -> ordenes
 *                     PEDIDO ORDEN DE SERVICIO            -> ordenes-servicio
 *                     COMPARATIVA DE PROVEEDORES MANT.    -> comparativas
 *
 *      Si RECURSO queda vacío la app sincroniza las cuatro. Anda igual, sólo
 *      tarda unos segundos más.
 *
 *   3. Activadores -> Añadir activador:
 *        alEditar | De la hoja de cálculo -> Al editar
 *
 *      Tiene que ser un activador **instalable** (los que se crean desde este
 *      menú). Un activador simple —una función llamada onEdit— no puede hacer
 *      llamadas externas y falla en silencio.
 *
 * Dos cosas que conviene saber:
 *
 *   - En la planilla de **órdenes de servicio** las OS entran por un formulario
 *     de Google que vive en OTRA planilla, y llegan acá por IMPORTRANGE. Eso no
 *     dispara "Al editar", así que las OS nuevas las va a traer el cron. Si se
 *     quiere que lleguen al toque, hay que instalar este mismo script en la
 *     planilla de respuestas del formulario, con el activador "Al enviarse el
 *     formulario" y RECURSO = ordenes-servicio.
 *
 *   - No se manda el contenido de la celda: sólo el aviso de que hubo un
 *     cambio, y la app relee la planilla. Así el secreto es lo único que viaja.
 */

// Espera este tiempo antes de avisar, para no disparar una llamada por tecla.
var ESPERA_MS = 30 * 1000;

/** Activador de "Al editar": alguien tocó una celda a mano. */
function alEditar(e) {
  var props = PropertiesService.getScriptProperties();
  var ahora = Date.now();
  var ultimo = Number(props.getProperty('ULTIMO_AVISO') || 0);

  if (ahora - ultimo < ESPERA_MS) return;
  props.setProperty('ULTIMO_AVISO', String(ahora));

  avisarAlaApp();
}

/**
 * Activador de "Al enviarse el formulario".
 *
 * Sólo hace falta en la planilla de respuestas del formulario de órdenes de
 * servicio. Es la misma acción que alEditar, pero va aparte para que en la
 * lista de activadores se entienda cuál cubre cada caso.
 */
function alEnviarFormulario(e) {
  alEditar(e);
}

function avisarAlaApp() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('URL_APP');
  var secreto = props.getProperty('SECRETO');
  var recurso = props.getProperty('RECURSO');

  if (!url || !secreto) {
    Logger.log('Faltan las propiedades URL_APP o SECRETO');
    return;
  }

  if (recurso) {
    url += (url.indexOf('?') === -1 ? '?' : '&') + 'recurso=' + encodeURIComponent(recurso);
  }

  try {
    var respuesta = UrlFetchApp.fetch(url, {
      method: 'post',
      headers: { 'x-webhook-secret': secreto },
      muteHttpExceptions: true,
    });
    Logger.log('Sincronización: ' + respuesta.getResponseCode() + ' ' + respuesta.getContentText());
  } catch (error) {
    Logger.log('Error al avisar a la app: ' + error);
  }
}

/** Para probar la conexión a mano desde el editor de Apps Script. */
function probar() {
  avisarAlaApp();
}
