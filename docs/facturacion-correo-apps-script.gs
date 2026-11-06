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
 *      **Hay que apretar "Guardar propiedades de la secuencia de comandos"**:
 *      escribirlas y volver al editor no las guarda.
 *   3. Correr `revisarLasPropiedades` y mirar el registro de ejecuciones. Tiene
 *      que listar URL_APP y SECRETO; si dice "(ninguna)", se guardaron en otro
 *      proyecto o no se guardaron.
 *   4. Activadores -> Añadir activador:
 *        revisarElCorreo | Basado en tiempo | Cada 15 minutos
 *   5. Correr `revisarElCorreo` una vez a mano para aceptar los permisos.
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

/**
 * Qué versión de este archivo está pegada en el editor.
 *
 * Suena a burocracia y no lo es: este script vive **fuera del repo**, en un
 * proyecto de Apps Script que se actualiza a mano pegando el archivo entero.
 * Cuando algo falla, la primera pregunta —"¿está puesta la última versión?"—
 * no se podía contestar con nada, y eso costó una vuelta entera el 16/10/2026:
 * el mismo 413 podía ser un arreglo que no estaba puesto o un agujero nuevo, y
 * no había forma de distinguirlos desde afuera. Ahora el número viaja en cada
 * POST y aparece en todos los errores.
 */
var VERSION = '2026-10-16';

/**
 * Cuánto base64 entra en un POST, **medido y no estimado**.
 *
 * El tope no lo pone el SdG sino **Vercel: 4,5 MB por request**, y no se puede
 * subir desde el código. Pasarse da un `413 FUNCTION_PAYLOAD_TOO_LARGE`.
 *
 * Las dos versiones anteriores contaban **bytes crudos** y multiplicaban por
 * 4/3 de cabeza para estimar el cuerpo. Las dos se pasaron igual —el 07/10 y
 * el 13/10—, así que el problema no era el número sino **contar una cosa para
 * predecir otra**. Esto cuenta directamente lo que viaja: `contenido.length`
 * es exactamente la cantidad de caracteres base64 que van en el JSON.
 *
 * El margen que queda —unos 600 KB— es para el asunto, el remitente, los
 * nombres de archivo y las llaves. Y si aun así se pasa, está la red de abajo.
 */
var MAXIMO_CUERPO = 3900000;

/**
 * Cuánto puede pesar **un adjunto**, en bytes crudos.
 *
 * Acá el valor crudo sí sirve, porque es un filtro previo: se usa para no
 * molestarse en leer un archivo que no va a entrar en ningún POST. Es
 * deliberadamente holgado; quien decide de verdad es `MAXIMO_CUERPO`, sobre el
 * base64 ya calculado.
 */
var MAXIMO_BYTES = 3 * 1024 * 1024;

/** Saca los espacios de los costados. Apps Script no tiene `String.trim` viejo. */
function limpiar(valor) {
  return valor ? valor.replace(/^\s+|\s+$/g, '') : '';
}

/**
 * Qué ve el script. Correr esto cuando algo no cierra.
 *
 * No imprime el secreto —queda en el registro de ejecuciones, que lo ve
 * cualquiera con acceso al proyecto—, sólo si está y cuánto mide: con eso
 * alcanza para distinguir "no lo cargué" de "lo cargué con un espacio al final"
 * de "lo cargué en otro proyecto".
 */
function revisarLasPropiedades() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var claves = Object.keys(props);

  Logger.log('Version de este script: ' + VERSION);
  Logger.log('Propiedades cargadas en ESTE proyecto: ' + (claves.length ? claves.join(', ') : '(ninguna)'));

  ['URL_APP', 'SECRETO', 'BUSQUEDA'].forEach(function (clave) {
    var valor = props[clave];
    if (valor === undefined) {
      Logger.log(clave + ': NO ESTÁ');
      return;
    }
    var limpio = valor.replace(/^\s+|\s+$/g, '');
    Logger.log(
      clave + ': ' + limpio.length + ' caracteres' +
      (limpio.length !== valor.length ? ' — OJO, tiene espacios alrededor' : '') +
      (clave === 'SECRETO' ? '' : ' — ' + limpio)
    );
  });
}

function revisarElCorreo() {
  var props = PropertiesService.getScriptProperties();
  /*
   * Con `trim`: copiar y pegar desde Vercel arrastra un espacio o un salto de
   * línea más veces de las que uno creería, y un secreto con un espacio al
   * final da un 401 que no se parece en nada a su causa.
   */
  var url = limpiar(props.getProperty('URL_APP'));
  var secreto = limpiar(props.getProperty('SECRETO'));
  var busqueda = limpiar(props.getProperty('BUSQUEDA')) || BUSQUEDA_POR_DEFECTO;

  /*
   * El mensaje dice **cuál** falta y **qué sí hay**. Decir sólo "faltan
   * URL_APP o SECRETO" obliga a adivinar entre tres cosas distintas: que no se
   * cargó, que se cargó con otro nombre, o que se cargó en otro proyecto de
   * Apps Script. Las tres se ven de una con la lista de claves.
   */
  if (!url || !secreto) {
    var faltan = [];
    if (!url) faltan.push('URL_APP');
    if (!secreto) faltan.push('SECRETO');

    var hay = Object.keys(PropertiesService.getScriptProperties().getProperties());

    throw new Error(
      'Falta ' + faltan.join(' y ') + ' en las propiedades del script. ' +
      'Lo que hay cargado en este proyecto es: ' +
      (hay.length ? hay.join(', ') : '(ninguna propiedad)') + '. ' +
      'Se cargan en Configuración del proyecto -> Propiedades de la secuencia ' +
      'de comandos, y hay que apretar Guardar; los nombres van en mayúsculas y ' +
      'sin espacios.'
    );
  }

  var etiqueta = GmailApp.getUserLabelByName(ETIQUETA) || GmailApp.createLabel(ETIQUETA);
  var hilos = GmailApp.search(busqueda, 0, POR_CORRIDA);
  if (!hilos.length) return;

  var muyGrandes = [];

  /*
   * **Un hilo por vez, y se etiqueta apenas entró.**
   *
   * Antes se juntaban los diez hilos en un solo POST, y eso fallaba de dos
   * formas a la vez: el cuerpo se pasaba del tope de Vercel, y si algo fallaba
   * no entraba ninguno aunque nueve estuvieran bien. Así, lo que entró queda
   * etiquetado y la corrida siguiente arranca donde quedó ésta.
   */
  for (var h = 0; h < hilos.length; h++) {
    var mensajes = mensajesDelHilo(hilos[h], muyGrandes);
    if (mensajes.length) enviarPorTandas(url, secreto, mensajes, muyGrandes);

    // Los hilos sin nada que mandar se etiquetan igual: un hilo con adjuntos
    // que no sirven no tiene que volver a mirarse en cada corrida.
    hilos[h].addLabel(etiqueta);
  }

  /*
   * Lo que no entra no se pierde en silencio: se avisa.
   *
   * El aviso va **después** de etiquetar, a propósito. Si cortara antes, ese
   * hilo volvería en cada corrida y mandaría un mail de error cada quince
   * minutos para siempre, que termina siendo lo mismo que no avisar. Así se
   * avisa una vez, con el nombre del archivo y de quién lo mandó, y esa
   * factura se carga a mano desde el mail.
   */
  if (muyGrandes.length) {
    /*
     * El motivo lo trae cada entrada y no este mensaje, porque hay dos causas
     * distintas: el filtro previo por tamaño del archivo, y el servidor
     * rechazando uno que ya iba solo. Decir "pesan más de 3 MB" para las dos
     * era mentira en la segunda — y era mi propio texto el que la decía.
     */
    throw new Error(
      'Entró todo lo demás, pero ' + muyGrandes.length + ' adjunto(s) no se ' +
      'pudieron mandar (el tope es de Vercel, no del SdG). Hay que cargarlos a ' +
      'mano desde el mail (script ' + VERSION + '): ' + muyGrandes.join(' · ')
    );
  }
}

/**
 * Los mensajes de un hilo, con sus adjuntos en base64.
 *
 * `getAttachments` sin opciones ya deja afuera las imágenes embebidas en el
 * cuerpo del HTML, que son la mayoría de los logos de las firmas.
 *
 * De lo que pasa, **acá no se decide nada**: el SdG descarta por tamaño lo que
 * es decorativo y por el texto del PDF lo que no es una factura nuestra. Se
 * manda y allá se resuelve, en un solo lugar y con tests —si la regla se
 * dividiera entre el script y el servidor, en algún momento las dos mitades
 * dirían cosas distintas—. Lo único que se decide acá es lo que **no entra en
 * un POST**, que no es un criterio sino un límite físico.
 */
function mensajesDelHilo(hilo, muyGrandes) {
  var mensajes = [];
  var deEsteHilo = hilo.getMessages();

  for (var m = 0; m < deEsteHilo.length; m++) {
    var mensaje = deEsteHilo[m];
    var adjuntos = [];
    var archivos = mensaje.getAttachments();

    for (var a = 0; a < archivos.length; a++) {
      var archivo = archivos[a];

      if (archivo.getSize() > MAXIMO_BYTES) {
        muyGrandes.push(
          archivo.getName() + ' (' + Math.round(archivo.getSize() / (1024 * 1024)) +
          ' MB, de ' + mensaje.getFrom() + '): más grande que el tope por adjunto'
        );
        continue;
      }

      adjuntos.push({
        nombre: archivo.getName(),
        tipo: archivo.getContentType(),
        contenido: Utilities.base64Encode(archivo.getBytes()),
        bytes: archivo.getSize(),
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

  return mensajes;
}

/**
 * Manda los adjuntos en varios POST, para no pasarse del tope de Vercel.
 *
 * Se corta por **base64 acumulado** —`contenido.length`, que es exactamente lo
 * que viaja— y no por cantidad ni por bytes crudos. Diez mails livianos entran
 * juntos; un escaneo grande va solo.
 *
 * ## La unidad es el adjunto, no el mensaje
 *
 * La primera versión cortaba por mensaje y **nunca partía uno**, con el
 * argumento de que sus adjuntos tenían que viajar juntos para que el UNIQUE
 * por (mensaje, adjunto) del SdG siguiera valiendo. Ese argumento estaba mal:
 * la clave es el par, así que cada adjunto es una fila independiente y mandar
 * la mitad en un POST y la otra mitad en el siguiente da el mismo resultado.
 *
 * El mismo mensaje puede aparecer en dos tandas, cada vez con los adjuntos que
 * le tocaron y repitiendo su cabecera.
 */
function enviarPorTandas(url, secreto, mensajes, muyGrandes) {
  var tanda = [];
  var acumulado = 0;

  for (var i = 0; i < mensajes.length; i++) {
    var mensaje = mensajes[i];

    for (var a = 0; a < mensaje.adjuntos.length; a++) {
      var adjunto = mensaje.adjuntos[a];
      var pesa = adjunto.contenido.length;

      if (tanda.length && acumulado + pesa > MAXIMO_CUERPO) {
        enviarPartiendoSiHaceFalta(url, secreto, tanda, muyGrandes);
        tanda = [];
        acumulado = 0;
      }

      var ultimo = tanda.length ? tanda[tanda.length - 1] : null;
      if (!ultimo || ultimo.id !== mensaje.id) {
        ultimo = {
          id: mensaje.id,
          remitente: mensaje.remitente,
          asunto: mensaje.asunto,
          fecha: mensaje.fecha,
          adjuntos: [],
        };
        tanda.push(ultimo);
      }

      ultimo.adjuntos.push(adjunto);
      acumulado += pesa;
    }
  }

  if (tanda.length) enviarPartiendoSiHaceFalta(url, secreto, tanda, muyGrandes);
}

/**
 * Manda una tanda y, **si el servidor igual dice 413, la parte al medio**.
 *
 * Ésta es la parte que importa, y existe porque el cálculo de arriba ya falló
 * dos veces: el 07/10/2026 y el 13/10/2026, las dos con un número que parecía
 * bien calculado. Un tope elegido a mano es una predicción sobre lo que el
 * otro lado va a aceptar; un 413 es el otro lado diciendo qué acepta de
 * verdad. **Cuando los dos no coinciden, gana el 413.**
 *
 * Partir al medio y reintentar convierte el tope en una pista: si está bien,
 * esto nunca corre; si quedó corto, la corrida se acomoda sola en vez de
 * fallar y dejar el correo sin entrar. Y cuando ya no se puede partir —un solo
 * adjunto que el servidor no acepta— se informa ese adjunto y **sigue con el
 * resto**, en vez de tirar la corrida entera por un archivo.
 */
function enviarPartiendoSiHaceFalta(url, secreto, tanda, muyGrandes) {
  var r = enviar(url, secreto, tanda);
  if (r.ok) return;

  if (r.codigo !== 413) {
    throw new Error(
      'El SdG contestó ' + r.codigo + ' (script ' + VERSION + '): ' + r.texto.slice(0, 300)
    );
  }

  if (contarAdjuntos(tanda) <= 1) {
    var solo = tanda[0].adjuntos[0];
    muyGrandes.push(
      solo.nombre + ' (' + Math.round(solo.contenido.length / (1024 * 1024)) +
      ' MB ya codificado, de ' + tanda[0].remitente + '): el servidor lo rechazó por tamaño'
    );
    return;
  }

  var mitades = partirAlMedio(tanda);
  enviarPartiendoSiHaceFalta(url, secreto, mitades[0], muyGrandes);
  enviarPartiendoSiHaceFalta(url, secreto, mitades[1], muyGrandes);
}

/** Cuántos adjuntos hay en una tanda, sumando los de todos sus mensajes. */
function contarAdjuntos(tanda) {
  var n = 0;
  for (var i = 0; i < tanda.length; i++) n += tanda[i].adjuntos.length;
  return n;
}

/**
 * Parte una tanda en dos, por **adjunto** y no por mensaje.
 *
 * Por mensaje no alcanzaría: una tanda de un solo mensaje con cuatro adjuntos
 * no se podría partir, que es justo el caso que hizo falta arreglar.
 */
function partirAlMedio(tanda) {
  var mitad = Math.ceil(contarAdjuntos(tanda) / 2);
  var primera = [];
  var segunda = [];
  var vistos = 0;

  for (var i = 0; i < tanda.length; i++) {
    var m = tanda[i];
    for (var a = 0; a < m.adjuntos.length; a++) {
      var donde = vistos < mitad ? primera : segunda;
      var ultimo = donde.length ? donde[donde.length - 1] : null;
      if (!ultimo || ultimo.id !== m.id) {
        ultimo = { id: m.id, remitente: m.remitente, asunto: m.asunto, fecha: m.fecha, adjuntos: [] };
        donde.push(ultimo);
      }
      ultimo.adjuntos.push(m.adjuntos[a]);
      vistos++;
    }
  }

  return [primera, segunda];
}

/**
 * El POST. Devuelve qué contestó en vez de tirar, para que quien llama decida.
 *
 * Un 413 no es lo mismo que un 500: el primero se arregla partiendo y el
 * segundo no. Tirar acá los hacía indistinguibles.
 */
function enviar(url, secreto, mensajes) {
  var limpios = [];
  for (var i = 0; i < mensajes.length; i++) {
    var m = mensajes[i];
    var adjuntos = [];
    for (var a = 0; a < m.adjuntos.length; a++) {
      // `bytes` es de acá: sirve para el filtro previo y no tiene que viajar.
      adjuntos.push({
        nombre: m.adjuntos[a].nombre,
        tipo: m.adjuntos[a].tipo,
        contenido: m.adjuntos[a].contenido,
      });
    }
    limpios.push({
      id: m.id,
      remitente: m.remitente,
      asunto: m.asunto,
      fecha: m.fecha,
      adjuntos: adjuntos,
    });
  }

  var respuesta = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-webhook-secret': secreto },
    payload: JSON.stringify({ version: VERSION, mensajes: limpios }),
    muteHttpExceptions: true,
  });

  var codigo = respuesta.getResponseCode();

  /*
   * El hilo se etiqueta sólo si el SdG contestó que sí: un error del servidor
   * que dejara el mail marcado como cargado haría que esa factura no se cargue
   * nunca, y nadie se enteraría. Como acá no se tira, el corte lo hace quien
   * llama —y eso pasa antes de etiquetar.
   */
  return {
    ok: codigo >= 200 && codigo < 300,
    codigo: codigo,
    texto: respuesta.getContentText(),
  };
}
