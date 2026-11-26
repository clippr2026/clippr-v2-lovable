import * as React from "react";
import { supabase } from "@/integrations/supabase/client";

// Página pública en mantenimiento: el dueño lo activa desde el botón WWW (business_settings.schedule._publicSiteStatus).
// Mientras está activo, /negocio y /reservar muestran esta pantalla en lugar de la página y no se puede reservar.
// La vista previa de Configuración (?preview=1) sigue mostrando la página normal.

type Estado = { cargando: true } | { cargando: false; mantenimiento: boolean; nombre: string; logo: string | null };

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export function usePublicMantenimiento(slug: string): Estado {
  const [estado, setEstado] = React.useState<Estado>({ cargando: true });
  React.useEffect(() => {
    let vigente = true;
    void (async () => {
      try {
        const q = supabase.from("public_booking_businesses").select("id,name,avatar_url,logo_url");
        const { data } = await (isUuid(slug) ? q.eq("id", slug) : q.eq("slug", slug)).maybeSingle();
        const negocio = data as { id?: string; name?: string | null; avatar_url?: string | null; logo_url?: string | null } | null;
        let mantenimiento = false;
        if (negocio?.id) {
          const { data: st } = await supabase.from("public_booking_settings").select("schedule").eq("business_id", negocio.id).maybeSingle();
          const estadoSitio = ((st as { schedule?: Record<string, unknown> } | null)?.schedule?._publicSiteStatus ?? {}) as Record<string, unknown>;
          mantenimiento = estadoSitio.maintenance === true;
        }
        if (vigente)
          setEstado({
            cargando: false,
            mantenimiento,
            nombre: negocio?.name?.trim() || "",
            logo: negocio?.avatar_url || negocio?.logo_url || null,
          });
      } catch {
        // Si no se puede leer, la página sigue normal.
        if (vigente) setEstado({ cargando: false, mantenimiento: false, nombre: "", logo: null });
      }
    })();
    return () => {
      vigente = false;
    };
  }, [slug]);
  return estado;
}

export function PantallaMantenimiento({ nombre, logo }: { nombre: string; logo: string | null }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#0b0a14] px-6 py-12 text-center text-white">
      <div className="flex max-w-sm flex-col items-center">
        {logo ? (
          <img src={logo} alt={nombre} className="h-24 w-24 rounded-full object-cover ring-1 ring-white/15" />
        ) : (
          <div className="grid h-24 w-24 place-items-center rounded-full bg-white/10 text-3xl font-bold">{nombre.slice(0, 1) || "?"}</div>
        )}
        {nombre && <p className="mt-4 text-lg font-semibold">{nombre}</p>}
        <h1 className="mt-6 text-2xl font-bold tracking-tight">Estamos en mantenimiento</h1>
        <p className="mt-2 text-base text-white/70">Volveremos pronto. Gracias por tu paciencia.</p>
      </div>
    </main>
  );
}

/** Envuelve la página pública: en mantenimiento muestra el aviso en su lugar. */
export function ConMantenimiento({ slug, children }: { slug: string; children: React.ReactNode }) {
  const esPreview = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("preview") === "1";
  const estado = usePublicMantenimiento(slug);
  if (!esPreview && !estado.cargando && estado.mantenimiento) {
    return <PantallaMantenimiento nombre={estado.nombre} logo={estado.logo} />;
  }
  return <>{children}</>;
}
