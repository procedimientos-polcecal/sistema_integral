/*
 * Las decisiones de la cola de cargas sin señal: qué fallo es definitivo y cuál
 * pasajero, de quién es cada carga, cuál sigue, cuánto se espera entre
 * reintentos, **cómo se lee lo que contestó la ruta de alta y cómo queda la
 * carga después de cada intento**. Son funciones puras: no tocan IndexedDB ni
 * `fetch`. Lo que persiste la cola y lo que la dispara son otros archivos; acá
 * sólo se decide.
 *
 * Las dos últimas están acá y no en la pantalla por un motivo concreto: el
 * service worker va a vaciar la cola con la app cerrada (tarea 7 del plan) y
 * necesita exactamente las mismas reglas, palabra por palabra. Desde un service
 * worker no se puede importar un componente de React, así que si vivieran allá
 * se escribirían dos veces — y dos implementaciones de la misma transición,
 * ninguna probada, es como esto se separa sin que nadie lo note.
 *
 * Vive en `public/` y es JavaScript plano porque lo van a importar los dos
 * mundos: la app (con `@/public/cola/colaOffline.js`) y el service worker
 * `public/sw.js` (el enganche es la tarea 7 del plan; hoy no lo importa), que
 * no puede importar TypeScript ni nada que el sitio no sirva tal cual. Los
 * tipos van por JSDoc, pero ojo con qué garantizan: `tsconfig.json` tiene
 * `allowJs` y no `checkJs`, y no incluye los `.js` en su `include`, así que
 * adentro de este archivo nadie los verifica. Rigen sólo para quien lo importa
 * desde TypeScript, que ve las firmas y las usa para chequear sus llamadas.
 *
 * LO ÚNICO CONTRAINTUITIVO: un 401 es PASAJERO. Parece una falla definitiva
 * —"no tenés permiso"—, pero acá no lo es: la sesión de Supabase se vence sola,
 * y una carga que esperó un día sin señal la va a encontrar vencida aunque
 * estuviera perfecta cuando se hizo. Tratarla como definitiva tiraría a la
 * basura una carga buena; como pasajera, espera a que la persona vuelva a
 * entrar y sale con su sesión nueva (y `puedeMandarse` ya exige que sea la
 * misma persona que la cargó).
 */

/** @typedef {"aviso" | "orden"} TipoDeCarga */

/**
 * Una carga que espera en el teléfono hasta tener señal.
 *
 * @typedef {object} CargaEnCola
 * @property {string} clave Identifica la carga de punta a punta: la ruta la reserva para no escribirla dos veces.
 * @property {TipoDeCarga} tipo
 * @property {Record<string, unknown>} cuerpo Lo que se manda a la ruta, tal como lo cargó la persona.
 * @property {string} usuarioId Quien la cargó. La planilla queda firmada con esta persona, no con quien tenga el teléfono después.
 * @property {string} creadaEn Fecha ISO de cuando se cargó.
 * @property {string | null} tomadaEn Fecha ISO de cuando un disparo la tomó para mandarla; null si nadie la tiene.
 * @property {number} intentos
 * @property {string | null} ultimoError Lo último que pasó con la carga, para mostrarlo tal cual: casi siempre lo que dijo el servidor sin traducir, y en un caso lo que compuso `siNoSePudoAvisar` —una carga que entró y cuya advertencia no se pudo decir—.
 * @property {"esperando" | "parada"} estado "parada" es una carga que no se reintenta sola: necesita que una persona la mire.
 */

/**
 * Cuánto puede tener una carga "tomada" un disparo antes de que se la dé por
 * abandonada. La marca existe para que dos disparos simultáneos (la pantalla y
 * el service worker, o dos pestañas) no manden lo mismo; pero un service worker
 * que el sistema duerme a mitad de camino nunca la libera, y sin este plazo esa
 * carga quedaría tomada para siempre.
 */
export const MINUTOS_PARA_SOLTAR = 5;

/** Una carga que espera más que esto se le avisa a la persona. */
const HORAS_PARA_AVISAR = 24;

/** La espera entre reintentos no pasa de acá, por mucho que se haya fallado. */
const MINUTOS_TECHO_DE_ESPERA = 60;

const MS_POR_MINUTO = 60_000;

/**
 * Si reintentar tiene sentido.
 *
 * Definitivo es lo que el servidor contesta con la cabeza fría y volvería a
 * contestar igual: un 400 (la carga está mal armada), un 403 (no tiene
 * permiso) o un 409. El 409 es el que va a devolver la ruta de carga cuando la
 * clave quedó reservada y no se sabe si la fila llegó a escribirse en la
 * planilla (la ruta se escribe en la tarea 4 del plan; hasta entonces es el
 * contrato que se acordó, no algo que ya exista): reintentar sólo daría otro
 * 409. Todo lo demás es
 * pasajero —un 502 porque Google no contestó, un 500, un corte a mitad de
 * camino— y, sobre todo, el 401: ver la cabecera del archivo.
 *
 * @param {number | null} status El código HTTP, o null si ni se llegó a hablar con el servidor.
 * @returns {"definitivo" | "pasajero"}
 */
export function clasificarFallo(status) {
  if (status === 400 || status === 403 || status === 409) return "definitivo";
  return "pasajero";
}

/**
 * @param {string} fechaIso
 * @returns {number} Milisegundos, o NaN si la fecha no se entiende.
 */
function enMilisegundos(fechaIso) {
  return new Date(fechaIso).getTime();
}

/**
 * La fecha como número para ordenar; una ilegible queda al final.
 *
 * @param {string} fechaIso
 * @returns {number}
 */
function clavesDeOrden(fechaIso) {
  const ms = enMilisegundos(fechaIso);
  return Number.isNaN(ms) ? Infinity : ms;
}

/**
 * Si esta carga se puede mandar ahora, desde esta sesión.
 *
 * @param {CargaEnCola} carga
 * @param {string | null} usuarioActualId Quien tiene la sesión abierta; null si no se sabe.
 * @param {Date} ahora
 * @returns {boolean}
 */
export function puedeMandarse(carga, usuarioActualId, ahora) {
  // Sin sesión conocida no hay a nombre de quién mandar, y una carga sin dueño
  // no tiene a quién firmar. Se chequea la falsedad y no sólo `null` porque el
  // service worker es JavaScript sin tipos: ahí puede llegar `undefined` o "", y
  // dos valores vacíos iguales pasarían la comparación de abajo. Una carga de
  // otra persona se queda esperando a que ella vuelva a entrar: mandarla desde
  // esta sesión firmaría la planilla con quien no la hizo.
  if (!usuarioActualId || !carga.usuarioId) return false;
  if (carga.usuarioId !== usuarioActualId) return false;
  if (carga.estado !== "esperando") return false;
  if (carga.tomadaEn === null) return true;

  const hace = ahora.getTime() - enMilisegundos(carga.tomadaEn);
  // Una marca ilegible o del futuro (el reloj del teléfono se corrigió hacia
  // atrás) no puede trabar la carga hasta que el reloj la alcance: se suelta.
  // El diseño es que mandarla dos veces no sea un riesgo, porque la ruta de
  // carga reservará la clave y el segundo intento recibirá un 409 (esa ruta
  // llega con la tarea 4 del plan; hasta entonces esto descansa en esa promesa).
  if (Number.isNaN(hace) || hace < 0) return true;
  return hace > MINUTOS_PARA_SOLTAR * MS_POR_MINUTO;
}

/**
 * La próxima carga a mandar: la más vieja de las que se pueden mandar, para que
 * salgan en el orden en que se cargaron. No modifica el arreglo que recibe.
 *
 * Una `creadaEn` ilegible no tiene lugar en la fila: iría a cualquier parte
 * según cómo compare el motor. Se decide que va al final, así nunca le pasa por
 * delante a una carga con fecha, pero tampoco se queda sin mandar si es la
 * única; entre dos ilegibles se respeta el orden en que llegaron.
 *
 * @param {CargaEnCola[]} cargas
 * @param {string | null} usuarioActualId
 * @param {Date} ahora
 * @returns {CargaEnCola | null}
 */
export function proximaAMandar(cargas, usuarioActualId, ahora) {
  const mandables = cargas
    .filter((carga) => puedeMandarse(carga, usuarioActualId, ahora))
    .sort((a, b) => {
      const desdeA = clavesDeOrden(a.creadaEn);
      const desdeB = clavesDeOrden(b.creadaEn);
      // Comparación explícita y no resta: Infinity - Infinity da NaN.
      if (desdeA < desdeB) return -1;
      if (desdeA > desdeB) return 1;
      return 0;
    });
  return mandables[0] ?? null;
}

/**
 * Las cargas que llevan más de 24 horas esperando, para avisarle a la persona
 * que algo quedó sin mandar.
 *
 * Sólo cuentan las que están "esperando": una "parada" ya tiene su propio
 * aviso. Y una con fecha futura no cuenta —el reloj del teléfono puede estar
 * mal—, igual que una con fecha ilegible: no se puede afirmar que lleve
 * esperando nada.
 *
 * @param {CargaEnCola[]} cargas
 * @param {Date} ahora
 * @returns {CargaEnCola[]}
 */
export function esperandoDesdeAyer(cargas, ahora) {
  const tope = HORAS_PARA_AVISAR * 60 * MS_POR_MINUTO;
  return cargas.filter((carga) => {
    if (carga.estado !== "esperando") return false;
    return ahora.getTime() - enMilisegundos(carga.creadaEn) > tope;
  });
}

/**
 * Las cargas que quedaron paradas, sin importar hace cuánto: son las que
 * fallaron de forma definitiva y no se reintentan solas, así que la persona
 * tiene que enterarse de que están. `esperandoDesdeAyer` no las cuenta; las dos
 * listas son lo que muestra el aviso de la cola.
 *
 * @param {CargaEnCola[]} cargas
 * @returns {CargaEnCola[]}
 */
export function paradas(cargas) {
  return cargas.filter((carga) => carga.estado === "parada");
}

/**
 * Cuántos minutos esperar antes del próximo reintento, según cuántos van.
 *
 * Es una decisión y no un detalle del service worker, así que vive acá, donde
 * se puede probar. El primer reintento sale casi enseguida (una señal que
 * parpadea suele volver en segundos); después la espera se duplica para no
 * gastar batería ni datos golpeando un servidor caído, y se frena en una hora
 * para que cincuenta fallos no signifiquen días de silencio.
 *
 * @param {number} intentos Cuántas veces se intentó ya.
 * @returns {number} Minutos.
 */
export function esperaAntesDeReintentar(intentos) {
  // Un dato raro (NaN, negativo) cuenta como el primer reintento. Infinity no
  // es raro, es "muchísimos": 2 ** Infinity da Infinity y el techo lo corta.
  const n = intentos > 1 ? intentos : 1;
  return Math.min(0.5 * 2 ** (n - 1), MINUTOS_TECHO_DE_ESPERA);
}

/**
 * Si una **persona** puede empujar esta carga a mano desde esta sesión.
 *
 * Es `puedeMandarse` con una sola diferencia, y es la que justifica el botón de
 * la pantalla: una carga `parada` no se reintenta sola —falló con algo que el
 * servidor volvería a contestar igual— pero una persona sí puede decidir
 * reintentarla después de mirar qué pasó. Lo demás no se relaja: sigue teniendo
 * que ser de quien tiene la sesión abierta, y sigue sin pisar a un disparo que
 * la tomó hace menos de `MINUTOS_PARA_SOLTAR`.
 *
 * Existe para que el botón no reimplemente a mano un tercio de la regla, que es
 * exactamente lo que hacía: copiaba "es mía" y perdía las otras dos
 * condiciones.
 *
 * @param {CargaEnCola} carga
 * @param {string | null} usuarioActualId
 * @param {Date} ahora
 * @returns {boolean}
 */
export function puedeEmpujarla(carga, usuarioActualId, ahora) {
  return puedeMandarse({ ...carga, estado: "esperando" }, usuarioActualId, ahora);
}

// ── Cómo se nombra una carga ─────────────────────────────────────────────────

/**
 * Cómo se llama cada tipo de carga en lo que ve una persona.
 *
 * **Vive acá porque la misma carga se nombraba de tres formas distintas**
 * —«Orden de trabajo» en la lista, «la orden» en el formulario y «la orden de
 * trabajo» en la notificación del service worker—, o sea que una carga cambiaba
 * de nombre según si entró con la app abierta o cerrada. Son dos funciones y no
 * una porque el castellano necesita las dos formas, pero **son dos y no tres**:
 * el que necesite nombrarla tiene que usar una de éstas.
 *
 * @param {TipoDeCarga} tipo
 * @returns {string}
 */
export function comoSeLlama(tipo) {
  return tipo === "aviso" ? "Aviso" : "Orden de trabajo";
}

/**
 * Lo mismo, para cuando va en medio de una oración: «Se cargó la orden de
 * trabajo OT-12».
 *
 * @param {TipoDeCarga} tipo
 * @returns {string}
 */
export function conSuArticulo(tipo) {
  return tipo === "aviso" ? "el aviso" : "la orden de trabajo";
}

// ── Cómo se lee lo que contestó la ruta de alta ──────────────────────────────

/** Cómo se llama el número en la respuesta de cada ruta. */
const CAMPO_DEL_NUMERO = {
  aviso: "oa_number",
  orden: "ot_number",
};

/**
 * Lo que contestó la ruta, ya leído por quien la llamó.
 *
 * @typedef {object} ContestacionCruda
 * @property {number | null} status El código HTTP, o null si ni se llegó a hablar con el servidor.
 * @property {boolean} redirigida Si el pedido terminó en otra dirección que la pedida.
 * @property {unknown} cuerpo El JSON tal cual vino. Es `unknown` y no un objeto a propósito: `JSON.parse("null")` da `null`, y un tipo que prometiera un objeto haría que quien llama escribiera un cast en vez de que esto lo contemple.
 */

/**
 * `deLaRuta` es si el fallo lo contestó **la ruta de carga** y no otra cosa en
 * el medio. Existe porque el código HTTP sólo significa algo si lo contestó
 * quien dice haberlo contestado: un 400 de un portal cautivo o del cortafuegos
 * de Vercel no dice nada sobre la carga, y tratarlo como definitivo la deja
 * parada para siempre por algo que se arregla saliendo del WiFi del bar.
 *
 * @typedef {{ ok: true, numero: string, advertencia: string | null }
 *         | { ok: false, status: number | null, deLaRuta: boolean, error: string }} ResultadoDelEnvio
 */

/** Si el valor es un objeto con el que se puede trabajar. `null` no lo es. */
function esObjeto(valor) {
  return typeof valor === "object" && valor !== null;
}

/**
 * Lo que se dice cuando la respuesta no salió de la ruta de carga.
 *
 * Un redirect tiene nombre y apellido —la sesión se venció y hay que volver a
 * entrar— y eso es accionable, así que se dice aparte.
 *
 * @param {boolean} redirigida
 * @param {number | null} status
 * @returns {string}
 */
function laContestoOtro(redirigida, status) {
  if (redirigida) {
    return (
      "El pedido terminó en otra pantalla, casi seguro el login: la sesión de " +
      "este teléfono se venció. La carga queda esperando; entrá de nuevo al SdG " +
      "y mandala desde la lista."
    );
  }
  if (status === null) return "No se pudo hablar con el servidor.";
  return (
    `Contestó ${status}, pero sin nada de lo que manda siempre la ruta de carga, ` +
    `así que eso lo contestó otro —un portal de WiFi o un cortafuegos—. ` +
    `La carga queda esperando.`
  );
}

/**
 * Qué salió de un envío.
 *
 * UN 200 SIN NÚMERO NO ES UN ÉXITO, y ésta es la razón entera de que esta
 * función exista en vez de mirar `response.ok`. Las dos rutas devuelven siempre
 * su número en un 200 —el reintento que cae en "ya estaba" también, porque la
 * clave se resuelve escribiendo el número junto con la marca de resuelta—, así
 * que un 200 sin número es siempre una respuesta que **no salió de la ruta de
 * carga**. Y ese camino no es teórico: es el más probable de esta pantalla.
 * `proxy.ts` contesta un 307 al login a cualquier pedido sin sesión válida,
 * incluidas las rutas de `/api/mantenimiento/*`; `fetch` sigue el redirect y
 * devuelve el HTML del login con un 200 redondo. Ya pasó en este repo —está
 * contado en `lib/supabase/middleware.ts`— y la sesión vencida es justamente el
 * escenario de esta pantalla: un teléfono que estuvo un día sin señal. Un
 * portal cautivo de WiFi hace lo mismo sin ninguna ambigüedad.
 *
 * Tratarlo como éxito era lo peor que podía pasar: la pantalla decía "se cargó"
 * y vaciaba el formulario sin que se hubiera escrito nada, y en el reintento
 * **borraba de la cola** una carga que había esperado días. Es pasajero, así
 * que la carga se queda y se vuelve a intentar.
 *
 * De paso, esto es lo que deja vivo el diseño del 401 como pasajero: ese 401
 * casi nunca llega solo, lo tapa el 307.
 *
 * LA MISMA IDEA, GENERALIZADA: **un fallo sin `error` en el cuerpo tampoco
 * salió de la ruta.** Las dos rutas mandan `error` en todos sus 400, 403 y 409,
 * sin excepción. Así que un 400 pelado es de otro —el mismo portal cautivo, el
 * cortafuegos de Vercel— y marcarlo definitivo dejaría la carga parada para
 * siempre por algo que se arregla saliendo de ese WiFi. Eso es lo que decide
 * `deLaRuta`, y lo que lee `convieneReintentar`.
 *
 * ES TOTAL A PROPÓSITO: un `cuerpo` que no es objeto —un JSON que es
 * literalmente `null`, que es lo que devuelve `JSON.parse("null")`— no puede
 * tirar acá. En la pantalla lo atraparía un `catch` y saldría un mensaje
 * engañoso; en el service worker sería una excepción sin atrapar que corta el
 * vaciado de la cola entera.
 *
 * @param {TipoDeCarga} tipo
 * @param {ContestacionCruda} contestacion
 * @returns {ResultadoDelEnvio}
 */
export function comoContesto(tipo, contestacion) {
  const { status, redirigida } = contestacion;
  const cuerpo = esObjeto(contestacion.cuerpo) ? contestacion.cuerpo : {};
  const salioBien = status !== null && status >= 200 && status < 300;

  if (salioBien) {
    const numero = cuerpo[CAMPO_DEL_NUMERO[tipo]];
    const comoTexto =
      numero === null || numero === undefined ? "" : String(numero).trim();
    if (comoTexto !== "") {
      return { ok: true, numero: comoTexto, advertencia: loQueQuedoPendiente(cuerpo) };
    }
    return {
      ok: false,
      status,
      deLaRuta: false,
      error: laContestoOtro(redirigida, status),
    };
  }

  const dicho = texto(cuerpo.error);
  if (dicho !== null) return { ok: false, status, deLaRuta: true, error: dicho };

  return { ok: false, status, deLaRuta: false, error: laContestoOtro(redirigida, status) };
}

/**
 * Si conviene volver a intentar esta carga.
 *
 * `clasificarFallo` mira el código, y el código sólo significa algo **si lo
 * contestó la ruta**. Cuando no salió de ella —un redirect al login, un portal
 * cautivo, un cortafuegos, o `fetch` que ni llegó a hablar— no hay nada que
 * clasificar: lo que falló está en el camino y no en la carga, así que se
 * reintenta sea cual sea el número que haya llegado.
 *
 * @param {ResultadoDelEnvio} resultado
 * @returns {boolean}
 */
export function convieneReintentar(resultado) {
  if (resultado.ok) return false;
  if (!resultado.deLaRuta) return true;
  return clasificarFallo(resultado.status) === "pasajero";
}

/**
 * Lo que la ruta contestó que quedó a medias, todo junto, o null si no quedó
 * nada. **Lo que salió a medias se dice, no se calla.**
 *
 * Los cuatro campos conviven y por eso se miran los cuatro en los dos tipos de
 * carga, aunque hoy cada ruta mande los suyos: la de avisos devuelve
 * `advertencia` y `clave_error`, y la de órdenes ésos dos más `planilla_error`
 * y `aviso_error`. El que más importa es `advertencia`: aparece cuando la carga
 * ya está escrita en la planilla y no se sabe si llegó al sistema, que es
 * exactamente el caso en el que alguien podría cargar dos veces lo mismo.
 *
 * @param {unknown} cuerpoCrudo El JSON de la respuesta, sea lo que sea.
 * @returns {string | null}
 */
export function loQueQuedoPendiente(cuerpoCrudo) {
  // Un `null` entra acá igual que a `comoContesto`, y por el mismo motivo no
  // puede tirar: es pública y la va a llamar el service worker.
  const cuerpo = esObjeto(cuerpoCrudo) ? cuerpoCrudo : {};
  const claveError = texto(cuerpo.clave_error);
  const planillaError = texto(cuerpo.planilla_error);

  const partes = [
    texto(cuerpo.advertencia),
    claveError === null
      ? null
      : `La clave de esta carga no se pudo anotar del lado del servidor ` +
        `(${claveError}): si se vuelve a mandar, mirá la planilla antes de darla ` +
        `por duplicada.`,
    planillaError === null
      ? null
      : `El estado y las horas todavía no llegaron a la planilla (${planillaError}) — ` +
        `queda pendiente y lo escribe la próxima sincronización.`,
    texto(cuerpo.aviso_error),
  ].filter((parte) => parte !== null);

  return partes.length > 0 ? partes.join(" ") : null;
}

/** El campo si es un texto con algo adentro; null en cualquier otro caso. */
function texto(valor) {
  return typeof valor === "string" && valor.trim() !== "" ? valor : null;
}

// ── Cómo queda la carga después de un intento ────────────────────────────────

/**
 * Cada veredicto trae lo que hace falta para ejecutarlo, y no sólo su nombre:
 * así quien llama no tiene que volver a mirar el resultado —que es volver a
 * decidir— para saber qué número mostrar o qué error guardar.
 *
 * @typedef {{ accion: "listo", numero: string, advertencia: string | null }
 *         | { accion: "rechazar", error: string }
 *         | { accion: "encolar", intentos: number, ultimoError: string | null }} QueHacerConLaNueva
 */

/**
 * Qué hacer con una carga **recién hecha**, que todavía no está en la cola.
 *
 * `null` es "ni se intentó": no había señal, así que va derecho a la cola sin
 * ningún intento en contra.
 *
 * Un fallo **definitivo** no se encola, y eso es una decisión y no un atajo:
 * una carga que el servidor volvería a rechazar igual no va a entrar nunca, y
 * dejarla en la lista sólo tapa a las que sí pueden salir. Se le muestra a
 * quien cargó el texto de la ruta, sin traducir, mientras lo escrito sigue en
 * el formulario para corregirlo.
 *
 * @param {ResultadoDelEnvio | null} resultado
 * @returns {QueHacerConLaNueva}
 */
export function queHacerConLaNueva(resultado) {
  if (resultado === null) return { accion: "encolar", intentos: 0, ultimoError: null };
  if (resultado.ok) {
    return { accion: "listo", numero: resultado.numero, advertencia: resultado.advertencia };
  }
  if (!convieneReintentar(resultado)) return { accion: "rechazar", error: resultado.error };
  return { accion: "encolar", intentos: 1, ultimoError: resultado.error };
}

/**
 * Qué se le escribe a una carga al tomarla para mandarla. La marca es lo que
 * evita que dos disparos —la pantalla y el service worker, o dos pestañas—
 * manden lo mismo; `puedeMandarse` la lee y `MINUTOS_PARA_SOLTAR` la suelta si
 * quien la tomó muere a mitad de camino.
 *
 * @param {CargaEnCola} carga
 * @param {Date} ahora
 * @returns {Partial<CargaEnCola>}
 */
export function tomarLaCarga(carga, ahora) {
  const intentos = Number.isFinite(carga.intentos) ? carga.intentos : 0;
  return { tomadaEn: ahora.toISOString(), intentos: intentos + 1 };
}

/**
 * `borrar-y-avisar` **no es** `borrar` con un campo de más, y el nombre
 * distinto es el punto entero: quien ejecute esto no puede borrar la carga sin
 * darse cuenta de que había algo que decir. Un `{accion:"borrar", advertencia}`
 * se maneja sin leer el segundo campo —y el service worker de la tarea 7
 * borraría la carga con la advertencia adentro, que es la que dice «está en la
 * planilla y todavía no en el sistema, no la cargues de nuevo»—. Un veredicto
 * que no se llama igual no se puede atender igual sin querer: en TypeScript el
 * `switch` deja de ser exhaustivo, y en JavaScript el nombre es la instrucción.
 *
 * @typedef {{ accion: "borrar", numero: string }
 *         | { accion: "borrar-y-avisar", numero: string, advertencia: string }
 *         | { accion: "actualizar", cambios: Partial<CargaEnCola> }} QueHacerDespues
 */

/**
 * Cómo queda una carga **que ya estaba en la cola** después de intentarla.
 *
 * Sale de la cola sólo cuando el envío salió bien de verdad —y qué es "bien" lo
 * decide `comoContesto`, no `response.ok`—. Borrarla por cualquier otra cosa es
 * perder sin aviso lo que alguien escribió hace días.
 *
 * Cuando salió bien **y quedó algo a medias**, la carga igual sale de la cola
 * —ya está hecha, dejarla ahí haría que se mande dos veces— pero el veredicto
 * se llama distinto y trae la advertencia, para que quien borra tenga que
 * decirla. En esta pantalla es un cartel; en el service worker va a ser una
 * notificación. En este repo eso no puede terminar en un log.
 *
 * Si falló, la marca de tomada se suelta sí o sí: dejarla puesta la trabaría
 * `MINUTOS_PARA_SOLTAR` minutos por un fallo que ya se conoce. Y el estado
 * depende de si reintentar tiene sentido: `parada` es la que necesita que una
 * persona la mire, `esperando` la que sale sola cuando vuelva la señal.
 *
 * @param {ResultadoDelEnvio} resultado
 * @returns {QueHacerDespues}
 */
export function despuesDelIntento(resultado) {
  if (resultado.ok) {
    return resultado.advertencia === null
      ? { accion: "borrar", numero: resultado.numero }
      : {
          accion: "borrar-y-avisar",
          numero: resultado.numero,
          advertencia: resultado.advertencia,
        };
  }
  return {
    accion: "actualizar",
    cambios: {
      tomadaEn: null,
      ultimoError: resultado.error,
      estado: convieneReintentar(resultado) ? "esperando" : "parada",
    },
  };
}

/**
 * Qué hacer con una carga que **entró** y cuya advertencia **no se pudo decir**.
 *
 * Existe por el service worker, que es el único que puede quedarse sin dónde
 * decirla: con la app cerrada el único lugar es una notificación, y sin permiso
 * de notificaciones no hay ninguno. En la pantalla no pasa nunca —el cartel
 * siempre se puede dibujar—, así que allá `borrar-y-avisar` se ejecuta entero.
 *
 * Está acá y no en `public/sw.js` por lo mismo que todo lo demás de este
 * archivo: decide **una transición de estado** y **compone el texto que lee una
 * persona**, que son las dos cosas que este archivo existe para concentrar. En
 * el service worker eso quedaba escrito a mano, que es exactamente cómo una
 * regla termina estando en dos lugares.
 *
 * **El estado es `parada` y no `esperando`:** la carga ya está entregada, así
 * que no tiene que volver a salir sola —sería un lazo de POST que siempre
 * terminan igual—, y `parada` significa literalmente «necesita que una persona
 * la mire». Es la única carga `parada` que **sí** entró, y por eso el texto
 * empieza diciendo que entró y con qué número: lo primero que alguien tiene que
 * saber es que esto **no** hay que volver a cargarlo.
 *
 * @param {{ numero: string, advertencia: string }} veredicto El `borrar-y-avisar` que no se pudo ejecutar.
 * @param {TipoDeCarga} tipo
 * @returns {{ accion: "actualizar", cambios: Partial<CargaEnCola> }}
 */
export function siNoSePudoAvisar(veredicto, tipo) {
  return {
    accion: "actualizar",
    cambios: {
      tomadaEn: null,
      estado: "parada",
      ultimoError:
        `Entró: se cargó ${conSuArticulo(tipo)} ${veredicto.numero}, así que no ` +
        `hay que volver a cargarlo. Pero quedó esto para mirar: ${veredicto.advertencia}`,
    },
  };
}
