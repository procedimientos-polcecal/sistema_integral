// Service worker del SdG. Hoy hace tres cosas: recibe notificaciones Web Push,
// lleva a la persona a donde la notificación dice al tocarla, y existe para que
// el navegador considere instalable a la app. Sin caché offline todavía.

// Handler de `fetch` de paso: no intercepta nada, la petición sigue a la red.
//
// **Está por la instalabilidad. Que nadie lo borre por parecer inútil.** Chrome
// no dispara `beforeinstallprompt` si el service worker no tiene un handler de
// `fetch`, y entonces el botón de instalar de Android no aparece nunca, sin
// ningún error: la app simplemente no se ofrece. `lib/core/sw.test.ts` verifica
// que siga registrado.
//
// Además es el gancho donde la fase 3 va a colgar el caché.
self.addEventListener("fetch", () => {});

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
