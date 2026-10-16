// Service worker del SdG. Hoy hace tres cosas: recibe notificaciones Web Push,
// lleva a la persona a donde la notificación dice al tocarla, y existe para que
// el navegador considere instalable a la app. Sin caché offline todavía.

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
      // Sin esto el click no encuentra a dónde ir: `event.notification.data`
      // es lo único que la notificación recuerda de este payload.
      data: data.data,
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
