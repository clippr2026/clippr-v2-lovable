import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Topbar } from "@/components/topbar";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Crown,
  Mail,
  MoreHorizontal,
  PauseCircle,
  MessageCircle,
  Phone,
  Plus,
  Search,
  Sparkles,
  Star,
  Trash2,
  TrendingUp,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useClientsData,
  useDeleteClient,
  useSaveClient,
  useUpdateClientNotes,
  type Client,
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

function whatsappHref(phone?: string | null) {
  const clean = (phone || "").replace(/\D/g, "");
  if (!clean) return undefined;
  return `https://wa.me/${clean.startsWith("54") ? clean : `54${clean}`}`;
}

function statusByDays(c: Client, activeDays: number, inactiveDays: number, lostDays: number): ClientStatus {
  if (c.visits === 0 || c.lastVisitDays == null) return "nuevo";

  // Prioridad real de segmentación:
  // 1) Perdido, 2) Inactivo, 3) VIP, 4) Activo.
  // Así un cliente para reconquistar nunca aparece también como VIP.
  if (c.lastVisitDays >= lostDays) return "perdido";
  if (c.lastVisitDays >= inactiveDays) return "inactivo";
  if ((c.visits >= 8 || c.spent >= 100000) && c.lastVisitDays <= activeDays) return "vip";
  if (c.lastVisitDays <= activeDays) return "activo";

  return "inactivo";
}

function statusBadge(s: ClientStatus) {
  const map = {
    vip: { label: "VIP", cls: "bg-gradient-to-r from-amber-300/20 to-violet-400/15 text-amber-100 ring-amber-300/40" },
    nuevo: { label: "NUEVO", cls: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30" },
    activo: { label: "ACTIVO", cls: "bg-cyan-400/10 text-cyan-300 ring-cyan-400/30" },
    inactivo: { label: "INACTIVO", cls: "bg-white/5 text-muted-foreground ring-white/10" },
    perdido: { label: "PERDIDO", cls: "bg-rose-400/10 text-rose-300 ring-rose-400/30" },
  } as const;
  const c = map[s];
  return <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-bold tracking-[0.18em] ring-1", c.cls)}>{c.label}</span>;
}

type ClientMetricInfo = {
  title: string;
  description: string;
  bullets: string[];
};

const CLIENT_METRIC_INFO = {
  vip: {
    title: "Clientes VIP",
    description: "Clientes de mayor valor para el negocio por cantidad de visitas, facturación y actividad reciente.",
    bullets: [
      "Sirven para detectar a quién conviene cuidar con prioridad.",
      "Un VIP activo no debería recibir mensajes genéricos: conviene anticipar su próximo turno.",
      "Si un VIP deja de venir, Clippr lo mueve a inactivo o perdido para que no se pierda en el listado.",
    ],
  },
  nuevos: {
    title: "Clientes nuevos",
    description: "Personas registradas que todavía no tienen historial suficiente de visitas.",
    bullets: [
      "Ayuda a medir si el negocio está captando gente nueva.",
      "Lo importante es lograr que vuelvan una segunda vez.",
      "Después de acumular visitas, dejan de ser nuevos y pasan a activo, VIP, inactivo o perdido.",
    ],
  },
  activos: {
    title: "Clientes activos",
    description: "Clientes que visitaron el negocio dentro del período considerado saludable.",
    bullets: [
      "Son la base actual del negocio.",
      "Cuanto más alto sea este número, más estable es la facturación recurrente.",
      "Incluye clientes VIP activos porque también forman parte de la base vigente.",
    ],
  },
  inactivos: {
    title: "Clientes inactivos",
    description: "Clientes que dejaron pasar más tiempo del habitual desde su última visita, pero todavía pueden recuperarse con una acción simple.",
    bullets: [
      "Conviene contactarlos antes de que pasen a perdidos.",
      "Un WhatsApp o beneficio puntual suele ser suficiente para probar recuperación.",
      "No significa que el cliente se perdió; significa que está enfriándose.",
    ],
  },
  perdidos: {
    title: "Clientes perdidos",
    description: "Clientes que llevan demasiado tiempo sin volver y ya no conviene asumir que siguen eligiendo el negocio.",
    bullets: [
      "Necesitan una campaña de reconquista más fuerte.",
      "Sirven para medir clientes que el negocio dejó de retener.",
      "No se mezclan con VIP para que no oculten una oportunidad de recuperación.",
    ],
  },
  frecuencia: {
    title: "Frecuencia promedio",
    description: "Promedio de días transcurridos desde la última visita de los clientes con historial.",
    bullets: [
      "Sirve para entender cada cuánto vuelve la clientela.",
      "Si sube demasiado, puede indicar pérdida de recurrencia.",
      "Es una señal útil para activar campañas antes de que los clientes se enfríen.",
    ],
  },
} satisfies Record<string, ClientMetricInfo>;

function Rating({ value }: { value: number }) {
  return <div className="flex gap-[3px]">{Array.from({ length: 5 }).map((_, i) => <Star key={i} className={cn("h-3 w-3", i < value ? "fill-violet-300 text-violet-300 drop-shadow-[0_0_4px_rgba(139,92,246,0.6)]" : "text-white/15")} />)}</div>;
}

function StatCard({ label, value, caption, link, onLinkClick, icon, glow, featured, info, onInfoClick }: {
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
}) {
  return (
    <div className={cn("glass relative overflow-hidden rounded-2xl p-3 sm:p-4 group transition-all hover:-translate-y-0.5 hover:ring-white/20", featured && "ring-1 ring-violet-400/30 shadow-[0_0_60px_-20px_rgba(139,92,246,0.45)]")}>
      <div className={cn("pointer-events-none absolute -top-20 -right-16 h-40 w-40 rounded-full blur-3xl opacity-70", glow)} />
      <div className="relative flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.18em] text-muted-foreground/90 truncate">{label}</div>
          {info && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onInfoClick?.();
              }}
              className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/5 text-[10px] font-bold text-muted-foreground ring-1 ring-white/10 transition hover:bg-violet-400/10 hover:text-violet-200 hover:ring-violet-300/30"
              aria-label={`Información sobre ${label}`}
            >
              i
            </button>
          )}
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="text-2xl sm:text-3xl font-display font-light leading-none tracking-tight">{value}</div>
          <div className="text-xl sm:text-2xl opacity-90 shrink-0">{icon}</div>
        </div>
        {caption && <div className="text-[11px] text-muted-foreground leading-snug">{caption}</div>}
        {link && <button onClick={onLinkClick} className="mt-0.5 inline-flex items-center gap-1 self-start text-[9px] sm:text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300/90 hover:text-violet-200 transition-colors">{link} <ArrowRight className="h-3 w-3" /></button>}
      </div>
    </div>
  );
}

function sanitizeDays(v: string) {
  return v.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
}

function daysNumber(v: string, defaultDays: number) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : defaultDays;
}


function formatClientSince(date?: string | null) {
  if (!date) return "Sin fecha";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "Sin fecha";
  return parsed.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
}

function formatNextAppointment(date?: string | null) {
  if (!date) return "No registrado";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "No registrado";
  return parsed.toLocaleString("es-AR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getClientRisk(c: Client | null) {
  const days = c?.lastVisitDays;
  if (!c || c.visits === 0 || days == null) {
    return {
      label: "Sin datos",
      tone: "neutral" as const,
      emoji: "⚪",
      className: "text-muted-foreground bg-white/5 ring-white/10",
      explanation: "Todavía no hay visitas suficientes para medir riesgo.",
    };
  }
  if (days <= 30) {
    return {
      label: "Bajo",
      tone: "low" as const,
      emoji: "🟢",
      className: "text-emerald-300 bg-emerald-400/10 ring-emerald-400/25",
      explanation: "Vino hace poco. Mantené el vínculo y ofrecé su próximo turno.",
    };
  }
  if (days <= 60) {
    return {
      label: "Medio",
      tone: "medium" as const,
      emoji: "🟡",
      className: "text-amber-300 bg-amber-400/10 ring-amber-400/25",
      explanation: "Está cerca de enfriarse. Conviene contactarlo antes de que pase más tiempo.",
    };
  }
  return {
    label: "Alto",
    tone: "high" as const,
    emoji: "🔴",
    className: "text-rose-300 bg-rose-400/10 ring-rose-400/25",
    explanation: "Hace mucho que no vuelve. Necesita una acción de reconquista.",
  };
}

function getReturnProbability(c: Client | null) {
  const risk = getClientRisk(c).tone;
  if (!c || c.visits === 0) return "Sin datos";
  if (risk === "low") return "Alta";
  if (risk === "medium") return "Media";
  if (risk === "high") return "Baja";
  return "Sin datos";
}

function getClientProfileText(c: Client | null, ticket: number) {
  if (!c) return "Seleccioná un cliente para ver el perfil.";
  if (c.visits === 0) return "Cliente nuevo. Todavía no hay historial suficiente para perfilar su comportamiento.";
  if (c.status === "vip") return "Es uno de los clientes más valiosos del negocio. Cuidá la relación y anticipá su próximo turno.";
  if (c.status === "perdido") return "Hace demasiado tiempo que no vuelve. Conviene usar una acción puntual de reconquista, no un mensaje genérico.";
  if (c.status === "inactivo") return "Está perdiendo frecuencia. Es buen momento para contactarlo con una propuesta concreta.";
  if (ticket > 0) return "Cliente activo con historial real de consumo. Mantené la frecuencia y registrá sus preferencias.";
  return "Cliente activo. Seguí acumulando historial para mejorar las recomendaciones.";
}

function ClientsPage() {
  const { businessId } = useAuth();
  const { data: rawClients = [], isLoading } = useClientsData(businessId);
  const saveClient = useSaveClient(businessId);
  const deleteClient = useDeleteClient(businessId);
  const updateNotes = useUpdateClientNotes(businessId);

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"gasto" | "recientes" | "nombre">("gasto");
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"resumen" | "historial">("resumen");
  const [daysActive, setDaysActive] = useState("60");
  const [daysInactive, setDaysInactive] = useState("60");
  const [daysLost, setDaysLost] = useState("90");
  const [newClientOpen, setNewClientOpen] = useState(false);
  const [clientMenuOpen, setClientMenuOpen] = useState(false);
  const [segmentModal, setSegmentModal] = useState<{ title: string; clients: Client[] } | null>(null);
  const [metricInfo, setMetricInfo] = useState<ClientMetricInfo | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [newClient, setNewClient] = useState({ name: "", phone: "", email: "", birth_date: "", notes: "" });

  const activeN = daysNumber(daysActive, 60);
  const inactiveN = daysNumber(daysInactive, 60);
  const lostN = daysNumber(daysLost, 90);

  const clients = useMemo(() => rawClients.map((c) => ({ ...c, status: statusByDays(c, activeN, inactiveN, lostN) })), [rawClients, activeN, inactiveN, lostN]);

  useEffect(() => { if (!selected && clients.length > 0) setSelected(clients[0].id); }, [clients, selected]);

  const filtered = useMemo(() => {
    let list = clients.filter((c) => [c.name, c.phone, c.email].some((x) => (x ?? "").toLowerCase().includes(query.toLowerCase())));
    if (sort === "gasto") list = [...list].sort((a, b) => b.spent - a.spent);
    if (sort === "nombre") list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "recientes") list = [...list].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return list;
  }, [clients, query, sort]);

  const counts = useMemo(() => ({
    vip: clients.filter((c) => c.status === "vip").length,
    nuevos: clients.filter((c) => c.status === "nuevo").length,
    activos: clients.filter((c) => c.status === "activo" || c.status === "vip").length,
    inactivos: clients.filter((c) => c.status === "inactivo").length,
    perdidos: clients.filter((c) => c.status === "perdido").length,
  }), [clients]);

  const current = clients.find((c) => c.id === selected) ?? null;
  useEffect(() => { setNoteDraft(current?.notes ?? ""); setClientMenuOpen(false); }, [current?.id, current?.notes]);
  const ticket = current && current.visits ? Math.round(current.spent / current.visits) : 0;
  const avgDays = Math.round(clients.filter((c) => c.lastVisitDays != null).reduce((s, c) => s + Number(c.lastVisitDays ?? 0), 0) / Math.max(1, clients.filter((c) => c.lastVisitDays != null).length));
  const currentRisk = getClientRisk(current);
  const currentSince = formatClientSince(current?.created_at);
  const returnProbability = getReturnProbability(current);
  const profileText = getClientProfileText(current, ticket);
  const nextAppointmentLabel = formatNextAppointment(current?.nextAppointment?.date);
  const favoriteServices = current?.favoriteServices ?? [];
  const spentLast12Months = current?.spentLast12Months ?? 0;
  const hasNote = Boolean((current?.notes ?? "").trim());

  function showGroup(title: string, fn: (c: Client) => boolean) {
    setSegmentModal({ title, clients: clients.filter(fn) });
  }

  async function handleCreateClient() {
    if (!newClient.name.trim()) return toast.error("Ingresá el nombre del cliente");
    await saveClient.mutateAsync(newClient);
    toast.success("Cliente guardado");
    setNewClient({ name: "", phone: "", email: "", birth_date: "", notes: "" });
    setNewClientOpen(false);
  }

  async function handleDeleteClient(client: Client) {
    if (!window.confirm(`¿Eliminar cliente ${client.name}?`)) return;
    await deleteClient.mutateAsync(client.id);
    toast.success("Cliente eliminado");
    if (selected === client.id) setSelected(null);
  }

  async function saveNotes() {
    if (!current) return;
    await updateNotes.mutateAsync({ clientId: current.id, notes: noteDraft });
    toast.success("Nota guardada");
  }

  return (
    <AppShell>
      <Topbar title="Clientes" subtitle="Clientes y fidelización" action={<button onClick={() => setNewClientOpen(true)} className="h-10 px-4 rounded-xl text-white font-medium text-sm flex items-center gap-2 hover:brightness-110 transition" style={{ background: "linear-gradient(135deg, oklch(0.65 0.24 255), oklch(0.65 0.28 305))" }}><Plus className="h-4 w-4" />Nuevo cliente</button>} />

      <div className="space-y-6 animate-fade-up">
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          <StatCard featured label="VIP" value={String(counts.vip)} caption="" link="Ver todos" onLinkClick={() => showGroup("VIP", (c) => c.status === "vip")} icon={<Crown className="h-7 w-7 text-violet-300" />} glow="bg-violet-500/25" info={CLIENT_METRIC_INFO.vip.description} onInfoClick={() => setMetricInfo(CLIENT_METRIC_INFO.vip)} />
          <StatCard label="Nuevos" value={String(counts.nuevos)} caption="" link="Ver todos" onLinkClick={() => showGroup("Nuevos", (c) => c.status === "nuevo")} icon={<Sparkles className="h-7 w-7 text-violet-300" />} glow="bg-violet-400/20" info={CLIENT_METRIC_INFO.nuevos.description} onInfoClick={() => setMetricInfo(CLIENT_METRIC_INFO.nuevos)} />
          <StatCard label="Activos" value={String(counts.activos)} caption="" link="Ver todos" onLinkClick={() => showGroup("Activos", (c) => c.status === "activo" || c.status === "vip")} icon={<CheckCircle2 className="h-7 w-7 text-emerald-300" />} glow="bg-emerald-400/20" info={CLIENT_METRIC_INFO.activos.description} onInfoClick={() => setMetricInfo(CLIENT_METRIC_INFO.activos)} />
          <StatCard label="Inactivos" value={String(counts.inactivos)} caption="" link="Ver todos" onLinkClick={() => showGroup("Inactivos", (c) => c.status === "inactivo")} icon={<PauseCircle className="h-7 w-7 text-amber-300" />} glow="bg-amber-400/15" info={CLIENT_METRIC_INFO.inactivos.description} onInfoClick={() => setMetricInfo(CLIENT_METRIC_INFO.inactivos)} />
          <StatCard label="Perdidos" value={String(counts.perdidos)} caption="" link="Reconquistar" onLinkClick={() => showGroup("Perdidos", (c) => c.status === "perdido")} icon={<AlertTriangle className="h-7 w-7 text-rose-300" />} glow="bg-rose-400/20" info={CLIENT_METRIC_INFO.perdidos.description} onInfoClick={() => setMetricInfo(CLIENT_METRIC_INFO.perdidos)} />
          <StatCard label="Frecuencia promedio" value={avgDays ? `${avgDays}d` : "—"} caption="" icon={<CalendarDays className="h-7 w-7 text-cyan-300" />} glow="bg-cyan-400/20" info={CLIENT_METRIC_INFO.frecuencia.description} onInfoClick={() => setMetricInfo(CLIENT_METRIC_INFO.frecuencia)} />
        </div>

        <div className="grid gap-5 lg:grid-cols-[400px_1fr]">
          <div className="glass rounded-2xl p-4 flex flex-col gap-4 max-h-[82vh]">
            <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre, teléfono, servicio…" className="w-full rounded-xl bg-white/5 ring-1 ring-white/10 pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-violet-400/40" /></div>
            <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{filtered.length} clientes</span><div className="flex items-center gap-2"><span>Ordenar:</span><select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="rounded-md bg-white/5 ring-1 ring-white/10 px-2 py-1 text-foreground"><option value="gasto">Mayor gasto</option><option value="recientes">Recientes</option><option value="nombre">Nombre</option></select></div></div>
            <div className="flex-1 overflow-y-auto pr-1 -mr-1 space-y-2">
              {filtered.map((c, i) => {
                const risk = getClientRisk(c);
                const isTopValue = sort === "gasto" && i === 0 && c.spent > 0;
                return (
                  <button key={c.id} onClick={() => setSelected(c.id)} className={cn("w-full flex items-center gap-3 rounded-xl p-3 ring-1 transition text-left relative overflow-hidden", selected === c.id ? "bg-gradient-to-r from-sky-500/15 via-violet-500/8 to-transparent ring-violet-400/40" : "bg-white/[0.02] ring-white/5 hover:bg-white/5")}>
                    <div className={cn("h-11 w-11 rounded-full grid place-items-center text-sm font-semibold bg-gradient-to-br ring-1", avatarTints[i % avatarTints.length])}>{c.name[0]?.toUpperCase()}</div>
                    <div className="flex-1 min-w-0">
                      {isTopValue && <div className="mb-1 text-[9px] font-bold uppercase tracking-[0.18em] text-amber-200">👑 Cliente más valioso</div>}
                      <div className="flex items-center justify-between gap-2"><div className="font-medium truncate">{c.name}</div><div className="text-sm font-semibold tabular-nums">${c.spent.toLocaleString("es-AR")}</div></div>
                      <div className="text-[11px] text-muted-foreground truncate">{c.visits} visitas · {c.lastVisit ?? "sin visitas"}</div>
                      <div className="flex items-center justify-between mt-1.5"><span className={cn("rounded-full px-2 py-0.5 text-[9px] font-bold ring-1", risk.className)}>{risk.emoji} Riesgo {risk.label}</span>{statusBadge(c.status)}</div>
                    </div>
                  </button>
                );
              })}
              {isLoading && <div className="text-center text-sm text-muted-foreground py-10 animate-pulse">Cargando clientes…</div>}
              {!isLoading && filtered.length === 0 && <div className="text-center text-sm text-muted-foreground py-10">Sin clientes para mostrar.</div>}
            </div>
          </div>

          <div className={cn("glass rounded-2xl p-0 min-h-[60vh] overflow-hidden", current?.status === "perdido" && "ring-1 ring-rose-400/30", current?.status === "vip" && "ring-1 ring-amber-300/30")}>
            {current ? <div className="flex flex-col h-full">
              <div className={cn("relative p-6 border-b border-white/5 overflow-hidden", current.status === "perdido" && "bg-rose-500/5", current.status === "vip" && "bg-amber-400/5")}>
                <div className="relative flex items-start gap-5">
                  <div className="h-20 w-20 rounded-2xl grid place-items-center text-2xl font-display font-semibold bg-gradient-to-br from-sky-400/30 to-violet-600/10 ring-1 ring-violet-400/40 text-sky-100">{current.name[0]?.toUpperCase()}</div>
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2 text-2xl font-display font-semibold leading-tight">{current.status === "perdido" && <AlertTriangle className="h-5 w-5 text-rose-300" />}{current.status === "vip" && <Crown className="h-5 w-5 text-amber-200" />}{current.name}</div><div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">{current.phone ? <a href={whatsappHref(current.phone)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-300 ring-1 ring-emerald-400/25 hover:bg-emerald-500/20 transition"><MessageCircle className="h-3.5 w-3.5 text-emerald-300" /> WhatsApp {current.phone}</a> : <span>sin teléfono</span>}{current.email && <><span>·</span><span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" /> {current.email}</span></>}</div></div><div className="relative"><button onClick={() => setClientMenuOpen((v) => !v)} className="rounded-full p-2 hover:bg-white/5 transition"><MoreHorizontal className="h-4 w-4 text-muted-foreground" /></button>{clientMenuOpen && <div className="absolute right-0 top-9 z-20 w-44 rounded-xl bg-background/95 ring-1 ring-white/10 shadow-2xl p-1.5 backdrop-blur"><button onClick={() => handleDeleteClient(current)} className="w-full inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-rose-300 hover:bg-rose-500/10"><Trash2 className="h-4 w-4" />Eliminar</button></div>}</div></div>
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">{statusBadge(current.status)}<span className={cn("rounded-full px-2 py-0.5 text-[9px] font-bold tracking-[0.12em] ring-1", currentRisk.className)}>{currentRisk.emoji} Riesgo {currentRisk.label}</span><Rating value={current.rating} /></div>
                    <div className="grid gap-2 pt-2 text-[11px] text-muted-foreground sm:grid-cols-3">
                      <div className="rounded-xl bg-white/[0.035] ring-1 ring-white/10 px-3 py-2"><span className="block text-white/45">Cliente desde</span><span className="font-semibold text-white/80 capitalize">{currentSince}</span></div>
                      <div className="rounded-xl bg-white/[0.035] ring-1 ring-white/10 px-3 py-2"><span className="block text-white/45">Estado</span><span className="font-semibold text-white/80">{current.status.toUpperCase()}</span></div>
                      <div className="rounded-xl bg-white/[0.035] ring-1 ring-white/10 px-3 py-2"><span className="block text-white/45">Próximo turno</span><span className="font-semibold text-white/80 capitalize">{nextAppointmentLabel}</span>{current.nextAppointment?.service && <span className="mt-0.5 block truncate text-[10px] text-white/45">{current.nextAppointment.service}</span>}</div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="px-6 pt-4"><div className="inline-flex rounded-full bg-white/5 ring-1 ring-white/10 p-1">{(["resumen", "historial"] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={cn("rounded-full px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] transition", tab === t ? "bg-gradient-to-r from-sky-400 to-violet-500 text-background" : "text-muted-foreground hover:text-foreground")}>{t}</button>)}</div></div>
              <div className="p-6 flex-1 space-y-5">
                {tab === "resumen" && <>
                  <div className="rounded-2xl bg-gradient-to-br from-violet-500/12 via-sky-500/8 to-transparent ring-1 ring-violet-400/25 p-4 shadow-[0_0_60px_-35px_rgba(139,92,246,0.9)]">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-violet-200/90"><Sparkles className="h-3.5 w-3.5" /> Perfil IA del cliente</div>
                        <div className="mt-2 text-sm leading-relaxed text-white/78">{profileText}</div>
                      </div>
                      <div className={cn("rounded-xl px-3 py-2 text-xs font-semibold ring-1", currentRisk.className)}>{currentRisk.emoji} Riesgo {currentRisk.label}</div>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-xl bg-white/[0.04] ring-1 ring-white/10 p-3"><div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Probabilidad de volver</div><div className="mt-1 text-lg font-display font-semibold">{returnProbability}</div></div>
                      <div className="rounded-xl bg-white/[0.04] ring-1 ring-white/10 p-3"><div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Frecuencia</div><div className="mt-1 text-lg font-display font-semibold">{current.lastVisitDays != null ? `${current.lastVisitDays}d desde última visita` : "Sin datos"}</div></div>
                      <div className="rounded-xl bg-white/[0.04] ring-1 ring-white/10 p-3"><div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Acción sugerida</div><div className="mt-1 text-sm font-semibold text-white/85">{currentRisk.tone === "high" ? "Reconquistar" : currentRisk.tone === "medium" ? "Contactar esta semana" : currentRisk.tone === "low" ? "Mantener vínculo" : "Registrar próxima visita"}</div></div>
                    </div>
                    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{currentRisk.explanation}</p>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3"><div className="rounded-xl bg-gradient-to-br from-sky-400/15 to-violet-500/8 ring-1 ring-violet-400/30 p-3"><div className="text-[10px] uppercase tracking-[0.18em] text-violet-200/90">Lifetime value</div><div className="text-2xl font-display mt-1 tabular-nums">${current.spent.toLocaleString("es-AR")}</div></div><div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-3"><div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Últimos 12 meses</div><div className="text-2xl font-display mt-1 tabular-nums">${spentLast12Months.toLocaleString("es-AR")}</div></div><div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-3"><div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Visitas</div><div className="text-2xl font-display mt-1 tabular-nums">{current.visits}</div></div><div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-3"><div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Ticket prom.</div><div className="text-2xl font-display mt-1 tabular-nums">${ticket.toLocaleString("es-AR")}</div></div><div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-3"><div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Última visita</div><div className="text-sm font-semibold mt-2">{current.lastVisit ?? "—"}</div></div></div>
                  <div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-4"><div className="flex items-center justify-between gap-2 mb-3"><div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Servicios favoritos</div><div className="text-[10px] text-muted-foreground">Según historial de cobros</div></div>{favoriteServices.length === 0 ? <div className="text-sm text-muted-foreground">Todavía no hay servicios suficientes para detectar favoritos.</div> : <div className="grid gap-2 sm:grid-cols-3">{favoriteServices.map((item) => <div key={item.service} className="rounded-xl bg-white/[0.035] ring-1 ring-white/10 p-3"><div className="truncate text-sm font-semibold text-white/85">{item.service}</div><div className="mt-1 text-[11px] text-muted-foreground">{item.count} veces · ${item.amount.toLocaleString("es-AR")}</div></div>)}</div>}</div>
                  <div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-4"><div className="flex flex-wrap items-center justify-between gap-2 mb-2"><div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Notas</div>{hasNote && <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-200/80">Última nota registrada</div>}</div>{hasNote && <div className="mb-3 rounded-xl bg-white/[0.035] ring-1 ring-white/10 p-3 text-sm text-white/78">“{current.notes}”</div>}<textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Agregá notas internas del cliente..." className="w-full min-h-[110px] rounded-xl bg-white/5 ring-1 ring-white/10 p-3 text-sm focus:outline-none focus:ring-violet-400/40" /><div className="flex justify-end mt-3"><button onClick={saveNotes} disabled={updateNotes.isPending} className="rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 text-background px-4 py-2 text-sm font-semibold disabled:opacity-50">{updateNotes.isPending ? "Guardando…" : "Guardar nota"}</button></div></div>
                </>}
                {tab === "historial" && <div className="space-y-2">{current.history.length === 0 ? <div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-4 text-sm text-muted-foreground">Sin historial de cobros todavía.</div> : current.history.map((h) => <div key={h.id} className="flex items-center justify-between rounded-xl bg-white/5 ring-1 ring-white/10 p-3"><div><div className="text-sm font-medium">{h.service}</div><div className="text-[11px] text-muted-foreground">{new Date(h.date).toLocaleString("es-AR")}</div></div><div className="text-sm font-semibold tabular-nums">${h.amount.toLocaleString("es-AR")}</div></div>)}</div>}
              </div>
            </div> : <div className="h-full grid place-items-center p-6"><div className="text-center space-y-3"><UserRound className="mx-auto h-8 w-8 text-muted-foreground" /><div className="text-lg font-display">Seleccioná un cliente</div></div></div>}
          </div>
        </div>
      </div>

      {newClientOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4"><div className="w-full max-w-lg rounded-2xl bg-background ring-1 ring-white/10 shadow-2xl overflow-hidden"><div className="flex items-center justify-between p-5 border-b border-white/5"><div><div className="text-lg font-display font-semibold">Nuevo cliente</div><div className="text-xs text-muted-foreground">Guardá un cliente real en la base de datos.</div></div><button onClick={() => setNewClientOpen(false)} className="rounded-full bg-white/5 px-3 py-1.5 text-sm">Cerrar</button></div><div className="p-5 space-y-4"><label className="block text-xs text-muted-foreground">Nombre *<input value={newClient.name} onChange={(e) => setNewClient((s) => ({ ...s, name: e.target.value }))} className="mt-1 w-full rounded-xl bg-white/5 ring-1 ring-white/10 px-3 py-2.5 text-sm text-foreground" /></label><div className="grid grid-cols-2 gap-3"><label className="block text-xs text-muted-foreground">Teléfono<input value={newClient.phone} onChange={(e) => setNewClient((s) => ({ ...s, phone: e.target.value }))} className="mt-1 w-full rounded-xl bg-white/5 ring-1 ring-white/10 px-3 py-2.5 text-sm text-foreground" /></label><label className="block text-xs text-muted-foreground">Email<input value={newClient.email} onChange={(e) => setNewClient((s) => ({ ...s, email: e.target.value }))} className="mt-1 w-full rounded-xl bg-white/5 ring-1 ring-white/10 px-3 py-2.5 text-sm text-foreground" /></label></div><label className="block text-xs text-muted-foreground">Fecha de nacimiento<input type="date" value={newClient.birth_date} onChange={(e) => setNewClient((s) => ({ ...s, birth_date: e.target.value }))} className="mt-1 w-full rounded-xl bg-white/5 ring-1 ring-white/10 px-3 py-2.5 text-sm text-foreground" /></label><label className="block text-xs text-muted-foreground">Notas<textarea value={newClient.notes} onChange={(e) => setNewClient((s) => ({ ...s, notes: e.target.value }))} className="mt-1 w-full min-h-[90px] rounded-xl bg-white/5 ring-1 ring-white/10 px-3 py-2.5 text-sm text-foreground" /></label></div><div className="flex justify-end gap-2 p-5 border-t border-white/5"><button onClick={() => setNewClientOpen(false)} className="rounded-xl bg-white/5 px-4 py-2 text-sm">Cancelar</button><button onClick={handleCreateClient} disabled={saveClient.isPending} className="rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 text-background px-4 py-2 text-sm font-semibold disabled:opacity-50">Guardar cliente</button></div></div></div>}

      {metricInfo && <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4"><div className="w-full max-w-md rounded-2xl bg-background ring-1 ring-white/10 shadow-2xl overflow-hidden"><div className="flex items-center justify-between p-5 border-b border-white/5"><div><div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300">Información</div><div className="text-lg font-display font-semibold">{metricInfo.title}</div></div><button onClick={() => setMetricInfo(null)} className="rounded-full bg-white/5 px-3 py-1.5 text-sm">Cerrar</button></div><div className="p-5 space-y-4"><p className="text-sm leading-relaxed text-muted-foreground">{metricInfo.description}</p><div className="space-y-2">{metricInfo.bullets.map((point) => <div key={point} className="rounded-xl bg-white/[0.04] ring-1 ring-white/10 px-3 py-2 text-sm text-white/78">{point}</div>)}</div></div></div></div>}

      {segmentModal && <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4"><div className="w-full max-w-xl rounded-2xl bg-background ring-1 ring-white/10 shadow-2xl overflow-hidden"><div className="flex items-center justify-between p-5 border-b border-white/5"><div className="text-lg font-display font-semibold">{segmentModal.title}</div><button onClick={() => setSegmentModal(null)} className="rounded-full bg-white/5 px-3 py-1.5 text-sm">Cerrar</button></div><div className="max-h-[60vh] overflow-y-auto p-3 space-y-2">{segmentModal.clients.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">No hay clientes en este grupo.</div> : segmentModal.clients.map((c) => <button key={c.id} onClick={() => { setSelected(c.id); setSegmentModal(null); }} className="w-full flex items-center justify-between rounded-xl bg-white/5 ring-1 ring-white/10 p-3 text-left hover:bg-white/10"><div><div className="font-medium">{c.name}</div><div className="text-xs text-muted-foreground">{c.phone || "sin teléfono"} · {c.lastVisit || "sin visitas"}</div></div><div className="text-sm font-semibold">${c.spent.toLocaleString("es-AR")}</div></button>)}</div></div></div>}
    </AppShell>
  );
}
