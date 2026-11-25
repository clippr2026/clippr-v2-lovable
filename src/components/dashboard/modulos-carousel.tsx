import * as React from "react";
import { Link } from "@tanstack/react-router";
import { Brain, Briefcase, Calendar, Clock, HandCoins, Package, Star, Users, Wallet, type LucideIcon } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

// Carrusel de Inicio para descubrir qué se puede hacer en la app. Se desliza con el dedo (no avanza solo). Todos ven
// las 9 tarjetas; solo el dueño o administrador general puede tocarlas para ir a la sección (la sucursal es la activa
// de siempre). Para el resto son informativas.
type Modulo = {
  id: string;
  nombre: string;
  icono: LucideIcon;
  titulo: string;
  descripcion: string;
  // Color en el que termina el degradado de la tarjeta (arranca casi negro).
  color: string;
  to?: "/agenda" | "/cash-register" | "/clients" | "/advisor" | "/settings";
  search?: Record<string, string>;
};

const MODULOS: Modulo[] = [
  { id: "agenda", nombre: "Agenda", icono: Calendar, titulo: "Reservas online", descripcion: "Recibí turnos desde tu página y organizá la agenda de tu equipo.", color: "#b52f7d", to: "/agenda" },
  { id: "caja", nombre: "Caja", icono: Wallet, titulo: "Control de caja", descripcion: "Registrá ventas y gastos, y revisá tus cierres diarios.", color: "#e0345c", to: "/cash-register", search: { tab: "resumen" } },
  { id: "liquidaciones", nombre: "Liquidaciones", icono: HandCoins, titulo: "Pagos al equipo", descripcion: "Revisá comisiones, propinas y adelantos antes de liquidar.", color: "#1763c9", to: "/cash-register", search: { tab: "profesionales" } },
  { id: "clientes", nombre: "Clientes", icono: Users, titulo: "Hacé que vuelvan", descripcion: "Identificá a quienes dejaron de venir y contactalos.", color: "#c0267a", to: "/clients" },
  { id: "inventario", nombre: "Inventario", icono: Package, titulo: "Stock al día", descripcion: "Consultá tu stock y registrá entradas y retiros.", color: "#b4560c", to: "/cash-register", search: { tab: "inventario" } },
  { id: "asesor", nombre: "Asesor IA", icono: Brain, titulo: "Análisis diario", descripcion: "Revisá tus ventas, clientes y ocupación para saber cómo va tu negocio.", color: "#0e7f9e", to: "/advisor" },
  { id: "bolsa", nombre: "Bolsa de trabajo", icono: Briefcase, titulo: "Conectá con profesionales", descripcion: "Publicá ofertas de trabajo o puestos en alquiler y recibí solicitudes.", color: "#7c3aed", to: "/settings", search: { section: "bolsa" } },
  { id: "resenas", nombre: "Reseñas", icono: Star, titulo: "Opiniones de tus clientes", descripcion: "Revisá las reseñas que recibís y elegí cuáles destacar en tu página.", color: "#a86a08", to: "/settings", search: { section: "resenas" } },
  // Sin destino fijo: abre el listado de asistencia del día (o la configuración de fichaje si todavía no se puede).
  { id: "fichaje", nombre: "Fichaje", icono: Clock, titulo: "Asistencia del equipo", descripcion: "Registrá entradas y salidas, y consultá quién ya fichó.", color: "#0d8578" },
];

export const EVENTO_VER_ASISTENCIA = "clippr:ver-asistencia";

function Contenido({ m }: { m: Modulo }) {
  return (
    <>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-black/35 py-1 pl-2 pr-2.5 text-[10px] font-extrabold uppercase tracking-[0.12em] text-white">
        <m.icono aria-hidden className="h-4 w-4 shrink-0" strokeWidth={2.2} />
        {m.nombre}
      </span>
      <span className="mt-1.5 block text-[19px] font-extrabold leading-tight text-white">{m.titulo}</span>
      <span className="mt-0.5 block text-sm font-medium leading-[1.35] text-white/85">{m.descripcion}</span>
    </>
  );
}

// Movimiento sutil al deslizar: la tarjeta encajada queda a tamaño completo y las vecinas apenas más chicas y tenues.
function useEnfoque(ref: React.RefObject<HTMLDivElement | null>) {
  React.useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const pintar = () => {
      frame = 0;
      const items = Array.from(el.children) as HTMLElement[];
      const padding = parseFloat(getComputedStyle(el).paddingLeft) || 0;
      const inicio = el.getBoundingClientRect().left + padding;
      // Al final del recorrido la última tarjeta no llega al borde izquierdo: se considera encajada igual.
      const alFinal = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
      items.forEach((item, i) => {
        const distancia = Math.abs(item.getBoundingClientRect().left - inicio) / Math.max(1, item.offsetWidth);
        const lejos = alFinal && i === items.length - 1 ? 0 : Math.min(1, distancia);
        item.style.transform = `scale(${1 - lejos * 0.05})`;
        item.style.opacity = String(1 - lejos * 0.25);
      });
    };
    const alDeslizar = () => {
      if (!frame) frame = window.requestAnimationFrame(pintar);
    };
    pintar();
    el.addEventListener("scroll", alDeslizar, { passive: true });
    window.addEventListener("resize", alDeslizar);
    return () => {
      el.removeEventListener("scroll", alDeslizar);
      window.removeEventListener("resize", alDeslizar);
      window.cancelAnimationFrame(frame);
    };
  }, [ref]);
}

export function ModulosCarousel() {
  const { profile, loading } = useAuth();
  // Sin rol cargado todavía no se habilita el toque.
  const isOwner = !loading && Boolean(profile) && (!profile?.role || profile.role === "owner" || profile.role === "admin_general");
  const ref = React.useRef<HTMLDivElement>(null);
  useEnfoque(ref);

  const base = "block h-full w-full rounded-[24px] px-4 py-3 text-left";
  const clase = `${base} transition-transform duration-150 active:scale-[0.97]`;

  return (
    <div
      ref={ref}
      aria-label="Qué podés hacer en Clippr"
      className="-mx-3 mb-3 flex snap-x snap-mandatory scroll-px-3 gap-3 overflow-x-auto px-3 py-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:-mx-5 sm:scroll-px-5 sm:px-5 lg:-mx-6 lg:scroll-px-6 lg:px-6 [&::-webkit-scrollbar]:hidden"
    >
      {MODULOS.map((m) => {
        const style = { backgroundImage: `linear-gradient(112deg, #05040b 0%, #17122f 46%, ${m.color} 100%)` };
        return (
          <div key={m.id} className="w-[86%] shrink-0 snap-start transition-[transform,opacity] duration-200 ease-out sm:w-[320px]">
            {!isOwner ? (
              <div className={base} style={style}>
                <Contenido m={m} />
              </div>
            ) : m.to ? (
              <Link to={m.to} search={m.search as never} className={clase} style={style}>
                <Contenido m={m} />
              </Link>
            ) : (
              <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(EVENTO_VER_ASISTENCIA))} className={clase} style={style}>
                <Contenido m={m} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
