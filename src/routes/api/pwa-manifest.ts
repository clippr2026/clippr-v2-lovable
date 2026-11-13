import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// Manifiesto de la app instalada de un local, con el ícono dinámico (foto de perfil actual).
// GET /api/pwa-manifest?slug=auro-stylo&name=Auro%20Stylo
export const Route = createFileRoute("/api/pwa-manifest")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = new URL(request.url);
        const slug = (u.searchParams.get("slug") ?? "").trim().toLowerCase();
        if (!/^[a-z0-9-]{1,80}$/.test(slug)) return new Response("Parámetros inválidos", { status: 400 });
        let name = (u.searchParams.get("name") ?? "").slice(0, 40);
        if (!name) {
          // Sin nombre en el pedido: se lee el del local (vista pública), con el slug como último recurso.
          const url = process.env.VITE_SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL;
          const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
          if (url && key) {
            const { data } = await createClient(url, key).from("public_booking_businesses").select("name").eq("slug", slug).maybeSingle();
            name = String((data as { name?: string | null } | null)?.name ?? "").slice(0, 40);
          }
        }
        name = name || slug;
        const icon = (size: number, maskable = false) =>
          `/api/pwa-icon?slug=${slug}&size=${size}${maskable ? "&maskable=1" : ""}`;
        const manifest = {
          id: `/${slug}?app=local`,
          name,
          short_name: name,
          description: `Reservá tu turno en ${name}.`,
          // Auro tiene su página propia (/auro-stylo); el resto de los locales arranca en su perfil público.
          start_url: slug === "auro-stylo" ? `/auro-stylo?source=pwa` : `/negocio/${slug}?source=pwa`,
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
