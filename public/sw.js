// Service worker de Clippr y de las apps de cada local (PWA).
// A propósito NO guarda nada en caché: siempre va a la red, así una versión nueva
// se ve apenas se publica. Su trabajo por ahora es hacer instalable la app y
// recibir las notificaciones push.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "Aviso", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Clippr";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: data.icon || "/pwa/clippr-192.png",
      badge: data.badge || "/pwa/clippr-192.png",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
