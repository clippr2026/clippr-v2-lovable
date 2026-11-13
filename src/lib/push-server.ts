import * as webpushModule from "web-push";
import { createClient } from "@supabase/supabase-js";

// web-push es CommonJS: según el entorno el módulo viene con o sin "default".
const webpush: typeof import("web-push") = (webpushModule as any).default ?? webpushModule;

// Envío de notificaciones push (solo servidor). Usa la clave privada VAPID (VAPID_PRIVATE_KEY, variable de
// entorno de Vercel — nunca va en el repo ni llega al navegador) y la clave de servicio de Supabase para leer
// las suscripciones. Las suscripciones vencidas (el celular ya no las acepta: 404/410) se borran solas.
const VAPID_PUBLIC_KEY =
  "BE3-3hG9suQnA55ywpRe1kbxxYlIq4oWkgA8zpRBuATHM__nvjnomDShRvYAnYNvoCK4-yCjrMosaJ8mWgxgG6E";

export type PushPayload = { title: string; body: string; url?: string; icon?: string };

export async function sendPush(args: {
  businessId: string;
  app: "clippr" | "auro";
  userId?: string | null;
  payload: PushPayload;
}): Promise<{ sent: number; removed: number; failed: number }> {
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!privateKey || !supabaseUrl || !serviceRoleKey) {
    throw new Error("Faltan VAPID_PRIVATE_KEY / VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:aurostyloadmi@gmail.com", VAPID_PUBLIC_KEY, privateKey);

  const admin = createClient(supabaseUrl, serviceRoleKey);
  let q = admin
    .from("push_subscriptions")
    .select("id,endpoint,p256dh,auth")
    .eq("business_id", args.businessId)
    .eq("app", args.app);
  if (args.userId) q = q.eq("user_id", args.userId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const icon = args.payload.icon ?? (args.app === "auro" ? "/pwa/auro-192.png" : "/pwa/clippr-192.png");
  const body = JSON.stringify({ ...args.payload, icon });
  let sent = 0;
  let removed = 0;
  let failed = 0;
  for (const sub of (data ?? []) as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body);
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        await admin.from("push_subscriptions").delete().eq("id", sub.id);
        removed++;
      } else {
        failed++;
        console.error("[push] error enviando:", code, (e as Error).message);
      }
    }
  }
  return { sent, removed, failed };
}
