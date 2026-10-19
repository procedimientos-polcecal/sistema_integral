/**
 * Los dos pedidos de vaciado que la app le hace al service worker, y lo único
 * que hay que entender de este archivo es por qué son dos y no uno.
 *
 * `public/sw.js` sabe vaciar la cola de cargas sin señal —mandar lo que espera
 * y dejar cada carga como corresponda— pero **nadie se lo pedía**: sus dos
 * disparos eran el `push` del resumen diario, que hoy tienen prendido dos
 * personas de trece, y el `sync`, que no registraba nadie. O sea que una carga
 * hecha el viernes en la cantera podía quedarse en el teléfono hasta que su
 * dueño abriera `/cargar` y tocara el botón de cada una.
 *
 * - **`pedirVaciadoEnSegundoPlano`** usa Background Sync: el navegador
 *   guarda el pedido y despierta al worker cuando vuelve la conexión, **con la
 *   app cerrada**. Es el bueno, y **no existe en iPhone**: Safari no implementa
 *   Background Sync en ninguna versión.
 * - **`pedirVaciadoAhora`** le habla al worker activo por `postMessage`. **Pide
 *   más** —necesita la app abierta, porque es la pestaña la que mantiene vivo
 *   al worker— pero a cambio funciona en todos lados, iPhone incluido. Abrir la
 *   app es el único disparo que siempre ocurre, y en la mitad del equipo es el
 *   único que hay.
 *
 * Los dos corren el **mismo** código del otro lado (`loQueHaceUnDisparo` en
 * `public/sw.js`), así que no hay una segunda versión de las reglas que se
 * pueda separar sin que nadie lo note.
 *
 * QUIÉN LOS LLAMA, QUE ES LO QUE EXPLICA POR QUÉ NO ALCANZA CON UNO:
 * `components/CargasEsperando.tsx` pide los dos al abrirse la app con algo en
 * la cola. `app/cargar/CargarClient.tsx` pide el de segundo plano al guardar
 * una carga —la barra no llega ahí, porque `/cargar` vive fuera del grupo
 * `(app)`— y el de ahora cuando vuelve la señal con la pantalla abierta, que en
 * un iPhone es la única de las dos llamadas de esa pantalla que hace algo.
 *
 * LAS DOS FALLAN CALLADAS, A PROPÓSITO. Esto lo llama una barra que se monta en
 * el layout de toda la app: no tiene derecho a romper nada. Sin service worker
 * (Firefox de escritorio, que no soporta los de tipo módulo), sin Background
 * Sync (iPhone), o con el permiso denegado, no hay nada que decirle a la
 * persona —no es algo que ella pidió ni algo que pueda arreglar— y la cola
 * sigue saliendo por donde salía: el botón «Mandar ahora» de `/cargar`.
 */

/**
 * La etiqueta del pedido de Background Sync.
 *
 * **`public/sw.js` no filtra por ella** —atiende cualquier `sync`, porque éste
 * es el único que se registra en todo el SdG—, así que hoy el nombre no
 * sincroniza nada entre los dos archivos y no puede desincronizarse. Se pone
 * igual porque el navegador exige una, porque es lo que se ve al depurar, y
 * porque es el nombre con el que los tests de `lib/core/sw.test.ts` disparan el
 * evento. El día que haya un segundo uso de `sync`, el filtro va allá y esta
 * constante pasa a ser load-bearing.
 */
export const ETIQUETA_DE_VACIADO = "vaciar-la-cola";

/** Lo que `public/sw.js` espera en el `message` para ponerse a vaciar. */
export const MENSAJE_DE_VACIADO = { tipo: "vaciar-la-cola" } as const;

/**
 * `ServiceWorkerRegistration.sync` no está en los tipos del DOM de TypeScript:
 * Background Sync no es parte del estándar que lib.dom describe. El cast es por
 * eso y no para tapar nada — abajo se comprueba que exista antes de usarlo, que
 * es el chequeo que de verdad hace falta, porque en iPhone no está.
 */
type ConSync = ServiceWorkerRegistration & {
  sync?: { register(etiqueta: string): Promise<void> };
};

/**
 * El registro del service worker, o null si no hay.
 *
 * `navigator.serviceWorker.ready` **no resuelve nunca** si el registro falla
 * —Firefox de escritorio rechaza los service workers de tipo módulo— y queda
 * una promesa colgada que nadie observa. Es inofensivo (no hay temporizador ni
 * recurso detrás) y es el precio de esperar a que el worker esté activo, que es
 * lo que las dos funciones de abajo necesitan: `RegistrarServiceWorker` lo
 * registra recién en el `load`, así que al montarse la barra todavía puede no
 * haber ninguno.
 */
async function elWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  return await navigator.serviceWorker.ready;
}

/**
 * Le pide al navegador que vacíe la cola cuando vuelva la señal, aunque la app
 * esté cerrada. Sin Background Sync no hace nada.
 */
export async function pedirVaciadoEnSegundoPlano(): Promise<void> {
  try {
    const registro = await elWorker();
    const sync = (registro as ConSync | null)?.sync;
    if (!sync) return;
    await sync.register(ETIQUETA_DE_VACIADO);
  } catch {
    // Sin permiso de Background Sync, o con el registro rechazado. La cola
    // queda como estaba y sale por el botón de `/cargar`.
  }
}

/**
 * Le pide al worker activo que vacíe la cola ahora mismo.
 *
 * Es el disparo de «abrir la app»: el único que ocurre en un iPhone.
 */
export async function pedirVaciadoAhora(): Promise<void> {
  try {
    const registro = await elWorker();
    // `active` y no `installing` ni `waiting`: un worker que todavía no se
    // activó no tiene corriendo su handler de `message`, así que el mensaje se
    // perdería en silencio. Al que recién se instala lo despierta igual el
    // próximo `load` de la app, que es dentro de muy poco.
    registro?.active?.postMessage(MENSAJE_DE_VACIADO);
  } catch {
    // Lo mismo que arriba.
  }
}
