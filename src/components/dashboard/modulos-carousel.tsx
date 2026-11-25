import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useAuth, type PermKey } from "@/hooks/use-auth";

// Carrusel de Inicio para descubrir qué se puede hacer en la app. Se desliza con el dedo (no avanza solo) y cada
// tarjeta entera abre la sección que describe. Respeta los permisos; la sucursal es la activa de siempre.
type Modulo = {
  id: string;
  nombre: string;
  titulo: string;
  descripcion: string;
  perm: PermKey;
  // "r,g,b" del acento del módulo.
  color: string;
  to?: "/agenda" | "/cash-register" | "/clients" | "/advisor" | "/settings";
  search?: Record<string, string>;
};

const MODULOS: Modulo[] = [
  { id: "agenda", nombre: "Agenda", titulo: "Reservas online", descripcion: "Recibí turnos desde tu página y organizá la agenda de tu equipo.", perm: "agenda", color: "139,92,246", to: "/agenda" },
  { id: "caja", nombre: "Caja", titulo: "Control de caja", descripcion: "Registrá ventas y gastos, y revisá tus cierres diarios.", perm: "caja", color: "52,211,153", to: "/cash-register", search: { tab: "resumen" } },
  { id: "liquidaciones", nombre: "Liquidaciones", titulo: "Pagos al equipo", descripcion: "Revisá comisiones, propinas y adelantos antes de liquidar.", perm: "caja", color: "56,189,248", to: "/cash-register", search: { tab: "profesionales" } },
  { id: "clientes", nombre: "Clientes", titulo: "Hacé que vuelvan", descripcion: "Identificá a quienes dejaron de venir y contactalos.", perm: "clientes", color: "244,114,182", to: "/clients" },
  { id: "inventario", nombre: "Inventario", titulo: "Stock al día", descripcion: "Consultá tu stock y registrá entradas y retiros.", perm: "caja", color: "251,191,36", to: "/cash-register", search: { tab: "inventario" } },
  { id: "asesor", nombre: "Asesor IA", titulo: "Análisis diario", descripcion: "Revisá tus ventas, clientes y ocupación para saber cómo va tu negocio.", perm: "asesor_ia", color: "34,211,238", to: "/advisor" },
  { id: "bolsa", nombre: "Bolsa de trabajo", titulo: "Conectá con profesionales", descripcion: "Publicá ofertas de trabajo o puestos en alquiler y recibí solicitudes.", perm: "configuracion", color: "192,132,252", to: "/settings", search: { section: "bolsa" } },
  { id: "resenas", nombre: "Reseñas", titulo: "Opiniones de tus clientes", descripcion: "Revisá las reseñas que recibís y elegí cuáles destacar en tu página.", perm: "configuracion", color: "250,204,21", to: "/settings", search: { section: "resenas" } },
  // Sin destino fijo: abre el listado de asistencia del día (o la configuración de fichaje si todavía no se puede).
  { id: "fichaje", nombre: "Fichaje", titulo: "Asistencia del equipo", descripcion: "Registrá entradas y salidas, y consultá quién ya fichó.", perm: "dashboard", color: "45,212,191" },
];

export const EVENTO_VER_ASISTENCIA = "clippr:ver-asistencia";

function Contenido({ m }: { m: Modulo }) {
  return (
    <>
      <span className="inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white" style={{ backgroundColor: `rgba(${m.color},0.22)`, boxShadow: `inset 0 0 0 1px rgba(${m.color},0.55)` }}>
        {m.nombre}
      </span>
      <span className="mt-2 block text-xl font-bold leading-tight text-white">{m.titulo}</span>
      <span className="mt-1.5 flex items-end gap-3">
        <span className="min-w-0 flex-1 text-sm leading-5 text-white/75">{m.descripcion}</span>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.06] text-white ring-1 ring-white/15" aria-hidden>
          <ArrowRight className="h-4 w-4" />
        </span>
      </span>
    </>
  );
}

export function ModulosCarousel() {
  const { permissions, profile } = useAuth();
  const isOwner = !profile?.role || profile.role === "owner" || profile.role === "admin_general";
  const visibles = MODULOS.filter((m) => isOwner || permissions[m.perm] === true);
  if (visibles.length === 0) return null;

  const clase = "block w-[86%] shrink-0 snap-start rounded-3xl border p-4 text-left transition active:scale-[0.985] sm:w-[320px]";

  return (
    <div
      aria-label="Qué podés hacer en Clippr"
      className="-mx-3 mb-3 flex snap-x snap-mandatory scroll-px-3 gap-3 overflow-x-auto px-3 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:-mx-5 sm:scroll-px-5 sm:px-5 lg:-mx-6 lg:scroll-px-6 lg:px-6 [&::-webkit-scrollbar]:hidden"
    >
      {visibles.map((m) => {
        const style = {
          borderColor: `rgba(${m.color},0.45)`,
          backgroundColor: "#0b0914",
          backgroundImage: `radial-gradient(120% 100% at 100% 0%, rgba(${m.color},0.30), transparent 62%), radial-gradient(90% 90% at 0% 100%, rgba(139,92,246,0.14), transparent 65%)`,
          boxShadow: `0 0 24px -14px rgba(${m.color},0.9)`,
        };
        return m.to ? (
          <Link key={m.id} to={m.to} search={m.search as never} className={clase} style={style}>
            <Contenido m={m} />
          </Link>
        ) : (
          <button key={m.id} type="button" onClick={() => window.dispatchEvent(new CustomEvent(EVENTO_VER_ASISTENCIA))} className={clase} style={style}>
            <Contenido m={m} />
          </button>
        );
      })}
    </div>
  );
}
