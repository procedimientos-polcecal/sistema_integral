/*
 * Dónde viven en el teléfono la cola de cargas sin señal y los catálogos que
 * la pantalla de carga necesita para armar una carga sin conexión. Es un
 * envoltorio delgado sobre IndexedDB, a mano y sin librería, y NO TIENE
 * NINGUNA DECISIÓN ADENTRO, a propósito: qué carga sigue, qué fallo es
 * definitivo y cuánto se espera viven en `colaOffline.js`, que es lo que se
 * puede probar. Si acá hace falta un `if` que decida algo sobre una carga, está
 * en el archivo equivocado.
 *
 * LO ÚNICO QUE ALGUIEN PODRÍA "SIMPLIFICAR" por no saberlo: esto es IndexedDB y
 * no `localStorage` porque `localStorage` no se puede leer desde un service
 * worker, y la cola está pensada para que la vacíe el service worker con la
 * app cerrada. Con `localStorage` las cargas quedarían guardadas y nadie
 * podría mandarlas hasta que la persona volviera a abrir la app, que es
 * justamente lo que esta cola quiere evitar.
 *
 * Ninguna función traga su propio error. Si la base no abre —Safari en modo
 * privado, el almacenamiento lleno, el permiso denegado— la promesa rechaza, y
 * quien llama decide qué decirle a la persona. La pantalla de carga avisa que
 * no pudo guardar en lugar de fingir que guardó: una carga que se perdió sin
 * aviso es peor que una que se rechazó.
 *
 * Vive en `public/` y es JavaScript plano por la misma razón que
 * `colaOffline.js`: lo importan la app (`app/cargar/CargarClient.tsx` y
 * `components/CargasEsperando.tsx`) y el service worker `public/sw.js`, que no
 * puede importar TypeScript ni nada que el sitio no sirva tal cual. Los
 * tipos van por JSDoc y rigen sólo para quien lo importe desde TypeScript
 * (`tsconfig.json` tiene `allowJs` pero no `checkJs`).
 *
 * No lleva tests, por dos motivos: no tiene decisiones que probar, y probar un
 * envoltorio de IndexedDB exigiría sumar `fake-indexeddb` como dependencia para
 * comprobar que IndexedDB funciona. Lo que sí se va a probar de verdad es el
 * vaciado entero de la cola, en un navegador real, en la última tarea del plan.
 */

/** @typedef {import("./colaOffline.js").CargaEnCola} CargaEnCola */

const NOMBRE_DE_LA_BASE = "sdg";

/**
 * Sube cuando cambia la forma de la base. Hoy no hay migraciones: la única
 * versión crea los dos almacenes.
 *
 * El día que haya una versión 2, una pestaña vieja con la versión 1 abierta
 * puede bloquear la subida: `onversionchange` le cierra la conexión, pero si
 * esa pestaña no llega a hacerlo `abrirBase` rechaza con un error de bloqueo, y
 * si el desbloqueo llega tarde la conexión que se abra se cierra sola.
 */
const VERSION_DE_LA_BASE = 1;

const ALMACEN_COLA = "cola";
const ALMACEN_CATALOGOS = "catalogos";

/**
 * Abre la base `sdg`, creándola la primera vez. Cola: una carga por `clave`.
 * Catálogos: un catálogo por `nombre`.
 *
 * Es pública porque el service worker y la app la necesitan igual; las demás
 * funciones la llaman por su cuenta y cierran la conexión al terminar, así que
 * quien use `abrirBase` directamente es dueño de cerrar lo que abrió.
 *
 * @returns {Promise<IDBDatabase>}
 */
export function abrirBase() {
  return new Promise((resolver, rechazar) => {
    // `indexedDB` puede no existir (un contexto sin almacenamiento): esa
    // excepción tiene que salir como rechazo y no como un throw síncrono.
    let rechazada = false;
    let pedido;
    try {
      pedido = indexedDB.open(NOMBRE_DE_LA_BASE, VERSION_DE_LA_BASE);
    } catch (error) {
      rechazar(error);
      return;
    }

    pedido.onupgradeneeded = () => {
      const base = pedido.result;
      if (!base.objectStoreNames.contains(ALMACEN_COLA)) {
        base.createObjectStore(ALMACEN_COLA, { keyPath: "clave" });
      }
      if (!base.objectStoreNames.contains(ALMACEN_CATALOGOS)) {
        base.createObjectStore(ALMACEN_CATALOGOS, { keyPath: "nombre" });
      }
    };
    pedido.onsuccess = () => {
      const base = pedido.result;
      // Si ya se rechazó por el bloqueo, nadie recibió esta conexión y nadie la va
      // a cerrar: se cierra acá para no dejarla abierta bloqueando futuras subidas.
      if (rechazada) {
        base.close();
        return;
      }
      // Si otra pestaña pide subir la versión, esta conexión no puede quedarse
      // abierta bloqueándola.
      base.onversionchange = () => base.close();
      resolver(base);
    };
    pedido.onerror = () => rechazar(pedido.error);
    pedido.onblocked = () => {
      rechazada = true;
      rechazar(new Error("La base sdg está bloqueada por otra pestaña abierta."));
    };
  });
}

/**
 * Corre `trabajo` dentro de una transacción y devuelve lo que éste devuelva,
 * pero sólo cuando la transacción terminó de verdad: para una escritura,
 * resolver con el `onsuccess` del pedido no garantiza que haya quedado en el
 * disco, y la cola existe justamente para no perder lo cargado.
 *
 * @template T
 * @param {string} almacen
 * @param {IDBTransactionMode} modo
 * @param {(almacen: IDBObjectStore) => IDBRequest<T> | null} trabajo Devuelve el pedido cuyo resultado se quiere, o null si no hay nada que devolver.
 * @returns {Promise<T | undefined>}
 */
async function enTransaccion(almacen, modo, trabajo) {
  const base = await abrirBase();
  try {
    return await new Promise((resolver, rechazar) => {
      const transaccion = base.transaction(almacen, modo);
      const pedido = trabajo(transaccion.objectStore(almacen));
      transaccion.oncomplete = () => resolver(pedido ? pedido.result : undefined);
      // El error va del pedido que falló y no de `transaccion.error`: ese campo
      // recién se llena cuando la transacción aborta, y el evento de error sube
      // a la transacción antes, así que acá todavía vale `null`. Rechazar con
      // `null` rompería el `catch` de quien llama en cuanto lea `e.message`.
      transaccion.onerror = (evento) =>
        rechazar(
          /** @type {IDBRequest} */ (evento.target)?.error ??
            transaccion.error ??
            new Error("Falló una operación de la base."),
        );
      transaccion.onabort = () =>
        rechazar(transaccion.error ?? new Error("La transacción se canceló."));
    });
  } finally {
    base.close();
  }
}

/**
 * Guarda una carga; si ya había una con esa `clave`, la reemplaza.
 *
 * @param {CargaEnCola} carga
 * @returns {Promise<void>}
 */
export async function guardarCarga(carga) {
  await enTransaccion(ALMACEN_COLA, "readwrite", (almacen) => almacen.put(carga));
}

/**
 * Todas las cargas de la cola, de todas las personas y en cualquier estado, sin
 * ordenar: quién puede mandar qué y en qué orden lo decide `colaOffline.js`.
 *
 * @returns {Promise<CargaEnCola[]>}
 */
export async function leerCola() {
  const cargas = await enTransaccion(ALMACEN_COLA, "readonly", (almacen) =>
    almacen.getAll(),
  );
  return cargas ?? [];
}

/**
 * Le cambia a una carga sólo los campos que se pasan. Leer y escribir ocurren
 * en la misma transacción para que dos disparos que actualizan la misma carga
 * a la vez no se pisen con una copia vieja.
 *
 * Si la carga ya no existe —otra pestaña la mandó y la borró entre medio— no
 * hace nada: crearla a partir de unos cambios sueltos dejaría en la cola una
 * carga sin `cuerpo` ni `usuarioId`, que es peor que no tenerla. No es un
 * error de la base, así que no rechaza.
 *
 * @param {string} clave
 * @param {Partial<CargaEnCola>} cambios
 * @returns {Promise<void>}
 */
export async function actualizarCarga(clave, cambios) {
  await enTransaccion(ALMACEN_COLA, "readwrite", (almacen) => {
    const lectura = almacen.get(clave);
    lectura.onsuccess = () => {
      const actual = lectura.result;
      if (actual === undefined) return;
      // `clave` va al final: es la identidad de la carga, y un `cambios` con otra
      // crearía una carga nueva dejando viva la original.
      almacen.put({ ...actual, ...cambios, clave });
    };
    return null;
  });
}

/**
 * Saca una carga de la cola. Borrar una que no existe no es un error.
 *
 * @param {string} clave
 * @returns {Promise<void>}
 */
export async function borrarCarga(clave) {
  await enTransaccion(ALMACEN_COLA, "readwrite", (almacen) => almacen.delete(clave));
}

/**
 * Guarda un catálogo entero bajo su nombre, reemplazando el anterior. No mira
 * qué hay adentro: es lo que `leerCatalogo` devuelve tal cual.
 *
 * @param {string} nombre
 * @param {unknown} datos
 * @returns {Promise<void>}
 */
export async function guardarCatalogo(nombre, datos) {
  await enTransaccion(ALMACEN_CATALOGOS, "readwrite", (almacen) =>
    almacen.put({ nombre, datos }),
  );
}

/**
 * El catálogo guardado bajo ese nombre, o null si nunca se guardó uno. El tipo
 * `T` lo afirma quien llama: acá no se valida.
 *
 * @template T
 * @param {string} nombre
 * @returns {Promise<T | null>}
 */
export async function leerCatalogo(nombre) {
  const registro = await enTransaccion(ALMACEN_CATALOGOS, "readonly", (almacen) =>
    almacen.get(nombre),
  );
  return registro === undefined ? null : registro.datos;
}
