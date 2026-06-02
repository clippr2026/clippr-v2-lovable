import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
  Gift,
  Star,
  TrendingUp,
  Clock3,
  Filter,
  MoreHorizontal,
  Scissors,
  Heart,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useClientsData, useDeleteClient, type ClientStatus } from "@/hooks/use-clients-data";
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
  icon,
  glow,
  trend,
  featured,
}: {
  label: string;
  value: string;
  caption: React.ReactNode;
  link?: string;
  icon: React.ReactNode;
  glow: string;
  trend?: { val: string; up?: boolean };
  featured?: boolean;
}) {
  return (
    <div
      className={cn(
        "glass relative overflow-hidden rounded-2xl p-3 sm:p-4 group transition-all hover:-translate-y-0.5 hover:ring-white/20",
        featured && "ring-1 ring-violet-400/30 shadow-[0_0_60px_-20px_rgba(139,92,246,0.45)]"
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute -top-20 -right-16 h-40 w-40 rounded-full blur-3xl opacity-70 transition-opacity group-hover:opacity-100",
          glow
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
                  : "bg-rose-400/10 text-rose-300 ring-1 ring-rose-400/30"
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
          <div className="text-xl sm:text-2xl opacity-90 transition-transform group-hover:scale-110 shrink-0">{icon}</div>
        </div>
        <div className="text-[11px] text-muted-foreground leading-snug">{caption}</div>
        {link && (
          <button className="mt-0.5 inline-flex items-center gap-1 self-start text-[9px] sm:text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300/90 hover:text-violet-200 transition-colors">
            {link} <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
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
              : "text-white/15"
          )}
        />
      ))}
    </div>
  );
}

function statusBadge(s: ClientStatus) {
  const map = {
    vip: { label: "VIP", cls: "bg-violet-500/15 text-violet-200 ring-violet-400/40" },
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
        c.cls
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
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"gasto" | "recientes" | "nombre">("gasto");
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"resumen" | "historial" | "notas">("resumen");
  const [daysActive, setDaysActive] = useState(60);
  const [daysInactive, setDaysInactive] = useState(60);
  const [daysLost, setDaysLost] = useState(90);

  // Auto-select first client when data loads
  useMemo(() => {
    if (!selected && allClients.length > 0) setSelected(allClients[0].id);
  }, [allClients, selected]);

  const filtered = useMemo(() => {
    let list = allClients.filter((c) =>
      (c.name ?? "").toLowerCase().includes(query.toLowerCase()) ||
      (c.phone ?? "").toLowerCase().includes(query.toLowerCase()) ||
      (c.email ?? "").toLowerCase().includes(query.toLowerCase())
    );
    if (sort === "gasto") list = [...list].sort((a, b) => b.spent - a.spent);
    if (sort === "nombre") list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "recientes") list = [...list].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return list;
  }, [allClients, query, sort]);

  const counts = useMemo(
    () => ({
      vip: allClients.filter((c) => c.status === "vip").length,
      nuevos: allClients.filter((c) => c.status === "nuevo").length,
      activos: allClients.filter((c) => c.status === "activo").length,
      inactivos: allClients.filter((c) => c.status === "inactivo").length,
      perdidos: allClients.filter((c) => c.status === "perdido").length,
    }),
    [allClients]
  );

  const current = allClients.find((c) => c.id === selected) ?? null;
  const ticket = current && current.visits ? Math.round(current.spent / current.visits) : 0;

  const handleDeleteClient = async (clientId: string, clientName: string) => {
    const ok = window.confirm(`¿Eliminar cliente ${clientName}? Esta acción no se puede deshacer.`);
    if (!ok) return;
    await deleteClient.mutateAsync(clientId);
    if (selected === clientId) setSelected(null);
  };

  return (
    <AppShell>
      <Topbar title="Clientes" subtitle="Cartera, segmentación y reconquista" />
      <div className="space-y-6 animate-fade-up">
      {/* Stats grid */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        <StatCard
          featured
          label="Clientes VIP"
          value={String(counts.vip)}
          caption="mayor gasto + visitas"
          link="Ver todos"
          icon={<Crown className="h-7 w-7 text-violet-300" />}
          glow="bg-violet-500/25"
          trend={{ val: "+12%", up: true }}
        />
        <StatCard
          label="Clientes nuevos"
          value={String(counts.nuevos)}
          caption="ingresaron este mes"
          link="Ver todos"
          icon={<Sparkles className="h-7 w-7 text-violet-300" />}
          glow="bg-violet-400/20"
          trend={{ val: "+4", up: true }}
        />
        <StatCard
          label="Frecuencia promedio"
          value="42"
          caption="días entre visitas"
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
                onChange={(e) => setDaysActive(+e.target.value)}
                className="w-12 rounded-md bg-white/5 ring-1 ring-white/10 px-1.5 py-0.5 text-foreground text-center"
              />
              días
            </span>
          }
          link="Ver todos"
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
                onChange={(e) => setDaysInactive(+e.target.value)}
                className="w-12 rounded-md bg-white/5 ring-1 ring-white/10 px-1.5 py-0.5 text-foreground text-center"
              />
              días
            </span>
          }
          link="Ver todos"
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
                onChange={(e) => setDaysLost(+e.target.value)}
                className="w-12 rounded-md bg-white/5 ring-1 ring-white/10 px-1.5 py-0.5 text-foreground text-center"
              />
              días
            </span>
          }
          link="Reconquistar"
          icon={<AlertTriangle className="h-7 w-7 text-rose-300" />}
          glow="bg-rose-400/20"
          trend={{ val: "-2", up: false }}
        />
      </div>

      {/* List + Detail */}
      <div className="grid gap-5 lg:grid-cols-[400px_1fr]">
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
                  onClick={() => setSelected(c.id)}
                  className={cn(
                    "w-full flex items-center gap-3 rounded-xl p-3 ring-1 transition text-left relative overflow-hidden group",
                    active
                      ? "bg-gradient-to-r from-sky-500/15 via-violet-500/8 to-transparent ring-violet-400/40 shadow-[0_0_24px_-8px_rgba(139,92,246,0.5)]"
                      : "bg-white/[0.02] ring-white/5 hover:bg-white/5 hover:ring-white/10"
                  )}
                >
                  {active && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 h-8 w-[3px] rounded-r-full bg-gradient-to-b from-sky-300 to-violet-500" />
                  )}
                  <div className="relative">
                    <div
                      className={cn(
                        "h-11 w-11 rounded-full grid place-items-center text-sm font-semibold bg-gradient-to-br ring-1",
                        avatarTints[i % avatarTints.length]
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
                {allClients.length === 0 ? "Sin clientes registrados aún." : "No hay clientes con ese filtro"}
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
                      <button
                        onClick={() => handleDeleteClient(current.id, current.name)}
                        title="Eliminar cliente"
                        className="rounded-full p-2 hover:bg-rose-500/10 transition"
                      >
                        <MoreHorizontal className="h-4 w-4 text-muted-foreground hover:text-rose-300" />
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      {statusBadge(current.status)}
                      {current.notes && (
                        <span className="rounded-full bg-white/5 ring-1 ring-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                          nota
                        </span>
                      )}
                      <Rating value={current.rating} />
                    </div>
                  </div>
                </div>

              </div>

              {/* Tabs */}
              <div className="px-6 pt-4">
                <div className="inline-flex rounded-full bg-white/5 ring-1 ring-white/10 p-1">
                  {(["resumen", "historial", "notas"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      className={cn(
                        "rounded-full px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] transition",
                        tab === t
                          ? "bg-gradient-to-r from-sky-400 to-violet-500 text-background shadow"
                          : "text-muted-foreground hover:text-foreground"
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
                        <div className="text-[10px] uppercase tracking-[0.18em] text-violet-200/90">Lifetime value</div>
                        <div className="text-2xl font-display mt-1 tabular-nums">
                          ${current.spent.toLocaleString("es-AR")}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5 inline-flex items-center gap-1">
                          <TrendingUp className="h-3 w-3 text-emerald-300" /> Top 10%
                        </div>
                      </div>
                      <div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-3">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Visitas</div>
                        <div className="text-2xl font-display mt-1 tabular-nums">{current.visits}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">total histórico</div>
                      </div>
                      <div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-3">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Ticket prom.</div>
                        <div className="text-2xl font-display mt-1 tabular-nums">
                          ${ticket.toLocaleString("es-AR")}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">por visita</div>
                      </div>
                      <div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-3">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Última visita</div>
                        <div className="text-sm font-semibold mt-2">{current.lastVisit ?? "—"}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5 inline-flex items-center gap-1">
                          <Clock3 className="h-3 w-3" /> {current.lastVisit ? `Últ: ${current.lastVisit}` : "sin visitas"}
                        </div>
                      </div>
                    </div>

                  </>
                )}

                {tab === "historial" && (
                  <div className="space-y-2">
                    {[
                      { d: "12 Mar", s: "Color + corte", p: "Sol", m: 14500 },
                      { d: "20 Feb", s: "Brushing", p: "Mara", m: 6800 },
                      { d: "02 Feb", s: "Manicura", p: "Vale", m: 4200 },
                      { d: "18 Ene", s: "Color", p: "Sol", m: 12900 },
                    ].map((h, i) => (
                      <div key={i} className="flex items-center justify-between rounded-xl bg-white/5 ring-1 ring-white/10 p-3">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-lg bg-violet-500/15 ring-1 ring-violet-400/20 grid place-items-center text-violet-200">
                            <Scissors className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="text-sm font-medium">{h.s}</div>
                            <div className="text-[11px] text-muted-foreground">{h.d} · {h.p}</div>
                          </div>
                        </div>
                        <div className="text-sm font-semibold tabular-nums">${h.m.toLocaleString("es-AR")}</div>
                      </div>
                    ))}
                  </div>
                )}

                {tab === "notas" && (
                  <div className="space-y-3">
                    <textarea
                      placeholder="Agregá una nota privada sobre el cliente…"
                      className="w-full min-h-[120px] rounded-xl bg-white/5 ring-1 ring-white/10 p-3 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-violet-400/40"
                    />
                    <div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-3 text-sm text-muted-foreground">
                      Prefiere turnos a la mañana. Alérgica a amoníaco — usar línea sin.
                    </div>
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
    </AppShell>
  );
}

