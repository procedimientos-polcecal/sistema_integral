/*
 * Las decisiones de la cola de cargas sin señal: qué fallo es definitivo y cuál
 * pasajero, de quién es cada carga, cuál sigue, cuánto se espera entre
 * reintentos, **cómo se lee lo que contestó la ruta de alta y cómo queda la
 * carga después de cada intento**. Son funciones puras: no tocan IndexedDB ni
 * `fetch`. Lo que persiste la cola y lo que la dispara son otros archivos; acá
 * sólo se decide.
 *
 * Las dos últimas están acá y no en la pantalla por un motivo concreto: el
 * service worker vacía la cola con la app cerrada y necesita exactamente las
 * mismas reglas, palabra por palabra. Desde un service
 * worker no se puede importar un componente de React, así que si vivieran allá
 * se escribirían dos veces — y dos implementaciones de la misma transición,
 * ninguna probada, es como esto se separa sin que nadie lo note.
 *
 * Vive en `public/` y es JavaScript plano porque lo importan los dos
 * mundos: la app (con `@/public/cola/colaOffline.js`, desde `CargarClient.tsx`,
 * `app/cargar/envio.tsx`, `lib/core/sesionDelTelefono.ts` y
 * `lib/core/loQueNoEntro.ts`) y el service worker `public/sw.js`, que le
 * importa seis funciones y las dos constantes de abajo, y no puede importar
 * TypeScript ni nada que el sitio no sirva tal cual. Los
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

/** @typedef {"aviso" | "orden" | "condicion"} TipoDeCarga */

// ── El pegamento que los dos mundos tienen que escribir igual ────────────────
//
// No son reglas —no deciden nada— pero son los nombres y las formas que la
// pantalla y el service worker **tienen** que escribir idénticos (y en el caso
// de los dos campos del `FormData`, también la ruta de alta, que es un tercer
// mundo sin tipos compartidos), y hasta el 19/10/2026
// estaban copiados a mano en los dos lados. El modo de fallar de `SESION` es el
// peor que tiene esta cola: el worker lee quién sos de esa clave, así que una
// letra distinta deja el vaciado sin sesión conocida y **no sale ninguna
// carga**, sin un error en ningún lado.
//
// Un test que atara las dos copias habría avisado; tener una sola definición
// hace que no haya nada que atar, y por eso viven acá: es el único archivo que
// pueden importar los tres —React, el service worker y vitest—.

/**
 * Dónde queda anotado en el teléfono quién tiene la sesión abierta.
 *
 * Lo escriben `lib/core/sesionDelTelefono.ts` (desde `/cargar` y desde la barra
 * del layout) y lo lee `public/sw.js` para decidir a nombre de quién puede
 * mandar una carga.
 */
export const SESION = "sesion";

/**
 * A dónde va cada tipo de carga. Las dos de Mantenimiento son las de siempre; la
 * de la condición insegura es la del módulo Seguridad e Higiene.
 *
 * @type {Record<TipoDeCarga, string>}
 */
export const RUTA_DE = {
  aviso: "/api/mantenimiento/avisos",
  orden: "/api/mantenimiento/ordenes",
  condicion: "/api/seguridad-higiene/condiciones",
};

/**
 * Si el cuerpo de este tipo de carga puede traer un archivo, y por lo tanto
 * tiene que salir como `multipart/form-data` en vez de como JSON.
 *
 * **ES UN MAPA Y NO UN `tipo === "condicion"`, Y ESA ES LA PROMESA DE ESTA
 * TAREA:** el aviso y la orden de trabajo son lo que la gente usa todos los
 * días, y su pedido tiene que salir **byte por byte igual que antes**. Con un
 * mapa, el `if` de las dos `mandarALaRuta` va *alrededor* de la construcción
 * del pedido y la rama vieja queda intacta; una condición adentro de la
 * construcción es cómo una cabecera cambia para los tres tipos sin que nadie
 * lo note.
 *
 * Un tipo sin entrada devuelve `undefined`, que es falso: sale como JSON, que
 * es lo que hacía hoy. El modo de fallar es el seguro, y que el mapa esté
 * completo lo fija el test de `lib/core/colaOffline.test.ts` que recorre
 * `RUTA_DE`.
 *
 * @type {Record<TipoDeCarga, boolean>}
 */
const LLEVA_ARCHIVO = {
  aviso: false,
  orden: false,
  condicion: true,
};

/**
 * @param {TipoDeCarga} tipo
 * @returns {boolean}
 */
export function llevaArchivo(tipo) {
  return LLEVA_ARCHIVO[tipo];
}

/**
 * Cómo se llama, dentro del `FormData`, el campo que lleva el cuerpo entero.
 *
 * **EL CUERPO VA EN UN SOLO CAMPO DE JSON Y NO UN CAMPO POR CLAVE.** En un
 * `FormData` todo es texto: `prioridad: 2` llegaría como `"2"` y `peligro_id:
 * null` como `"null"`, así que la ruta tendría que reconvertirlos uno por uno
 * y su esquema de zod —el mismo que valida el camino JSON— vería otra cosa
 * según si la carga trajo foto o no. Con el cuerpo en un campo, la ruta hace
 * un `JSON.parse` y de ahí en adelante **es exactamente el mismo objeto**: un
 * solo camino de validación y un solo juego de mensajes.
 *
 * Lo escriben los dos mundos (la pantalla y el service worker) y lo lee la
 * ruta de alta, que es TypeScript: tres lugares que no comparten tipos, así
 * que el nombre vive acá y en ningún otro lado.
 */
export const CAMPO_DEL_CUERPO = "cuerpo";

/** Y así se llama el archivo. Mismo motivo que el de arriba. */
export const CAMPO_DE_LA_FOTO = "foto";

/**
 * El cuerpo de una carga con archivo, armado para mandarlo.
 *
 * La foto sale del cuerpo y va aparte: adentro del JSON un `Blob` se
 * serializa como `{}` —sin error y sin aviso—, que es perder el único campo
 * de una condición que no se puede volver a conseguir.
 *
 * **Vive acá, con todo lo demás que los dos mundos tienen que escribir
 * igual.** No es HTTP: es la forma del cuerpo, o sea el contrato con la ruta.
 * Escrita dos veces, un día una de las dos manda la foto con otro nombre de
 * campo y lo que se rompe es sólo el camino sin señal, que es el que nadie
 * mira.
 *
 * @param {Record<string, unknown>} cuerpo El cuerpo de la carga, con la foto adentro si la hay.
 * @returns {FormData}
 */
export function cuerpoComoFormData(cuerpo) {
  const { [CAMPO_DE_LA_FOTO]: foto, ...resto } = cuerpo;
  const forma = new FormData();
  forma.append(CAMPO_DEL_CUERPO, JSON.stringify(resto));
  // Sin foto el campo **no se manda**, en vez de mandarlo vacío: que no esté
  // es inequívoco. El tercer argumento es el nombre del archivo, que un `Blob`
  // no tiene; la ruta decide la extensión por el tipo del archivo y no por
  // este nombre, pero sin él algunos servidores tratan la parte como texto.
  if (foto instanceof Blob) forma.append(CAMPO_DE_LA_FOTO, foto, "foto");
  return forma;
}

/**
 * De dónde salió una carga: si la mandó el teléfono solo o si alguien estaba
 * mirando la pantalla.
 *
 * **Decide si una carga rechazada manda correo**, y por eso viaja: la ruta no
 * tiene forma de saberlo. Sólo este archivo y `public/sw.js` lo saben, porque
 * allá son tres handlers distintos —`push` y `sync` despiertan al worker con la
 * app cerrada; el `message` lo pide una pestaña abierta—.
 *
 * **Va en una cabecera y no en el cuerpo a propósito.** El cuerpo es lo que las
 * dos rutas de alta validan y guardan, y la promesa de que una carga sin
 * `clave` se comporta exactamente como antes se sostiene sobre que ese cuerpo
 * no cambie.
 *
 * El nombre y los dos valores viven **acá y en ningún otro lado**: los usan el
 * service worker, la pantalla y las dos rutas, y son tres mundos que no
 * comparten tipos. Copiarlos a mano en alguno es cómo se desincronizan sin que
 * nada falle —ya pasó en este repo con la clave de la sesión—.
 */
export const CABECERA_DEL_DISPARO = "X-SdG-Disparo";

/** @type {{ fondo: "fondo", pantalla: "pantalla" }} */
export const DISPARO = {
  /** Lo mandó el teléfono solo, con la app cerrada: no había nadie mirando. */
  fondo: "fondo",
  /** Lo pidió una pestaña abierta: la persona está viendo lo que pasa. */
  pantalla: "pantalla",
};

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
 * @property {string | null} [yaEntro] El número con el que la fila **ya quedó escrita del lado del servidor**, cuando la carga sigue en la cola porque faltó terminar algo (hoy: la foto de una condición insegura, que entró con la condición pero no se pudo guardar). Ver abajo.
 */

/*
 * ── `yaEntro`, Y POR QUÉ HIZO FALTA UN CAMPO NUEVO ──────────────────────────
 *
 * Hasta el 30/10/2026 una carga que seguía en la cola era, sin excepción, una
 * carga que **no** estaba escrita del otro lado: por eso «corregir y volver a
 * mandar» le da una clave nueva a propósito —es otra carga, con otro cuerpo, y
 * la vieja puede haber quedado reservada—.
 *
 * La foto de una condición insegura rompió ese invariante y es la primera que
 * lo hace: la condición se crea, la foto no se puede guardar, y se contesta un
 * error **a propósito**, porque el `Blob` vive en la cola y sacarla de ahí lo
 * pierde para siempre. O sea que ahora hay cargas en la cola cuya fila ya
 * existe. Sobre una de ésas, corregir **crea una segunda condición** con la
 * misma descripción y la misma foto: el duplicado exacto que la idempotencia
 * por `clave` existe para evitar. Empujarla, en cambio, reusa la clave y cae
 * en la rama de idempotencia, que es justo lo que tiene que pasar.
 *
 * Por eso el número viaja: no es decorativo, es lo que le dice a la pantalla
 * que sobre esta carga el camino de corregir no se ofrece. Lo manda la ruta en
 * `ya_entro` —un nombre que ninguna otra ruta usa, para que nada cambie para
 * el aviso ni para la orden de trabajo— y lo lee `comoContesto`.
 *
 * **Una vez puesto no se saca.** Lo que entró no se des-entra, así que los dos
 * veredictos lo escriben sólo cuando viene, y nunca lo pisan con null.
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
 * permiso) o un 409. El 409 es el que devuelve la ruta de carga cuando la clave
 * quedó reservada y no se sabe si la fila llegó a escribirse en la planilla:
 * reintentar sólo daría otro 409. Todo lo demás es
 * pasajero —un 502 porque Google no contestó, un 500, un corte a mitad de
 * camino— y, sobre todo, el 401: ver la cabecera del archivo.
 *
 * **EL 413 ES EL CUARTO, Y ES DISTINTO DE LOS OTROS TRES: no lo contesta la
 * ruta.** Lo contesta la infraestructura —Vercel corta el cuerpo de un pedido
 * antes de invocar la función— así que el código de la ruta nunca corre y la
 * respuesta no trae el `error` que mandan todas. Entró acá el 30/10/2026, con
 * la foto de una condición insegura: una foto grande viaja adentro del alta,
 * rebota con 413, y como el 413 caía en «no salió de la ruta» se reintentaba
 * **para siempre** —no hay tope de intentos, sólo un techo de espera— mandando
 * megas con los datos de la planta, y el texto que se guardaba le echaba la
 * culpa al WiFi. Un cuerpo demasiado grande es una propiedad **de la carga** y
 * no del camino: el próximo intento lleva exactamente los mismos bytes.
 *
 * @param {number | null} status El código HTTP, o null si ni se llegó a hablar con el servidor.
 * @returns {"definitivo" | "pasajero"}
 */
export function clasificarFallo(status) {
  if (status === 400 || status === 403 || status === 409 || status === 413) {
    return "definitivo";
  }
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
  // carga reserva la clave y el segundo intento recibe un 409.
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
 * **NO LA USA NADIE TODAVÍA, Y ESO HAY QUE DECIRLO ACÁ** porque este archivo es
 * donde alguien viene a leer cuál es la política de reintento. La de hoy, la de
 * verdad, es **«en cada disparo, sin espera»**: ni `public/sw.js` ni
 * `CargarClient.tsx` la llaman. Para respetarla habría que anotar en la carga a
 * partir de cuándo puede volver a salir, y `CargaEnCola` no tiene ese campo.
 * Lo que hay en su lugar, y es lo que esta espera venía a comprar, es que **el
 * vaciado corta en el primer fallo**: sin señal se gasta un pedido por disparo
 * y no uno por carga (ver el punto 3 de `public/sw.js`).
 *
 * Queda escrita y probada porque la decisión ya está tomada —cuánto esperar es
 * esto— y el día que `CargaEnCola` tenga el campo, usarla es una línea. Lo que
 * no puede pasar es que alguien lea esto y crea que el escalonado ya corre.
 *
 * Qué haría si se usara: el primer reintento sale casi enseguida (una señal que
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
 * **LAS TRES FUNCIONES DE NOMBRE LEEN DE UN MAPA, NO DE UN `tipo === "aviso"`.**
 * Con dos tipos el ternario alcanzaba; con el tercero la condición habría caído
 * en la rama de «orden» sin que nada fallara, y dos de las tres frases habrían
 * sonado bien. Con un mapa, un tipo sin entrada ya no cae en la rama de otro.
 *
 * **LO QUE ESTO NO GARANTIZA, PARA QUE NADIE CONFÍE DE MÁS:** los
 * `@type {Record<TipoDeCarga, …>}` de acá son documentación, no una
 * comprobación. `tsconfig.json` tiene `allowJs` y no `checkJs`, y este archivo
 * no lleva `// @ts-check` (se probó: prende errores que ya estaban, en
 * `comoContesto` y `loQueQuedoPendiente`), así que un cuarto tipo sin entrada
 * **compila igual** y devuelve `undefined` —y `concordado` armaría
 * «parad» + «undefined»—. Lo que sí falla es el test «todos los tipos tienen su
 * nombre, su artículo, su vocal y su campo» de `lib/core/colaOffline.test.ts`,
 * que recorre las claves de `RUTA_DE`: al agregar un tipo, empezar por `RUTA_DE`.
 *
 * @type {Record<TipoDeCarga, string>}
 */
const NOMBRE_DE = {
  aviso: "Aviso",
  orden: "Orden de trabajo",
  condicion: "Condición insegura",
};

/**
 * @param {TipoDeCarga} tipo
 * @returns {string}
 */
export function comoSeLlama(tipo) {
  return NOMBRE_DE[tipo];
}

/**
 * Lo mismo, para cuando va en medio de una oración: «Se cargó la orden de
 * trabajo OT-12».
 *
 * @type {Record<TipoDeCarga, string>}
 */
const CON_SU_ARTICULO = {
  aviso: "el aviso",
  orden: "la orden de trabajo",
  condicion: "la condición insegura",
};

/**
 * @param {TipoDeCarga} tipo
 * @returns {string}
 */
export function conSuArticulo(tipo) {
  return CON_SU_ARTICULO[tipo];
}

/**
 * Un participio o adjetivo que concuerda con lo que nombra `conSuArticulo`:
 * «el aviso que quedó parado», «la orden de trabajo que quedó parada». Se da la
 * raíz sin la vocal final («parad») y se le pone la que corresponde.
 *
 * Vive junto al artículo y no en la pantalla porque el género es de la palabra
 * («aviso» es masculino, «orden» femenino), y quien escribe la oración no tiene
 * por qué acordarse: sin esto, un cartel que decía «que quedó parada» salía mal
 * con el aviso y bien con la orden, sin que nada lo notara. «Condición» es
 * femenino, como «orden».
 *
 * @type {Record<TipoDeCarga, "o" | "a">}
 */
const VOCAL_DE = {
  aviso: "o",
  orden: "a",
  condicion: "a",
};

/**
 * @param {TipoDeCarga} tipo
 * @param {string} raiz La palabra sin su vocal final, por ejemplo «parad».
 * @returns {string}
 */
export function concordado(tipo, raiz) {
  return raiz + VOCAL_DE[tipo];
}

// ── Cómo se lee lo que contestó la ruta de alta ──────────────────────────────

/**
 * Cómo se llama el número en la respuesta de cada ruta.
 *
 * @type {Record<TipoDeCarga, string>}
 */
const CAMPO_DEL_NUMERO = {
  aviso: "oa_number",
  orden: "ot_number",
  condicion: "numero",
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
 * `yaEntro` es el número con el que la fila quedó escrita pese al fallo: hoy lo
 * manda sólo el alta de una condición insegura cuando la condición entró y la
 * foto no. Ver el bloque de `CargaEnCola`.
 *
 * @typedef {{ ok: true, numero: string, advertencia: string | null }
 *         | { ok: false, status: number | null, deLaRuta: boolean, error: string, yaEntro?: string | null }} ResultadoDelEnvio
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
  // El 413 primero, porque es el único de acá que **no** es un problema del
  // camino y que no se arregla esperando: lo contesta la infraestructura
  // —Vercel corta el cuerpo antes de invocar la función, así que la ruta no
  // llega a decir nada— y quiere decir que lo que se manda es demasiado
  // grande. Decirle «portal de WiFi» a eso es mandar a alguien a buscar señal
  // por una foto que no va a entrar nunca.
  if (status === 413) {
    return (
      "Lo que se mandó es demasiado grande y el servidor lo cortó antes de " +
      "leerlo, casi seguro por la foto. Esta carga no se reintenta sola: " +
      "corregila con una foto más chica, o sacale la foto y mandala así."
    );
  }
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
 * función exista en vez de mirar `response.ok`. Las tres rutas devuelven siempre
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
      yaEntro: null,
    };
  }

  // `ya_entro` sólo puede venir de la ruta, así que se lee únicamente en la
  // rama que la reconoce: una respuesta que no salió de ella no puede afirmar
  // que algo quedó escrito.
  const dicho = texto(cuerpo.error);
  if (dicho !== null) {
    return { ok: false, status, deLaRuta: true, error: dicho, yaEntro: texto(cuerpo.ya_entro) };
  }

  return {
    ok: false,
    status,
    deLaRuta: false,
    error: laContestoOtro(redirigida, status),
    yaEntro: null,
  };
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
  // **EL 413 ES LA EXCEPCIÓN A LA REGLA DE ARRIBA, Y VA ANTES QUE ELLA.** Es
  // el único código que significa algo aunque no lo haya contestado la ruta:
  // dice que el cuerpo no entra, y el cuerpo es el mismo en cada intento. Sin
  // esto, una foto de 6 MB sale por la rama de «lo contestó otro» y se
  // reintenta sin fin. Ver `clasificarFallo`.
  if (resultado.status === 413) return false;
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
 *         | { accion: "encolar", intentos: number, ultimoError: string | null, yaEntro?: string }} QueHacerConLaNueva
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
  return {
    accion: "encolar",
    intentos: 1,
    ultimoError: resultado.error,
    // El campo va **sólo si vino**: una carga que todavía no está escrita de
    // ningún lado no puede nacer diciendo que sí. Ver el bloque de
    // `CargaEnCola`.
    ...(resultado.yaEntro ? { yaEntro: resultado.yaEntro } : {}),
  };
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
 * se maneja sin leer el segundo campo —y el service worker borraría la carga
 * con la advertencia adentro, que es la que dice «está en la
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
 * decirla. En la pantalla es un cartel; en el service worker, una
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
      // Sólo si vino, y nunca pisándolo con null: lo que entró no se
      // des-entra, y los dos lados aplican estos `cambios` con un spread sobre
      // la fila guardada. Ver el bloque de `CargaEnCola`.
      ...(resultado.yaEntro ? { yaEntro: resultado.yaEntro } : {}),
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
