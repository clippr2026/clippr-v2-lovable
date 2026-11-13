import { createFileRoute } from "@tanstack/react-router";

// Manifiesto de la app instalada de un local, con el ícono dinámico (foto de perfil actual).
// GET /api/pwa-manifest?slug=auro-stylo&name=Auro%20Stylo
export const Route = createFileRoute("/api/pwa-manifest")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = new URL(request.url);
        const slug = (u.searchParams.get("slug") ?? "").trim().toLowerCase();
        if (!/^[a-z0-9-]{1,80}$/.test(slug)) return new Response("Parámetros inválidos", { status: 400 });
        const name = (u.searchParams.get("name") ?? "").slice(0, 40) || slug;
        const icon = (size: number, maskable = false) =>
          `/api/pwa-icon?slug=${slug}&size=${size}${maskable ? "&maskable=1" : ""}`;
        const manifest = {
          id: `/${slug}?app=local`,
          name,
          short_name: name,
          description: `Reservá tu turno en ${name}.`,
          start_url: `/${slug}?source=pwa`,
          scope: "/",
          display: "standalone",
          orientation: "portrait",
          background_color: "#0b0a14",
          theme_color: "#0b0a14",
          lang: "es-AR",
          icons: [
            { src: icon(192), sizes: "192x192", purpose: "any" },
            { src: icon(512), sizes: "512x512", purpose: "any" },
            { src: icon(512, true), sizes: "512x512", purpose: "maskable" },
          ],
        };
        return new Response(JSON.stringify(manifest), {
          headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "public, max-age=300" },
        });
      },
    },
  },
});
