import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Topbar } from "@/components/topbar";
import {
  Crown,
  Sparkles,
  CalendarDays,
  CheckCircle2,
  PauseCircle,
  AlertTriangle,
  Search,
  Plus,
  UserRound,
  Phone,
  ArrowRight,
  ArrowUpRight,
  Mail,
  MessageCircle,
  Trash2,
  Star,
  TrendingUp,
  Clock3,
  MoreHorizontal,
  Scissors,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useClientsData,
  useDeleteClient,
  useSaveClient,
  useUpdateClientNotes,
  type ClientStatus,
} from "@/hooks/use-clients-data";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/clients")({
  component: ClientsPage,
});

// Types imported from use-clients-data

// Data comes from Supabase via useClientsData

const avatarTints = [
  "from-sky-400/30 to-violet-600/10 text-sky-100 ring-violet-400/30",
  "from-rose-300/30 to-rose-600/10 text-rose-100 ring-rose-300/30",
  "from-violet-300/30 to-violet-600/10 text-violet-100 ring-violet-300/30",
  "from-cyan-300/30 to-cyan-600/10 text-cyan-100 ring-cyan-300/30",
  "from-emerald-300/30 to-emerald-600/10 text-emerald-100 ring-emerald-300/30",
];

function StatCard({
  label,
  value,
  caption,
  link,
  onLinkClick,
  icon,
  glow,
  trend,
  featured,
}: {
  label: string;
  value: string;
  caption: React.ReactNode;
  link?: string;
  onLinkClick?: () => void;
  icon: React.ReactNode;
  glow: string;
  trend?: { val: string; up?: boolean };
  featured?: boolean;
}) {
  return (
    <div
      className={cn(
        "glass relative overflow-hidden rounded-2xl p-3 sm:p-4 group transition-all hover:-translate-y-0.5 hover:ring-white/20",
        featured && "ring-1 ring-violet-400/30 shadow-[0_0_60px_-20px_rgba(139,92,246,0.45)]",
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute -top-20 -right-16 h-40 w-40 rounded-full blur-3xl opacity-70 transition-opacity group-hover:opacity-100",
          glow,
        )}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.04] to-transparent" />
      <div className="relative flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.18em] text-muted-foreground/90 truncate">
            {label}
          </div>
          {trend && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold tabular-nums shrink-0",
                trend.up
                  ? "bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/30"
                  : "bg-rose-400/10 text-rose-300 ring-1 ring-rose-400/30",
              )}
            >
              <ArrowUpRight className={cn("h-3 w-3", !trend.up && "rotate-90")} /> {trend.val}
            </span>
          )}
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="text-2xl sm:text-3xl font-display font-light leading-none tracking-tight bg-gradient-to-b from-foreground to-foreground/70 bg-clip-text text-transparent">
            {value}
          </div>
          <div className="text-xl sm:text-2xl opacity-90 transition-transform group-hover:scale-110 shrink-0">
            {icon}
          </div>
        </div>
        <div className="text-[11px] text-muted-foreground leading-snug">{caption}</div>
        {link && (
          <button
            onClick={onLinkClick}
            className="mt-0.5 inline-flex items-center gap-1 self-start text-[9px] sm:text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300/90 hover:text-violet-200 transition-colors"
          >
            {link}{" "}
            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </button>
        )}
      </div>
    </div>
  );
}

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

function statusBadge(s: ClientStatus) {
  const map = {
    vip: { label: "⭐ VIP", cls: "bg-amber-400/15 text-amber-300 ring-amber-400/40 shadow-[0_0_12px_-4px_oklch(0.82_0.18_75/0.5)]" },
    nuevo: { label: "NUEVO", cls: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30" },
    activo: { label: "ACTIVO", cls: "bg-cyan-400/10 text-cyan-300 ring-cyan-400/30" },
    inactivo: { label: "INACTIVO", cls: "bg-white/5 text-muted-foreground ring-white/10" },
    perdido: { label: "⚠ PERDIDO", cls: "bg-rose-500/20 text-rose-300 ring-rose-500/50 shadow-[0_0_12px_-4px_oklch(0.66_0.24_25/0.4)]" },
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

function Sparkbars({ data }: { data: number[] }) {
  const max = Math.max(...data, 1);
  return (
    <div className="flex items-end gap-[3px] h-8">
      {data.map((v, i) => (
        <div
          key={i}
          className="w-1.5 rounded-sm bg-gradient-to-t from-sky-500/20 to-violet-400/80"
          style={{ height: `${(v / max) * 100}%` }}
        />
      ))}
    </div>
  );
}

function ClientsPage() {
  const { businessId } = useAuth();
  const { data: allClients = [], isLoading } = useClientsData(businessId);
  const deleteClient = useDeleteClient(businessId);
  const saveClient = useSaveClient(businessId);
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
  const [newClient, setNewClient] = useState({
    name: "",
    phone: "",
    email: "",
    birth_date: "",
    notes: "",
  });
  const [noteDraft, setNoteDraft] = useState("");
  const [listModal, setListModal] = useState<{
    title: string;
    subtitle: string;
    clients: typeof allClients;
  } | null>(null);

  // Auto-select first client when data loads
  useMemo(() => {
    if (!selected && allClients.length > 0) setSelected(allClients[0].id);
  }, [allClients, selected]);

  const filtered = useMemo(() => {
    let list = allClients.filter(
      (c) =>
        (c.name ?? "").toLowerCase().includes(query.toLowerCase()) ||
        (c.phone ?? "").toLowerCase().includes(query.toLowerCase()) ||
        (c.email ?? "").toLowerCase().includes(query.toLowerCase()),
    );
    if (sort === "gasto") list = [...list].sort((a, b) => b.spent - a.spent);
    if (sort === "nombre") list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "recientes")
      list = [...list].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    return list;
  }, [allClients, query, sort]);

  const activeDaysNumber = Number(daysActive || 0);
  const inactiveDaysNumber = Number(daysInactive || 0);
  const lostDaysNumber = Number(daysLost || 0);

  const clientsVip = useMemo(
    () => allClients.filter((c) => c.status === "vip"),
    [allClients],
  );
  const clientsNew = useMemo(
    () => allClients.filter((c) => c.status === "nuevo"),
    [allClients],
  );
  const clientsActive = useMemo(
    () =>
      allClients.filter(
        (c) =>
          c.lastVisitDays !== null &&
          c.lastVisitDays !== undefined &&
          c.lastVisitDays <= activeDaysNumber,
      ),
    [allClients, activeDaysNumber],
  );
  const clientsInactive = useMemo(
    () =>
      allClients.filter(
        (c) =>
          c.lastVisitDays !== null &&
          c.lastVisitDays !== undefined &&
          c.lastVisitDays >= inactiveDaysNumber,
      ),
    [allClients, inactiveDaysNumber],
  );
  const clientsLost = useMemo(
    () =>
      allClients.filter(
        (c) =>
          c.lastVisitDays !== null &&
          c.lastVisitDays !== undefined &&
          c.lastVisitDays >= lostDaysNumber,
      ),
    [allClients, lostDaysNumber],
  );

  const counts = useMemo(
    () => ({
      vip: clientsVip.length,
      nuevos: clientsNew.length,
      activos: clientsActive.length,
      inactivos: clientsInactive.length,
      perdidos: clientsLost.length,
    }),
    [clientsVip.length, clientsNew.length, clientsActive.length, clientsInactive.length, clientsLost.length],
  );

  const openClientList = (title: string, subtitle: string, clients: typeof allClients) => {
    setListModal({
      title,
      subtitle,
      clients: [...clients].sort((a, b) => b.spent - a.spent),
    });
  };

  const current = allClients.find((c) => c.id === selected) ?? null;

  useEffect(() => {
    setNoteDraft(current?.notes ?? "");
    setClientMenuOpen(false);
  }, [current?.id, current?.notes]);
  const ticket = current && current.visits ? Math.round(current.spent / current.visits) : 0;
  const avgDaysBetweenVisits = useMemo(() => {
    const withVisits = allClients.filter(
      (c) => c.lastVisitDays !== null && c.lastVisitDays !== undefined,
    );
    if (withVisits.length === 0) return 0;
    return Math.round(
      withVisits.reduce((sum, c) => sum + Number(c.lastVisitDays ?? 0), 0) / withVisits.length,
    );
  }, [allClients]);

  const handleDeleteClient = async (clientId: string, clientName: string) => {
    const ok = window.confirm(`¿Eliminar cliente ${clientName}? Esta acción no se puede deshacer.`);
    if (!ok) return;
    await deleteClient.mutateAsync(clientId);
    setClientMenuOpen(false);
    if (selected === clientId) setSelected(null);
  };

  const setDaysValue = (setter: (v: string) => void) => (value: string) => {
    const clean = value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    setter(clean);
  };

  const scrollToList = () => {
    document
      .getElementById("clientes-listado")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const saveClientNotes = async () => {
    if (!current) return;
    try {
      await updateNotes.mutateAsync({ clientId: current.id, notes: noteDraft });
      window.alert("Nota guardada correctamente.");
    } catch (err: any) {
      window.alert(err?.message || "No se pudo guardar la nota.");
    }
  };

  const handleCreateClient = async () => {
    if (!newClient.name.trim()) {
      window.alert("Ingresá el nombre del cliente.");
      return;
    }

    await saveClient.mutateAsync({
      name: newClient.name,
      phone: newClient.phone,
      email: newClient.email,
      birth_date: newClient.birth_date,
      notes: newClient.notes,
    });

    setNewClient({ name: "", phone: "", email: "", birth_date: "", notes: "" });
    setNewClientOpen(false);
    window.alert("Cliente guardado correctamente.");
  };

  return (
    <AppShell>
      <Topbar
        title="Clientes"
        subtitle="Cartera, Segmentación Y Reconquista"
        action={
          <button
            onClick={() => setNewClientOpen(true)}
            className="h-10 px-4 rounded-xl text-white font-medium text-sm flex items-center gap-2 hover:brightness-110 transition"
            style={{
              background: "linear-gradient(135deg, oklch(0.65 0.24 255), oklch(0.65 0.28 305))",
              boxShadow:
                "0 10px 26px -10px oklch(0.6 0.28 290 / 0.65), inset 0 1px 0 oklch(1 0 0 / 0.2)",
            }}
          >
            <Plus className="h-4 w-4" />
            Nuevo cliente
          </button>
        }
      />
      <div className="space-y-6 animate-fade-up">
        {/* Stats grid */}
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          <StatCard
            featured
            label="Clientes VIP"
            value={String(counts.vip)}
            caption="+ gasto + visita"
            link="Ver todos"
            onLinkClick={() => openClientList("Clientes VIP", "Mayor gasto y más visitas", clientsVip)}
            icon={<Crown className="h-7 w-7 text-violet-300" />}
            glow="bg-violet-500/25"
          />
          <StatCard
            label="Clientes nuevos"
            value={String(counts.nuevos)}
            caption="ingresaron este mes"
            link="Ver todos"
            onLinkClick={() => openClientList("Clientes nuevos", "Ingresaron este mes", clientsNew)}
            icon={<Sparkles className="h-7 w-7 text-violet-300" />}
            glow="bg-violet-400/20"
          />
          <StatCard
            label="Frecuencia promedio"
            value={avgDaysBetweenVisits ? String(avgDaysBetweenVisits) : "—"}
            caption="días desde última visita"
            icon={<CalendarDays className="h-7 w-7 text-cyan-300" />}
            glow="bg-cyan-400/20"
          />
          <StatCard
            label="Clientes activos"
            value={String(counts.activos)}
            caption={
              <span className="inline-flex items-center gap-2">
                visita en
                <input
                  type="number"
                  value={daysActive}
                  min={1}
                  onChange={(e) => setDaysValue(setDaysActive)(e.target.value)}
                  className="w-12 rounded-md bg-white/5 ring-1 ring-white/10 px-1.5 py-0.5 text-foreground text-center"
                />
                días
              </span>
            }
            link="Ver todos"
            onLinkClick={() => openClientList("Clientes activos", `Clientes con visita en los últimos ${daysActive || 0} días`, clientsActive)}
            icon={<CheckCircle2 className="h-7 w-7 text-emerald-300" />}
            glow="bg-emerald-400/20"
          />
          <StatCard
            label="Clientes inactivos"
            value={String(counts.inactivos)}
            caption={
              <span className="inline-flex items-center gap-2">
                sin visita +
                <input
                  type="number"
                  value={daysInactive}
                  min={1}
                  onChange={(e) => setDaysValue(setDaysInactive)(e.target.value)}
                  className="w-12 rounded-md bg-white/5 ring-1 ring-white/10 px-1.5 py-0.5 text-foreground text-center"
                />
                días
              </span>
            }
            link="Ver todos"
            onLinkClick={() => openClientList("Clientes inactivos", `Sin visita hace ${daysInactive || 0} días o más`, clientsInactive)}
            icon={<PauseCircle className="h-7 w-7 text-muted-foreground" />}
            glow="bg-white/10"
          />
          <StatCard
            label="Clientes perdidos"
            value={String(counts.perdidos)}
            caption={
              <span className="inline-flex items-center gap-2">
                sin visita +
                <input
                  type="number"
                  value={daysLost}
                  min={1}
                  onChange={(e) => setDaysValue(setDaysLost)(e.target.value)}
                  className="w-12 rounded-md bg-white/5 ring-1 ring-white/10 px-1.5 py-0.5 text-foreground text-center"
                />
                días
              </span>
            }
            link="Reconquistar"
            onLinkClick={() => openClientList("Clientes para reconquistar", `Sin visita hace ${daysLost || 0} días o más`, clientsLost)}
            icon={<AlertTriangle className="h-7 w-7 text-rose-300" />}
            glow="bg-rose-400/20"
          />
        </div>

        {/* List + Detail */}
        <div id="clientes-listado" className="grid gap-5 lg:grid-cols-[400px_1fr]">
          {/* List */}
          <div className="glass rounded-2xl p-4 flex flex-col gap-4 max-h-[82vh]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por nombre, teléfono, servicio…"
                className="w-full rounded-xl bg-white/5 ring-1 ring-white/10 pl-9 pr-3 py-2.5 text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:ring-violet-400/40 transition"
              />
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{filtered.length} clientes</span>
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

            <div className="flex-1 overflow-y-auto pr-1 -mr-1 space-y-2">
              {filtered.map((c, i) => {
                const active = selected === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => {
                      setSelected(c.id);
                      setClientMenuOpen(false);
                    }}
                    className={cn(
                      "w-full flex items-center gap-3 rounded-xl p-3 ring-1 transition text-left relative overflow-hidden group",
                      active
                        ? "bg-gradient-to-r from-sky-500/15 via-violet-500/8 to-transparent ring-violet-400/40 shadow-[0_0_24px_-8px_rgba(139,92,246,0.5)]"
                        : "bg-white/[0.02] ring-white/5 hover:bg-white/5 hover:ring-white/10",
                    )}
                  >
                    {active && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 h-8 w-[3px] rounded-r-full bg-gradient-to-b from-sky-300 to-violet-500" />
                    )}
                    <div className="relative">
                      <div
                        className={cn(
                          "h-11 w-11 rounded-full grid place-items-center text-sm font-semibold bg-gradient-to-br ring-1",
                          avatarTints[i % avatarTints.length],
                        )}
                      >
                        {(c.name ?? "")[0]?.toUpperCase()}
                      </div>
                      {c.status === "vip" && (
                        <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-gradient-to-br from-sky-300 to-violet-500 grid place-items-center ring-2 ring-background">
                          <Crown className="h-2.5 w-2.5 text-background" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium truncate">{c.name}</div>
                        <div className="text-sm font-semibold tabular-nums text-foreground/90">
                          ${c.spent.toLocaleString("es-AR")}
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <div className="text-[11px] text-muted-foreground truncate">
                          {c.visits} visitas · {c.lastVisit ?? "sin visitas"}
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-1.5">
                        <Rating value={c.rating} />
                        {statusBadge(c.status)}
                      </div>
                    </div>
                  </button>
                );
              })}
              {isLoading && (
                <div className="text-center text-sm text-muted-foreground py-10 animate-pulse">
                  Cargando clientes…
                </div>
              )}
              {!isLoading && filtered.length === 0 && (
                <div className="text-center text-sm text-muted-foreground py-10">
                  {allClients.length === 0
                    ? "Sin clientes registrados aún."
                    : "No hay clientes con ese filtro"}
                </div>
              )}
            </div>
          </div>

          {/* Detail */}
          <div className="glass rounded-2xl p-0 min-h-[60vh] overflow-hidden">
            {current ? (
              <div className="flex flex-col h-full">
                {/* Detail hero */}
                <div className="relative p-6 border-b border-white/5 overflow-hidden">
                  <div className="pointer-events-none absolute -top-20 -right-10 h-56 w-56 rounded-full bg-violet-500/20 blur-3xl" />
                  <div className="relative flex items-start gap-5">
                    <div className="relative">
                      <div className="h-20 w-20 rounded-2xl grid place-items-center text-2xl font-display font-semibold bg-gradient-to-br from-sky-400/30 to-violet-600/10 ring-1 ring-violet-400/40 text-sky-100 shadow-[0_0_40px_-10px_rgba(139,92,246,0.6)]">
                        {current.name[0]?.toUpperCase()}
                      </div>
                      {current.status === "vip" && (
                        <div className="absolute -bottom-1 -right-1 rounded-full bg-gradient-to-br from-sky-300 to-violet-500 px-1.5 py-0.5 ring-2 ring-background">
                          <Crown className="h-3 w-3 text-background" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-2xl font-display font-semibold leading-tight">
                            {current.name}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                            {current.phone ? (
                              <span className="inline-flex items-center gap-1">
                                <Phone className="h-3 w-3" /> {current.phone}
                              </span>
                            ) : (
                              <span>sin teléfono</span>
                            )}
                            {current.email && (
                              <>
                                <span>·</span>
                                <span className="inline-flex items-center gap-1">
                                  <Mail className="h-3 w-3" /> {current.email}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="relative">
                          <button
                            onClick={() => setClientMenuOpen((v) => !v)}
                            title="Acciones"
                            className="rounded-full p-2 hover:bg-white/5 transition"
                          >
                            <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                          </button>
                          {clientMenuOpen && (
                            <div className="absolute right-0 top-9 z-20 w-44 rounded-xl bg-background/95 ring-1 ring-white/10 shadow-2xl p-1.5 backdrop-blur">
                              <button
                                onClick={() => handleDeleteClient(current.id, current.name)}
                                className="w-full inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-rose-300 hover:bg-rose-500/10 transition text-left"
                              >
                                <Trash2 className="h-4 w-4" />
                                Eliminar cliente
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        {statusBadge(current.status)}
                        <Rating value={current.rating} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Tabs */}
                <div className="px-6 pt-4">
                  <div className="inline-flex rounded-full bg-white/5 ring-1 ring-white/10 p-1">
                    {(["resumen", "historial"] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setTab(t)}
                        className={cn(
                          "rounded-full px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] transition",
                          tab === t
                            ? "bg-gradient-to-r from-sky-400 to-violet-500 text-background shadow"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Content */}
                <div className="p-6 flex-1 space-y-5">
                  {tab === "resumen" && (
                    <>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-sky-400/15 to-violet-500/8 ring-1 ring-violet-400/30 p-3">
                          <div className="text-[10px] uppercase tracking-[0.18em] text-violet-200/90">
                            Lifetime value
                          </div>
                          <div className="text-2xl font-display mt-1 tabular-nums">
                            ${current.spent.toLocaleString("es-AR")}
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5 inline-flex items-center gap-1">
                            <TrendingUp className="h-3 w-3 text-emerald-300" /> gasto total
                          </div>
                        </div>
                        <div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-3">
                          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                            Visitas
                          </div>
                          <div className="text-2xl font-display mt-1 tabular-nums">
                            {current.visits}
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            total histórico
                          </div>
                        </div>
                        <div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-3">
                          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                            Ticket prom.
                          </div>
                          <div className="text-2xl font-display mt-1 tabular-nums">
                            ${ticket.toLocaleString("es-AR")}
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">por visita</div>
                        </div>
                        <div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-3">
                          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                            Última visita
                          </div>
                          <div className="text-sm font-semibold mt-2">
                            {current.lastVisit ?? "—"}
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5 inline-flex items-center gap-1">
                            <Clock3 className="h-3 w-3" />{" "}
                            {current.lastVisit ? `Últ: ${current.lastVisit}` : "sin visitas"}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-4 space-y-3">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                          Notas
                        </div>
                        <textarea
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          placeholder="Agregá notas internas del cliente…"
                          className="w-full min-h-[100px] rounded-xl bg-white/5 ring-1 ring-white/10 p-3 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-violet-400/40"
                        />
                        <div className="flex justify-end">
                          <button
                            onClick={saveClientNotes}
                            disabled={updateNotes.isPending || !current}
                            className="rounded-xl px-4 py-2 text-sm font-semibold bg-gradient-to-r from-sky-400 to-violet-500 text-background hover:brightness-110 transition disabled:opacity-60"
                          >
                            {updateNotes.isPending ? "Guardando…" : "Guardar nota"}
                          </button>
                        </div>
                      </div>
                    </>
                  )}

                  {tab === "historial" && (
                    <div className="space-y-2">
                      {current.history.length === 0 ? (
                        <div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-4 text-sm text-muted-foreground">
                          Sin cobros registrados para este cliente.
                        </div>
                      ) : (
                        current.history.map((h) => (
                          <div
                            key={h.id}
                            className="flex items-center justify-between rounded-xl bg-white/5 ring-1 ring-white/10 p-3"
                          >
                            <div className="flex items-center gap-3">
                              <div className="h-9 w-9 rounded-lg bg-violet-500/15 ring-1 ring-violet-400/20 grid place-items-center text-violet-200">
                                <Scissors className="h-4 w-4" />
                              </div>
                              <div>
                                <div className="text-sm font-medium">{h.service}</div>
                                <div className="text-[11px] text-muted-foreground">
                                  {new Date(h.date).toLocaleDateString("es-AR")}
                                </div>
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
            ) : (
              <div className="h-full grid place-items-center p-6">
                <div className="text-center space-y-3">
                  <div className="mx-auto h-14 w-14 rounded-full grid place-items-center bg-white/5 ring-1 ring-white/10">
                    <UserRound className="h-7 w-7 text-muted-foreground" />
                  </div>
                  <div className="text-lg font-display">Seleccioná un cliente</div>
                  <div className="text-sm text-muted-foreground">
                    Hacé click en cualquier cliente para ver su perfil completo
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {listModal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-background ring-1 ring-white/10 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <div className="text-lg font-display font-semibold">{listModal.title}</div>
                <div className="text-xs text-muted-foreground">{listModal.subtitle}</div>
              </div>
              <button
                onClick={() => setListModal(null)}
                className="rounded-full px-3 py-1.5 text-sm bg-white/5 hover:bg-white/10 transition"
              >
                Cerrar
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-4 space-y-2">
              {listModal.clients.length === 0 ? (
                <div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-4 text-sm text-muted-foreground text-center">
                  No hay clientes para mostrar.
                </div>
              ) : (
                listModal.clients.map((client) => (
                  <button
                    key={client.id}
                    onClick={() => {
                      setSelected(client.id);
                      setListModal(null);
                    }}
                    className="w-full flex items-center justify-between gap-3 rounded-xl bg-white/5 ring-1 ring-white/10 p-3 text-left hover:bg-white/10 transition"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{client.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {client.phone || "sin teléfono"} {client.email ? `· ${client.email}` : ""}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold tabular-nums">
                        ${client.spent.toLocaleString("es-AR")}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {client.visits} visitas · {client.lastVisit ?? "sin visitas"}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {newClientOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl bg-background ring-1 ring-white/10 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <div className="text-lg font-display font-semibold">Nuevo cliente</div>
                <div className="text-xs text-muted-foreground">
                  Guardá un cliente real en la base de datos.
                </div>
              </div>
              <button
                onClick={() => setNewClientOpen(false)}
                className="rounded-full px-3 py-1.5 text-sm bg-white/5 hover:bg-white/10 transition"
              >
                Cerrar
              </button>
            </div>

            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Nombre *</label>
                <input
                  value={newClient.name}
                  onChange={(e) => setNewClient((v) => ({ ...v, name: e.target.value }))}
                  className="mt-1 w-full rounded-xl bg-white/5 ring-1 ring-white/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-violet-400/40"
                  placeholder="Nombre y apellido"
                />
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Teléfono</label>
                  <input
                    value={newClient.phone}
                    onChange={(e) => setNewClient((v) => ({ ...v, phone: e.target.value }))}
                    className="mt-1 w-full rounded-xl bg-white/5 ring-1 ring-white/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-violet-400/40"
                    placeholder="WhatsApp"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Email</label>
                  <input
                    value={newClient.email}
                    onChange={(e) => setNewClient((v) => ({ ...v, email: e.target.value }))}
                    className="mt-1 w-full rounded-xl bg-white/5 ring-1 ring-white/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-violet-400/40"
                    placeholder="email@cliente.com"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Fecha de nacimiento</label>
                <input
                  type="date"
                  value={newClient.birth_date}
                  onChange={(e) => setNewClient((v) => ({ ...v, birth_date: e.target.value }))}
                  className="mt-1 w-full rounded-xl bg-white/5 ring-1 ring-white/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-violet-400/40"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Notas</label>
                <textarea
                  value={newClient.notes}
                  onChange={(e) => setNewClient((v) => ({ ...v, notes: e.target.value }))}
                  className="mt-1 w-full min-h-[90px] rounded-xl bg-white/5 ring-1 ring-white/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-violet-400/40"
                  placeholder="Preferencias, observaciones, etc."
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
              <button
                onClick={() => setNewClientOpen(false)}
                className="rounded-xl px-4 py-2 text-sm bg-white/5 hover:bg-white/10 transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateClient}
                disabled={saveClient.isPending}
                className="rounded-xl px-4 py-2 text-sm font-semibold bg-gradient-to-r from-sky-400 to-violet-500 text-background hover:brightness-110 transition disabled:opacity-60"
              >
                {saveClient.isPending ? "Guardando…" : "Guardar cliente"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
