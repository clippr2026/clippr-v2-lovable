import * as React from "react";
import { toast } from "sonner";
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
import { FichajeQrModal } from "@/components/dashboard/fichaje-qr-modal";
import {
  DollarSign,
  ArrowDownCircle,
  Wallet,
  Landmark,
  Scissors,
  Package,
  XCircle,
  ChevronRight,
  Plus,
  Minus,
  AlertTriangle,
  ScanLine,
  Loader2,
  CalendarClock,
  Activity,
  Receipt,
} from "lucide-react";
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
      {/* Oculto en mobile: el banner de sección debajo del header ya dice
          "Inicio" (ver MobileSectionBanner) — repetirlo acá era
          redundante y le sacaba alto útil a la pantalla. En desktop no hay
          banner, así que el título sigue siendo la única referencia. */}
      <h1 className="mb-2 hidden font-display text-[1.65rem] leading-tight sm:text-3xl font-semibold tracking-tight lg:block">
        Resumen del negocio
      </h1>
      <DashboardContent businessId={businessId} />
    </AppShell>
  );
}

// Fecha local (YYYY-MM-DD) según el reloj/timezone del navegador — nunca usar
// toISOString() acá: convierte a UTC y en Argentina (UTC-3) eso adelanta la
// fecha al día siguiente durante la noche (ej. 21:00 ART ya es 00:00 UTC).
function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
  // Inicio ya no tiene selector de rango — es una mirada rápida de HOY,
  // el detalle completo (con su propio rango) vive en Caja. `range` queda
  // fijo al día de hoy, recalculado solo si el día cambia con la pestaña
  // abierta (medianoche).
  const todayStr = React.useMemo(() => localDateStr(new Date()), []);
  const range = React.useMemo(() => {
    const from = new Date(todayStr + "T00:00:00");
    const to = new Date(todayStr + "T23:59:59");
    return { from, to };
  }, [todayStr]);

  const { data, isLoading, error } = useDashboardData(businessId, range, activeBranchId);
  const cajaHoy = useCajaHoy(businessId, activeBranchId);
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
      <CajaHoyCard caja={cajaHoy} data={data} userEmail={userEmail} />
      <FichajeHoyCard
        fichaje={fichajeHoy}
        branchId={fichajeBranchId}
        activeBranches={activeBranches}
        branchesLoading={branchesLoading}
      />

      {/* Próximos turnos + Actividad reciente */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ProximosTurnosCard widgets={inicioWidgets} />
        <ActividadRecienteCard widgets={inicioWidgets} />
      </section>
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
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-white/[0.03] ring-1 ring-white/8 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate text-[11px] leading-tight">{label}</span>
      </div>
      <div className="mt-1 font-display text-lg font-semibold tracking-tight truncate">{value}</div>
    </div>
  );
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
  const [movModal, setMovModal] = React.useState<"ingreso" | "retiro" | null>(null);
  const [amount, setAmount] = React.useState("");
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [closingVencida, setClosingVencida] = React.useState(false);

  const serviciosRealizados = data.topServices.reduce((s, item) => s + item.count, 0);
  const productosVendidos = data.topCatalog.reduce((s, cat) => s + cat.count, 0);

  async function confirmMovement() {
    const value = Number(amount);
    if (!movModal || !value || value <= 0) {
      toast.error("Ingresá un monto válido");
      return;
    }
    setSaving(true);
    try {
      await caja.registerMovement(movModal, value, note, userEmail);
      toast.success(movModal === "ingreso" ? "Efectivo ingresado" : "Efectivo retirado");
      setMovModal(null);
      setAmount("");
      setNote("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmCerrarVencida() {
    if (!userEmail) return;
    setClosingVencida(true);
    try {
      await caja.closeVencida(userEmail);
      toast.success("Caja vencida cerrada");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setClosingVencida(false);
    }
  }

  return (
    <div className="glass rounded-2xl p-4 sm:p-5 ring-1 ring-white/5">
      {caja.pendingCierre ? (
        <div className="mb-3 flex flex-col gap-2 rounded-xl bg-amber-400/10 px-3 py-2.5 ring-1 ring-amber-400/25 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Caja vencida desde {fechaCortaLabel(caja.pendingCierre.date)}
          </div>
          <button
            type="button"
            onClick={confirmCerrarVencida}
            disabled={closingVencida}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-400/20 px-3 py-1.5 text-xs font-semibold text-amber-100 ring-1 ring-amber-400/30 transition hover:bg-amber-400/30 disabled:opacity-50"
          >
            {closingVencida ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Cerrar caja vencida
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
          Caja de hoy
        </div>
        <Link
          to="/cash-register"
          search={{
            depositAppointmentId: null,
            depositAmount: null,
            clientName: null,
            serviceName: null,
            employeeId: null,
            appointmentId: null,
            finalAmount: null,
            depositPaid: null,
            totalPrice: null,
            chargeStep: null,
          }}
          className="inline-flex items-center gap-0.5 text-xs font-semibold text-primary transition hover:text-primary/80"
        >
          Ver todo <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Ingresos / Egresos — únicos 2 montos grandes acá, el detalle
          completo (gráficos, desglose por servicio/categoría) vive en
          Caja, no se repite en Inicio. */}
      <div className="mt-2 grid grid-cols-2 gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <DollarSign className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs">Ingresos</span>
          </div>
          <div className="mt-0.5 text-2xl font-display font-semibold tracking-tight">
            {fmtAR(data.revHoy)}
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <ArrowDownCircle className="h-3.5 w-3.5 text-rose-400" />
            <span className="text-xs">Egresos</span>
          </div>
          <div className="mt-0.5 text-2xl font-display font-semibold tracking-tight">
            {fmtExpenseAR(data.totalGastos)}
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <MiniStat icon={Wallet} label="Efectivo esperado en caja" value={caja.loading ? "—" : fmtAR(caja.cashExpected)} />
        <MiniStat icon={Landmark} label="Dinero esperado en banco" value={caja.loading ? "—" : fmtAR(caja.bankExpected)} />
        <MiniStat icon={Scissors} label="Servicios realizados" value={String(serviciosRealizados)} />
        <MiniStat icon={Package} label="Productos vendidos" value={String(productosVendidos)} />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setMovModal("ingreso")}
          className="inline-flex items-center gap-1.5 rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold ring-1 ring-white/10 transition hover:bg-white/10"
        >
          <Plus className="h-3.5 w-3.5" /> Ingresar
        </button>
        <button
          type="button"
          onClick={() => setMovModal("retiro")}
          className="inline-flex items-center gap-1.5 rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold ring-1 ring-white/10 transition hover:bg-white/10"
        >
          <Minus className="h-3.5 w-3.5" /> Retirar
        </button>
      </div>

      {movModal ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4" onClick={() => setMovModal(null)}>
          <div
            className="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-900 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-foreground">
              {movModal === "ingreso" ? "Ingresar efectivo" : "Retirar efectivo"}
            </h3>
            <label className="mt-4 block text-[11px] text-muted-foreground">Monto</label>
            <input
              autoFocus
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-3 text-xl font-bold text-center text-foreground focus:outline-none focus:border-violet-400/50"
            />
            <label className="mt-3 block text-[11px] text-muted-foreground">Nota (opcional)</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ej: Cambio para el día"
              className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-foreground focus:outline-none focus:border-violet-400/50"
            />
            <div className="mt-4 flex gap-2">
              <button
                disabled={saving}
                onClick={confirmMovement}
                className="flex-1 rounded-lg bg-gradient-to-b from-violet-500 to-blue-500 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Guardando…" : "Confirmar"}
              </button>
              <button
                onClick={() => setMovModal(null)}
                className="rounded-lg border border-white/10 px-4 py-2.5 text-sm text-muted-foreground"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function horaCorta(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
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

function FichajeHoyCard({
  fichaje,
  branchId,
  activeBranches,
  branchesLoading,
}: {
  fichaje: ReturnType<typeof useFichajeHoy>;
  branchId: string | null;
  activeBranches: Branch[];
  branchesLoading: boolean;
}) {
  const { setActiveBranchId } = useAuth();
  const [qrOpen, setQrOpen] = React.useState(false);
  const branchName = activeBranches.find((b) => b.id === branchId)?.name ?? "";
  // Selector propio (no <BranchSelector/>, que incluye inactivas): fichar
  // en una sucursal desactivada no tiene sentido, así que acá solo se
  // eligen entre las activas. Con 0 o 1 nunca se muestra — ver abajo.
  const needsPicker = activeBranches.length >= 2;

  // Un solo placeholder a la vez, en orden de prioridad — nunca "Elegí una
  // sucursal" mientras todavía no se sabe cuántas hay (branchesLoading) ni
  // cuando hay 0 o 1 (ahí no hay nada para elegir).
  const placeholder = branchesLoading
    ? "Cargando…"
    : activeBranches.length === 0
      ? "No hay sucursales activas. Activá una en Configuración → Sucursales para poder fichar."
      : needsPicker && !branchId
        ? "Elegí una sucursal."
        : fichaje.loading || !fichaje.summary || !branchId
          ? "Cargando…"
          : null;

  return (
    <div className="glass rounded-2xl p-4 sm:p-5 ring-1 ring-white/5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ScanLine className="h-4 w-4 text-emerald-300" />
          Fichaje de jornada
        </div>
        {needsPicker && (
          <select
            value={branchId ?? ""}
            onChange={(e) => setActiveBranchId(e.target.value)}
            className="h-8 min-w-0 appearance-none rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-xs font-semibold text-white outline-none transition hover:border-white/20 focus:border-violet-300/40 focus:ring-2 focus:ring-violet-400/15"
          >
            {activeBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {placeholder || !fichaje.summary || !branchId ? (
        <div className="mt-3 text-sm text-muted-foreground">{placeholder ?? "Cargando…"}</div>
      ) : (
        <div className="mt-3 flex flex-col gap-4 sm:flex-row">
          {/* QR visible directo, sin tocar nada — click opcional para
              ampliarlo (útil para dejarlo bien grande en una tablet/mostrador). */}
          <button
            type="button"
            onClick={() => setQrOpen(true)}
            className="group relative shrink-0 self-center sm:self-start"
            aria-label="Ampliar QR de fichaje"
          >
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(
                `${typeof window !== "undefined" ? window.location.origin : ""}/fichar/${branchId}?code=${fichaje.summary.code}`,
              )}`}
              alt="Código QR de fichaje"
              width={110}
              height={110}
              className="rounded-xl border border-white/10 bg-white p-2 transition group-hover:brightness-95"
            />
          </button>

          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
              Código
            </div>
            <div className="mt-0.5 font-mono text-xl font-bold tracking-[0.25em] text-foreground">
              {fichaje.summary.code}
            </div>
            <div className="mt-1.5 text-sm text-muted-foreground">
              {fichaje.summary.fichados} fichado{fichaje.summary.fichados === 1 ? "" : "s"} · {fichaje.summary.pendientes} pendiente{fichaje.summary.pendientes === 1 ? "" : "s"}
            </div>

            {fichaje.summary.fichadosNames.length > 0 && (
              <div className="mt-2.5">
                <div className="text-[10px] uppercase tracking-wider text-emerald-300/70">Ya ficharon</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {fichaje.summary.fichadosNames.map((name) => (
                    <span key={name} className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs text-emerald-200 ring-1 ring-emerald-400/25">
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {fichaje.summary.pendientesNames.length > 0 && (
              <div className="mt-2.5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Pendientes</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {fichaje.summary.pendientesNames.map((name) => (
                    <span key={name} className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-muted-foreground ring-1 ring-white/10">
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {qrOpen && fichaje.summary && branchId && (
        <FichajeQrModal
          branchName={branchName}
          code={fichaje.summary.code}
          branchId={branchId}
          onClose={() => setQrOpen(false)}
        />
      )}
    </div>
  );
}

function ProximosTurnosCard({ widgets }: { widgets: ReturnType<typeof useInicioWidgets> }) {
  return (
    <div className="glass rounded-2xl p-4 sm:p-5 ring-1 ring-white/5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CalendarClock className="h-4 w-4 text-violet-300" />
          Próximos turnos
        </div>
        <Link
          to="/agenda"
          className="inline-flex items-center gap-0.5 text-xs font-semibold text-primary transition hover:text-primary/80"
        >
          Ver todos <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="mt-3 space-y-2">
        {widgets.loading ? (
          <div className="text-sm text-muted-foreground">Cargando…</div>
        ) : widgets.proximosTurnos.length === 0 ? (
          <div className="text-sm text-muted-foreground">Sin turnos próximos.</div>
        ) : (
          widgets.proximosTurnos.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">
                  {t.client_name ?? "Cliente"}
                </div>
                <div className="truncate text-xs text-muted-foreground">{t.service_name ?? "—"}</div>
              </div>
              <div className="shrink-0 text-xs font-semibold text-violet-200">{diaYHoraCorta(t.starts_at)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ActividadRecienteCard({ widgets }: { widgets: ReturnType<typeof useInicioWidgets> }) {
  function describe(item: ActividadItem) {
    if (item.kind === "cobro") {
      return {
        icon: Receipt,
        text: `Cobro a ${item.client_name ?? "cliente"} · ${fmtAR(item.total)}`,
      };
    }
    return {
      icon: CalendarClock,
      text: `Turno agendado: ${item.client_name ?? "cliente"} · ${item.service_name ?? "—"}`,
    };
  }

  return (
    <div className="glass rounded-2xl p-4 sm:p-5 ring-1 ring-white/5">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Activity className="h-4 w-4 text-sky-300" />
        Actividad reciente
      </div>
      <div className="mt-3 space-y-2">
        {widgets.loading ? (
          <div className="text-sm text-muted-foreground">Cargando…</div>
        ) : widgets.actividad.length === 0 ? (
          <div className="text-sm text-muted-foreground">Sin actividad reciente.</div>
        ) : (
          widgets.actividad.map((item) => {
            const { icon: Icon, text } = describe(item);
            return (
              <div key={`${item.kind}-${item.id}`} className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5">
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1 truncate text-sm text-foreground">{text}</div>
                <div className="shrink-0 text-xs text-muted-foreground">{horaCorta(item.at)}</div>
              </div>
            );
          })
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
