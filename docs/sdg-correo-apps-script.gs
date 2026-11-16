/**
 * Apps Script que manda los correos del SdG.
 *
 * Manda el aviso de una carga rechazada, el de una mención en un hilo y el
 * resumen de novedades de RR.HH. del cierre del día. Quien lo llama es
 * `lib/core/correo.ts`.
 *
 * ## ESTE ARCHIVO SE PUBLICA DOS VECES, DESDE DOS CUENTAS
 *
 * No son dos scripts distintos: es el mismo código pegado en dos proyectos,
 * cada uno con su `SECRETO` y su url.
 *
 *   - **La casilla del sistema**, publicada por quien administra el SdG.
 *     Sus variables son `SDG_CORREO_URL` y `SDG_CORREO_SECRET`.
 *   - **La casilla de RR.HH.**, publicada desde `gestiondepersonas@polcecal.com`
 *     (16/11/2026). Sus variables son `SDG_CORREO_RRHH_URL` y
 *     `SDG_CORREO_RRHH_SECRET`.
 *
 * Hacen falta dos porque **una aplicación web se ejecuta como su dueño**: el
 * remitente no se elige desde el pedido, lo decide qué cuenta publicó. Y que
 * no se pueda elegir es deliberado —si el `doPost` aceptara un `from`, una url
 * filtrada podría falsear el remitente—, así que mandar desde otra casilla es
 * publicar desde esa otra casilla y no agregarle un parámetro a ésta.
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
 *   1. **Desde la cuenta que tiene que figurar como remitente**, porque el
 *      dueño del proyecto es el remitente que la gente va a ver y a donde van
 *      a ir las respuestas. Son dos implementaciones y cada una va desde su
 *      cuenta:
 *
 *        - la **del sistema**, desde la cuenta de quien administra el SdG
 *          (`SDG_CORREO_URL` / `SDG_CORREO_SECRET`);
 *        - la **de RR.HH.**, desde `gestiondepersonas@polcecal.com`
 *          (`SDG_CORREO_RRHH_URL` / `SDG_CORREO_RRHH_SECRET`).
 *
 *      Para la del sistema se evaluó una casilla aparte y se descartó: en
 *      Workspace una cuenta nueva ocupa una licencia, y no hacía falta. La de
 *      RR.HH. no crea ninguna casilla nueva — usa una que ya existe.
 *
 *      **Las dos son proyectos independientes.** Tienen su propia url, su
 *      propio SECRETO y su propia autorización, y editar una no toca a la
 *      otra: el día que se cambie este archivo hay que volver a implementar
 *      **las dos**, cada una desde su cuenta, o una de las dos queda sirviendo
 *      el código viejo sin avisar.
 *
 *      **Renombrar esa cuenta más adelante no rompe nada.** Un renombre en
 *      Workspace deja la misma cuenta, con el mismo Drive y el mismo proyecto,
 *      así que la URL de implementación sigue sirviendo y no hay que tocar
 *      `SDG_CORREO_URL`. Lo único que cambia es el remitente.
 *
 *      **Lo que sí rompe es mover esto a otra cuenta.** Crear una casilla
 *      nueva y suspender la vieja deja el script en un Drive suspendido, que
 *      no ejecuta nada: hay que transferir el proyecto **antes** de suspender
 *      y volver a implementar. Si lo único que se busca es que el correo no
 *      figure mandado por una persona, la salida barata es un alias de envío
 *      en esta misma cuenta y un remitente fijo en las propiedades del
 *      script — nunca tomado del pedido, que es lo que hoy impide que desde el
 *      cuerpo se inyecte `from`, `cc` o copia oculta.
 *   2. script.google.com -> Nuevo proyecto, y pegar este archivo.
 *   3. Configuración del proyecto -> Propiedades del script:
 *        SECRETO  = el mismo valor que, EN VERCEL, tenga la variable de ESTA
 *                   implementación: `SDG_CORREO_SECRET` para la del sistema,
 *                   `SDG_CORREO_RRHH_SECRET` para la de RR.HH. **No son el
 *                   mismo valor y no tienen por qué serlo**: son dos puertas
 *                   distintas, y compartir el secreto hace que filtrar una
 *                   abra las dos.
 *        DOMINIOS = los dominios permitidos, separados por coma. Acá sí va lo
 *                   mismo en las dos: polcecal.com,polysan.com.ar
 *      **Hay que apretar "Guardar propiedades de la secuencia de comandos"**:
 *      escribirlas y volver al editor no las guarda.
 *   4. Correr `revisarLasPropiedades` y mirar el registro de ejecuciones. Tiene
 *      que listar SECRETO y DOMINIOS; si dice "(ninguna)", se guardaron en otro
 *      lado.
 *   5. Implementar -> Nueva implementación -> Aplicación web:
 *        Ejecutar como: Yo (o sea, la cuenta del paso 1)
 *        Quién tiene acceso: Cualquier usuario
 *      La primera vez pide autorizar el permiso de mandar correo. **"Cualquier
 *      usuario" suena peor de lo que es**: sin eso, Google le pide sesión a
 *      quien llame y el SdG no tiene ninguna; lo que de verdad protege la url
 *      es el SECRETO del paso 3, y lo que impide que sea un relay abierto es
 *      DOMINIOS.
 *   6. Copiar la URL de la implementación a la variable de ESTA implementación
 *      en Vercel —`SDG_CORREO_URL` o `SDG_CORREO_RRHH_URL`— y a `.env.local`.
 *      **Tiene que terminar en `/exec`**: la que termina en `/dev` es la de
 *      prueba, cambia con cada edición y exige sesión.
 *      Vercel no aplica una variable nueva hasta el próximo despliegue.
 *
 *      **LA FORMA DE LA URL DELATA EL ACCESO, y es el diagnóstico más rápido
 *      que hay.** Si sale
 *      `script.google.com/a/macros/<dominio>/s/<id>/exec`, con ese
 *      `/a/macros/<dominio>/` en el medio, el paso 5 quedó restringido al
 *      dominio: Google no ejecuta nada y redirige a `ServiceLogin`, así que el
 *      SdG recibe **HTML y un 401** en vez del JSON del script. La abierta es
 *      `script.google.com/macros/s/<id>/exec`, sin el dominio. Medido el
 *      16/11/2026 al publicar la de RR.HH., que salió restringida: una vez
 *      corregido el acceso **las dos formas funcionan** —es la misma
 *      implementación— así que no hace falta volver a copiar la URL; lo que
 *      hay que cambiar es el acceso, no la variable.
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
  // Un cuerpo que es `null` o un número parsea bien y después revienta al
  // pedirle una propiedad. Se descarta antes de mirar el secreto.
  if (!pedido || typeof pedido !== "object") return respuesta_("cuerpo-ilegible", "no es un objeto");

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
