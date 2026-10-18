// Service worker del SdG. Hoy hace tres cosas: recibe notificaciones Web Push,
// lleva a la persona a donde la notificación dice al tocarla, y existe para que
// el navegador considere instalable a la app. Sin caché offline todavía.

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
// **CUÁNDO ESTO DEJA DE SER SEGURO.** Hoy lo es porque este archivo **no cachea
// nada**: el handler de `fetch` pasa derecho a la red, así que un worker nuevo
// tomando el control a mitad de sesión no puede servir nada inconsistente. El
// día que este archivo cachee —la fase 3 y la 4—, `skipWaiting` pasa a
// significar que a una página ya cargada con los assets de una versión se le
// empiecen a servir los de otra. Quien agregue el caché tiene que decidir ahí
// si versiona el nombre del caché, si condiciona esto, o si lo saca.
//
// **No se borran cachés viejos en el `activate`,** y no es un olvido: hoy no hay
// ninguno, y un `activate` que borra es justamente lo que vuelve peligroso a
// `skipWaiting` —la página vieja pide un chunk que ya no está—. Esa decisión va
// junto con la del caché, no antes.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(clients.claim()));

// Handler de `fetch`: responde **las navegaciones a una pantalla del SdG**
// yendo a la red, y no toca nada más.
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
// observable. Esto es el mínimo honesto: contesta la navegación con la misma
// petición que iba a salir igual.
//
// **EL RIESGO, QUE CORRE EN PRODUCCIÓN PARA TODOS.** Si la promesa que recibe
// `respondWith` rechaza, la navegación falla. Sin señal `fetch` rechaza y el
// navegador muestra su página de sin-conexión — que es exactamente lo que pasa
// hoy sin service worker, así que no empeora nada. Lo que sí empeoraría es
// agregarle caché o lógica acá: eso es la fase 3 y va con su propio spec.
//
// Se filtran los pedidos que no son navegación (imágenes, JSON, el bundle) para
// no meterse en el medio de todo el tráfico de la app a cambio de nada.
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
  if (event.request.mode !== "navigate") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  event.respondWith(fetch(event.request));
});

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
});

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
