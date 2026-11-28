import * as React from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import {
  AlarmClock,
  ArrowLeft,
  Bell,
  Briefcase,
  CalendarCheck,
  CalendarX,
  CheckCheck,
  ChevronRight,
  Clock,
  HandCoins,
  Receipt,
  Wallet,
  WalletCards,
  Users,
  Package,
  Star,
  BellOff,
  type LucideIcon,
} from "lucide-react";
import { useAuth, type PermKey } from "@/hooks/use-auth";
import {
  cargarActividad,
  cargarImportantes,
  EVENTO_LEIDAS,
  grupoDeFecha,
  leerLeidas,
  marcarLeidas,
  type Aviso,
  type TipoAviso,
} from "@/lib/notificaciones";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { silenciarDeuda } from "@/lib/deudas-clientes";
import { CobrarDeudas } from "@/components/clients/deuda-clientes-banner";

const ICONO: Record<TipoAviso, LucideIcon> = {
  reserva: CalendarCheck,
  cancelacion: CalendarX,
  sena: HandCoins,
  caja: Wallet,
  bolsa: Briefcase,
  liquidacion: Users,
  fichaje: Clock,
  cobro: WalletCards,
  gasto: Receipt,
  cierre: Wallet,
  tardanza: AlarmClock,
  stock: Package,
  resena: Star,
  deuda: Clock,
};

const REVISAR_MS = 120_000;

function useContexto() {
  const { businessId, activeBranchId, permissions, profile } = useAuth();
  const esDueno = !profile?.role || profile.role === "owner" || profile.role === "admin_general";
  const puede = React.useCallback((p: PermKey) => esDueno || permissions[p] === true, [esDueno, permissions]);
  return { businessId, branchId: activeBranchId ?? null, puede, esDueno };
}

/** Avisos importantes y cuántos no se leyeron (para el punto de la campanita). */
function useImportantes() {
  const ctx = useContexto();
  const [avisos, setAvisos] = React.useState<Aviso[]>([]);
  const [leidas, setLeidas] = React.useState<Set<string>>(new Set());
  const [cargando, setCargando] = React.useState(true);
  const { businessId, branchId, puede, esDueno } = ctx;

  const cargar = React.useCallback(async () => {
    if (!businessId) return;
    const lista = await cargarImportantes({ businessId, branchId, puede, esDueno });
    setAvisos(lista);
    setLeidas(leerLeidas(businessId));
    setCargando(false);
  }, [businessId, branchId, puede, esDueno]);

  React.useEffect(() => {
    void cargar();
    const reloj = window.setInterval(() => document.visibilityState === "visible" && void cargar(), REVISAR_MS);
    return () => window.clearInterval(reloj);
  }, [cargar]);

  React.useEffect(() => {
    if (!businessId) return;
    const actualizar = () => setLeidas(leerLeidas(businessId));
    window.addEventListener(EVENTO_LEIDAS, actualizar);
    return () => window.removeEventListener(EVENTO_LEIDAS, actualizar);
  }, [businessId]);

  const sinLeer = avisos.filter((a) => !leidas.has(a.id)).length;
  return { avisos, leidas, sinLeer, cargando, recargar: cargar, ctx };
}

/** Campanita de la cabecera: abre el centro de notificaciones. */
export function CampanitaNotificaciones() {
  const importantes = useImportantes();
  const [abierto, setAbierto] = React.useState(false);
  // Cobro de deudas abierto desde un aviso (ids) o desde «Ver todas las deudas» (null = todas).
  const [cobro, setCobro] = React.useState<{ ids?: string[] } | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setAbierto(true);
          void importantes.recargar();
        }}
        aria-label={importantes.sinLeer ? `Notificaciones: ${importantes.sinLeer} sin leer` : "Notificaciones"}
        className="boton-cabecera relative grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-white/85 transition hover:bg-white/[0.1] active:scale-95"
      >
        <Bell className="h-4 w-4" />
        {importantes.sinLeer > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-violet-600 px-1 text-[10px] font-bold leading-none text-white">
            {importantes.sinLeer > 9 ? "9+" : importantes.sinLeer}
          </span>
        )}
      </button>
      {abierto && <CentroNotificaciones importantes={importantes} onClose={() => setAbierto(false)} onCobrar={setCobro} />}
      {cobro && <CobrarDeudas soloIds={cobro.ids} onClose={() => setCobro(null)} onCollected={() => void importantes.recargar()} />}
    </>
  );
}

function CentroNotificaciones({
  importantes,
  onClose,
  onCobrar,
}: {
  importantes: ReturnType<typeof useImportantes>;
  onClose: () => void;
  onCobrar: (cobro: { ids?: string[] }) => void;
}) {
  const navigate = useNavigate();
  const [pestana, setPestana] = React.useState<"importantes" | "actividad">("importantes");
  const [actividad, setActividad] = React.useState<Aviso[] | null>(null);
  const { businessId, branchId, puede, esDueno } = importantes.ctx;

  // Mientras está abierto: sin barra de abajo, sin scroll de la página de atrás y Escape cierra.
  React.useEffect(() => {
    document.documentElement.classList.add("notificaciones-abiertas");
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", tecla);
    return () => {
      document.documentElement.classList.remove("notificaciones-abiertas");
      window.removeEventListener("keydown", tecla);
    };
  }, [onClose]);

  React.useEffect(() => {
    if (pestana !== "actividad" || !businessId) return;
    let vigente = true;
    void cargarActividad({ businessId, branchId, puede, esDueno }).then((lista) => vigente && setActividad(lista));
    return () => {
      vigente = false;
    };
  }, [pestana, businessId, branchId, puede, esDueno]);

  function abrir(aviso: Aviso) {
    if (businessId) marcarLeidas(businessId, [aviso.id]);
    onClose();
    if (aviso.deuda) return onCobrar({ ids: aviso.deuda.ids });
    void navigate({ to: aviso.to, search: aviso.search } as never);
  }

  function noAvisarMas(aviso: Aviso) {
    if (!businessId || !aviso.deuda) return;
    const ids = aviso.deuda.ids;
    silenciarDeuda(businessId, ids);
    void importantes.recargar();
    toast.success("No te avisamos más. La deuda aparece cuando le cobres.", {
      action: {
        label: "Deshacer",
        onClick: () => {
          silenciarDeuda(businessId, ids, false);
          void importantes.recargar();
        },
      },
    });
  }

  const lista = pestana === "importantes" ? importantes.avisos : actividad;
  const cargando = pestana === "importantes" ? importantes.cargando : actividad === null;
  const grupos = React.useMemo(() => {
    const salida: Array<{ titulo: string; avisos: Aviso[] }> = [];
    for (const a of lista ?? []) {
      const titulo = grupoDeFecha(a.fecha);
      const ultimo = salida.at(-1);
      if (ultimo?.titulo === titulo) ultimo.avisos.push(a);
      else salida.push({ titulo, avisos: [a] });
    }
    return salida;
  }, [lista]);

  return createPortal(
    <div className="notificaciones-centro fixed inset-0 z-[10030] flex justify-end bg-black/50 lg:backdrop-blur-[2px]" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Notificaciones"
        onClick={(e) => e.stopPropagation()}
        className="notificaciones-panel flex h-dvh w-full flex-col bg-[#0b0a14] text-white lg:max-w-[440px] lg:border-l lg:border-white/10"
      >
        <header className="shrink-0 border-b border-white/[0.06] px-4 pb-3 pt-[calc(env(safe-area-inset-top,0px)+12px)]">
          <div className="flex items-center gap-3">
            <button type="button" onClick={onClose} aria-label="Volver" className="boton-cabecera grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.06]">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h2 className="min-w-0 flex-1 truncate text-2xl font-bold tracking-tight">Notificaciones</h2>
            <button
              type="button"
              onClick={() => businessId && marcarLeidas(businessId, importantes.avisos.map((a) => a.id))}
              disabled={importantes.sinLeer === 0}
              aria-label="Marcar todas como leídas"
              title="Marcar todas como leídas"
              className="boton-cabecera grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.06] disabled:opacity-40"
            >
              <CheckCheck className="h-5 w-5" />
            </button>
          </div>
          <div className="notificaciones-pestanas mt-3 grid grid-cols-2 gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1">
            {(["importantes", "actividad"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPestana(p)}
                className={cn(
                  "inline-flex h-10 items-center justify-center gap-2 rounded-full text-sm font-semibold transition",
                  pestana === p ? "pestana-activa bg-violet-500/20 text-violet-100" : "text-white/70",
                )}
              >
                {p === "importantes" ? "Importantes" : "Actividad"}
                {p === "importantes" && importantes.sinLeer > 0 && (
                  <span className="grid h-5 min-w-5 place-items-center rounded-full bg-violet-600 px-1.5 text-[11px] font-bold text-white">{importantes.sinLeer}</span>
                )}
              </button>
            ))}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] pt-3">
          {pestana === "importantes" && puede("caja") && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onCobrar({});
              }}
              className="mb-3 flex h-10 w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.04] text-sm font-semibold text-white/80"
            >
              <Clock className="h-4 w-4" /> Ver todas las deudas
            </button>
          )}
          {cargando ? (
            <div className="space-y-2 pt-2" aria-label="Cargando">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-[68px] animate-pulse rounded-2xl bg-white/[0.05]" />
              ))}
            </div>
          ) : grupos.length === 0 ? (
            <div className="grid place-items-center px-6 py-16 text-center text-sm text-white/55">
              {pestana === "importantes" ? "No tenés avisos pendientes." : "Todavía no hay actividad en los últimos 7 días."}
            </div>
          ) : (
            grupos.map((g) => (
              <section key={g.titulo} className="mb-4">
                <h3 className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.08em] text-white/50">{g.titulo}</h3>
                <div className="space-y-2">
                  {g.avisos.map((a) => {
                    const Icono = ICONO[a.tipo];
                    const nueva = pestana === "importantes" && !importantes.leidas.has(a.id);
                    return (
                      <div key={a.id}>
                      <button
                        type="button"
                        onClick={() => abrir(a)}
                        data-nueva={nueva || undefined}
                        className="aviso-fila flex w-full items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.04] px-3 py-3 text-left transition active:scale-[0.99] data-[nueva]:border-violet-400/25 data-[nueva]:bg-violet-500/[0.12]"
                      >
                        <span className="aviso-icono grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violet-500/15 text-violet-200">
                          <Icono className="h-5 w-5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-[15px] font-semibold">{a.titulo}</span>
                            <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium tabular-nums text-white/50">
                              {new Date(a.fecha).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                              {nueva && <span className="h-2 w-2 rounded-full bg-violet-500" aria-label="Sin leer" />}
                            </span>
                          </span>
                          <span className="mt-0.5 line-clamp-2 block text-sm leading-snug text-white/65">{a.detalle}</span>
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-white/35" />
                      </button>
                      {a.deuda && (
                        <button
                          type="button"
                          onClick={() => noAvisarMas(a)}
                          className="mt-1 ml-auto flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 text-xs font-medium text-white/70 active:scale-95"
                        >
                          <BellOff className="h-3.5 w-3.5" /> No avisar más
                        </button>
                      )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
