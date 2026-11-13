import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// Ícono de la app instalada (PWA) de un local: siempre la FOTO DE PERFIL ACTUAL del negocio, leída de la
// base en cada pedido (con caché corta), recortada a un cuadrado sobre fondo negro. Así, cuando el local
// cambia su foto de perfil, la app nueva ya sale con la foto nueva, sin tocar archivos.
// GET /api/pwa-icon?slug=auro-stylo&size=180[&maskable=1]
const SIZES = new Set([120, 152, 167, 180, 192, 512]);

export const Route = createFileRoute("/api/pwa-icon")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = new URL(request.url);
        const slug = (u.searchParams.get("slug") ?? "").trim().toLowerCase();
        const size = Number(u.searchParams.get("size") ?? 180);
        const maskable = u.searchParams.get("maskable") === "1";
        if (!/^[a-z0-9-]{1,80}$/.test(slug) || !SIZES.has(size)) {
          return new Response("Parámetros inválidos", { status: 400 });
        }
        const supabaseUrl = process.env.VITE_SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !key) return new Response("Servidor sin credenciales", { status: 500 });

        const admin = createClient(supabaseUrl, key);
        const { data } = await admin.from("businesses").select("avatar_url,logo_url").eq("slug", slug).maybeSingle();
        const row = data as { avatar_url?: string | null; logo_url?: string | null } | null;
        const foto = row?.avatar_url || row?.logo_url;
        if (!foto) return new Response("Sin foto de perfil", { status: 404 });

        let res: Response;
        try {
          res = await fetch(foto);
        } catch {
          return new Response("No se pudo leer la foto", { status: 502 });
        }
        if (!res.ok) return new Response("No se pudo leer la foto", { status: 502 });
        const input = Buffer.from(await res.arrayBuffer());
        const cacheHeaders = { "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=3600" };

        // Se convierte a PNG cuadrado sobre fondo negro (iPhone lo pide así). sharp se carga recién acá: si
        // en este servidor no está disponible, se entrega la foto original tal cual, sin romper nada más.
        try {
          const sharp = (await import("sharp")).default;
          const inner = Math.round(size * (maskable ? 0.78 : 1));
          const logo = await sharp(input).resize(inner, inner, { fit: "cover" }).png().toBuffer();
          const png = await sharp({ create: { width: size, height: size, channels: 3, background: "#000000" } })
            .composite([{ input: logo, gravity: "centre" }])
            .png()
            .toBuffer();
          return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", ...cacheHeaders } });
        } catch (e) {
          console.error("[pwa-icon] sin conversión, se entrega la foto original:", (e as Error).message);
          return new Response(new Uint8Array(input), {
            headers: { "Content-Type": res.headers.get("content-type") || "image/webp", ...cacheHeaders },
          });
        }
      },
    },
  },
});
