// Service worker del SdG. Hace cinco cosas: recibe notificaciones Web Push,
// lleva a la persona a donde la notificación dice al tocarla, existe para que
// el navegador considere instalable a la app, **guarda la pantalla `/cargar`
// para poder abrirla sin señal**, y **vacía la cola de cargas con la app
// cerrada**.
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
// `components/BotonNotificaciones.tsx`. Los dos o ninguno: registrar el mismo
// alcance con un tipo distinto del que ya está **rechaza**, y la app queda sin
// service worker hasta el deploy siguiente —sin oferta de instalar y sin push—.
//
// Y por lo mismo `proxy.ts` deja `cola` afuera de su matcher: si `/cola/*.js`
// pidiera sesión, un canje de cookie vencido devolvería el HTML del login donde
// el navegador espera un módulo y **el service worker entero no se registraría**.
// Son funciones de decisión, sin datos ni secretos.
import {
  comoContesto,
  despuesDelIntento,
  proximaAMandar,
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
// otra. Ese día es hoy, y así se resolvió, con las tres cosas juntas:
//
//   - **El nombre del caché va versionado** (`CACHE`). Una versión nueva estrena
//     caché en vez de pisarle los assets a quien ya está adentro.
//   - **Un chunk que no está en el caché sale a la red.** En Vercel los assets
//     de los despliegues viejos siguen estando, así que una página ya cargada
//     que pide un chunk de otra versión lo consigue igual.
//   - **El respaldo de navegación se activa sólo cuando la red falla**, nunca
//     para una página que cargó bien: con señal, lo que llega es lo del
//     servidor, igual que sin service worker.
//
// **No se borran cachés viejos en el `activate`,** y sigue sin ser un olvido:
// un `activate` que borra es justamente lo que vuelve peligroso a `skipWaiting`
// —la página vieja pide un chunk que ya no está—. El costo asumido es que si
// algún día se sube la versión, el caché anterior queda ocupando lugar hasta que
// el navegador lo desaloje. Hay un test que fija esto (`not.toMatch(/caches
// .delete/)`): si alguien decide limpiar, va con su propio porqué escrito.
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(guardarLaPantalla());
});
self.addEventListener("activate", (event) => event.waitUntil(clients.claim()));

/**
 * El caché, con el nombre versionado. **Subir el número estrena caché**: es lo
 * que hay que hacer si alguna vez lo guardado queda inservible, porque `install`
 * sólo vuelve a correr cuando cambian los bytes de este archivo.
 */
const CACHE = "sdg-cargar-v1";

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
 * No rechaza nunca: un `install` que falla deja al worker sin activarse, y con
 * él se van el push y el vaciado. Guardar la pantalla es lo que se puede perder.
 */
async function guardarLaPantalla() {
  try {
    const respuesta = await fetch(LA_PANTALLA);
    if (!respuesta.ok || respuesta.redirected) return;

    const cache = await caches.open(CACHE);
    const html = await respuesta.clone().text();
    await cache.put(LA_PANTALLA, respuesta);

    // Uno por uno y cada uno con su red de seguridad: un archivo que no se pudo
    // bajar no tiene por qué llevarse puestos a los demás, que es justo lo que
    // haría un `cache.addAll`.
    await Promise.all(
      archivosDe(html).map(async (url) => {
        try {
          const archivo = await fetch(url);
          if (archivo.ok) await cache.put(url, archivo);
        } catch {
          // Ese archivo no entra. La página puede andar sin él o no, pero se
          // sabrá al abrirla; dejar de guardar los otros no ayuda a nadie.
        }
      })
    );
  } catch {
    // Sin red al instalar no hay nada que guardar. El worker se activa igual.
  }
}

/**
 * Los archivos que un HTML pide: los `src` de `<script>` y los `href` de
 * `<link rel="stylesheet">`. No es un parser de HTML y no pretende serlo —en un
 * service worker no hay DOM—, así que se queda con lo que Next escribe y con
 * nada más: rutas que empiezan con una sola barra, o sea de este mismo origen.
 *
 * Lo que queda afuera a propósito: los `<link rel="preload">` (el navegador los
 * va a pedir igual y van a pasar por el handler de `fetch`) y cualquier url de
 * otro origen, que no se puede guardar sin saber si contesta con CORS.
 *
 * @param {string} html
 * @returns {string[]}
 */
function archivosDe(html) {
  const urls = [];

  for (const etiqueta of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    urls.push(etiqueta[1]);
  }

  for (const etiqueta of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel=["']stylesheet["']/i.test(etiqueta[0])) continue;
    const href = etiqueta[0].match(/\bhref=["']([^"']+)["']/i);
    if (href) urls.push(href[1]);
  }

  // `//otro.com/x.js` también empieza con barra y es de otro origen.
  return urls.filter((url) => url.startsWith("/") && !url.startsWith("//"));
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
// `/_next/static/`, que **sí** se guarda al pasar: esos nombres llevan hash, así
// que una url nunca cambia de contenido y lo guardado no puede quedar viejo.
// (El costo asumido: ese caché sólo crece. Cada despliegue estrena nombres y los
// de ayer se quedan hasta que el navegador desaloje el origen entero, que es un
// desalojo del que se vuelve pidiendo todo a la red.)
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
  // Sólo GET: `cache.put` tira con cualquier otro método.
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
 * Un archivo de `/_next/static/`: lo guardado si está, y si no la red,
 * guardando lo que vuelva.
 *
 * El caché es lo primero porque esos nombres llevan hash —el contenido de una
 * url nunca cambia—, así que servir lo guardado no puede devolver algo viejo.
 * Y el que no está sale a la red **sin fallar**: en Vercel los assets de los
 * despliegues anteriores siguen estando, así que una página ya cargada que pide
 * un chunk de otra versión lo consigue igual. Eso es lo que deja que este caché
 * conviva con `skipWaiting`.
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
  let cache = null;
  try {
    cache = await caches.open(CACHE);
    const guardado = await cache.match(pedido);
    if (guardado) return guardado;
  } catch {
    // Sin caché, a la red y nada más.
  }

  const respuesta = await fetch(pedido);
  // La copia se guarda sin esperarla: lo que la página necesita es la respuesta,
  // no que el caché haya terminado de escribir.
  if (cache && respuesta.ok) {
    const copia = respuesta.clone();
    cache.put(pedido, copia).catch(() => {
      // El almacenamiento está lleno o el navegador no deja guardar. La
      // respuesta ya salió; lo único que se pierde es tenerla la próxima vez.
    });
  }
  return respuesta;
}

/**
 * Una navegación: la red, y la pantalla guardada **sólo si la red falló**.
 *
 * El orden importa y es la mitad de la decisión. Al revés —el caché primero—
 * una persona con señal vería la pantalla de hace una semana, y peor: vería
 * `/cargar` en lugar de la pantalla que pidió. Acá, con señal no cambia
 * absolutamente nada respecto de no tener service worker.
 *
 * Y si no hay nada guardado, el error vuelve a salir tal cual: el navegador
 * muestra su página de sin-conexión, como siempre.
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
      if (guardada) return guardada;
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
  // vaciar la cola, y va en el mismo `waitUntil` para que el navegador no mate
  // al worker apenas termina de dibujar la notificación.
  //
  // Dos `waitUntil` y no uno solo con un `Promise.all`: así el vaciado no puede
  // demorar ni tumbar a la notificación, que es lo que a la persona le
  // prometieron. `vaciarLaCola` no rechaza nunca, pero eso es una promesa de
  // otra función y acá no se depende de ella.
  event.waitUntil(vaciarLaCola());
});

/**
 * El otro disparo: `sync`, que el navegador entrega cuando vuelve la señal,
 * incluso con la app cerrada.
 *
 * **No se filtra por etiqueta**, y no es un descuido: hoy nadie registra
 * ninguna —la pantalla todavía no llama a `registration.sync.register()`—, así
 * que filtrar por un nombre que nadie usa sería código muerto con aire de
 * precisión. El día que haya un segundo uso de `sync`, acá va el filtro.
 */
self.addEventListener("sync", (event) => event.waitUntil(vaciarLaCola()));

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
// **2. DE QUIÉN ES UNA CARGA: ESTO ESTÁ ACOTADO, NO RESUELTO.** `puedeMandarse`
// exige que la carga sea de quien tiene la sesión abierta, porque la planilla
// queda firmada con esa persona. Pero acá «quién sos» sale de lo que la pantalla
// anotó en IndexedDB —`catalogos.ts` lo escribe cada vez que alguien abre
// `/cargar` con señal—, **no de la cookie**, que un service worker no puede
// leer. Entonces: si otra persona entra al SdG en ese teléfono y **nunca abre
// `/cargar`**, lo anotado sigue diciendo la anterior, y una carga de la anterior
// saldría con la cookie de la nueva — firmada por quien no la hizo, que es
// exactamente lo que `puedeMandarse` existe para evitar.
// Qué lo acota hoy: la ventana se cierra sola en cuanto alguien abre `/cargar`
// (y esa pantalla es la única razón para que haya algo en la cola), y una carga
// ajena **nunca** sale —lo que puede salir mal es la firma de una propia, no la
// de otro—. Qué lo cerraría de verdad: que el servidor diga de quién es la
// cookie. Eso es una ruta nueva o un campo en la respuesta del alta, y no
// entraba en esta tarea.
//
// **3. NO HAY ESPERA ENTRE REINTENTOS.** `esperaAntesDeReintentar` existe y está
// probada, pero no se usa todavía —ni acá ni en la pantalla—: para respetarla
// habría que anotar en la carga a partir de cuándo puede volver a salir, y
// `CargaEnCola` no tiene ese campo. Lo que sí hay, y es lo que esa espera venía
// a comprar, es que **el vaciado corta en el primer fallo**: sin señal se gasta
// un pedido por disparo y no uno por carga.

/** Dónde dejó la pantalla anotado quién tiene la sesión abierta. */
//
// Es el mismo nombre que usa `app/cargar/catalogos.ts`, escrito dos veces porque
// aquél es un archivo de React y desde acá no se puede importar. **Si allá
// cambia y acá no, este vaciado deja de mandar nada y no avisa**: sin sesión
// conocida no hay a nombre de quién mandar. Es pegamento, no una regla, y por
// eso se copia en vez de mudarse a `public/cola/`.
const SESION = "sesion";

/** A dónde va cada tipo de carga. Las de siempre, las mismas que `envio.tsx`. */
const RUTA_DE = {
  aviso: "/api/mantenimiento/avisos",
  orden: "/api/mantenimiento/ordenes",
};

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
async function vaciarLaCola() {
  try {
    const sesion = await leerCatalogo(SESION);
    const quienSoy = sesion && typeof sesion.id === "string" ? sesion.id : null;
    // Sin sesión anotada no hay con qué comparar el dueño de una carga, así que
    // no sale ninguna. Ver el punto 2 de arriba.
    if (!quienSoy) return;

    for (let vuelta = 0; vuelta < TOPE_POR_DISPARO; vuelta++) {
      const carga = proximaAMandar(await leerCola(), quienSoy, new Date());
      if (!carga) return;
      if (!(await mandarUna(carga))) return;
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
async function mandarUna(carga) {
  await actualizarCarga(carga.clave, tomarLaCarga(carga, new Date()));

  let resultado;
  try {
    resultado = await mandarALaRuta(carga.tipo, carga.cuerpo);
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
    // Va como `parada` y no como `esperando`, y es por lo mismo que la borraría
    // si se hubiera podido avisar: ya está entregada, así que no tiene que
    // volver a salir sola. `parada` significa exactamente «necesita que una
    // persona la mire», que es lo que pasa acá.
    await actualizarCarga(carga.clave, {
      tomadaEn: null,
      estado: "parada",
      ultimoError:
        `Se cargó ${comoSeLlama(carga.tipo)} ${veredicto.numero}, pero con esto ` +
        `para mirar: ${veredicto.advertencia}`,
    });
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
 * @param {"aviso" | "orden"} tipo
 * @param {string} numero
 * @param {string} advertencia
 * @returns {Promise<boolean>} Si quedó dicho.
 */
async function contarLaAdvertencia(tipo, numero, advertencia) {
  try {
    await self.registration.showNotification(`Se cargó ${comoSeLlama(tipo)} ${numero}`, {
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
 * @param {"aviso" | "orden"} tipo
 * @param {Record<string, unknown>} cuerpo
 */
async function mandarALaRuta(tipo, cuerpo) {
  let respuesta;
  try {
    respuesta = await fetch(RUTA_DE[tipo], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

/** Cómo se nombra cada tipo de carga en lo que ve una persona. */
function comoSeLlama(tipo) {
  return tipo === "aviso" ? "el aviso" : "la orden de trabajo";
}
