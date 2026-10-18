/*
 * Las decisiones de la cola de cargas sin señal: qué fallo es definitivo y cuál
 * pasajero, de quién es cada carga, cuál sigue y cuánto se espera entre
 * reintentos. Son funciones puras: no tocan IndexedDB ni `fetch`. Lo que
 * persiste la cola y lo que la dispara son otros archivos; acá sólo se decide.
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
 * @property {string | null} ultimoError Lo que dijo el servidor, sin traducir.
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
