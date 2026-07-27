// Service worker del SdG — por ahora solo maneja notificaciones Web Push
// para Remises ("Mi remis"). Sin caché offline: no hace falta para este uso.

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
      icon: "/logo.png",
      badge: "/logo.png",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow("/mi-remis"));
});
