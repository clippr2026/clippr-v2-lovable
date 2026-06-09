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
} from "@/hooks/use-clients-data";
import { useAuth } from "@/hooks/use-auth";
import {
  useClientesConfig,
  computeClientStatus,
  type ClientStatus,
  type ClientFieldKey,
} from "@/hooks/use-clientes-config";
import React from "react";

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

function statusBadge(s: ClientStatus) {
  const map = {
    vip:      { label: "VIP",      cls: "bg-gradient-to-r from-amber-300/20 to-violet-400/15 text-amber-100 ring-amber-300/40" },
    nuevo:    { label: "NUEVO",    cls: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30" },
    activo:   { label: "ACTIVO",   cls: "bg-cyan-400/10 text-cyan-300 ring-cyan-400/30" },
    inactivo: { label: "INACTIVO", cls: "bg-white/5 text-muted-foreground ring-white/10" },
    perdido:  { label: "PERDIDO",  cls: "bg-rose-400/10 text-rose-300 ring-rose-400/30" },
  } as const;
  const c = map[s];
  return <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-bold tracking-[0.18em] ring-1", c.cls)}>{c.label}</span>;
}

function Rating({ value }: { value: number }) {
  return (
    <div className="flex gap-[3px]">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className={cn("h-3 w-3", i < value ? "fill-violet-300 text-violet-300 drop-shadow-[0_0_4px_rgba(139,92,246,0.6)]" : "text-white/15")} />
      ))}
    </div>
  );
}

function StatCard({ label, value, caption, link, onLinkClick, icon, glow, featured }: {
  label: string; value: string; caption: React.ReactNode; link?: string;
  onLinkClick?: () => void; icon: React.ReactNode; glow: string; featured?: boolean;
}) {
  return (
    <div className={cn("glass relative overflow-hidden rounded-2xl p-3 sm:p-4 group transition-all hover:-translate-y-0.5 hover:ring-white/20", featured && "ring-1 ring-violet-400/30 shadow-[0_0_60px_-20px_rgba(139,92,246,0.45)]")}>
      <div className={cn("pointer-events-none absolute -top-20 -right-16 h-40 w-40 rounded-full blur-3xl opacity-70", glow)} />
      <div className="relative flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.18em] text-muted-foreground/90 truncate">{label}</div>
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="text-2xl sm:text-3xl font-display font-light leading-none tracking-tight">{value}</div>
          <div className="text-xl sm:text-2xl opacity-90 shrink-0">{icon}</div>
        </div>
        <div className="text-[11px] text-muted-foreground leading-snug">{caption}</div>
        {link && <button onClick={onLinkClick} className="mt-0.5 inline-flex items-center gap-1 self-start text-[9px] sm:text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300/90 hover:text-violet-200 transition-colors">{link} <ArrowRight className="h-3 w-3" /></button>}
      </div>
    </div>
  );
}

// ── Field input helper ────────────────────────────────────────────────────────

function FieldInput({
  fieldKey, label, required, value, onChange, type = "text",
}: {
  fieldKey: ClientFieldKey;
  label: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block text-xs text-muted-foreground">
      {label}{required && " *"}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl bg-white/5 ring-1 ring-white/10 px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-violet-400/40"
        placeholder={fieldKey === "instagram" ? "@usuario" : fieldKey === "direccion" ? "Dirección completa" : ""}
      />
    </label>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function ClientsPage() {
  const { businessId } = useAuth();
  const { data: rawClients = [], isLoading } = useClientsData(businessId);
  const saveClient = useSaveClient(businessId);
  const deleteClient = useDeleteClient(businessId);
  const updateNotes = useUpdateClientNotes(businessId);
  const { config: cfg, isFieldEnabled, enabledFields } = useClientesConfig(businessId);

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"gasto" | "recientes" | "nombre">("gasto");
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"resumen" | "historial">("resumen");
  const [newClientOpen, setNewClientOpen] = useState(false);
  const [clientMenuOpen, setClientMenuOpen] = useState(false);
  const [segmentModal, setSegmentModal] = useState<{ title: string; clients: (Client & { status: ClientStatus })[] } | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  // Dynamic new-client form state — all possible fields
  const [newClient, setNewClient] = useState({
    name: "", phone: "", email: "", birth_date: "",
    instagram: "", direccion: "", notes: "",
  });

  // Apply status using config-driven thresholds
  const clients = useMemo(() => {
    return rawClients.map((c) => {
      // Compute current-month visits & spend
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const monthVisits = c.history.filter((h) => h.date >= monthStart).length;
      const monthSpent  = c.history.filter((h) => h.date >= monthStart).reduce((s, h) => s + h.amount, 0);

      const status = computeClientStatus(
        {
          lastVisitDays: c.lastVisitDays ?? null,
          visits: c.visits,
          spent: c.spent,
          monthVisits,
          monthSpent,
        },
        cfg,
      );
      return { ...c, status };
    });
  }, [rawClients, cfg]);

  useEffect(() => { if (!selected && clients.length > 0) setSelected(clients[0].id); }, [clients, selected]);

  const filtered = useMemo(() => {
    let list = clients.filter((c) =>
      [c.name, c.phone, c.email].some((x) => (x ?? "").toLowerCase().includes(query.toLowerCase()))
    );
    if (sort === "gasto")    list = [...list].sort((a, b) => b.spent - a.spent);
    if (sort === "nombre")   list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "recientes") list = [...list].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return list;
  }, [clients, query, sort]);

  const counts = useMemo(() => ({
    vip:       clients.filter((c) => c.status === "vip").length,
    nuevos:    clients.filter((c) => c.status === "nuevo").length,
    activos:   clients.filter((c) => c.status === "activo" || c.status === "vip").length,
    inactivos: clients.filter((c) => c.status === "inactivo").length,
    perdidos:  clients.filter((c) => c.status === "perdido").length,
  }), [clients]);

  const current = clients.find((c) => c.id === selected) ?? null;
  useEffect(() => { setNoteDraft(current?.notes ?? ""); setClientMenuOpen(false); }, [current?.id, current?.notes]);
  const ticket  = current && current.visits ? Math.round(current.spent / current.visits) : 0;
  const avgDays = Math.round(
    clients.filter((c) => c.lastVisitDays != null).reduce((s, c) => s + Number(c.lastVisitDays ?? 0), 0) /
    Math.max(1, clients.filter((c) => c.lastVisitDays != null).length)
  );

  function showGroup(title: string, fn: (c: typeof clients[number]) => boolean) {
    setSegmentModal({ title, clients: clients.filter(fn) });
  }

  async function handleCreateClient() {
    if (!newClient.name.trim()) return toast.error("Ingresá el nombre del cliente");
    if (isFieldEnabled("telefono") && !newClient.phone.trim()) return toast.error("El teléfono es obligatorio");
    await saveClient.mutateAsync({
      name: newClient.name,
      phone: isFieldEnabled("telefono") ? newClient.phone : "",
      email: isFieldEnabled("email") ? newClient.email : "",
      birth_date: isFieldEnabled("fecha_nacimiento") ? newClient.birth_date : "",
      notes: [
        isFieldEnabled("notas") ? newClient.notes : "",
        isFieldEnabled("instagram") && newClient.instagram ? `Instagram: ${newClient.instagram}` : "",
        isFieldEnabled("direccion") && newClient.direccion ? `Dirección: ${newClient.direccion}` : "",
      ].filter(Boolean).join("\n").trim(),
    });
    toast.success("Cliente guardado");
    setNewClient({ name: "", phone: "", email: "", birth_date: "", instagram: "", direccion: "", notes: "" });
    setNewClientOpen(false);
  }

  async function handleDeleteClient(client: typeof clients[number]) {
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
      <Topbar
        title="Clientes"
        subtitle="Clientes y fidelización"
        action={
          <button
            onClick={() => setNewClientOpen(true)}
            className="h-10 px-4 rounded-xl text-white font-medium text-sm flex items-center gap-2 hover:brightness-110 transition"
            style={{ background: "linear-gradient(135deg, oklch(0.65 0.24 255), oklch(0.65 0.28 305))" }}
          >
            <Plus className="h-4 w-4" />Nuevo cliente
          </button>
        }
      />

      <div className="space-y-6 animate-fade-up">
        {/* Stats */}
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          <StatCard featured label="VIP"      value={String(counts.vip)}      caption="" link="Ver todos"   onLinkClick={() => showGroup("VIP",      (c) => c.status === "vip")}      icon={<Crown        className="h-7 w-7 text-violet-300"         />} glow="bg-violet-500/25" />
          <StatCard        label="Nuevos"     value={String(counts.nuevos)}   caption="" link="Ver todos"   onLinkClick={() => showGroup("Nuevos",    (c) => c.status === "nuevo")}    icon={<Sparkles     className="h-7 w-7 text-violet-300"         />} glow="bg-violet-400/20" />
          <StatCard        label="Frec. prom" value={avgDays ? String(avgDays) : "—"} caption="" icon={<CalendarDays className="h-7 w-7 text-cyan-300" />} glow="bg-cyan-400/20" />
          <StatCard        label="Activos"    value={String(counts.activos)}  caption="" link="Ver todos"   onLinkClick={() => showGroup("Activos",   (c) => c.status === "activo")}   icon={<CheckCircle2 className="h-7 w-7 text-emerald-300"      />} glow="bg-emerald-400/20" />
          <StatCard        label="Inactivos"  value={String(counts.inactivos)} caption="" link="Ver todos"  onLinkClick={() => showGroup("Inactivos", (c) => c.status === "inactivo")} icon={<PauseCircle  className="h-7 w-7 text-muted-foreground" />} glow="bg-white/10" />
          <StatCard        label="Perdidos"   value={String(counts.perdidos)} caption="" link="Reconquistar" onLinkClick={() => showGroup("Perdidos",  (c) => c.status === "perdido")}  icon={<AlertTriangle className="h-7 w-7 text-rose-300"        />} glow="bg-rose-400/20" />
        </div>

        <div className="grid gap-5 lg:grid-cols-[400px_1fr]">
          {/* Client list */}
          <div className="glass rounded-2xl p-4 flex flex-col gap-4 max-h-[82vh]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre, teléfono…"
                className="w-full rounded-xl bg-white/5 ring-1 ring-white/10 pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-violet-400/40" />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{filtered.length} clientes</span>
              <div className="flex items-center gap-2">
                <span>Ordenar:</span>
                <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}
                  className="rounded-md bg-white/5 ring-1 ring-white/10 px-2 py-1 text-foreground">
                  <option value="gasto">Mayor gasto</option>
                  <option value="recientes">Recientes</option>
                  <option value="nombre">Nombre</option>
                </select>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto pr-1 -mr-1 space-y-2">
              {filtered.map((c, i) => (
                <button key={c.id} onClick={() => setSelected(c.id)}
                  className={cn("w-full flex items-center gap-3 rounded-xl p-3 ring-1 transition text-left relative overflow-hidden",
                    selected === c.id ? "bg-gradient-to-r from-sky-500/15 via-violet-500/8 to-transparent ring-violet-400/40" : "bg-white/[0.02] ring-white/5 hover:bg-white/5")}>
                  <div className={cn("h-11 w-11 rounded-full grid place-items-center text-sm font-semibold bg-gradient-to-br ring-1", avatarTints[i % avatarTints.length])}>
                    {c.name[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium truncate">{c.name}</div>
                      <div className="text-sm font-semibold tabular-nums">${c.spent.toLocaleString("es-AR")}</div>
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">{c.visits} visitas · {c.lastVisit ?? "sin visitas"}</div>
                    <div className="flex items-center justify-between mt-1.5">
                      <Rating value={c.rating} />
                      {statusBadge(c.status)}
                    </div>
                  </div>
                </button>
              ))}
              {isLoading && <div className="text-center text-sm text-muted-foreground py-10 animate-pulse">Cargando clientes…</div>}
              {!isLoading && filtered.length === 0 && <div className="text-center text-sm text-muted-foreground py-10">Sin clientes para mostrar.</div>}
            </div>
          </div>

          {/* Client detail */}
          <div className={cn("glass rounded-2xl p-0 min-h-[60vh] overflow-hidden",
            current?.status === "perdido" && "ring-1 ring-rose-400/30",
            current?.status === "vip"     && "ring-1 ring-amber-300/30")}>
            {current ? (
              <div className="flex flex-col h-full">
                <div className={cn("relative p-6 border-b border-white/5 overflow-hidden",
                  current.status === "perdido" && "bg-rose-500/5",
                  current.status === "vip"     && "bg-amber-400/5")}>
                  <div className="relative flex items-start gap-5">
                    <div className="h-20 w-20 rounded-2xl grid place-items-center text-2xl font-display font-semibold bg-gradient-to-br from-sky-400/30 to-violet-600/10 ring-1 ring-violet-400/40 text-sky-100">
                      {current.name[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 text-2xl font-display font-semibold leading-tight">
                            {current.status === "perdido" && <AlertTriangle className="h-5 w-5 text-rose-300" />}
                            {current.status === "vip"     && <Crown className="h-5 w-5 text-amber-200" />}
                            {current.name}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                            {current.phone
                              ? <a href={whatsappHref(current.phone)} target="_blank" rel="noreferrer"
                                  className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-300 ring-1 ring-emerald-400/25 hover:bg-emerald-500/20 transition">
                                  <MessageCircle className="h-3.5 w-3.5" /> WhatsApp {current.phone}
                                </a>
                              : <span>sin teléfono</span>
                            }
                            {current.email && <><span>·</span><span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" /> {current.email}</span></>}
                          </div>
                        </div>
                        <div className="relative">
                          <button onClick={() => setClientMenuOpen((v) => !v)} className="rounded-full p-2 hover:bg-white/5 transition">
                            <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                          </button>
                          {clientMenuOpen && (
                            <div className="absolute right-0 top-9 z-20 w-44 rounded-xl bg-background/95 ring-1 ring-white/10 shadow-2xl p-1.5 backdrop-blur">
                              <button onClick={() => handleDeleteClient(current)}
                                className="w-full inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-rose-300 hover:bg-rose-500/10">
                                <Trash2 className="h-4 w-4" />Eliminar
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
                      <button key={t} onClick={() => setTab(t)}
                        className={cn("rounded-full px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] transition",
                          tab === t ? "bg-gradient-to-r from-sky-400 to-violet-500 text-background" : "text-muted-foreground hover:text-foreground")}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-6 flex-1 space-y-5">
                  {tab === "resumen" && (
                    <>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="rounded-xl bg-gradient-to-br from-sky-400/15 to-violet-500/8 ring-1 ring-violet-400/30 p-3">
                          <div className="text-[10px] uppercase tracking-[0.18em] text-violet-200/90">Lifetime value</div>
                          <div className="text-2xl font-display mt-1 tabular-nums">${current.spent.toLocaleString("es-AR")}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5 inline-flex items-center gap-1"><TrendingUp className="h-3 w-3 text-emerald-300" /> gasto total</div>
                        </div>
                        <div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-3">
                          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Visitas</div>
                          <div className="text-2xl font-display mt-1 tabular-nums">{current.visits}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">total histórico</div>
                        </div>
                        <div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-3">
                          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Ticket prom.</div>
                          <div className="text-2xl font-display mt-1 tabular-nums">${ticket.toLocaleString("es-AR")}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">por visita</div>
                        </div>
                        <div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-3">
                          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Última visita</div>
                          <div className="text-sm font-semibold mt-2">{current.lastVisit ?? "—"}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5 inline-flex items-center gap-1"><Clock3 className="h-3 w-3" /> {current.lastVisit ?? "sin visitas"}</div>
                        </div>
                      </div>
                      <div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-4">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Notas</div>
                        <textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)}
                          placeholder="Agregá notas internas del cliente..."
                          className="w-full min-h-[110px] rounded-xl bg-white/5 ring-1 ring-white/10 p-3 text-sm focus:outline-none focus:ring-violet-400/40" />
                        <div className="flex justify-end mt-3">
                          <button onClick={saveNotes} disabled={updateNotes.isPending}
                            className="rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 text-background px-4 py-2 text-sm font-semibold disabled:opacity-50">
                            {updateNotes.isPending ? "Guardando…" : "Guardar nota"}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                  {tab === "historial" && (
                    <div className="space-y-2">
                      {current.history.length === 0
                        ? <div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-4 text-sm text-muted-foreground">Sin historial de cobros todavía.</div>
                        : current.history.map((h) => (
                          <div key={h.id} className="flex items-center justify-between rounded-xl bg-white/5 ring-1 ring-white/10 p-3">
                            <div>
                              <div className="text-sm font-medium">{h.service}</div>
                              <div className="text-[11px] text-muted-foreground">{new Date(h.date).toLocaleString("es-AR")}</div>
                            </div>
                            <div className="text-sm font-semibold tabular-nums">${h.amount.toLocaleString("es-AR")}</div>
                          </div>
                        ))
                      }
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="h-full grid place-items-center p-6">
                <div className="text-center space-y-3">
                  <UserRound className="mx-auto h-8 w-8 text-muted-foreground" />
                  <div className="text-lg font-display">Seleccioná un cliente</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Nuevo cliente modal ── */}
      {newClientOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl bg-background ring-1 ring-white/10 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-white/5">
              <div>
                <div className="text-lg font-display font-semibold">Nuevo cliente</div>
                <div className="text-xs text-muted-foreground">Guardá un cliente real en la base de datos.</div>
              </div>
              <button onClick={() => setNewClientOpen(false)} className="rounded-full bg-white/5 px-3 py-1.5 text-sm">Cerrar</button>
            </div>

            <div className="p-5 space-y-3">
              {/* Nombre — always shown, always required */}
              <FieldInput fieldKey="nombre" label="Nombre" required value={newClient.name} onChange={(v) => setNewClient(s => ({ ...s, name: v }))} />

              {/* Teléfono — always shown, always required */}
              <FieldInput fieldKey="telefono" label="Teléfono" required value={newClient.phone} onChange={(v) => setNewClient(s => ({ ...s, phone: v }))} />

              {/* Conditional fields */}
              {isFieldEnabled("email") && (
                <FieldInput fieldKey="email" label="Email" type="email" value={newClient.email} onChange={(v) => setNewClient(s => ({ ...s, email: v }))} />
              )}
              {isFieldEnabled("fecha_nacimiento") && (
                <FieldInput fieldKey="fecha_nacimiento" label="Fecha de nacimiento" type="date" value={newClient.birth_date} onChange={(v) => setNewClient(s => ({ ...s, birth_date: v }))} />
              )}
              {isFieldEnabled("instagram") && (
                <FieldInput fieldKey="instagram" label="Instagram" value={newClient.instagram} onChange={(v) => setNewClient(s => ({ ...s, instagram: v }))} />
              )}
              {isFieldEnabled("direccion") && (
                <FieldInput fieldKey="direccion" label="Dirección" value={newClient.direccion} onChange={(v) => setNewClient(s => ({ ...s, direccion: v }))} />
              )}
              {isFieldEnabled("notas") && (
                <label className="block text-xs text-muted-foreground">
                  Notas
                  <textarea value={newClient.notes} onChange={(e) => setNewClient(s => ({ ...s, notes: e.target.value }))}
                    className="mt-1 w-full min-h-[80px] rounded-xl bg-white/5 ring-1 ring-white/10 px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-violet-400/40" />
                </label>
              )}
            </div>

            <div className="flex justify-end gap-2 p-5 border-t border-white/5">
              <button onClick={() => setNewClientOpen(false)} className="rounded-xl bg-white/5 px-4 py-2 text-sm">Cancelar</button>
              <button onClick={handleCreateClient} disabled={saveClient.isPending}
                className="rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 text-background px-4 py-2 text-sm font-semibold disabled:opacity-50">
                {saveClient.isPending ? "Guardando…" : "Guardar cliente"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Segment modal ── */}
      {segmentModal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl rounded-2xl bg-background ring-1 ring-white/10 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-white/5">
              <div className="text-lg font-display font-semibold">{segmentModal.title}</div>
              <button onClick={() => setSegmentModal(null)} className="rounded-full bg-white/5 px-3 py-1.5 text-sm">Cerrar</button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-3 space-y-2">
              {segmentModal.clients.length === 0
                ? <div className="p-8 text-center text-sm text-muted-foreground">No hay clientes en este grupo.</div>
                : segmentModal.clients.map((c) => (
                  <button key={c.id} onClick={() => { setSelected(c.id); setSegmentModal(null); }}
                    className="w-full flex items-center justify-between rounded-xl bg-white/5 ring-1 ring-white/10 p-3 text-left hover:bg-white/10">
                    <div>
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground">{c.phone || "sin teléfono"} · {c.lastVisit || "sin visitas"}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {statusBadge(c.status)}
                      <span className="text-sm font-semibold">${c.spent.toLocaleString("es-AR")}</span>
                    </div>
                  </button>
                ))
              }
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
