/**
 * Apps Script de la casilla que recibe las facturas.
 *
 * Le manda al SdG los adjuntos que llegaron por mail, para que aparezcan en el
 * buzón de Facturación como "esperando que las cargues". No lee el QR ni crea
 * nada: sólo acerca el archivo. El QR lo lee el navegador de quien carga, que
 * es lo que llevó la lectura automática al 98%.
 *
 * ## Por qué un script acá y no que el servidor lea el buzón
 *
 * Se probó: la cuenta de servicio del SdG pide un token de Gmail haciéndose
 * pasar por un usuario del dominio y Google contesta `unauthorized_client`,
 * porque la delegación a nivel dominio no está otorgada. Otorgarla es una
 * acción de un admin de Workspace y le daría al sistema permiso de leer
 * **cualquier** buzón. Este script lo instala el dueño de la casilla y sólo ve
 * esa — además de ser el mismo patrón que ya usan la planilla de Compras, la
 * de Mantenimiento y el formulario.
 *
 * ## Instalación
 *
 *   1. En la casilla que recibe las facturas: script.google.com -> Nuevo
 *      proyecto, y pegar este archivo.
 *   2. Configuración del proyecto -> Propiedades del script:
 *        URL_APP  = https://TU-DOMINIO/api/facturacion/correo/webhook
 *        SECRETO  = el mismo valor que FACTURACION_CORREO_SECRET en Vercel
 *        BUSQUEDA = (opcional) la búsqueda de Gmail; por defecto la de abajo
 *   3. Activadores -> Añadir activador:
 *        revisarElCorreo | Basado en tiempo | Cada 15 minutos
 *   4. Correr `revisarElCorreo` una vez a mano para aceptar los permisos.
 *
 * ## Cómo evita traer dos veces lo mismo
 *
 * Con una etiqueta. Lo que ya mandó queda con `SdG/cargado` y la búsqueda la
 * excluye, así que en la corrida siguiente ni lo mira — que es lo que evita
 * subir el mismo PDF cada quince minutos. Del lado del SdG hay además un
 * UNIQUE por (mensaje, adjunto): si la etiqueta no se llegó a escribir, el
 * webhook lo cuenta como repetido y no duplica.
 *
 * Para reprocesar un mail, sacarle la etiqueta `SdG/cargado` a mano.
 */

/**
 * Qué mensajes mirar. Se puede cambiar por Propiedades del script.
 *
 * Es a propósito **ancha**: todos los mails con adjunto, no una etiqueta ni un
 * remitente. Quién es una factura **no lo decide esta búsqueda** — lo decide el
 * SdG leyendo el texto del PDF, que es donde está el dato bueno: una factura
 * nuestra lleva el CUIT de Polcecal o de Polysan y dice ser un comprobante.
 * Medido sobre los 336 PDF de la carpeta de facturas, 316 (94%) se reconocen
 * así, y los 20 que no son escaneos sin capa de texto, que entran igual
 * marcados como "sin confirmar".
 *
 * Qué hace cada parte:
 *
 *   has:attachment        sin adjunto no hay nada que traer.
 *   -in:sent              lo que mandamos nosotros no es una factura que nos
 *                         hagan: presupuestos reenviados, órdenes de compra.
 *   -label:SdG/cargado    lo ya procesado. Es lo que evita subir el mismo PDF
 *                         cada quince minutos.
 *   newer_than:30d        un techo para la primera corrida. Sin esto, el script
 *                         barrería años de correo y la bandeja arrancaría con
 *                         cientos de facturas viejas ya cargadas a mano.
 *
 * Para traer más historia una vez, cambiar a `newer_than:90d`, dejar que corra,
 * y volver a 30. Para una casilla dedicada sólo a facturas, se puede sacar
 * `-in:sent` y agrandar `newer_than`.
 */
var BUSQUEDA_POR_DEFECTO = 'has:attachment -in:sent -label:SdG/cargado newer_than:30d';

/** La etiqueta que marca lo ya mandado. */
var ETIQUETA = 'SdG/cargado';

/**
 * Cuántos mensajes por corrida.
 *
 * Apps Script corta una ejecución a los 6 minutos y `UrlFetch` tiene un tope
 * por llamada, así que se manda de a poco y seguido. Con un activador cada 15
 * minutos, diez por corrida son muchísimo más de lo que entra: son ~19
 * facturas por día.
 */
var POR_CORRIDA = 10;

/** Más que esto no entra en el bucket del SdG, así que no se manda. */
var MAXIMO_BYTES = 20 * 1024 * 1024;

function revisarElCorreo() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('URL_APP');
  var secreto = props.getProperty('SECRETO');
  var busqueda = props.getProperty('BUSQUEDA') || BUSQUEDA_POR_DEFECTO;

  if (!url || !secreto) {
    throw new Error('Faltan URL_APP o SECRETO en las propiedades del script.');
  }

  var etiqueta = GmailApp.getUserLabelByName(ETIQUETA) || GmailApp.createLabel(ETIQUETA);
  var hilos = GmailApp.search(busqueda, 0, POR_CORRIDA);
  if (!hilos.length) return;

  var mensajes = [];
  var procesados = [];

  for (var h = 0; h < hilos.length; h++) {
    var deEsteHilo = hilos[h].getMessages();

    for (var m = 0; m < deEsteHilo.length; m++) {
      var mensaje = deEsteHilo[m];
      var adjuntos = [];

      /*
       * `getAttachments` sin opciones ya deja afuera las imágenes embebidas en
       * el cuerpo del HTML, que son la mayoría de los logos de las firmas.
       *
       * De lo que pasa, **acá no se decide nada**: el SdG descarta por tamaño
       * lo que es decorativo y por el texto del PDF lo que no es una factura
       * nuestra. Se manda y allá se resuelve, en un solo lugar y con tests —si
       * la regla se dividiera entre el script y el servidor, en algún momento
       * las dos mitades dirían cosas distintas.
       */
      var archivos = mensaje.getAttachments();

      for (var a = 0; a < archivos.length; a++) {
        var archivo = archivos[a];
        if (archivo.getSize() > MAXIMO_BYTES) continue;

        adjuntos.push({
          nombre: archivo.getName(),
          tipo: archivo.getContentType(),
          contenido: Utilities.base64Encode(archivo.getBytes()),
        });
      }

      if (!adjuntos.length) continue;

      mensajes.push({
        id: mensaje.getId(),
        remitente: mensaje.getFrom(),
        asunto: mensaje.getSubject(),
        fecha: mensaje.getDate().toISOString(),
        adjuntos: adjuntos,
      });
    }

    procesados.push(hilos[h]);
  }

  if (!mensajes.length) {
    // Igual se etiqueta: un hilo con adjuntos que no sirven no tiene que
    // volver a mirarse en cada corrida.
    for (var p = 0; p < procesados.length; p++) procesados[p].addLabel(etiqueta);
    return;
  }

  var respuesta = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-webhook-secret': secreto },
    payload: JSON.stringify({ mensajes: mensajes }),
    muteHttpExceptions: true,
  });

  var codigo = respuesta.getResponseCode();

  /*
   * La etiqueta se pone **sólo si el SdG contestó que sí**. Al revés, un error
   * del servidor dejaría el mail marcado como cargado y esa factura no se
   * cargaría nunca — y nadie se enteraría, que es la peor forma de fallar.
   */
  if (codigo < 200 || codigo >= 300) {
    throw new Error('El SdG contestó ' + codigo + ': ' + respuesta.getContentText().slice(0, 300));
  }

  for (var i = 0; i < procesados.length; i++) procesados[i].addLabel(etiqueta);
}
