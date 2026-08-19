/**
 * Apps Script de la planilla "PEDIDOS DE COMPRA".
 *
 * Avisa a la app cuando alguien edita la planilla, para que los RI nuevos
 * aparezcan sin esperar al cron de cada 2 horas.
 *
 * Instalación:
 *   1. En la planilla: Extensiones -> Apps Script y pegar este archivo.
 *   2. Configuración del proyecto -> Propiedades del script, agregar:
 *        URL_APP  = https://TU-DOMINIO/api/compras/sheets/webhook
 *        SECRETO  = el mismo valor que SHEETS_WEBHOOK_SECRET en Vercel
 *   3. Activadores -> Añadir activador:
 *        función: alEditar | evento: De la hoja de cálculo -> Al editar
 *
 * No manda el contenido de la celda: sólo avisa que hubo un cambio y la app
 * relee la planilla. Así el secreto es lo único que viaja.
 */

// Espera este tiempo antes de avisar, para no disparar una llamada por tecla.
var ESPERA_MS = 30 * 1000;

function alEditar(e) {
  var props = PropertiesService.getScriptProperties();
  var ahora = Date.now();
  var ultimo = Number(props.getProperty('ULTIMO_AVISO') || 0);

  if (ahora - ultimo < ESPERA_MS) return;
  props.setProperty('ULTIMO_AVISO', String(ahora));

  avisarAlaApp();
}

function avisarAlaApp() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('URL_APP');
  var secreto = props.getProperty('SECRETO');

  if (!url || !secreto) {
    Logger.log('Faltan las propiedades URL_APP o SECRETO');
    return;
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
