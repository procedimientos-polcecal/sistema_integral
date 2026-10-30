// Service worker del SdG. Hace cinco cosas: recibe notificaciones Web Push,
// lleva a la persona a donde la notificación dice al tocarla, existe para que
// el navegador considere instalable a la app, **guarda la pantalla `/cargar`
// para poder abrirla sin señal**, y **vacía la cola de cargas**, con la app
// abierta o cerrada según cuál de sus tres disparos le llegue.
//
// ── ES UN MÓDULO, Y ESO OBLIGA A LOS DOS `register()` ────────────────────────
//
// Las reglas de la cola —qué fallo es definitivo, de quién es una carga, cómo
// queda después de un intento— tienen que ser **las mismas** que corre la
// pantalla, palabra por palabra: dos implementaciones de la misma transición,
// una acá y otra en React, es como esto se separa sin que nadie lo note. Por
// eso viven en `public/cola/`, en JavaScript plano servido tal cual, y se
// importan desde acá como módulos ES.
//
// La consecuencia es que este archivo **se registra con `{ type: "module" }`**,
// en `components/RegistrarServiceWorker.tsx` y en
// `components/BotonNotificaciones.tsx`.
//
// **QUÉ PASA CON LOS 14 QUE YA TIENEN EL WORKER CLÁSICO DE LA FASE 2. Medido en
// Chromium el 19/10/2026, no deducido:** registrar el mismo alcance con un tipo
// distinto del que ya está **no rechaza**. Devuelve la misma registración y
// arranca un worker `installing`, o sea que dispara una actualización normal,
// que es lo que dice el algoritmo del estándar. (Antes acá decía que chocaba.
// Era falso y nadie lo había medido.)
//
// **Y SI EL MÓDULO NO CARGA, EL MODO DE FALLAR ES EL SEGURO**, también medido:
// un script de módulo que no se puede cargar hace que el `register` rechace y
// **deja al worker anterior en `activated`**. Se sigue con el viejo, el push
// sigue andando, y un deploy posterior arreglado se toma en el chequeo
// siguiente. Eso es lo que vuelve aceptable el riesgo de este cambio.
// Falta confirmarlo en Safari/iOS: el algoritmo es el mismo y Chromium lo
// cumple, pero no se midió ahí.
//
// Lo que **sí** rompe todo es que los imports no carguen, y eso ya pasaba:
// medido contra producción el 19/10/2026, `/cola/cualquier-cosa.js` devolvía
// *«The script resource is behind a redirect, which is disallowed»* —el 307 al
// login del `proxy.ts`—. Por eso `proxy.ts` ahora deja `cola` afuera de su
// matcher. Sin esa exclusión el service worker entero no se registra.
import {
  CABECERA_DEL_DISPARO,
  DISPARO,
  RUTA_DE,
  SESION,
  comoContesto,
  conSuArticulo,
  cuerpoComoFormData,
  despuesDelIntento,
  llevaArchivo,
  proximaAMandar,
  siNoSePudoAvisar,
  tomarLaCarga,
} from "/cola/colaOffline.js";
import { actualizarCarga, borrarCarga, leerCatalogo, leerCola } from "/cola/idb.js";

// ── Que una versión nueva tome el control, en vez de quedarse esperando ──
//
// Sin esto, un service worker nuevo se instala y queda **en espera** hasta que
// se cierren TODAS las ventanas de su alcance, y mientras tanto el viejo sigue
// atendiendo los `push`. Con la app instalada en un teléfono eso puede no pasar
// en días: mandarla atrás no la cierra, y basta una pestaña del dominio abierta
// en otro lado para que el worker viejo siga vivo.
//
// Y lo peor es que no se nota: un service worker en espera no se distingue de
// uno que funciona. El 18/10/2026 se arregló acá que la notificación llevara a
// su pantalla, se desplegó, y el único teléfono con notificaciones prendidas
// siguió cayendo en el inicio — el arreglo estaba servido y no corría. Mirando
// para atrás, **ningún arreglo hecho a este archivo desde la fase 1 llegó nunca
// a un aparato con la app instalada**. `register("/sw.js")` corre en cada carga,
// pero eso descarga el worker nuevo; no lo activa.
//
// **CÓMO CONVIVE CON EL CACHÉ, QUE YA ESTÁ ACÁ.** El aviso de arriba decía que
// el día que este archivo cacheara, `skipWaiting` pasaría a significar que a una
// página ya cargada con los assets de una versión se le empiecen a servir los de
// otra. Ese día es hoy, y lo que lo vuelve seguro son estas dos cosas:
//
//   - **Un chunk que no está en el caché sale a la red.** En Vercel los assets
//     de los despliegues viejos siguen estando, así que una página ya cargada
//     que pide un chunk de otra versión lo consigue igual. Ésta es la que hace
//     todo el trabajo.
//   - **El respaldo de navegación se activa sólo cuando la red falla**, nunca
//     para una página que cargó bien: con señal, lo que llega es lo del
//     servidor, igual que sin service worker.
//
// El nombre del caché además va **versionado**, pero ojo con lo que eso es y lo
// que no: `CACHE` es un literal que sólo cambia **a mano**, así que no hay un
// caché por despliegue. Es una palanca para el día en que lo guardado quede
// inservible, no parte de lo de arriba.
//
// **El `activate` no borra ningún caché** —`caches.delete` se lleva un caché
// entero, incluido el que está usando una pestaña abierta, y eso es justamente
// lo que volvería peligroso a `skipWaiting`—. Lo que sí hace el `install` es
// **limpiar adentro del propio caché** lo que la pantalla ya no pide; por qué
// eso sí es seguro está explicado en `guardarLaPantalla`. Un test fija la
// diferencia.
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(guardarLaPantalla());
});
self.addEventListener("activate", (event) => event.waitUntil(clients.claim()));

/**
 * El caché, con el nombre versionado. **Subir el número estrena caché**: es lo
 * que hay que hacer cuando lo guardado quedó inservible y nada lo va a
 * arreglar solo, porque `install` corre una sola vez por versión de este
 * archivo y `guardarLaPantallaSiFalta` mira si **hay** algo guardado, no si lo
 * que hay sirve.
 *
 * **POR QUÉ ESTÁ EN v2.** La v1 se desplegó con un `guardarLaPantalla` que
 * guardaba el HTML primero y después bajaba los archivos uno por uno siguiendo
 * de largo con el que fallara (commits `48715d1` y `0b18d61`, los dos ya en
 * producción). En un aparato donde la señal se cortó en el medio quedó un
 * `/cargar` guardado **sin sus chunks**: sin señal, la pantalla en blanco. El
 * arreglo de esa función no alcanza para curarlos —`install` los repara si su
 * única corrida anda, y si falla no hay nada más que los recupere—, y el
 * reintento ve el HTML presente y se va. Con el nombre nuevo el caché nace
 * vacío, así que el reintento sí se activa y lo que quedó a medias deja de
 * existir.
 *
 * O sea: esta palanca se toca cuando lo guardado puede estar roto de una forma
 * que el código nuevo no distingue de lo sano. No para estrenar versión.
 */
const CACHE = "sdg-cargar-v2";

/** La única pantalla que se guarda. El resto de la app sigue necesitando red. */
const LA_PANTALLA = "/cargar";

/**
 * Guarda `/cargar` y los archivos que esa página pide.
 *
 * **Sin los archivos la página no sirve de nada**: el HTML que manda Next no
 * trae nada dibujado —lo dibuja su JavaScript—, así que una `/cargar` guardada
 * sin sus chunks es una pantalla en blanco, que es peor que el error de
 * sin-conexión del navegador porque parece que algo anda.
 *
 * **Y OJO CON LO QUE SE GUARDA.** `/cargar` pide sesión en `proxy.ts` a
 * propósito, así que un pedido sin cookie válida termina en el login con un 200
 * redondo —`fetch` sigue el redirect—. Guardar eso sería servirle el login para
 * siempre a quien abra la pantalla sin señal. Por eso se mira `redirected`: no
 * alcanza con `ok`.
 *
 * **Y ACÁ SE LIMPIA LO QUE SOBRA**, que es lo que mantiene a este caché del
 * tamaño de una pantalla en vez de dejarlo crecer para siempre. Eso importa más
 * de lo que parece: **el desalojo de un origen se lleva todo el almacenamiento,
 * IndexedDB incluido**, o sea la base `sdg` con las cargas que todavía no
 * salieron. De eso no se vuelve —lo que alguien escribió sin señal desaparece
 * sin aviso—, así que un caché que crece sin límite empuja contra la cuota
 * justamente donde vive lo que este plan existe para no perder.
 *
 * Por qué borrar **acá adentro** sí es seguro, al revés que un `caches.delete`:
 * esto corre sólo cuando el `fetch` de arriba anduvo, o sea **con red**, y un
 * chunk que se saca y alguien pide igual cae en la red, donde Vercel todavía
 * tiene los assets de los despliegues viejos. Sin red no se borra nada, porque
 * la función ya salió por el `catch`.
 *
 * **ES TODO O NADA, Y ESO FUE UNA DECISIÓN.** Antes bajaba el HTML, lo
 * guardaba, y después intentaba los archivos uno por uno siguiendo de largo con
 * el que fallara. Si la red se cortaba en el medio —la señal de la cantera, que
 * es **exactamente** la gente para la que esto existe— quedaba un `/cargar`
 * guardado cuyos chunks no estaban y cuyos reemplazos viejos ya se habían
 * podado: sin señal, la pantalla en blanco, que es peor que el error del
 * navegador porque parece que algo anda. Y no la curaba nadie, porque el
 * `install` no vuelve a correr hasta que cambien los bytes de este archivo.
 * Ahora: se baja **todo** primero y recién si está todo se escribe. Si falta
 * uno, el caché queda **exactamente como estaba** —ni el HTML nuevo, ni los
 * archivos nuevos, ni la poda—, así que lo que ya andaba sigue andando y lo que
 * no había sigue sin haber, que es honesto.
 *
 * La otra salida que se consideró era curar lo que faltara al pasar por el
 * handler de `fetch`, limitado a las urls que el HTML guardado nombra. Se
 * descartó porque sólo cura **con red**, que es justo cuando la pantalla anda
 * igual sin caché: cierra la ventana donde no duele y la deja abierta donde sí.
 *
 * Lo que sí resuelve el «¿y si falló la única vez que corrió?» está en el
 * `sync` y el `push`: esto se vuelve a intentar cada vez que despiertan al
 * worker, y como es todo o nada, un intento que falla no puede empeorar nada.
 *
 * No rechaza nunca: un `install` que falla deja al worker sin activarse, y con
 * él se van el push y el vaciado. Guardar la pantalla es lo que se puede perder.
 */
async function guardarLaPantalla() {
  try {
    const respuesta = await fetch(LA_PANTALLA);
    if (!respuesta.ok || respuesta.redirected) return;

    const html = await respuesta.clone().text();
    const archivos = archivosDe(html);

    // Todos juntos y ninguno guardado todavía: si uno falla, esto tira y el
    // `catch` sale sin haber tocado el caché. Es lo contrario de `cache.addAll`
    // sólo en una cosa, y es la que importa: el error dice cuál faltó.
    const bajados = await Promise.all(
      archivos.map(async (url) => {
        const archivo = await fetch(url);
        if (!archivo.ok) throw new Error(`${url} contestó ${archivo.status}`);
        return archivo;
      })
    );

    const cache = await caches.open(CACHE);
    await Promise.all(archivos.map((url, i) => cache.put(url, bajados[i])));
    await cache.put(LA_PANTALLA, respuesta);
    await sacarLoQueYaNoPide(cache, archivos);
  } catch {
    // Sin red, o con un archivo que no vino: el caché queda como estaba y el
    // worker se activa igual. Se vuelve a intentar en el próximo `sync` o
    // `push`.
  }
}

/**
 * Lo mismo, pero sólo si no hay nada guardado.
 *
 * Es el reintento del todo-o-nada: `install` corre **una sola vez** por versión
 * de este archivo, así que un corte de señal en ese momento dejaba a ese
 * teléfono sin pantalla sin señal hasta el próximo despliegue del service
 * worker. Los disparos que despiertan al worker vuelven a intentarlo.
 *
 * **A CUÁNTA GENTE LE LLEGA ESTE REINTENTO.** Los disparos son tres. El push
 * necesita permiso de notificaciones, que al 19/10/2026 tiene **una sola
 * persona de trece** (medido contra `push_suscripciones`: una suscripción, un
 * usuario, trece usuarios activos). El `sync` llega a quien tenga algo
 * esperando en la cola y un navegador con Background Sync, o sea Android y no
 * iPhone. Y el `message`, que es el que nivela: lo manda la app, en cualquier
 * navegador.
 *
 * **Y el `message` es el que hace que esto repare de verdad**, desde el
 * 19/10/2026: `/cargar` abierta **con señal** lo pide **sin condición**. Antes
 * los dos últimos se pedían sólo si había alguna carga en estado `esperando`, y
 * eso dejaba sin reparación al teléfono que nunca encoló nada —o sea a casi
 * todos—, que es justamente el que puede tener el caché a medias sin saberlo.
 * La barra del layout sigue pidiéndolo bajo la condición vieja, porque ahí no
 * hay señal garantizada y despertar al worker para que mire una cola vacía no
 * compra nada.
 *
 * **Y sólo si falta, no cada vez.** Rebajar `/cargar` y sus once archivos en
 * cada push sería medio mega por día por aparato contra una señal que ya es
 * mala, a cambio de refrescar algo que no lo necesita: lo guardado es
 * consistente consigo mismo —el HTML viejo pide los chunks viejos, que están—,
 * así que quedarse viejo no lo rompe. Lo que no se puede dejar pasar es que
 * falte.
 */
async function guardarLaPantallaSiFalta() {
  try {
    const cache = await caches.open(CACHE);
    if (await cache.match(LA_PANTALLA)) return;
  } catch {
    // Sin caché no hay nada que completar.
    return;
  }
  await guardarLaPantalla();
}

/**
 * Saca del caché lo que la pantalla guardada ya no pide: los chunks del
 * despliegue anterior, que llevan otro hash en el nombre y no los va a volver a
 * pedir nadie.
 *
 * Se compara por el **camino** y no por la url entera porque lo que entra por
 * el handler de `fetch` se guarda con la url absoluta y lo del precache con la
 * ruta tal como la escribe el HTML; son la misma cosa escrita de dos formas.
 *
 * @param {Cache} cache
 * @param {string[]} archivos Lo que la pantalla pide ahora.
 */
async function sacarLoQueYaNoPide(cache, archivos) {
  const sirven = new Set([LA_PANTALLA, ...archivos]);
  const guardados = await cache.keys();
  await Promise.all(
    guardados.map(async (pedido) => {
      const camino = new URL(pedido.url, self.location.origin).pathname;
      if (!sirven.has(camino)) await cache.delete(pedido);
    })
  );
}

/**
 * Los archivos que un HTML pide: los `src` de `<script>`, los `href` de
 * `<link rel="stylesheet">` y los de `<link rel="preload">` que traen código
 * —`as="script"` o `as="style"`—. No es un parser de HTML y no pretende serlo
 * —en un service worker no hay DOM—, así que se queda con lo que Next escribe y
 * con nada más: rutas que empiezan con una sola barra, o sea de este mismo
 * origen.
 *
 * **Los `preload` de código entran aunque hoy sean redundantes.** En el
 * `/cargar` de hoy el único `preload` apunta a un chunk que además está como
 * `<script src>`, así que no cambia nada; pero si mañana Next emite uno que no,
 * ese archivo no estaría guardado y la pantalla fallaría sin señal. Antes acá
 * decía que quedaban afuera «porque van a pasar por el handler de `fetch`», y
 * eso dejó de ser cierto cuando el handler dejó de guardar lo que pasa.
 *
 * Lo que queda afuera: los `preload` de fuentes e imágenes —sin ellos la
 * pantalla se dibuja igual, con la tipografía de respaldo— y cualquier url de
 * otro origen, que no se puede guardar sin saber si contesta con CORS.
 *
 * @param {string} html
 * @returns {string[]}
 */
function archivosDe(html) {
  const urls = new Set();

  for (const etiqueta of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    urls.add(etiqueta[1]);
  }

  for (const etiqueta of html.matchAll(/<link\b[^>]*>/gi)) {
    const hojaDeEstilo = /\brel=["']stylesheet["']/i.test(etiqueta[0]);
    const codigoPrecargado =
      /\brel=["']preload["']/i.test(etiqueta[0]) &&
      /\bas=["'](?:script|style)["']/i.test(etiqueta[0]);
    if (!hojaDeEstilo && !codigoPrecargado) continue;
    const href = etiqueta[0].match(/\bhref=["']([^"']+)["']/i);
    if (href) urls.add(href[1]);
  }

  // `//otro.com/x.js` también empieza con barra y es de otro origen.
  return [...urls].filter((url) => url.startsWith("/") && !url.startsWith("//"));
}

// Handler de `fetch`: responde **las navegaciones a una pantalla del SdG**
// yendo a la red —y cayendo en la pantalla guardada si la red falla—, y guarda
// al pasar lo de `/_next/static/`.
//
// **Está por la instalabilidad. Que nadie lo borre por parecer inútil.** Chrome
// no dispara `beforeinstallprompt` si el service worker no tiene un handler de
// `fetch`, y entonces el botón de instalar de Android no aparece nunca, sin
// ningún error: la app simplemente no se ofrece. `lib/core/sw.test.ts` verifica
// que siga registrado y que haga lo que dice acá.
//
// **POR QUÉ NO ESTÁ VACÍO.** Lo estuvo, y no servía: un `() => {}` es
// literalmente el patrón que Chrome documenta como gameado —los sitios ponían
// handlers vacíos sólo para pasar el criterio— y que por eso dejó de aceptar. El
// requisito de que haya handler sigue en pie, así que tiene que hacer algo
// observable. Durante la fase 2 fue el mínimo honesto —contestar la navegación
// con la misma petición que iba a salir igual—; hoy además tiene el respaldo
// sin señal, que es lo que esa navegación gana por pasar por acá.
//
// **EL RIESGO, QUE CORRE EN PRODUCCIÓN PARA TODOS.** Si la promesa que recibe
// `respondWith` rechaza, la navegación falla. Sin señal `fetch` rechaza y, si
// no hay nada guardado, el navegador muestra su página de sin-conexión — que es
// exactamente lo que pasaba antes de que existiera este archivo, así que no
// empeora nada. Lo que hay ahora es una salida mejor cuando sí hay algo
// guardado: la pantalla de carga.
//
// Se filtran los pedidos que no son navegación (imágenes, JSON) para no meterse
// en el medio de todo el tráfico de la app a cambio de nada. La excepción es
// `/_next/static/`, que se **lee** del caché: sin eso la pantalla guardada no
// encontraría sus propios chunks sin señal, que es todo el punto.
//
// **PERO NO SE GUARDA NADA AL PASAR, Y ESO SE DECIDIÓ.** Guardar todo chunk que
// pasa era tentador —esos nombres llevan hash, así que nunca quedan viejos— y
// significaba acumular el bundle entero de cada despliegue para siempre. Lo que
// eso compra es casi nada: la pantalla guardada apunta a los chunks que el
// precache ya tiene, y para cualquier **otra** pantalla este plan no promete
// nada sin señal. Lo que cuesta es concreto: **el desalojo de un origen se lleva
// todo el almacenamiento, IndexedDB incluido**, o sea la cola con lo que alguien
// cargó sin señal y todavía no salió. De eso no se vuelve. El caché se queda del
// tamaño de una pantalla.
//
// **Y SE FILTRAN ADEMÁS `/api/` Y `/auth/`, QUE TAMBIÉN SON NAVEGACIONES.** Esto
// no es una optimización ni una redundancia: es no meterse en el medio de dos
// caminos que **no se pueden probar desde acá** y que, si salen mal, no se
// arreglan con un deploy —un service worker ya registrado sigue sirviendo hasta
// que se actualiza—. Los dos casos, concretos:
//
//   - **Las 14 descargas de Excel** (RRHH, Remises, Cantera, Taller Vial,
//     Trituración). Un `<a href="/api/.../export">` **es una navegación** aunque
//     lo que vuelva sea un Excel con `Content-Disposition: attachment`: el
//     `mode` del pedido no distingue "ir a una pantalla" de "bajar un archivo".
//   - **El canje del `?code=` de los correos** (`/auth/confirm`,
//     `/auth/callback`): una navegación que devuelve un **302 con `Set-Cookie`**,
//     y es por donde entra **todo usuario nuevo y toda recuperación de
//     contraseña**. Si ahí algo se comporta distinto, nadie puede entrar.
//
// Los dos deberían funcionar igual pasando por acá, según el estándar, y nadie
// encontró cómo romperlos. La asimetría es la que decide: no ganamos nada
// atravesándolos y perdemos el acceso de todo el mundo si nos equivocamos. **Que
// nadie saque estas dos líneas por parecer de más.**
//
// El chequeo de origen va por lo mismo: una navegación a otro dominio no tiene
// por qué pasar por el service worker del SdG.
//
// Chrome sigue conforme: lo único que mira es que haya un handler de `fetch` que
// responda las navegaciones de página, y ésas siguen pasando por acá.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Antes que el filtro de navegación, porque un chunk no es una navegación.
  if (url.pathname.startsWith("/_next/static/") && event.request.method === "GET") {
    event.respondWith(loGuardadoOLaRed(event.request));
    return;
  }

  if (event.request.mode !== "navigate") return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  // Un POST que navega (el envío de un formulario) no se contesta con una
  // pantalla guardada: lo que esa persona quiere saber es si su POST entró.
  if (event.request.method !== "GET") {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(laRedYSiNoLaPantalla(event.request));
});

/**
 * Un archivo de `/_next/static/`: lo guardado si está, y si no la red.
 *
 * El caché es lo primero porque esos nombres llevan hash —el contenido de una
 * url nunca cambia—, así que servir lo guardado no puede devolver algo viejo.
 * Y el que no está sale a la red **sin fallar**: en Vercel los assets de los
 * despliegues anteriores siguen estando, así que una página ya cargada que pide
 * un chunk de otra versión lo consigue igual. Eso es lo que deja que este caché
 * conviva con `skipWaiting`.
 *
 * Acá no se guarda nada; lo que hay guardado lo puso `guardarLaPantalla`. El
 * porqué está arriba, en el comentario del handler.
 *
 * **Y SI EL CACHÉ NO SE PUEDE ABRIR, ESTO SE APARTA.** `caches.open` tira en la
 * ventana privada de Safari y con el almacenamiento bloqueado; dejar salir esa
 * excepción haría que `respondWith` rechace y **el chunk no cargue**, o sea que
 * la app se rompa para esa persona por una mejora que no le llegó. Pasar a la
 * red es comportarse como si este archivo no existiera, que es lo correcto.
 *
 * @param {Request} pedido
 * @returns {Promise<Response>}
 */
async function loGuardadoOLaRed(pedido) {
  try {
    const cache = await caches.open(CACHE);
    const guardado = await cache.match(pedido);
    if (guardado) return guardado;
  } catch {
    // Sin caché, a la red y nada más.
  }

  return await fetch(pedido);
}

/**
 * Una navegación: la red, y la pantalla guardada **sólo si la red falló**.
 *
 * El orden importa y es la mitad de la decisión. Al revés —el caché primero—
 * una persona con señal vería la pantalla de hace una semana, y peor: vería
 * `/cargar` en lugar de la pantalla que pidió. Acá, con señal no cambia
 * absolutamente nada respecto de no tener service worker.
 *
 * **SIN SEÑAL SE CONTESTA UN REDIRECT Y NO EL DOCUMENTO, Y ÉSE ES EL CAMINO
 * PRINCIPAL.** El `start_url` del manifest es `/` (ver `app/manifest.ts`), así
 * que tocar el ícono de la app sin señal **navega a `/`**, no a `/cargar`.
 * Contestar ahí con el documento de `/cargar` dejaría una página cuyo payload
 * de Next describe `/cargar` mientras `location.pathname` dice `/`: si el
 * router no tolera ese desajuste, la pantalla queda en blanco, que es **peor**
 * que el error de sin-conexión del navegador. Mandándolo a `/cargar` el
 * navegador pide esa url, vuelve a entrar por acá y recibe el documento **en su
 * propio camino**, donde no hay nada que tolerar. No depende de cómo se porte
 * el router, que es lo que lo hace la opción correcta y no la cómoda.
 *
 * Y si no hay nada guardado, el error vuelve a salir tal cual: el navegador
 * muestra su página de sin-conexión, como siempre. Nunca se redirige a una
 * pantalla que no está guardada, que sería un lazo.
 *
 * @param {Request} pedido
 * @returns {Promise<Response>}
 */
async function laRedYSiNoLaPantalla(pedido) {
  try {
    return await fetch(pedido);
  } catch (sinRed) {
    try {
      const cache = await caches.open(CACHE);
      const guardada = await cache.match(LA_PANTALLA);
      if (guardada) {
        return new URL(pedido.url).pathname === LA_PANTALLA
          ? guardada
          : Response.redirect(new URL(LA_PANTALLA, self.location.origin).href, 302);
      }
    } catch {
      // El caché no se pudo abrir. Lo que hay que contarle a quien navega
      // sigue siendo que no hay red, no que falló el caché.
    }
    throw sinRed;
  }
}

self.addEventListener("push", (event) => {
  let data = { title: "SdG", body: "" };
  try {
    data = event.data.json();
  } catch {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "SdG", {
      body: data.body || "",
      // El ícono de 192 y no `logo.png`, que pesa 2 MB y mide 4266×4266: cada
      // notificación se bajaba el logo entero para dibujar un ícono de 64.
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // El payload ENTERO, no `data.data`.
      //
      // Lo que manda el servidor es un `Aviso` de `lib/core/webpush.ts`:
      // `{title, body, url}`, con la url en el primer nivel. Esto decía
      // `data: data.data`, o sea un nivel que nadie escribe nunca, así que
      // `event.notification.data` llegaba `undefined`, `destinoDe` caía en su
      // rama de respaldo y **toda notificación abría el inicio** en vez de su
      // pantalla. Confirmado en producción el 18/10/2026.
      //
      // El test no lo vio porque le pasaba al handler un payload anidado que
      // el servidor no produce: inventaba la forma en vez de copiar la del
      // contrato. Ahora hay un test que arranca de un `Aviso` de verdad y
      // sigue hasta el click.
      data,
    })
  );

  // El push es, hoy, el disparo que de verdad despierta a este archivo con la
  // app cerrada: el resumen diario llega a las 11:30 UTC. Se aprovecha para
  // vaciar la cola, y el `waitUntil` es lo que pide que el navegador no mate al
  // worker apenas terminó de dibujar la notificación.
  //
  // Es un `waitUntil` aparte y no un `Promise.all` con el de arriba por una
  // razón sola: **el navegador espera por los dos igual**, así que juntarlos no
  // cambia cuánto vive el worker, y separados se lee qué es cada cosa —la
  // notificación es lo prometido, el trabajo de abajo es lo de más—.
  event.waitUntil(loQueHaceUnDisparo(DISPARO.fondo));
});

/**
 * El segundo disparo: `sync`, que el navegador entrega cuando vuelve la señal,
 * incluso con la app cerrada. Lo registra `pedirVaciadoEnSegundoPlano` de
 * `lib/core/vaciarLaCola.ts`, con la etiqueta `"vaciar-la-cola"`.
 *
 * **No se filtra por etiqueta**, y no es un descuido: ése es el único `sync`
 * que se registra en todo el SdG, así que el filtro no podría descartar nada y
 * sí podría descartarlo todo el día que alguien cambiara una de las dos
 * cadenas. El día que haya un segundo uso de `sync`, acá va el filtro.
 *
 * **No llega nunca a un iPhone**: Safari no implementa Background Sync en
 * ninguna versión. Para esos aparatos está el `message` de abajo.
 */
self.addEventListener("sync", (event) => event.waitUntil(loQueHaceUnDisparo(DISPARO.fondo)));

/**
 * El tercer disparo, y el único que ocurre en todos lados: la app abierta
 * pidiéndolo. Lo manda `pedirVaciadoAhora` de `lib/core/vaciarLaCola.ts`, desde
 * dos lados y **con una condición distinta cada uno**: la barra del layout sólo
 * si hay algo en estado `esperando`, y `/cargar` **siempre que haya señal**,
 * porque ahí el vaciado no es lo único que se pide —también se repara el caché,
 * y eso le hace falta justo al teléfono que no tiene nada en la cola—.
 *
 * Pide más que los otros dos —necesita una pestaña abierta, porque es ella la
 * que mantiene vivo al worker— pero es el que siempre está: el `push` lo tiene
 * prendido **una sola persona de trece** (medido el 19/10/2026) y el `sync` no
 * existe en iPhone. Abrir la app es lo único que hace todo el mundo.
 *
 * **Se filtra por `tipo` aunque hoy éste sea el único mensaje**, al revés que
 * el `sync` de arriba, y la diferencia es cuál es el riesgo de cada uno. Un
 * `sync` sin filtrar no puede venir de otro lado: lo entrega el navegador por
 * un pedido nuestro. Un `message` sí —cualquier código de la página, hoy o
 * mañana, puede mandarle uno al worker—, así que atender cualquier cosa sería
 * ponerse a vaciar la cola por un mensaje que no habla de esto.
 */
self.addEventListener("message", (event) => {
  if (event.data && event.data.tipo === "vaciar-la-cola") {
    event.waitUntil(loQueHaceUnDisparo(DISPARO.pantalla));
  }
});

/**
 * Las dos cosas que hace un disparo, **en este orden y no a la vez**.
 *
 * Primero sale la cola, que es lo que alguien está esperando, y recién después
 * se completa la pantalla guardada si falta. En paralelo, medio mega de chunks
 * competiría con los POST de la cola por la misma señal mala y adentro de la
 * vida acotada de un evento: no se pierde nada, pero la tarea de más puede
 * demorar a la que importa.
 */
function loQueHaceUnDisparo(disparo) {
  return vaciarLaCola(disparo).then(() => guardarLaPantallaSiFalta());
}

// Dónde lleva una notificación: lo que traiga `data.url`, y la raíz si no trae
// nada. Sólo rutas del propio SdG; una url de otro origen cae en la raíz.
function destinoDe(data) {
  try {
    const url = new URL((data && data.url) || "/", self.location.origin);
    if (url.origin === self.location.origin) return url.pathname + url.search + url.hash;
  } catch {
    // url mal formada: se cae a la raíz
  }
  return "/";
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = destinoDe(event.notification.data);
  event.waitUntil(
    (async () => {
      // Si la app ya está abierta se reutiliza esa ventana. Sin esto cada
      // notificación abre una pestaña nueva, y a los tres avisos hay cuatro
      // copias de la app.
      const ventanas = await clients.matchAll({ type: "window", includeUncontrolled: true });
      let ventana = ventanas.find((v) => new URL(v.url).origin === self.location.origin);
      if (!ventana) return clients.openWindow(destino);
      // Enfocarla sin llevarla al destino dejaría a la persona mirando otra
      // pantalla que la que le avisaron. `navigate` rechaza con las ventanas que
      // este service worker no controla; en ese caso se enfoca como está.
      const absoluto = new URL(destino, self.location.origin).href;
      if (ventana.navigate && ventana.url !== absoluto) {
        try {
          ventana = (await ventana.navigate(absoluto)) || ventana;
        } catch {
          // no se pudo navegar: se enfoca igual
        }
      }
      return ventana.focus();
    })()
  );
});

// ── Vaciar la cola con la app cerrada ────────────────────────────────────────
//
// La secuencia es la misma que corre la pantalla en `app/cargar/CargarClient.tsx`
// —`proximaAMandar` → `tomarLaCarga` → el POST → `comoContesto` →
// `despuesDelIntento`— y las decisiones son **las mismas funciones**, importadas
// de `/cola/colaOffline.js`. Acá no se decide nada: se ejecuta.
//
// LAS TRES COSAS QUE HAY QUE SABER ANTES DE TOCAR ESTO:
//
// **1. TOMAR UNA CARGA NO ES ATÓMICO, Y NO PRETENDE SERLO.** `leerCola` y
// `actualizarCarga` son dos transacciones distintas, así que entre que se lee y
// se marca puede colarse otro disparo —la pantalla abierta en otra pestaña, o
// este mismo worker despertado dos veces— y los dos pueden mandar la misma
// carga. Lo que impide el duplicado **de verdad** es la clave del lado del
// servidor: las dos rutas de alta reservan la `clave` de la carga, así que el
// segundo POST no escribe una segunda fila —recibe el mismo número o un 409—.
// La marca `tomadaEn` protege algo más chico y bien real: que el caso normal
// —la pantalla y el service worker despertando juntos— no gaste dos pedidos por
// la misma carga, y que la lista no muestre como libre algo que está saliendo.
// **No protege contra la carrera; la acota.** Si algún día eso no alcanzara, el
// lugar es la base y no acá: una transacción que lea y marque junto.
//
// **2. DE QUIÉN ES UNA CARGA: QUIÉN ESCRIBE LA CLAVE `SESION` ES LA MITAD DEL
// ASUNTO.** `puedeMandarse` exige que la carga sea de quien tiene la sesión
// abierta, porque la planilla queda firmada con esa persona. Pero acá «quién
// sos» sale de lo que se anotó en IndexedDB bajo `SESION`, **no de la cookie**,
// que un service worker no puede leer. O sea que esa anotación tiene que estar
// al día en **todo** lugar desde el que se pida un vaciado, o el POST sale con
// la cookie de uno y la carga de otro.
//
// Hasta el 19/10/2026 eso lo escribía **sólo `/cargar`**, y la barra del layout
// —`components/CargasEsperando.tsx`, que se monta en toda la app— pedía el
// vaciado desde cualquier pantalla. El agujero era entero: Ana carga sin señal,
// presta el teléfono, Beto entra y abre **cualquier** pantalla, la barra dispara
// el vaciado, lo anotado todavía dice Ana, y el POST sale con la cookie de Beto
// — el alta de OT escribe en la planilla el nombre y el correo de **Beto**. La
// clave de la carga no lo tapa: detecta `ajena` en un **reintento**, no en el
// primer envío.
//
// Hoy la regla es: **quien pide un vaciado anota primero quién es**, y si no
// puede anotarlo no lo pide. Lo hace `lib/core/sesionDelTelefono.ts`, que usan
// los dos —la barra con el `usuarioId` que el layout sacó de la cookie del
// servidor, y `/cargar` con la sesión de Supabase—.
//
// Qué queda abierto, dicho: un teléfono donde la segunda persona **no abre
// ninguna pantalla del grupo `(app)` ni `/cargar`** no actualiza nada, pero
// entonces tampoco hay quien pida el vaciado desde ahí. Lo que cerraría el tema
// del todo es que el servidor diga de quién es la cookie en la respuesta del
// alta; eso es una ruta nueva o un campo más, y no entra acá.
//
// **3. NO HAY ESPERA ENTRE REINTENTOS.** `esperaAntesDeReintentar` existe y está
// probada, pero no se usa todavía —ni acá ni en la pantalla—: para respetarla
// habría que anotar en la carga a partir de cuándo puede volver a salir, y
// `CargaEnCola` no tiene ese campo. Lo que sí hay, y es lo que esa espera venía
// a comprar, es que **el vaciado corta en el primer fallo**: sin señal se gasta
// un pedido por disparo y no uno por carga.

// `SESION` y `RUTA_DE` se importan de `/cola/colaOffline.js` y **ya no se
// escriben acá**. Hasta el 19/10/2026 estaban copiados a mano en este archivo y
// en los de React, sin nada que atara las copias; el modo de fallar de `SESION`
// es que este vaciado se quede sin sesión conocida y **no mande ninguna carga**,
// en silencio. Con una sola definición no hay dos cadenas que puedan separarse.
// Un test de `lib/core/sw.test.ts` prohíbe volver a declararlas acá.

/**
 * Cuántas cargas manda un disparo. El tope no es por la red —el vaciado corta
 * solo en el primer fallo— sino por el caso en que escribir en la base no tome
 * efecto: ahí `proximaAMandar` devolvería siempre la misma carga y esto giraría
 * hasta que el navegador mate al worker.
 */
const TOPE_POR_DISPARO = 20;

/**
 * Manda lo que se pueda mandar, de a una y la más vieja primero.
 *
 * **No rechaza nunca.** Quien la llama es un `waitUntil`, y una promesa
 * rechazada ahí le dice al navegador que el push falló.
 */
async function vaciarLaCola(disparo) {
  try {
    const sesion = await leerCatalogo(SESION);
    const quienSoy = sesion && typeof sesion.id === "string" ? sesion.id : null;
    // Sin sesión anotada no hay con qué comparar el dueño de una carga, así que
    // no sale ninguna. Ver el punto 2 de arriba.
    if (!quienSoy) return;

    for (let vuelta = 0; vuelta < TOPE_POR_DISPARO; vuelta++) {
      const carga = proximaAMandar(await leerCola(), quienSoy, new Date());
      if (!carga) return;
      if (!(await mandarUna(carga, disparo))) return;
    }
  } catch {
    // La base no abrió —Safari en modo privado, el almacenamiento lleno— o la
    // cola no se pudo leer. No hay nadie mirando a quien decírselo: la pantalla
    // lo cuenta cuando se abra, que es donde hay alguien.
  }
}

/**
 * Manda una carga y deja la cola como corresponda.
 *
 * @param {import("/cola/colaOffline.js").CargaEnCola} carga
 * @returns {Promise<boolean>} Si tiene sentido seguir con la siguiente.
 */
async function mandarUna(carga, disparo) {
  await actualizarCarga(carga.clave, tomarLaCarga(carga, new Date()));

  let resultado;
  try {
    resultado = await mandarALaRuta(carga.tipo, carga.cuerpo, disparo);
  } catch (e) {
    // Un error de acá —no del servidor— no puede dejar la carga trabada cinco
    // minutos por algo que ya terminó.
    await actualizarCarga(carga.clave, { tomadaEn: null, ultimoError: loQueDijo(e) });
    return false;
  }

  const veredicto = despuesDelIntento(resultado);

  if (veredicto.accion === "actualizar") {
    await actualizarCarga(carga.clave, veredicto.cambios);
    // Falló. Cortar acá es lo que evita gastar un pedido por carga sin señal.
    return false;
  }

  // Entró, y la ruta contestó que algo quedó a medias. El veredicto trae la
  // advertencia justamente para que **quien borra tenga que decirla**: borrar
  // la carga sin decirlo sería tirar el único aviso de que algo quedó escrito
  // en un solo lado. Con la app cerrada, decirla es una notificación.
  if (veredicto.accion === "borrar-y-avisar") {
    if (await contarLaAdvertencia(carga.tipo, veredicto.numero, veredicto.advertencia)) {
      await borrarCarga(carga.clave);
      return true;
    }
    // No se pudo decir —sin permiso de notificaciones no hay dónde, y `sync`
    // no lo necesita—, así que la carga **no se borra**: se queda con el texto
    // adentro para que `/cargar` lo muestre. Es la única diferencia con la
    // pantalla, donde el cartel siempre se puede dibujar.
    //
    // Qué estado le queda y qué dice el texto lo decide `siNoSePudoAvisar`, que
    // vive en `colaOffline.js` con su test: acá eso estaba escrito a mano, y es
    // exactamente así como una regla termina estando en dos lugares.
    await actualizarCarga(carga.clave, siNoSePudoAvisar(veredicto, carga.tipo).cambios);
    return true;
  }

  if (veredicto.accion === "borrar") {
    await borrarCarga(carga.clave);
    return true;
  }

  // Un veredicto que este archivo no conoce, porque `colaOffline.js` sumó uno.
  // Borrar sería perder lo que alguien escribió por no haber entendido qué
  // había que hacer: se suelta la marca y la carga se queda donde está, que es
  // lo único reversible.
  await actualizarCarga(carga.clave, { tomadaEn: null });
  return false;
}

/**
 * Le cuenta a la persona que su carga entró pero con algo para mirar.
 *
 * Con la app cerrada **la notificación es el único lugar donde se puede decir
 * algo**. Si no se pudo mostrar —el permiso está denegado, y `sync` no lo
 * necesita— devuelve false y quien llama se encarga de que el texto no se
 * pierda.
 *
 * @param {import("/cola/colaOffline.js").TipoDeCarga} tipo
 * @param {string} numero
 * @param {string} advertencia
 * @returns {Promise<boolean>} Si quedó dicho.
 */
async function contarLaAdvertencia(tipo, numero, advertencia) {
  try {
    await self.registration.showNotification(`Se cargó ${conSuArticulo(tipo)} ${numero}`, {
      body: advertencia,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // La url en el primer nivel, que es de donde la lee `destinoDe`. Lleva a
      // la pantalla de la cola: es donde se ve qué pasó con cada carga.
      data: { url: LA_PANTALLA },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Manda el cuerpo tal cual y devuelve qué salió de eso.
 *
 * Es gemela de `mandarALaRuta` de `app/cargar/envio.tsx` y está escrita dos
 * veces a propósito: aquello es un archivo de React. **Lo que no está dos veces
 * es ninguna decisión** —quién contestó y si eso fue un éxito lo dice
 * `comoContesto`, la misma función en los dos lados—; acá sólo se habla HTTP.
 *
 * Las dos ramas son las mismas de allá y por el mismo motivo: una carga que
 * puede traer un archivo sale como `multipart/form-data` y las demás salen
 * como salían. **El `if` va alrededor de la construcción del pedido**, para
 * que el pedido del aviso y el de la OT —lo que la gente usa todos los días—
 * salga byte por byte igual que antes. Qué tipo lleva archivo y cómo se arma
 * ese cuerpo lo dicen `llevaArchivo` y `cuerpoComoFormData`, que son las
 * mismas funciones que corre la pantalla.
 *
 * El `Content-Type` de la rama del archivo **no se escribe**: lo pone el
 * navegador con su `boundary`, y escribirlo a mano lo deja sin él.
 *
 * @param {import("/cola/colaOffline.js").TipoDeCarga} tipo
 * @param {Record<string, unknown>} cuerpo
 */
async function mandarALaRuta(tipo, cuerpo, disparo) {
  let respuesta;
  try {
    respuesta = llevaArchivo(tipo)
      ? await fetch(RUTA_DE[tipo], {
          method: "POST",
          headers: { [CABECERA_DEL_DISPARO]: disparo },
          body: cuerpoComoFormData(cuerpo),
        })
      : await fetch(RUTA_DE[tipo], {
          method: "POST",
          headers: { "Content-Type": "application/json", [CABECERA_DEL_DISPARO]: disparo },
          body: JSON.stringify(cuerpo),
        });
  } catch (e) {
    // Un `fetch` que tira es un fallo sin status, y eso es pasajero. El mensaje
    // va **sin traducir**: es lo único que después va a poder leer quien mire
    // la carga parada. `deLaRuta` es false porque nunca se llegó a hablar con
    // la ruta.
    return { ok: false, status: null, deLaRuta: false, error: loQueDijo(e) };
  }

  // Un cuerpo que no es JSON no es un error a propagar: es el HTML del login o
  // el de un portal de WiFi, y `comoContesto` lo reconoce por lo que falta.
  const devuelto = await respuesta.json().catch(() => ({}));

  return comoContesto(tipo, {
    status: respuesta.status,
    redirigida: respuesta.redirected,
    cuerpo: devuelto,
  });
}

/** El mensaje de un error, sea lo que sea lo que se haya tirado. */
function loQueDijo(e) {
  return e instanceof Error ? e.message : String(e);
}
