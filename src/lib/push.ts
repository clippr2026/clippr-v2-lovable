import { supabase } from "@/integrations/supabase/client";

// Notificaciones push (PWA). El envío lo hace el servidor con la clave privada (nunca llega al navegador).
// La clave pública es pública por diseño (viaja al navegador): va incluida acá como valor por defecto.
const VAPID_PUBLIC_KEY =
  (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ??
  "BE3-3hG9suQnA55ywpRe1kbxxYlIq4oWkgA8zpRBuATHM__nvjnomDShRvYAnYNvoCK4-yCjrMosaJ8mWgxgG6E";

export type PushApp = "clippr" | "auro";

export function pushDisponible(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(VAPID_PUBLIC_KEY) &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

// iPhone: los avisos solo andan con la app instalada en la pantalla de inicio.
export function esIphoneSinInstalar(): boolean {
  if (typeof window === "undefined") return false;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const instalada =
    window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
  return ios && !instalada;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registro() {
  return (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.register("/sw.js"));
}

export async function estaSuscripto(): Promise<boolean> {
  if (!pushDisponible()) return false;
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  return Boolean(sub) && Notification.permission === "granted";
}

export async function activarAvisos(app: PushApp, opts?: { businessSlug?: string; clientPhone?: string }) {
  if (!pushDisponible()) throw new Error("Este navegador no permite avisos.");
  const permiso = await Notification.requestPermission();
  if (permiso !== "granted") throw new Error("Los avisos están bloqueados. Habilitalos en los ajustes del celular.");
  const reg = await registro();
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    }));
  const json = sub.toJSON();
  const { error } = await supabase.rpc("register_push_subscription_v1" as any, {
    p_app: app,
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh ?? "",
    p_auth: json.keys?.auth ?? "",
    p_user_agent: navigator.userAgent,
    p_business_slug: opts?.businessSlug ?? null,
    p_client_phone: opts?.clientPhone ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function desactivarAvisos() {
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await supabase.rpc("unregister_push_subscription_v1" as any, { p_endpoint: sub.endpoint });
  await sub.unsubscribe();
}

// La app instalada desde el correo arranca con el link único del turno (?k=…) en su dirección de inicio.
// Se guarda en el celular (solo dentro de la app instalada) y se saca de la barra. Después sirve para saber
// de qué cliente es el celular al activar los avisos.
const claveToken = (slug: string) => `clippr_push_k_${slug}`;

export function guardarTokenDeInicio(slug: string) {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    const k = url.searchParams.get("k");
    const instalada =
      window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
    if (k && instalada && /^[A-Za-z0-9_-]{8,128}$/.test(k)) {
      window.localStorage.setItem(claveToken(slug), k);
    }
    if (k && instalada) {
      url.searchParams.delete("k");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  } catch {
    /* sin almacenamiento: la app sigue andando, solo sin avisos de turnos */
  }
}

export function tokenGuardado(slug: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(claveToken(slug));
  } catch {
    return null;
  }
}
