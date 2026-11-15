import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import * as webpushModule from "web-push";

// web-push es CommonJS: según el entorno el módulo viene con o sin "default".
const webpush: typeof import("web-push") = (webpushModule as any).default ?? webpushModule;

const VAPID_PUBLIC_KEY =
  "BE3-3hG9suQnA55ywpRe1kbxxYlIq4oWkgA8zpRBuATHM__nvjnomDShRvYAnYNvoCK4-yCjrMosaJ8mWgxgG6E";

// Aviso a mano de la agenda al celular de un cliente. Exige sesión del local: con el token de quien envía se
// pregunta (staff_client_push_count_v1) si el cliente es de su local; si no lo es, no se manda nada.
// POST { clientId, message }  con  Authorization: Bearer <token de sesión>
export const Route = createFileRoute("/api/push-cliente")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
        const supabaseUrl = process.env.VITE_SUPABASE_URL;
        const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const privateKey = process.env.VAPID_PRIVATE_KEY;
        if (!token) return Response.json({ error: "Sin sesión" }, { status: 401 });
        if (!supabaseUrl || !anonKey || !serviceKey || !privateKey) {
          return Response.json({ error: "Los avisos todavía no están configurados" }, { status: 503 });
        }

        let clientId = "";
        let message = "";
        try {
          const body = (await request.json()) as { clientId?: string; message?: string };
          clientId = String(body.clientId ?? "");
          message = String(body.message ?? "").trim().slice(0, 180);
        } catch {
          return Response.json({ error: "Pedido inválido" }, { status: 400 });
        }
        if (!/^[0-9a-f-]{36}$/i.test(clientId) || !message) {
          return Response.json({ error: "Falta el cliente o el mensaje" }, { status: 400 });
        }

        const staff = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
        const { data: cantidad, error: errPermiso } = await staff.rpc("staff_client_push_count_v1" as any, {
          p_client_id: clientId,
        });
        if (errPermiso || cantidad === null || cantidad === undefined) {
          return Response.json({ error: "No podés avisarle a este cliente" }, { status: 403 });
        }
        if (cantidad === 0) return Response.json({ sent: 0, error: "El cliente no tiene los avisos activados" });

        const admin = createClient(supabaseUrl, serviceKey);
        const { data: targets } = await admin.rpc("get_client_push_targets_v1" as any, { p_client_id: clientId });
        const { data: negocio } = await staff.from("businesses").select("name,slug").limit(1).maybeSingle();
        const nombre = (negocio as { name?: string } | null)?.name || "Tu barbería";
        const slug = (negocio as { slug?: string } | null)?.slug;

        webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:aurostyloadmi@gmail.com", VAPID_PUBLIC_KEY, privateKey);
        const body = JSON.stringify({
          title: nombre,
          body: message,
          url: slug ? `/negocio/${slug}` : "/",
          icon: "/pwa/auro-192.png",
        });
        let sent = 0;
        let failed = 0;
        for (const t of (targets ?? []) as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>) {
          try {
            await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, body);
            sent++;
          } catch (e) {
            const code = (e as { statusCode?: number }).statusCode;
            if (code === 404 || code === 410) await admin.rpc("delete_push_subscription_v1" as any, { p_id: t.id });
            else failed++;
          }
        }
        return Response.json({ sent, failed });
      },
    },
  },
});
