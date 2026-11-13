import { createFileRoute } from "@tanstack/react-router";
import { sendPush } from "@/lib/push-server";

// Envío de prueba de una notificación push. Nunca público: exige Authorization: Bearer <CRON_SECRET>.
// GET /api/push-test?business=<uuid>&app=clippr|auro&title=...&body=...&url=/dashboard
export const Route = createFileRoute("/api/push-test")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
          return new Response("Unauthorized", { status: 401 });
        }
        const u = new URL(request.url);
        const businessId = u.searchParams.get("business");
        const app = u.searchParams.get("app") === "auro" ? "auro" : "clippr";
        if (!businessId) return Response.json({ error: "falta business" }, { status: 400 });
        try {
          const result = await sendPush({
            businessId,
            app,
            payload: {
              title: u.searchParams.get("title") || "Clippr",
              body: u.searchParams.get("body") || "Aviso de prueba",
              url: u.searchParams.get("url") || "/",
            },
          });
          return Response.json(result);
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});
