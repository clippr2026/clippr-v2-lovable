import * as React from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useAuth, type Branch } from "@/hooks/use-auth";
import { AccessDenied, usePermGuard } from "@/hooks/use-perm-guard";
import {
  useDashboardData,
  fmtAR,
  type DashboardData,
  type RecentCancellation,
} from "@/components/dashboard/use-dashboard-data";
import { useCajaHoy } from "@/components/dashboard/use-caja-hoy";
import { useInicioWidgets, type ActividadItem } from "@/components/dashboard/use-inicio-widgets";
import { useFichajeHoy } from "@/components/dashboard/use-fichaje-hoy";
import { FichajeHoyCard } from "@/components/dashboard/fichaje-hoy-card";
import { JornadaRecepcionCard } from "@/components/dashboard/jornada-recepcion-card";
import { SenasExtensionBanner } from "@/components/senas/senas-extension";
import { NegocioHero } from "@/components/dashboard/negocio-hero";
import { ModulosCarousel } from "@/components/dashboard/modulos-carousel";
import { cajaDateKeyBA, dayBoundsBA } from "@/lib/caja-cierre";
import { SaldoComposicionModal } from "@/components/caja/saldo-composicion";
import {
  TrendingUp,
  TrendingDown,
  XCircle,
  ChevronRight,
  AlertTriangle,
  ScanLine,
  CalendarClock,
  Activity,
  Receipt,
  Wallet,
  CreditCard,
  HandCoins,
  Eye,
  EyeOff,
} from "lucide-react";
import { MONTO_OCULTO, useMontosOcultos } from "@/hooks/use-montos-ocultos";
import { ClipprLoader } from "@/components/ui/clippr-loader";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Inicio — Clippr" },
      { name: "description", content: "Panel premium para barberías y salones." },
    ],
  }),
  component: DashboardRoute,
});

function DashboardRoute() {
  const hasAccess = usePermGuard("dashboard");
  const { loading, session, businessId, profile } = useAuth();
  const navigate = useNavigate();

  React.useEffect(() => {
    if (!loading && !session) navigate({ to: "/login", replace: true });
  }, [loading, session, navigate]);

  if (!hasAccess) return <AccessDenied />;

  if (loading || !session) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <ClipprLoader size="screen" delayMs={130} />
      </div>
    );
  }

  const firstName = (profile?.full_name ?? "Usuario").split(" ")[0];

  return (
    <AppShell containedScroll>
      <NegocioHero businessId={businessId}>
        <ModulosCarousel />
      </NegocioHero>
      <DashboardContent businessId={businessId} />
    </AppShell>
  );
}

// Fecha de HOY (YYYY-MM-DD) en huso Buenos Aires, que se actualiza sola al
// cruzar la medianoche ART sin que haga falta recargar la página — un
// setTimeout se reprograma cada vez que dispara, apuntando siempre a la
// medianoche BA siguiente (nunca a "+24h" a secas, que se corre un poco
// cada vez que el timer dispara unos milisegundos tarde).
function useTodayKeyBA(): string {
  const [todayKey, setTodayKey] = React.useState(() => cajaDateKeyBA());

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const scheduleNext = () => {
      const now = new Date();
      const nextMidnightBA = dayBoundsBA(cajaDateKeyBA(now)).end;
      const msUntilNext = nextMidnightBA.getTime() - now.getTime() + 1000; // +1s de margen
      timer = setTimeout(() => {
        setTodayKey(cajaDateKeyBA());
        scheduleNext();
      }, Math.max(1000, msUntilNext));
    };
    scheduleNext();
    return () => clearTimeout(timer);
  }, []);

  return todayKey;
}

function DashboardContent({ businessId }: { businessId: string | null }) {
  const { activeBranchId, branches, branchesLoading, session } = useAuth();
  const userEmail = session?.user?.email ?? session?.user?.id ?? null;
  // Fichaje de jornada: nunca debe pedir elegir sucursal si hay una sola
  // ACTIVA — se usa esa directo, sin depender de que activeBranchId (el
  // selector global, que puede apuntar a cualquier fila sin filtrar por
  // is_active) ya haya resuelto a la misma. Con 2+ activas sí hace falta
  // elegir (ver FichajeHoyCard, que arma su propio selector acotado a
  // sucursales activas). Con 0 activas no hay nada que fichar.
  const activeBranches = React.useMemo(
    () => branches.filter((b) => b.is_active),
    [branches],
  );
  const fichajeBranchId =
    activeBranches.length === 1 ? activeBranches[0].id : activeBranchId;
  const cajaHoy = useCajaHoy(businessId, activeBranchId);
  // "Caja de hoy" es SIEMPRE el día de hoy en huso Buenos Aires — nunca se
  // extiende hacia atrás aunque haya una caja anterior pendiente de
  // revisión (18/09, 19/09, 16/10, etc.). Esas jornadas se muestran por
  // separado en el aviso de pendientes (caja.pendingCierres); mezclarlas
  // acá fue el bug reportado ("Inicio mostraba la facturación del día
  // anterior"). todayKeyBA se actualiza solo al cruzar la medianoche —
  // ver useTodayKeyBA — así que `range` también se recalcula solo.
  const todayKeyBA = useTodayKeyBA();
  const range = React.useMemo(() => {
    const { start, end } = dayBoundsBA(todayKeyBA);
    return { from: start, to: end };
  }, [todayKeyBA]);

  const { data, isLoading, error } = useDashboardData(businessId, range, activeBranchId);
  const inicioWidgets = useInicioWidgets(businessId, activeBranchId);
  const fichajeHoy = useFichajeHoy(businessId, fichajeBranchId);

  if (!businessId) {
    return (
      <div className="glass rounded-2xl p-6 text-sm text-muted-foreground">
        No se encontró un negocio asignado a esta cuenta.
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="dashboard-premium-shell space-y-3">
        <DashboardSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass rounded-2xl p-6 text-sm text-destructive">
        Error cargando Inicio: {(error as Error).message}
      </div>
    );
  }

  return (
    <div className="dashboard-premium-shell space-y-3 animate-fade-in-safe">
      {/* Fichaje de jornada, justo debajo del banner. */}
      <FichajeHoyCard
        fichaje={fichajeHoy}
        branchId={fichajeBranchId}
        activeBranches={activeBranches}
        branchesLoading={branchesLoading}
      />
      <CajaHoyCard caja={cajaHoy} data={data} userEmail={userEmail} />
      <SenasExtensionBanner businessId={businessId} branchId={activeBranchId} onClosed={() => void cajaHoy.refresh()} />
      <JornadaRecepcionCard businessId={businessId} branchId={fichajeBranchId} />

      {/* Próximos turnos */}
      <ProximosTurnosCard widgets={inicioWidgets} />
    </div>
  );
}

// Mismo alto aproximado que el contenido real — el objetivo NO es
// estética, es que scrollHeight sea estable desde el primer render y
// cuando useDashboardData resuelva, sin importar cuánto tarde (un salto
// de altura justo cuando el usuario ya está scrolleando es lo que rompía
// el primer gesto de swipe en iOS Safari).
function DashboardSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="glass rounded-2xl p-4 sm:p-5 min-h-[260px]" />
      <div className="glass rounded-2xl p-4 sm:p-5 min-h-[160px]" />
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="glass rounded-2xl p-4 sm:p-5 min-h-[220px]" />
        <div className="glass rounded-2xl p-4 sm:p-5 min-h-[220px]" />
      </section>
    </div>
  );
}

function fechaCortaLabel(fecha: string) {
  return new Date(`${fecha}T12:00:00`).toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
  });
}

function MiniStat({
  icon: Icon,
  label,
  value,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  // Composición del saldo (ver saldo-composicion.tsx) — sin esto, se
  // comporta exactamente igual que antes (una tarjeta no interactiva).
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate text-[11px] leading-tight">{label}</span>
      </div>
      <div className="mt-1 font-display text-lg font-semibold tracking-tight truncate">{value}</div>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="w-full rounded-xl px-3 py-2.5 text-left ring-1 transition hover:bg-white/[0.1] bg-white/[0.07] ring-white/20 [background-image:radial-gradient(120%_100%_at_100%_0%,rgba(255,255,255,.16),transparent_60%)] shadow-[0_0_22px_-10px_rgba(255,255,255,.45)]"
      >
        {content}
      </button>
    );
  }
  return <div className="rounded-xl bg-white/[0.03] ring-1 ring-white/8 px-3 py-2.5">{content}</div>;
}

function CajaHoyCard({
  caja,
  data,
  userEmail,
}: {
  caja: ReturnType<typeof useCajaHoy>;
  data: DashboardData;
  userEmail: string | null;
}) {
  // Composición de "Efectivo en caja"/"Dinero en banco" — mismo
  // modal que Caja > Facturación, misma fuente (caja.todayExpectedFull):
  // un saldo negativo nunca queda sin explicación acá tampoco.
  const [saldoDetalle, setSaldoDetalle] = React.useState<"cash" | "digital" | null>(null);
  const { businessId: bizId, activeBranchId } = useAuth();
  const [montosOcultos, alternarOculto] = useMontosOcultos();

  // Los 10 campos en `undefined` (no `null`, no omitidos): la ruta exige el
  // objeto `search` completo por tipos, pero `undefined` es la única forma
  // de que TanStack Router NO los escriba en la URL — a diferencia de
  // `null`, que se serializa literal como la palabra "null" (ver
  // cleanSearchParam en cash-register.tsx).
  const emptyCashRegisterSearch = {
    depositAppointmentId: undefined,
    depositAmount: undefined,
    clientName: undefined,
    serviceName: undefined,
    employeeId: undefined,
    appointmentId: undefined,
    finalAmount: undefined,
    depositPaid: undefined,
    totalPrice: undefined,
    chargeStep: undefined,
    pendingDate: undefined,
    tab: undefined,
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Ninguna caja se cierra sola: este aviso solo lleva a la vista
          previa de Caja > Cierres (ver sección 2/4 del pedido) — nunca
          cierra nada desde Inicio. Lista TODAS las jornadas pendientes,
          no solo la más vieja.
          Mientras se averigua si hay pendientes NO se pinta nada (antes se
          mostraba un rectángulo de relleno que desaparecía apenas llegaba el
          dato, porque casi siempre no hay ninguna, y corría toda la tarjeta
          hacia arriba en cada carga). El aviso aparece solo cuando de verdad
          hay una caja pendiente; dentro de la misma sesión el hook recuerda
          el último valor (pendingCierresCache), así que no vuelve a parpadear. */}
      <div className="flex flex-col gap-3 empty:hidden">
      {caja.pendingCierres.length > 0 ? (
        <div
          className="flex items-center gap-3 rounded-[20px] border border-amber-400/45 bg-white/[0.03] p-4"
          style={{ background: "radial-gradient(110% 90% at 100% 0%, rgba(251,191,36,.20), transparent 62%), radial-gradient(90% 80% at 0% 100%, rgba(251,191,36,.10), transparent 65%)", boxShadow: "0 0 26px -12px rgba(251,191,36,.55)" }}
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
          <p className="min-w-0 flex-1 text-sm font-semibold text-white">
            {caja.pendingCierres.length === 1
              ? `Tenés una caja pendiente de revisión del ${fechaCortaLabel(caja.pendingCierres[0].date)}`
              : `Tenés ${caja.pendingCierres.length} cajas pendientes de revisión`}
          </p>
          <Link
            to="/cash-register"
            search={{ ...emptyCashRegisterSearch, tab: "cierres" }}
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-full border border-amber-400/50 bg-amber-400/15 px-5 text-sm font-semibold text-amber-100 transition hover:bg-amber-400/25"
          >
            Cerrar
          </Link>
        </div>
      ) : null}
      </div>

      <div className="glass rounded-2xl p-4 sm:p-5 ring-1 ring-white/5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-base font-semibold text-white">
          Caja de hoy
          {caja.cajaCerradaHoy && (
            <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[9px] font-semibold tracking-normal text-emerald-300 ring-1 ring-emerald-400/25">
              Caja cerrada
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Link
            to="/cash-register"
            search={emptyCashRegisterSearch}
            className="inline-flex items-center gap-0.5 text-xs font-semibold text-primary transition hover:text-primary/80"
          >
            Ver todo <ChevronRight className="h-3.5 w-3.5" />
          </Link>
          <button
            type="button"
            onClick={alternarOculto}
            aria-label={montosOcultos ? "Mostrar montos" : "Ocultar montos"}
            className="grid h-10 w-10 touch-manipulation place-items-center rounded-full text-white/70 transition active:scale-95 hover:text-white"
          >
            {montosOcultos ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Ingresos / Egresos — los únicos 2 montos grandes acá, el
          detalle completo (gráficos, desglose por servicio/categoría) vive
          en Caja, no se repite en Inicio. */}
      <div className="mt-2 grid grid-cols-2 gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5 text-blue-400" />
            <span className="text-xs">Ingresos</span>
          </div>
          <div className="mt-0.5 text-xl sm:text-2xl font-display font-semibold tracking-tight">
            {montosOcultos ? MONTO_OCULTO : fmtAR(caja.revHoy)}
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <TrendingDown className="h-3.5 w-3.5 text-rose-400" />
            <span className="text-xs">Egresos</span>
          </div>
          <div className="mt-0.5 text-xl sm:text-2xl font-display font-semibold tracking-tight">
            {montosOcultos ? MONTO_OCULTO : fmtExpenseAR(caja.totalGastosHoy)}
          </div>
        </div>
      </div>

      {/* Efectivo del día / Dinero en cuenta del día — ESTRICTAMENTE hoy
          (caja.todayCashExpected/todayDigitalExpected, useCajaSummary),
          misma fuente que ya usa Caja > Resumen. Cierra el bloque
          "Movimientos de hoy": todo lo de arriba (Ingresos/Egresos/
          Utilidad/Servicios/Productos) y esto son siempre $0 si todavía
          no hubo actividad hoy, sin importar cuánto backlog exista.
          NO restan adelantos a profesionales — eso es la tarjeta aparte
          de abajo, "Adelantos del día", para no mezclar un adelanto con
          cobros/gastos y producir un total negativo sin explicación. */}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <MiniStat
          icon={Wallet}
          label="Efectivo en caja"
          value={montosOcultos ? MONTO_OCULTO : fmtAR(caja.todayCashExpected)}
          onClick={() => setSaldoDetalle("cash")}
        />
        <MiniStat
          icon={CreditCard}
          label="Dinero en banco"
          value={montosOcultos ? MONTO_OCULTO : fmtAR(caja.todayDigitalExpected)}
          onClick={() => setSaldoDetalle("digital")}
        />
      </div>

      {saldoDetalle && (
        <SaldoComposicionModal
          title={saldoDetalle === "cash" ? "Efectivo en caja" : "Dinero en banco"}
          expected={caja.todayExpectedFull}
          side={saldoDetalle}
          onClose={() => setSaldoDetalle(null)}
        />
      )}
      </div>
    </div>
  );
}

function horaCorta(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

/** Cuándo pasó algo: hoy → la hora; ayer → "Ayer"; otro día → la fecha. */
function cuandoCorto(iso: string) {
  const d = new Date(iso);
  const hoy = new Date();
  if (d.toDateString() === hoy.toDateString()) return horaCorta(iso);
  const ayer = new Date(hoy);
  ayer.setDate(hoy.getDate() - 1);
  if (d.toDateString() === ayer.toDateString()) return "Ayer";
  return d.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
}

function diaYHoraCorta(iso: string) {
  const d = new Date(iso);
  const hoy = new Date();
  const esHoy = d.toDateString() === hoy.toDateString();
  const diaLabel = esHoy
    ? "Hoy"
    : d.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
  return `${diaLabel} · ${horaCorta(iso)}`;
}

function ProximosTurnosCard({ widgets }: { widgets: ReturnType<typeof useInicioWidgets> }) {
  return (
    <div className="glass rounded-2xl p-4 sm:p-5 ring-1 ring-white/5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 text-base font-semibold text-white">
          <CalendarClock className="h-5 w-5 text-violet-300" />
          Próximos turnos
        </div>
        <Link
          to="/agenda"
          className="inline-flex items-center gap-0.5 text-xs font-semibold text-primary transition hover:text-primary/80"
        >
          Ver todos <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="mt-3 space-y-1.5">
        {widgets.loading ? (
          <div className="text-sm text-muted-foreground">Cargando…</div>
        ) : widgets.proximosTurnos.length === 0 ? (
          <div className="text-sm text-muted-foreground">Sin turnos próximos.</div>
        ) : (
          widgets.proximosTurnos.map((t) => (
            // Dos renglones: cliente y horario arriba, servicio y profesional abajo.
            // Al tocarlo abre ese turno en la Agenda.
            <Link
              key={t.id}
              to="/agenda"
              search={{ date: cajaDateKeyBA(new Date(t.starts_at)), turno: t.id }}
              className="block rounded-xl bg-white/[0.03] px-3 py-1.5 transition active:scale-[0.98]"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-medium text-foreground">{t.client_name ?? "Cliente"}</span>
                <span className="shrink-0 text-xs font-semibold text-violet-200">{diaYHoraCorta(t.starts_at)}</span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-xs text-muted-foreground">{t.service_name ?? "—"}</span>
                {t.employee_name && <span className="max-w-[45%] shrink-0 truncate text-xs font-medium text-violet-200/90">Con {t.employee_name}</span>}
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

function fmtExpenseAR(value: number) {
  const abs = Math.abs(Math.round(value || 0));
  return abs > 0 ? `-$${abs.toLocaleString("es-AR")}` : "$0";
}


// ---------------------------------------------------------------------------
// Cancellations
// ---------------------------------------------------------------------------
function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.max(1, Math.round(diff / 60000));
  if (m < 60) return `Hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `Hace ${h} h`;
  return `Hace ${Math.round(h / 24)} d`;
}

function CancellationsPanel({ items }: { items: RecentCancellation[] }) {
  const count = items.length;
  const perdida = items.reduce((s, a) => s + Number(a.service_price ?? 0), 0);

  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg grid place-items-center bg-destructive/15 ring-1 ring-destructive/30">
            <XCircle className="h-4 w-4 text-destructive" />
          </div>
          <h3 className="font-display text-base font-semibold">Cancelaciones</h3>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">❌</span>
            <span className="font-display text-lg font-semibold text-destructive">{count}</span>
            <span className="text-xs text-muted-foreground">cancelaciones</span>
          </div>
          <div className="h-4 w-px bg-white/10" />
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">💸</span>
            <span className="font-display text-lg font-semibold text-destructive">{fmtAR(perdida)}</span>
            <span className="text-xs text-muted-foreground">pérdida est.</span>
          </div>
        </div>
      </div>

      {count === 0 ? (
        <p className="text-sm text-muted-foreground">Sin cancelaciones en el período.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((a) => (
            <li key={a.id} className="flex items-center gap-3">
              <div className="h-7 w-7 rounded-full grid place-items-center bg-destructive/15 ring-1 ring-destructive/30 shrink-0">
                <XCircle className="h-3.5 w-3.5 text-destructive" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">
                  {a.client_name || "Cliente"}
                  {a.service_name && (
                    <>
                      <span className="text-muted-foreground font-normal"> · </span>
                      <span className="text-foreground/80">{a.service_name}</span>
                    </>
                  )}
                </div>
                {a.service_price ? (
                  <div className="text-xs text-destructive/70">{fmtAR(a.service_price)} perdido</div>
                ) : (
                  <div className="text-xs text-muted-foreground">Turno cancelado</div>
                )}
              </div>
              <div className="text-xs text-muted-foreground shrink-0 tabular-nums">
                {timeAgo(a.starts_at)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
