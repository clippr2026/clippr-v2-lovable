import * as React from "react";

const CHECK_EVERY_MS = 2 * 60 * 1000;
const RETRY_EVERY_MS = 15 * 1000;
const IDLE_MS = 15 * 1000;
const MIN_BETWEEN_RELOADS_MS = 60 * 1000;
const RELOAD_KEY = "clippr-auto-reload-at";

// Hay algo en curso que se perdería al recargar: un campo con el foco o una ventana/modal abierta.
function userIsBusy(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) {
    return true;
  }
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
}

// Mantiene la app en la última versión sin que nadie tenga que hacer nada: compara la versión de
// este bundle con la que informa el servidor y, si salió una nueva, recarga sola cuando la persona
// no está usando la pantalla (sin tocar nada hace unos segundos, sin campo activo ni ventana
// abierta). Si la app estaba en segundo plano, se actualiza al volver a abrirla.
export function AppAutoUpdate() {
  React.useEffect(() => {
    const mine = typeof __APP_BUILD_ID__ === "string" ? __APP_BUILD_ID__ : "";
    if (!mine) return;
    let stale = false;
    let lastTouch = 0;
    let cancelled = false;

    const touch = () => {
      lastTouch = Date.now();
    };
    const tryReload = () => {
      if (!stale || document.visibilityState !== "visible") return;
      if (Date.now() - lastTouch < IDLE_MS || userIsBusy()) return;
      try {
        const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
        if (Date.now() - last < MIN_BETWEEN_RELOADS_MS) return;
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      } catch {
        // sin sessionStorage: igual se recarga (el chequeo de inactividad ya evita rebotes)
      }
      window.location.reload();
    };
    const check = async () => {
      try {
        const res = await fetch(`/api/version?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { build?: string };
        if (!cancelled && data.build && data.build !== mine) {
          stale = true;
          tryReload();
        }
      } catch {
        // sin conexión: se reintenta en el próximo chequeo
      }
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (stale) tryReload();
      else void check();
    };

    void check();
    const checkId = window.setInterval(() => {
      if (document.visibilityState === "visible" && !stale) void check();
    }, CHECK_EVERY_MS);
    const retryId = window.setInterval(tryReload, RETRY_EVERY_MS);
    const events = ["pointerdown", "keydown", "touchstart", "scroll"] as const;
    for (const e of events) window.addEventListener(e, touch, { passive: true, capture: true });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(checkId);
      window.clearInterval(retryId);
      for (const e of events) window.removeEventListener(e, touch, { capture: true });
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
