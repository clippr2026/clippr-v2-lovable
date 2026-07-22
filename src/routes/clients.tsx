import { createFileRoute } from "@tanstack/react-router";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { AppShell } from "@/components/app-shell";
import { ClipprLoader } from "@/components/ui/clippr-loader";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Crown,
  MoreHorizontal,
  Megaphone,
  PauseCircle,
  Plus,
  Search,
  Sparkles,
  Star,
  Trash2,
  UserRound,
  CalendarDays,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { ACQUISITION_CHANNELS, acquisitionChannelLabel, acquisitionChannelRequiresText } from "@/lib/acquisition-channels";
import { AcquisitionChannelIcon } from "@/components/acquisition-channel-icon";
import { AcquisitionSourceField } from "@/components/acquisition-source-field";
import { DateRangePicker, getPreset, type DateRange } from "@/components/date-range-picker";
import { useClientsData } from "@/hooks/use-clients-data";
import {
  useClientsPage,
  useClientSegmentSummary,
  useClientDetail,
  fetchClientsByStatus,
  useDeleteClient,
  useSaveClient,
  useUpdateClientNotes,
  type Client,
  type ClientListRow,
  type ClientStatus,
} from "@/hooks/use-clients-data";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/clients")({ component: ClientsPage });

const avatarTints = [
  "from-sky-400/30 to-violet-600/10 text-sky-100 ring-violet-400/30",
  "from-rose-300/30 to-rose-600/10 text-rose-100 ring-rose-300/30",
  "from-violet-300/30 to-violet-600/10 text-violet-100 ring-violet-300/30",
  "from-cyan-300/30 to-cyan-600/10 text-cyan-100 ring-cyan-300/30",
  "from-emerald-300/30 to-emerald-600/10 text-emerald-100 ring-emerald-300/30",
];

function statusBadge(s: ClientStatus) {
  const map = {
    vip: {
      label: "VIP",
      cls: "bg-gradient-to-r from-amber-300/20 to-violet-400/15 text-amber-100 ring-amber-300/40",
    },
    nuevo: { label: "NUEVO", cls: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30" },
    activo: { label: "ACTIVO", cls: "bg-cyan-400/10 text-cyan-300 ring-cyan-400/30" },
    inactivo: { label: "INACTIVO", cls: "bg-white/5 text-muted-foreground ring-white/10" },
    perdido: { label: "PERDIDO", cls: "bg-rose-400/10 text-rose-300 ring-rose-400/30" },
  } as const;
  const c = map[s];
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[9px] font-bold tracking-[0.18em] ring-1",
        c.cls,
      )}
    >
      {c.label}
    </span>
  );
}

function vipTagBadge(tag: Client["vipTag"]) {
  if (tag === "vip") {
    return (
      <span className="rounded-full bg-gradient-to-r from-amber-300/20 to-violet-400/15 px-2 py-0.5 text-[9px] font-bold tracking-[0.18em] text-amber-100 ring-1 ring-amber-300/40">
        👑 VIP
      </span>
    );
  }
  if (tag === "ex_vip") {
    return (
      <span className="rounded-full bg-white/5 px-2 py-0.5 text-[9px] font-bold tracking-[0.18em] text-amber-200 ring-1 ring-amber-300/25">
        👑 EX VIP
      </span>
    );
  }
  return null;
}

type ClientMetricInfo = {
  title: string;
  description: string;
  bullets: string[];
};

const CLIENT_METRIC_INFO = {
  vip: {
    title: "Clientes VIP",
    description:
      "Clientes que mantienen 4 visitas seguidas con una diferencia de 15 días o menos entre visitas.",
    bullets: [
      "Si sus últimas 4 visitas cumplen la frecuencia, aparece como VIP.",
      "Si alguna vez fue VIP pero ya no cumple la frecuencia, queda marcado como EX VIP en su ficha.",
      "Si vuelve a cumplir 4 visitas seguidas cada 15 días o menos, recupera el sello VIP automáticamente.",
    ],
  },
  nuevos: {
    title: "Clientes nuevos",
    description:
      "Clientes cuya primera visita ocurrió durante el mes vigente. Siguen contando como nuevos todo ese mes, aunque vuelvan 2 o 3 veces.",
    bullets: [
      "El contador se reinicia cada mes: si es otro mes, arranca de 0.",
      "Cuando cambia el mes, dejan de ser nuevos y pasan a activo, inactivo, perdido o VIP según su comportamiento.",
      "Sirve para medir cuántos clientes nuevos captó el negocio este mes.",
    ],
  },
  activos: {
    title: "Clientes activos",
    description: "Clientes que ya no son nuevos y cuya última visita fue hace 45 días o menos.",
    bullets: [
      "Representan la base vigente del negocio.",
      "Incluye clientes que siguen viniendo con una frecuencia saludable.",
      "Si un EX VIP está activo, se muestra como activo con el sello EX VIP en su ficha.",
    ],
  },
  inactivos: {
    title: "Clientes inactivos",
    description: "Clientes cuya última visita fue entre 46 y 75 días atrás.",
    bullets: [
      "Todavía son recuperables con una acción simple.",
      "Conviene contactarlos antes de que pasen a perdidos.",
      "Un WhatsApp o beneficio puntual suele ser suficiente para probar recuperación.",
    ],
  },
  perdidos: {
    title: "Clientes perdidos",
    description: "Clientes que no visitan el negocio hace 76 días o más.",
    bullets: [
      "Necesitan una campaña de reconquista más fuerte.",
      "Sirven para medir clientes que el negocio dejó de retener.",
      "Si fueron VIP alguna vez, mantienen el sello EX VIP en su ficha para no perder ese dato de valor.",
    ],
  },
} satisfies Record<string, ClientMetricInfo>;

function Rating({ value }: { value: number }) {
  return (
    <div className="flex gap-[3px]">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={cn(
            "h-3 w-3",
            i < value
              ? "fill-violet-300 text-violet-300 drop-shadow-[0_0_4px_rgba(139,92,246,0.6)]"
              : "text-white/15",
          )}
        />
      ))}
    </div>
  );
}

function StatCard({
  label,
  value,
  caption,
  link,
  onLinkClick,
  icon,
  glow,
  featured,
  info,
  onInfoClick,
  className,
}: {
  label: string;
  value: string;
  caption: React.ReactNode;
  link?: string;
  onLinkClick?: () => void;
  icon: React.ReactNode;
  glow: string;
  featured?: boolean;
  info?: string;
  onInfoClick?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "glass relative overflow-hidden rounded-2xl p-3 sm:p-3.5 group transition-all hover:-translate-y-0.5 hover:ring-white/20",
        featured && "ring-1 ring-violet-400/30 shadow-[0_0_60px_-20px_rgba(139,92,246,0.45)]",
        className,
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute -top-20 -right-16 h-40 w-40 rounded-full blur-3xl opacity-70",
          glow,
        )}
      />
      <div className="relative flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.18em] text-muted-foreground/90 truncate">
            {label}
          </div>
          {info && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onInfoClick?.();
              }}
              className="shrink-0 text-[10px] font-semibold text-muted-foreground/40 opacity-0 transition hover:text-violet-200 group-hover:opacity-100 focus-visible:opacity-100"
              aria-label={`Información sobre ${label}`}
            >
              i
            </button>
          )}
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="text-3xl sm:text-[2rem] font-display font-medium leading-none tracking-tight">
            {value}
          </div>
          <div className="text-lg sm:text-xl opacity-80 shrink-0">{icon}</div>
        </div>
        {caption && <div className="text-[11px] text-muted-foreground leading-snug">{caption}</div>}
        {link && (
          <button
            onClick={onLinkClick}
            className="mt-0.5 inline-flex items-center gap-1 self-start text-[9px] sm:text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300/90 hover:text-violet-200 transition-colors"
          >
            {link} <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

function formatClientSince(date?: string | null) {
  if (!date) return "Sin fecha";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "Sin fecha";
  return parsed.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
}

function getClientProfileText(c: Client | null) {
  if (!c) return "Seleccioná un cliente para ver el perfil.";
  if (c.visits === 0)
    return "Cliente nuevo. Todavía no hay historial suficiente para perfilar su comportamiento.";
  if (c.vipTag === "vip")
    return "Es uno de los clientes más valiosos del negocio. Mantiene 4 visitas seguidas cada 15 días o menos.";
  if (c.vipTag === "ex_vip")
    return "Fue VIP, pero ya no mantiene la frecuencia de 4 visitas seguidas cada 15 días o menos. Conviene recuperarlo con prioridad.";
  if (c.status === "perdido")
    return "Hace demasiado tiempo que no vuelve. Conviene usar una acción puntual de reconquista, no un mensaje genérico.";
  if (c.status === "inactivo")
    return "Está perdiendo frecuencia. Es buen momento para contactarlo con una propuesta concreta.";
  return "Cliente activo. Seguí acumulando historial para mejorar las recomendaciones.";
}

type ClientDetailPanelProps = {
  client: Client;
  onDelete: (client: Client) => void;
  onSaveNotes: (clientId: string, notes: string) => Promise<void>;
  savingNotes: boolean;
};

// Memoizado: el padre re-renderiza en cada tecla de búsqueda, cambio de orden,
// etc. Sin este límite, toda la ficha del cliente (header, métricas, historial)
// se recalculaba y re-renderizaba en cada una de esas teclas aunque nada acá
// hubiera cambiado. Ahora solo re-renderiza cuando cambia el cliente
// seleccionado o el estado de guardado de notas.
const ClientDetailPanel = memo(function ClientDetailPanel({
  client,
  onDelete,
  onSaveNotes,
  savingNotes,
}: ClientDetailPanelProps) {
  const [tab, setTab] = useState<"resumen" | "historial">("resumen");
  const [menuOpen, setMenuOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState(client.notes ?? "");

  useEffect(() => {
    setNoteDraft(client.notes ?? "");
    setMenuOpen(false);
  }, [client.id, client.notes]);

  const ticket = client.visits ? Math.round(client.spent / client.visits) : 0;
  const since = formatClientSince(client.created_at);
  const profileText = getClientProfileText(client);
  const favoriteServices = client.favoriteServices;
  const hasNote = Boolean((client.notes ?? "").trim());

  return (
    <div className="flex flex-col lg:h-full">
      <div
        className={cn(
          "relative px-6 py-5 border-b border-white/5",
          client.status === "perdido" && "bg-rose-500/5",
          client.status === "vip" && "bg-amber-400/5",
        )}
      >
        <div className="relative flex items-center gap-5">
          <div className="h-20 w-20 rounded-2xl grid place-items-center text-2xl font-display font-semibold bg-gradient-to-br from-sky-400/30 to-violet-600/10 ring-1 ring-violet-400/40 text-sky-100 shrink-0">
            {client.name[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-2xl font-display font-semibold leading-tight">
                  {client.status === "perdido" && <AlertTriangle className="h-5 w-5 text-rose-300" />}
                  {client.status === "vip" && <Crown className="h-5 w-5 text-amber-200" />}
                  {client.name}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  {client.vipTag ? vipTagBadge(client.vipTag) : statusBadge(client.status)}
                  <Rating value={client.rating} />
                </div>
                {profileText && (
                  <div className="mt-1.5 max-w-md text-xs text-white/55">{profileText}</div>
                )}
                <div className="mt-2.5 inline-flex items-center gap-2 text-sm text-white/70">
                  <CalendarDays className="h-4 w-4 text-white/45" />
                  <span>
                    Cliente desde <span className="font-semibold text-white capitalize">{since}</span>
                  </span>
                </div>
                {client.acquisitionSource && (
                  <div className="mt-1.5 inline-flex items-center gap-2 text-sm text-white/70">
                    {(() => {
                      const channel = ACQUISITION_CHANNELS.find((c) => c.id === client.acquisitionSource);
                      return channel ? (
                        <AcquisitionChannelIcon channel={channel} className="h-4 w-4 shrink-0" />
                      ) : (
                        <Megaphone className="h-4 w-4 text-white/45" />
                      );
                    })()}
                    <span>
                      Nos conoció por{" "}
                      <span className="font-semibold text-white">
                        {acquisitionChannelLabel(client.acquisitionSource, client.acquisitionSourceCustom)}
                      </span>
                      {client.acquisitionCapturedAt && (
                        <span className="text-white/50">
                          {" "}· {formatClientSince(client.acquisitionCapturedAt)}
                        </span>
                      )}
                    </span>
                  </div>
                )}
              </div>
              <div className="relative">
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="rounded-full p-2 hover:bg-white/5 transition"
                >
                  <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-9 z-20 w-44 rounded-xl bg-background/95 ring-1 ring-white/10 shadow-2xl p-1.5 backdrop-blur">
                    <button
                      onClick={() => onDelete(client)}
                      className="w-full inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-rose-300 hover:bg-rose-500/10"
                    >
                      <Trash2 className="h-4 w-4" />
                      Eliminar
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="px-6 pt-3 shrink-0">
        <div className="inline-flex rounded-full bg-white/5 ring-1 ring-white/10 p-1">
          {(["resumen", "historial"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-full px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] transition",
                tab === t
                  ? "bg-gradient-to-r from-sky-400 to-violet-500 text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 sm:p-5 lg:flex-1 min-h-0 lg:overflow-y-auto">
        {tab === "resumen" && (
          <div className="space-y-5">
            {/* Métricas: una sola banda integrada en vez de 4 cajas sueltas */}
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-white/[0.06] rounded-2xl bg-white/[0.025] ring-1 ring-white/[0.06] overflow-hidden">
              <div className="px-3 py-3 sm:px-4">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Lifetime value
                </div>
                <div className="mt-1 text-xl font-display tabular-nums">
                  ${client.spent.toLocaleString("es-AR")}
                </div>
              </div>
              <div className="px-3 py-3 sm:px-4">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Visitas</div>
                <div className="mt-1 text-xl font-display tabular-nums">{client.visits}</div>
              </div>
              <div className="px-3 py-3 sm:px-4">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Ticket prom.
                </div>
                <div className="mt-1 text-xl font-display tabular-nums">
                  ${ticket.toLocaleString("es-AR")}
                </div>
              </div>
              <div className="px-3 py-3 sm:px-4">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Última visita
                </div>
                <div className="mt-1 text-sm font-semibold">{client.lastVisit ?? "—"}</div>
              </div>
            </div>

            {/* Servicios favoritos: lista con separadores, sin una caja por ítem */}
            <div>
              <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Servicios favoritos
              </div>
              {favoriteServices.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  Todavía no hay servicios suficientes para detectar favoritos.
                </div>
              ) : (
                <div className="divide-y divide-white/[0.06]">
                  {favoriteServices.map((item) => (
                    <div key={item.service} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="truncate text-sm font-medium text-white/85">{item.service}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {item.count} veces · ${item.amount.toLocaleString("es-AR")}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Notas: integradas a la ficha, sin módulo contenedor propio */}
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Notas</span>
                {hasNote && (
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-200/70">
                    Última nota
                  </span>
                )}
              </div>
              {hasNote && (
                <p className="mb-2.5 text-sm italic leading-relaxed text-white/65">“{client.notes}”</p>
              )}
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="Agregá notas internas del cliente..."
                className="w-full min-h-[68px] rounded-xl bg-white/[0.03] ring-1 ring-white/10 p-3 text-sm focus:outline-none focus:ring-violet-400/40 focus:bg-white/[0.045] transition"
              />
              <div className="flex justify-end mt-2">
                <button
                  onClick={() => onSaveNotes(client.id, noteDraft)}
                  disabled={savingNotes}
                  className="rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 text-background px-4 py-2 text-sm font-semibold disabled:opacity-50"
                >
                  {savingNotes ? "Guardando…" : "Guardar nota"}
                </button>
              </div>
            </div>
          </div>
        )}
        {tab === "historial" && (
          <div className="space-y-2">
            {client.history.length === 0 ? (
              <div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-4 text-sm text-muted-foreground">
                Sin historial de cobros todavía.
              </div>
            ) : (
              client.history.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center justify-between rounded-xl bg-white/5 ring-1 ring-white/10 p-3"
                >
                  <div>
                    <div className="text-sm font-medium">{h.service}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {new Date(h.date).toLocaleString("es-AR")}
                    </div>
                  </div>
                  <div className="text-sm font-semibold tabular-nums">
                    ${h.amount.toLocaleString("es-AR")}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
});

type ClientDetailModalProps = {
  open: boolean;
  loading: boolean;
  client: Client | null;
  onClose: () => void;
  onDelete: (client: Client) => void;
  onSaveNotes: (clientId: string, notes: string) => Promise<void>;
  savingNotes: boolean;
};

function ClientDetailModal({
  open,
  loading,
  client,
  onClose,
  onDelete,
  onSaveNotes,
  savingNotes,
}: ClientDetailModalProps) {
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className={cn(
          "glass relative flex w-full sm:max-w-2xl max-h-[92dvh] flex-col overflow-hidden rounded-t-3xl sm:rounded-3xl",
          client?.status === "perdido" && "ring-1 ring-rose-400/30",
          client?.status === "vip" && "ring-1 ring-amber-300/30",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Cerrar"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white/80 backdrop-blur transition hover:bg-black/60 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {client ? (
            <ClientDetailPanel
              client={client}
              onDelete={onDelete}
              onSaveNotes={onSaveNotes}
              savingNotes={savingNotes}
            />
          ) : (
            <div className="grid min-h-[280px] place-items-center p-6">
              <div className="text-center space-y-3">
                {loading ? (
                  <>
                    <UserRound className="mx-auto h-8 w-8 text-muted-foreground animate-pulse" />
                    <div className="text-lg font-display text-muted-foreground">Cargando cliente…</div>
                  </>
                ) : (
                  <>
                    <UserRound className="mx-auto h-8 w-8 text-muted-foreground" />
                    <div className="text-lg font-display">No se encontró el cliente</div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ClientsPage() {
  const { businessId } = useAuth();
  const saveClient = useSaveClient(businessId);
  const deleteClient = useDeleteClient(businessId);
  const updateNotes = useUpdateClientNotes(businessId);

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"gasto" | "recientes" | "nombre">("gasto");
  const [selected, setSelected] = useState<string | null>(null);
  const [newClientOpen, setNewClientOpen] = useState(false);
  const [segmentModal, setSegmentModal] = useState<{ title: string; clients: ClientListRow[]; loading?: boolean } | null>(
    null,
  );
  const [metricInfo, setMetricInfo] = useState<ClientMetricInfo | null>(null);
  const [newClient, setNewClient] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
  });
  const [newClientAcquisitionSource, setNewClientAcquisitionSource] = useState("");
  const [newClientAcquisitionCustom, setNewClientAcquisitionCustom] = useState("");
  // Si el email ya tiene un origen guardado, no se vuelve a preguntar —
  // mismo criterio que ya usa la Página Pública para no re-pedir el dato.
  const [newClientSourceAlreadyKnown, setNewClientSourceAlreadyKnown] = useState(false);
  const [acquisitionModalOpen, setAcquisitionModalOpen] = useState(false);
  const [acquisitionRange, setAcquisitionRange] = useState<DateRange>(() => {
    const to = new Date();
    const from = new Date();
    from.setMonth(from.getMonth() - 6);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  });
  // Lista completa (no paginada) solo para el panel de estadísticas por canal —
  // el grid principal sigue usando useClientsPage (RPC paginada), sin tocarlo.
  const { data: allClients } = useClientsData(acquisitionModalOpen ? businessId : null);

  // Debounce the search so we don't hit the server on every keystroke.
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 280);
    return () => clearTimeout(t);
  }, [query]);

  // Server-side: sort by name/recientes (gasto is sorted client-side over the
  // already-loaded pages, since spend is an aggregate).
  // All three sorts (incl. "gasto") are now resolved server-side by the RPC.
  const {
    data: pageData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useClientsPage(businessId, debouncedQuery, sort);

  const { data: summary } = useClientSegmentSummary(businessId);
  const { data: currentDetail, isLoading: detailLoading } = useClientDetail(businessId, selected);

  const clients = useMemo<ClientListRow[]>(
    () => (pageData?.pages ?? []).flatMap((p) => p.rows),
    [pageData],
  );
  const total = pageData?.pages?.[0]?.total ?? 0;

  // Ya no se auto-selecciona el primer cliente de la lista al cargar: el
  // detalle ahora es un modal (ver ClientDetailModal más abajo), y un modal
  // solo debe abrirse por una acción explícita del usuario (tocar una
  // tarjeta), nunca solo. Antes tenía sentido porque el panel de detalle
  // era un panel siempre visible al lado de la lista en desktop.

  // Search + sorting (nombre/recientes/gasto) all happen server-side now.
  const filtered = clients;

  const counts = useMemo(
    () => ({
      vip: summary?.counts.vip ?? 0,
      nuevos: summary?.counts.nuevo ?? 0,
      activos: summary?.counts.activo ?? 0,
      inactivos: summary?.counts.inactivo ?? 0,
      perdidos: summary?.counts.perdido ?? 0,
    }),
    [summary],
  );

  const current = currentDetail ?? null;

  const acquisitionStats = useMemo(() => {
    if (!allClients) return [];
    const rangeStart = new Date(`${acquisitionRange.from}T00:00:00`).getTime();
    const rangeEnd = new Date(`${acquisitionRange.to}T23:59:59`).getTime();
    const byChannel = new Map<string, { count: number; revenue: number }>();
    for (const c of allClients) {
      const capturedAt = c.acquisitionCapturedAt ?? c.created_at;
      const capturedTime = new Date(capturedAt).getTime();
      if (Number.isNaN(capturedTime) || capturedTime < rangeStart || capturedTime > rangeEnd) continue;
      const key = c.acquisitionSource ?? "sin_dato";
      const entry = byChannel.get(key) ?? { count: 0, revenue: 0 };
      entry.count += 1;
      entry.revenue += c.spent;
      byChannel.set(key, entry);
    }
    return Array.from(byChannel.entries())
      .map(([value, stats]) => ({
        value,
        label: value === "sin_dato" ? "Sin dato" : acquisitionChannelLabel(value),
        ...stats,
      }))
      .sort((a, b) => b.count - a.count);
  }, [allClients, acquisitionRange]);

  const showGroup = useCallback(
    async (title: string, status: ClientStatus) => {
      setSegmentModal({ title, clients: [], loading: true });
      const rows = businessId ? await fetchClientsByStatus(businessId, status) : [];
      setSegmentModal({ title, clients: rows, loading: false });
    },
    [businessId],
  );

  // Mismo chequeo que ya usa la Página Pública: si el email ingresado ya
  // tiene un origen guardado, se oculta la pregunta en vez de repetirla.
  useEffect(() => {
    const email = newClient.email.trim();
    if (!businessId || !email || !email.includes("@")) {
      setNewClientSourceAlreadyKnown(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const { data, error } = await supabase.rpc("clippr_client_has_acquisition_source", {
        p_business_id: businessId,
        p_email: email,
      });
      if (!cancelled && !error) setNewClientSourceAlreadyKnown(Boolean(data));
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [businessId, newClient.email]);

  async function handleCreateClient() {
    if (!newClient.firstName.trim()) {
      return toast.error("Ingresá el nombre");
    }
    if (!newClient.lastName.trim()) {
      return toast.error("Ingresá el apellido");
    }
    if (!newClient.phone.trim()) {
      return toast.error("Ingresá teléfono");
    }
    if (!newClient.email.trim()) {
      return toast.error("Ingresá email");
    }
    if (!newClientSourceAlreadyKnown && !newClientAcquisitionSource) {
      return toast.error("Indicá cómo nos conoció el cliente");
    }
    if (
      !newClientSourceAlreadyKnown &&
      acquisitionChannelRequiresText(newClientAcquisitionSource) &&
      !newClientAcquisitionCustom.trim()
    ) {
      return toast.error("Indicá dónde nos conoció el cliente");
    }

    await saveClient.mutateAsync({
      ...newClient,
      acquisitionSource: newClientSourceAlreadyKnown ? null : newClientAcquisitionSource,
      acquisitionCustom: newClientSourceAlreadyKnown ? null : newClientAcquisitionCustom,
    });
    toast.success("Cliente guardado");
    setNewClient({ firstName: "", lastName: "", phone: "", email: "" });
    setNewClientAcquisitionSource("");
    setNewClientAcquisitionCustom("");
    setNewClientSourceAlreadyKnown(false);
    setNewClientOpen(false);
  }

  const handleDeleteClient = useCallback(
    async (client: Client) => {
      if (!window.confirm(`¿Eliminar cliente ${client.name}?`)) return;
      await deleteClient.mutateAsync(client.id);
      toast.success("Cliente eliminado");
      setSelected((cur) => (cur === client.id ? null : cur));
    },
    [deleteClient],
  );

  const saveNotes = useCallback(
    async (clientId: string, notes: string) => {
      await updateNotes.mutateAsync({ clientId, notes });
      toast.success("Nota guardada");
    },
    [updateNotes],
  );

  if (isLoading && clients.length === 0) {
    return (
      <AppShell>
        <div className="grid place-items-center py-32">
          <ClipprLoader size="screen" delayMs={130} />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="app-premium-shell">
        <div className="pointer-events-none absolute left-1/2 top-[-120px] z-[-1] h-[620px] w-screen -translate-x-1/2 bg-[radial-gradient(circle_at_17%_4%,rgb(139_92_246_/_0.34),transparent_38%),radial-gradient(circle_at_76%_0%,rgb(79_125_255_/_0.30),transparent_36%),radial-gradient(circle_at_46%_96%,rgb(255_123_229_/_0.14),transparent_50%)] blur-[16px]" />
        {/* Mobile: sin altura fija ni overflow-hidden — la página scrollea
            de forma natural (AppShell ya deja lugar para el nav inferior con
            pb-[4rem+safe-area] en <main>). Sumamos 40px más acá para que la
            última tarjeta quede claramente despegada del nav, sin duplicar
            el safe-area-inset-bottom que ya aplica AppShell. Total ~104–138px
            según el dispositivo. Desktop (lg+): layout de panes fijo, sin
            cambios. */}
        <div className="lg:h-[calc(100dvh-92px)] lg:overflow-hidden animate-fade-up flex flex-col gap-3 pb-10 lg:pb-0">
          {/* KPI cards — siempre arriba, fuera de cualquier scroll.
              Mobile: VIP+Activos / Nuevos+Inactivos / Perdidos a pantalla
              completa (destacado, misma altura que el resto — ver StatCard
              featured). Desktop (sm+): sin cambios, grilla pareja de 5. */}
          <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard
              label="VIP"
              value={String(summary?.counts.vip ?? 0)}
              caption={null}
              icon={<Crown className="h-5 w-5 text-amber-200" />}
              glow="bg-amber-500/25"
              featured
              info={CLIENT_METRIC_INFO.vip.title}
              onInfoClick={() => setMetricInfo(CLIENT_METRIC_INFO.vip)}
              link="Ver todos"
              onLinkClick={() => showGroup("Clientes VIP", "vip")}
            />
            <StatCard
              label="Activos"
              value={String(summary?.counts.activo ?? 0)}
              caption={null}
              icon={<CheckCircle2 className="h-5 w-5 text-emerald-300" />}
              glow="bg-emerald-500/20"
              info={CLIENT_METRIC_INFO.activos.title}
              onInfoClick={() => setMetricInfo(CLIENT_METRIC_INFO.activos)}
              link="Ver todos"
              onLinkClick={() => showGroup("Clientes activos", "activo")}
            />
            <StatCard
              label="Nuevos"
              value={String(summary?.counts.nuevo ?? 0)}
              caption={null}
              icon={<Sparkles className="h-5 w-5 text-violet-300" />}
              glow="bg-violet-500/25"
              info={CLIENT_METRIC_INFO.nuevos.title}
              onInfoClick={() => setMetricInfo(CLIENT_METRIC_INFO.nuevos)}
              link="Ver todos"
              onLinkClick={() => showGroup("Clientes nuevos", "nuevo")}
            />
            <StatCard
              label="Inactivos"
              value={String(summary?.counts.inactivo ?? 0)}
              caption={null}
              icon={<PauseCircle className="h-5 w-5 text-amber-300" />}
              glow="bg-amber-500/15"
              info={CLIENT_METRIC_INFO.inactivos.title}
              onInfoClick={() => setMetricInfo(CLIENT_METRIC_INFO.inactivos)}
              link="Ver todos"
              onLinkClick={() => showGroup("Clientes inactivos", "inactivo")}
            />
            <StatCard
              label="Perdidos"
              value={String(summary?.counts.perdido ?? 0)}
              caption={null}
              icon={<AlertTriangle className="h-5 w-5 text-rose-300" />}
              glow="bg-rose-500/20"
              featured
              info={CLIENT_METRIC_INFO.perdidos.title}
              onInfoClick={() => setMetricInfo(CLIENT_METRIC_INFO.perdidos)}
              link="Reconquistar"
              onLinkClick={() => showGroup("Clientes perdidos", "perdido")}
              className="col-span-2 sm:col-span-1"
            />
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <button
              onClick={() => setAcquisitionModalOpen(true)}
              className="h-10 flex-1 sm:flex-none px-4 rounded-xl text-sm font-medium flex items-center justify-center gap-2 bg-white/5 ring-1 ring-white/10 hover:bg-white/10 transition"
            >
              <Megaphone className="h-4 w-4 text-violet-300" />
              Cómo nos conocieron
            </button>
            <button
              onClick={() => setNewClientOpen(true)}
              className="h-10 flex-1 sm:flex-none px-4 rounded-xl text-white font-medium text-sm flex items-center justify-center gap-2 hover:brightness-110 transition"
              style={{
                background: "linear-gradient(135deg, oklch(0.65 0.24 255), oklch(0.65 0.28 305))",
              }}
            >
              <Plus className="h-4 w-4" />
              Nuevo cliente
            </button>
          </div>
        <div className="min-h-0 flex-1">
          <div className="glass rounded-2xl p-3 sm:p-4 flex min-h-0 lg:h-full flex-col gap-3 sm:gap-4 lg:overflow-hidden">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por nombre, teléfono, servicio…"
                className="w-full rounded-xl bg-white/5 ring-1 ring-white/10 pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-violet-400/40"
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{total} cliente{total === 1 ? "" : "s"}</span>
              <div className="flex items-center gap-2">
                <span>Ordenar:</span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as typeof sort)}
                  className="rounded-md bg-white/5 ring-1 ring-white/10 px-2 py-1 text-foreground"
                >
                  <option value="gasto">Mayor gasto</option>
                  <option value="recientes">Recientes</option>
                  <option value="nombre">Nombre</option>
                </select>
              </div>
            </div>
            <div className="lg:flex-1 lg:overflow-y-auto pr-1 -mr-1 space-y-2">
              {filtered.map((c, i) => {
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelected(c.id)}
                    className={cn(
                      "w-full flex items-center gap-3 rounded-xl p-3 ring-1 transition text-left relative overflow-hidden",
                      selected === c.id
                        ? "bg-gradient-to-r from-sky-500/15 via-violet-500/8 to-transparent ring-violet-400/40"
                        : "bg-white/[0.02] ring-white/5 hover:bg-white/5",
                    )}
                  >
                    <div
                      className={cn(
                        "h-11 w-11 rounded-full grid place-items-center text-sm font-semibold bg-gradient-to-br ring-1",
                        avatarTints[i % avatarTints.length],
                      )}
                    >
                      {c.name[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium truncate">{c.name}</div>
                        <div className="text-sm font-semibold tabular-nums">
                          ${c.spent.toLocaleString("es-AR")}
                        </div>
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {c.visits} visitas · {c.lastVisit ?? "sin visitas"}
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        {c.vipTag ? vipTagBadge(c.vipTag) : statusBadge(c.status)}
                      </div>
                    </div>
                  </button>
                );
              })}
              {isLoading && (
                <div className="grid place-items-center py-10">
                  <ClipprLoader size="screen" delayMs={130} />
                </div>
              )}
              {!isLoading && filtered.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-14 text-center">
                  {debouncedQuery ? (
                    <>
                      <Search className="h-6 w-6 text-muted-foreground/50" />
                      <div className="text-sm text-muted-foreground">
                        Sin resultados para “{debouncedQuery}”.
                      </div>
                    </>
                  ) : (
                    <>
                      <UserRound className="h-7 w-7 text-muted-foreground/50" />
                      <div className="text-sm font-medium text-white/80">Todavía no tenés clientes</div>
                      <div className="max-w-[220px] text-xs text-muted-foreground">
                        Se van a ir sumando solos con las ventas, o agregá el primero a mano.
                      </div>
                      <button
                        onClick={() => setNewClientOpen(true)}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-white/5 px-3 py-1.5 text-xs font-medium ring-1 ring-white/10 transition hover:bg-white/10"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Agregar cliente
                      </button>
                    </>
                  )}
                </div>
              )}
              {!isLoading && hasNextPage && (
                <button
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="w-full mt-2 rounded-xl bg-white/5 ring-1 ring-white/10 py-2.5 text-sm hover:bg-white/[0.08] transition disabled:opacity-50"
                >
                  {isFetchingNextPage ? "Cargando…" : `Cargar más (${clients.length} de ${total})`}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Detalle del cliente: modal superpuesto, no contenido normal de la
          página. Portal a document.body + useBodyScrollLock — mismo motivo
          que AgendaCenteredModal (src/components/agenda/agenda-drawer.tsx):
          sin portal, un modal fixed adentro de un contenedor con su propio
          stacking context puede terminar tapado por hermanos fixed del
          árbol raíz (barra inferior, etc.) aunque su z-index sea mayor en
          el papel. No se reusa AgendaCenteredModal tal cual porque
          ClientDetailPanel ya trae su propio header (avatar, nombre,
          estado) — un segundo título arriba sería un header duplicado; acá
          solo se agrega la X de cierre flotante sobre ese header propio.
          useBodyScrollLock además deja al usuario en el mismo scroll del
          listado al cerrar (no hace falta recordar la posición a mano). */}
      {selected &&
        createPortal(
          <ClientDetailModal
            open
            loading={detailLoading}
            client={current}
            onClose={() => setSelected(null)}
            onDelete={handleDeleteClient}
            onSaveNotes={saveNotes}
            savingNotes={updateNotes.isPending}
          />,
          document.body,
        )}

      {newClientOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl bg-background ring-1 ring-white/10 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-white/5">
              <div className="text-lg font-display font-semibold uppercase tracking-wide">Cliente</div>
              <button
                onClick={() => setNewClientOpen(false)}
                className="rounded-full bg-white/5 px-3 py-1.5 text-sm"
              >
                Cancelar
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs text-muted-foreground">
                  Nombre *
                  <input
                    value={newClient.firstName}
                    onChange={(e) => setNewClient((s) => ({ ...s, firstName: e.target.value }))}
                    className="mt-1 w-full rounded-xl bg-white/5 ring-1 ring-white/10 px-3 py-2.5 text-sm text-foreground"
                  />
                </label>
                <label className="block text-xs text-muted-foreground">
                  Apellido *
                  <input
                    value={newClient.lastName}
                    onChange={(e) => setNewClient((s) => ({ ...s, lastName: e.target.value }))}
                    className="mt-1 w-full rounded-xl bg-white/5 ring-1 ring-white/10 px-3 py-2.5 text-sm text-foreground"
                  />
                </label>
              </div>
              <label className="block text-xs text-muted-foreground">
                Teléfono *
                <input
                  value={newClient.phone}
                  onChange={(e) => setNewClient((s) => ({ ...s, phone: e.target.value }))}
                  className="mt-1 w-full rounded-xl bg-white/5 ring-1 ring-white/10 px-3 py-2.5 text-sm text-foreground"
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                Email *
                <input
                  value={newClient.email}
                  onChange={(e) => setNewClient((s) => ({ ...s, email: e.target.value }))}
                  className="mt-1 w-full rounded-xl bg-white/5 ring-1 ring-white/10 px-3 py-2.5 text-sm text-foreground"
                />
              </label>
              {newClientSourceAlreadyKnown ? (
                <div className="rounded-xl bg-white/[0.03] px-3 py-2.5 text-xs text-muted-foreground ring-1 ring-white/10">
                  Este cliente ya tiene un origen guardado — no hace falta volver a pedirlo.
                </div>
              ) : (
                <AcquisitionSourceField
                  value={newClientAcquisitionSource}
                  onChange={setNewClientAcquisitionSource}
                  customValue={newClientAcquisitionCustom}
                  onCustomChange={setNewClientAcquisitionCustom}
                  showLabel
                  otroBelow
                  questionLabel="¿Cómo nos conoció?"
                  labelClassName="text-xs text-muted-foreground"
                  triggerClassName="mt-1 h-auto w-full rounded-xl border-0 bg-white/5 px-3 py-2.5 text-sm text-foreground ring-1 ring-white/10"
                  inputClassName="mt-1 w-full rounded-xl border-0 bg-white/5 px-3 py-2.5 text-sm text-foreground ring-1 ring-white/10"
                />
              )}
            </div>
            <div className="flex justify-end gap-2 p-5 border-t border-white/5">
              <button
                onClick={handleCreateClient}
                disabled={saveClient.isPending}
                className="rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 text-background px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                Guardar cliente
              </button>
            </div>
          </div>
        </div>
      )}

      {acquisitionModalOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl bg-background ring-1 ring-white/10 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-white/5">
              <div>
                <div className="text-lg font-display font-semibold">Cómo nos conocieron</div>
                <div className="text-xs text-muted-foreground">
                  Origen de los clientes registrados en el rango elegido.
                </div>
              </div>
              <button
                onClick={() => setAcquisitionModalOpen(false)}
                className="rounded-full bg-white/5 px-3 py-1.5 text-sm"
              >
                Cerrar
              </button>
            </div>
            <div className="p-5 space-y-4">
              <DateRangePicker
                from={acquisitionRange.from}
                to={acquisitionRange.to}
                onChange={setAcquisitionRange}
              />
              <div className="space-y-1.5">
                {acquisitionStats.length === 0 ? (
                  <div className="rounded-xl bg-white/[0.04] ring-1 ring-white/10 px-3 py-4 text-sm text-muted-foreground text-center">
                    No hay clientes registrados en ese rango de fechas.
                  </div>
                ) : (
                  acquisitionStats.map((stat) => {
                    const channel = ACQUISITION_CHANNELS.find((c) => c.id === stat.value);
                    return (
                    <div
                      key={stat.value}
                      className="flex items-center justify-between rounded-xl bg-white/[0.03] ring-1 ring-white/10 px-3 py-2.5"
                    >
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {channel ? <AcquisitionChannelIcon channel={channel} className="h-4 w-4 shrink-0" /> : null}
                        {stat.label}
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="text-muted-foreground">
                          {stat.count} cliente{stat.count === 1 ? "" : "s"}
                        </span>
                        <span className="font-semibold tabular-nums">
                          ${stat.revenue.toLocaleString("es-AR")}
                        </span>
                      </div>
                    </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {metricInfo && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-background ring-1 ring-white/10 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-white/5">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300">
                  Información
                </div>
                <div className="text-lg font-display font-semibold">{metricInfo.title}</div>
              </div>
              <button
                onClick={() => setMetricInfo(null)}
                className="rounded-full bg-white/5 px-3 py-1.5 text-sm"
              >
                Cerrar
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm leading-relaxed text-muted-foreground">
                {metricInfo.description}
              </p>
              <div className="space-y-2">
                {metricInfo.bullets.map((point) => (
                  <div
                    key={point}
                    className="rounded-xl bg-white/[0.04] ring-1 ring-white/10 px-3 py-2 text-sm text-white/78"
                  >
                    {point}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {segmentModal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl rounded-2xl bg-background ring-1 ring-white/10 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-white/5">
              <div className="text-lg font-display font-semibold">{segmentModal.title}</div>
              <button
                onClick={() => setSegmentModal(null)}
                className="rounded-full bg-white/5 px-3 py-1.5 text-sm"
              >
                Cerrar
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-3 space-y-2">
              {segmentModal.loading ? (
                <div className="p-8 text-center text-sm text-muted-foreground animate-pulse">
                  Cargando clientes…
                </div>
              ) : segmentModal.clients.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No hay clientes en este grupo.
                </div>
              ) : (
                segmentModal.clients.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setSelected(c.id);
                      setSegmentModal(null);
                    }}
                    className="w-full flex items-center justify-between rounded-xl bg-white/5 ring-1 ring-white/10 p-3 text-left hover:bg-white/10"
                  >
                    <div>
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.phone || "sin teléfono"} · {c.lastVisit || "sin visitas"}
                      </div>
                    </div>
                    <div className="text-sm font-semibold">${c.spent.toLocaleString("es-AR")}</div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </AppShell>
  );
}
