import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

// Carrusel de Inicio para descubrir qué se puede hacer en la app. Se desliza con el dedo (no avanza solo). Todos ven
// las 9 tarjetas; solo el dueño o administrador general puede tocarlas para ir a la sección (la sucursal es la activa
// de siempre). Para el resto son informativas.
type Modulo = {
  id: string;
  nombre: string;
  titulo: string;
  descripcion: string;
  // Color en el que termina el degradado de la tarjeta (arranca casi negro).
  color: string;
  to?: "/agenda" | "/cash-register" | "/clients" | "/advisor" | "/settings";
  search?: Record<string, string>;
};

const MODULOS: Modulo[] = [
  { id: "agenda", nombre: "Agenda", titulo: "Reservas online", descripcion: "Recibí turnos desde tu página y organizá la agenda de tu equipo.", color: "#b52f7d", to: "/agenda" },
  { id: "caja", nombre: "Caja", titulo: "Control de caja", descripcion: "Registrá ventas y gastos, y revisá tus cierres diarios.", color: "#e0345c", to: "/cash-register", search: { tab: "resumen" } },
  { id: "liquidaciones", nombre: "Liquidaciones", titulo: "Pagos al equipo", descripcion: "Revisá comisiones, propinas y adelantos antes de liquidar.", color: "#1763c9", to: "/cash-register", search: { tab: "profesionales" } },
  { id: "clientes", nombre: "Clientes", titulo: "Hacé que vuelvan", descripcion: "Identificá a quienes dejaron de venir y contactalos.", color: "#c0267a", to: "/clients" },
  { id: "inventario", nombre: "Inventario", titulo: "Stock al día", descripcion: "Consultá tu stock y registrá entradas y retiros.", color: "#b4560c", to: "/cash-register", search: { tab: "inventario" } },
  { id: "asesor", nombre: "Asesor IA", titulo: "Análisis diario", descripcion: "Revisá tus ventas, clientes y ocupación para saber cómo va tu negocio.", color: "#0e7f9e", to: "/advisor" },
  { id: "bolsa", nombre: "Bolsa de trabajo", titulo: "Conectá con profesionales", descripcion: "Publicá ofertas de trabajo o puestos en alquiler y recibí solicitudes.", color: "#7c3aed", to: "/settings", search: { section: "bolsa" } },
  { id: "resenas", nombre: "Reseñas", titulo: "Opiniones de tus clientes", descripcion: "Revisá las reseñas que recibís y elegí cuáles destacar en tu página.", color: "#a86a08", to: "/settings", search: { section: "resenas" } },
  // Sin destino fijo: abre el listado de asistencia del día (o la configuración de fichaje si todavía no se puede).
  { id: "fichaje", nombre: "Fichaje", titulo: "Asistencia del equipo", descripcion: "Registrá entradas y salidas, y consultá quién ya fichó.", color: "#0d8578" },
];

export const EVENTO_VER_ASISTENCIA = "clippr:ver-asistencia";

function Contenido({ m, tocable }: { m: Modulo; tocable: boolean }) {
  return (
    <>
      <span className="inline-flex rounded-full bg-black/35 px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.12em] text-white">
        {m.nombre}
      </span>
      <span className="mt-2 block text-[22px] font-extrabold leading-tight text-white">{m.titulo}</span>
      <span className="mt-1 flex items-end gap-2">
        <span className="min-w-0 flex-1 text-[15px] font-medium leading-[1.35] text-white/85">{m.descripcion}</span>
        {tocable && (
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-black/25 text-white/80" aria-hidden>
            <ArrowRight className="h-4 w-4" />
          </span>
        )}
      </span>
    </>
  );
}

export function ModulosCarousel() {
  const { profile, loading } = useAuth();
  // Sin rol cargado todavía no se habilita el toque.
  const isOwner = !loading && Boolean(profile) && (!profile?.role || profile.role === "owner" || profile.role === "admin_general");

  const base = "block w-[86%] shrink-0 snap-start rounded-[28px] px-5 py-4 text-left sm:w-[320px]";
  const clase = `${base} transition active:scale-[0.985]`;

  return (
    <div
      aria-label="Qué podés hacer en Clippr"
      className="-mx-3 mb-3 flex snap-x snap-mandatory scroll-px-3 gap-3 overflow-x-auto px-3 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:-mx-5 sm:scroll-px-5 sm:px-5 lg:-mx-6 lg:scroll-px-6 lg:px-6 [&::-webkit-scrollbar]:hidden"
    >
      {MODULOS.map((m) => {
        const style = { backgroundImage: `linear-gradient(112deg, #05040b 0%, #17122f 46%, ${m.color} 100%)` };
        if (!isOwner) {
          return (
            <div key={m.id} className={base} style={style}>
              <Contenido m={m} tocable={false} />
            </div>
          );
        }
        return m.to ? (
          <Link key={m.id} to={m.to} search={m.search as never} className={clase} style={style}>
            <Contenido m={m} tocable />
          </Link>
        ) : (
          <button key={m.id} type="button" onClick={() => window.dispatchEvent(new CustomEvent(EVENTO_VER_ASISTENCIA))} className={clase} style={style}>
            <Contenido m={m} tocable />
          </button>
        );
      })}
    </div>
  );
}
