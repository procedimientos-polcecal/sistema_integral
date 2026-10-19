/**
 * Apps Script que manda los correos del SdG.
 *
 * Hoy manda uno solo: el aviso de que una carga hecha sin señal en la planta
 * fue rechazada cuando el teléfono la mandó solo, con la app cerrada. Quien lo
 * llama es `lib/core/correo.ts`.
 *
 * ## Por qué un script acá y no que el servidor mande el correo
 *
 * Es el mismo motivo, medido, que está escrito en
 * `docs/facturacion-correo-apps-script.gs`: la cuenta de servicio del SdG pide
 * un token de Gmail haciéndose pasar por un usuario del dominio y Google
 * contesta `unauthorized_client`, porque la delegación a nivel dominio no está
 * otorgada. Otorgarla es una acción de un admin de Workspace y le daría al
 * sistema permiso de leer **cualquier** buzón.
 *
 * **Va en la dirección contraria a los otros scripts del repo.** Los demás
 * llaman al SdG; éste se publica como aplicación web y lo llama el SdG.
 *
 * ## Las dos cosas que lo protegen, y por qué hacen falta las dos
 *
 *   1. **El secreto.** Una aplicación web publicada se ejecuta como su dueño y
 *      es alcanzable por URL. Si no trae el secreto, no se mira nada más.
 *   2. **Los dominios permitidos.** Sin esto, una URL filtrada es un relay
 *      abierto para mandar correo desde la empresa a cualquier lado. Es la
 *      única protección que el secreto no da: el día que la URL se filtre, lo
 *      peor que puede pasar es que le llegue un correo raro a alguien de la
 *      empresa, y no que la empresa mande spam al mundo.
 *
 * ## Instalación
 *
 *   1. **Desde una casilla del sistema, no desde la cuenta de una persona.**
 *      El dueño del proyecto es el remitente que la gente va a ver y a donde
 *      van a ir las respuestas, y eso no se cambia sin volver a publicar.
 *   2. script.google.com -> Nuevo proyecto, y pegar este archivo.
 *   3. Configuración del proyecto -> Propiedades del script:
 *        SECRETO  = el mismo valor que SDG_CORREO_SECRET en Vercel
 *        DOMINIOS = los dominios permitidos, separados por coma.
 *                   Por ejemplo: polcecal.com,polysan.com.ar
 *      **Hay que apretar "Guardar propiedades de la secuencia de comandos"**:
 *      escribirlas y volver al editor no las guarda.
 *   4. Correr `revisarLasPropiedades` y mirar el registro de ejecuciones. Tiene
 *      que listar SECRETO y DOMINIOS; si dice "(ninguna)", se guardaron en otro
 *      lado.
 *   5. Implementar -> Nueva implementación -> Aplicación web:
 *        Ejecutar como: Yo (la casilla del sistema)
 *        Quién tiene acceso: Cualquier usuario
 *      La primera vez pide autorizar el permiso de mandar correo.
 *   6. Copiar la URL de la implementación a SDG_CORREO_URL en Vercel y en
 *      `.env.local`.
 *   7. Probar con `mandarmeUnoDePrueba`, que se manda un correo a la propia
 *      casilla sin pasar por el SdG.
 *
 * **Cada vez que se edita este archivo hay que crear una implementación nueva**
 * o la URL vieja sigue sirviendo el código viejo.
 */

function propiedad_(nombre) {
  return PropertiesService.getScriptProperties().getProperty(nombre);
}

/** Paso 4 de la instalación: dice si las propiedades quedaron guardadas. */
function revisarLasPropiedades() {
  var p = PropertiesService.getScriptProperties().getProperties();
  var nombres = Object.keys(p);
  Logger.log("Propiedades: " + (nombres.length ? nombres.join(", ") : "(ninguna)"));
  Logger.log("DOMINIOS: " + (p.DOMINIOS || "(sin configurar)"));
}

/** Paso 7: un correo de prueba a la propia casilla, sin pasar por el SdG. */
function mandarmeUnoDePrueba() {
  var yo = Session.getEffectiveUser().getEmail();
  MailApp.sendEmail(yo, "SdG: prueba", "Si leés esto, el script puede mandar correo.");
  Logger.log("Mandado a " + yo);
}

/** Los dominios permitidos, en minúscula y sin espacios. */
function dominiosPermitidos_() {
  var crudo = propiedad_("DOMINIOS") || "";
  return crudo
    .split(",")
    .map(function (d) {
      return d.trim().toLowerCase();
    })
    .filter(function (d) {
      return d.length > 0;
    });
}

function estaPermitido_(direccion) {
  var partes = String(direccion || "").toLowerCase().split("@");
  if (partes.length !== 2) return false;
  return dominiosPermitidos_().indexOf(partes[1]) !== -1;
}

function respuesta_(codigo, texto) {
  // Apps Script no deja elegir el status de una aplicación web: siempre
  // contesta 200. Por eso el estado va en el cuerpo y `lib/core/correo.ts`
  // lo lee de ahí — y por eso un "ok: false" tiene que decir qué pasó, porque
  // es lo único que después permite distinguir un secreto mal puesto de un
  // dominio no permitido.
  return ContentService.createTextOutput(
    JSON.stringify({ ok: codigo === "ok", estado: codigo, detalle: texto || "" })
  ).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var secreto = propiedad_("SECRETO");
  if (!secreto) return respuesta_("sin-secreto", "El script no tiene SECRETO configurado.");

  var pedido;
  try {
    pedido = JSON.parse(e.postData.contents);
  } catch (err) {
    return respuesta_("cuerpo-ilegible", String(err));
  }

  // El secreto primero y antes de mirar nada más: es lo único que separa a esta
  // URL de cualquiera que la encuentre.
  if (pedido.secreto !== secreto) return respuesta_("secreto-invalido", "");

  if (!dominiosPermitidos_().length) {
    return respuesta_("sin-dominios", "El script no tiene DOMINIOS configurados.");
  }
  if (!estaPermitido_(pedido.para)) {
    return respuesta_("dominio-no-permitido", String(pedido.para || ""));
  }
  if (!pedido.asunto || !pedido.cuerpo) {
    return respuesta_("mensaje-incompleto", "");
  }

  try {
    MailApp.sendEmail(pedido.para, pedido.asunto, pedido.cuerpo);
  } catch (err) {
    // El cupo diario de MailApp, o Gmail caído. Se dice qué pasó: un fallo que
    // no se distingue de otro no es un diagnóstico.
    return respuesta_("no-se-pudo-mandar", String(err));
  }

  return respuesta_("ok", "");
}
