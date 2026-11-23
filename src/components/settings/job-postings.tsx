import * as React from "react";
import { createPortal } from "react-dom";
import { Clock, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Toggle } from "@/components/settings/shared";
import { cn } from "@/lib/utils";
import { BolsaTabs, type BolsaTab } from "@/components/settings/bolsa-tabs";

type Posting = {
  id: string;
  title: string;
  description: string | null;
  schedule: string | null;
  is_active: boolean;
  kind: "empleo" | "alquiler";
  price: string | null;
};

const inputCls =
  "h-14 w-full min-w-0 rounded-2xl border border-white/10 bg-black/30 px-4 text-lg font-semibold text-white placeholder:text-white/35 focus:border-violet-400/50 focus:outline-none";
const cardStyle: React.CSSProperties = {
  backgroundImage:
    "radial-gradient(110% 90% at 100% 0%, rgba(79,125,255,.16), transparent 62%), radial-gradient(90% 80% at 0% 100%, rgba(139,92,246,.12), transparent 65%)",
};

const EMPTY = { kind: "empleo" as "empleo" | "alquiler", price: "", title: "", schedule: "", description: "" };

// Avisos del negocio (personal o alquiler de puestos): crear, pausar, editar, borrar.
export function JobPostingsButton({ open = false, onClose = () => {}, onSelectTab, inline = false }: { open?: boolean; onClose?: () => void; onSelectTab: (t: BolsaTab) => void; inline?: boolean }) {
  const { businessId } = useAuth();
  const setOpen = (v: boolean) => {
    if (!v) onClose();
  };
  const wrap = (n: React.ReactNode, _t?: unknown) => (inline ? n : createPortal(n, document.body));
  const [rows, setRows] = React.useState<Posting[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [editing, setEditing] = React.useState<string | "new" | null>(null);
  const [form, setForm] = React.useState(EMPTY);
  const [saving, setSaving] = React.useState(false);
  const [askKind, setAskKind] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("job_postings")
      .select("id,title,description,schedule,is_active,kind,price")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false });
    setRows((data as Posting[] | null) ?? []);
    setLoading(false);
  }, [businessId]);

  React.useEffect(() => {
    if (open || inline) void load();
  }, [open, inline, load]);

  function startEdit(p: Posting | null) {
    setEditing(p ? p.id : "new");
    setAskKind(!p);
    setForm(
      p
        ? { kind: p.kind, price: p.price ?? "", title: p.title, schedule: p.schedule ?? "", description: p.description ?? "" }
        : EMPTY,
    );
  }

  async function save() {
    if (!businessId) return;
    if (!form.title.trim()) return toast.error("Ingresá un título");
    setSaving(true);
    const payload = {
      kind: form.kind,
      price: form.kind === "alquiler" ? form.price.trim() || null : null,
      title: form.title.trim(),
      schedule: form.schedule.trim() || null,
      description: form.description.trim() || null,
    };
    let error: unknown = null;
    if (editing === "new") {
      const { data: biz } = await supabase.from("businesses").select("name").eq("id", businessId).maybeSingle();
      ({ error } = await (supabase as any)
        .from("job_postings")
        .insert({ ...payload, business_id: businessId, business_name: (biz as { name?: string } | null)?.name || "Barbería" }));
    } else {
      ({ error } = await (supabase as any).from("job_postings").update(payload).eq("id", editing));
    }
    setSaving(false);
    if (error) return toast.error("No se pudo guardar el aviso");
    toast.success("Aviso guardado");
    setEditing(null);
    void load();
  }

  async function toggleActive(p: Posting, v: boolean) {
    setRows((cur) => cur.map((r) => (r.id === p.id ? { ...r, is_active: v } : r)));
    const { error } = await (supabase as any).from("job_postings").update({ is_active: v }).eq("id", p.id);
    if (error) {
      toast.error("No se pudo cambiar el aviso");
      void load();
    }
  }

  async function remove(p: Posting) {
    if (!window.confirm(`¿Borrar el aviso "${p.title}"?`)) return;
    const { error } = await (supabase as any).from("job_postings").delete().eq("id", p.id);
    if (error) return toast.error("No se pudo borrar el aviso");
    setRows((cur) => cur.filter((r) => r.id !== p.id));
  }

  return (
    <>

      {(open || inline) &&
        typeof document !== "undefined" &&
        wrap(
          <div
            className={inline ? "" : "fixed inset-0 z-[9999] flex items-start justify-center overflow-hidden bg-black/85 p-4 pt-[calc(24px+env(safe-area-inset-top,0px))] pb-[calc(0.25rem+env(safe-area-inset-bottom,0px))] lg:pb-4"}
            onClick={() => !saving && setOpen(false)}
          >
            <div
              className={inline ? "flex w-full flex-col overflow-hidden rounded-2xl bg-[oklch(0.12_0.02_275)] ring-1 ring-white/10" : "relative flex max-h-[calc(100dvh-24px-env(safe-area-inset-top,0px)-0.25rem-env(safe-area-inset-bottom,0px))] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-[oklch(0.12_0.02_275)] shadow-2xl ring-1 ring-white/10"}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={cn("shrink-0 items-center justify-between border-b border-white/5 px-5 py-4", inline && !editing ? "hidden" : "flex")}>
                <h3 className="font-display text-lg font-semibold">{editing ? (editing === "new" ? "Nuevo aviso" : "Editar aviso") : "Bolsa de trabajo"}</h3>
                <button
                  type="button"
                  onClick={() => (editing ? setEditing(null) : setOpen(false))}
                  aria-label="Cerrar"
                  className="-mr-2 grid h-12 w-12 place-items-center rounded-full text-white/80"
                >
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>

              {!editing && <BolsaTabs active="avisos" onSelect={onSelectTab} />}
              <div className={inline ? "px-3.5 py-3" : "min-h-0 flex-1 overflow-y-auto px-3.5 py-3"}>
                {editing ? (
                  <div className="space-y-4 rounded-2xl border border-white/20 bg-white/[0.08] p-4" style={cardStyle}>
                    {askKind && (
                      <div className="space-y-3">
                        <div className="text-lg font-semibold">¿Qué querés publicar?</div>
                        {([["empleo", "Busco personal", "Para sumar a alguien a tu equipo"], ["alquiler", "Alquilo un puesto", "Un lugar de trabajo en tu local"]] as const).map(([id, label, hint]) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => {
                              setForm({ ...form, kind: id });
                              setAskKind(false);
                            }}
                            className="block w-full rounded-2xl border border-white/15 bg-black/25 px-4 py-4 text-left transition active:scale-[0.99]"
                          >
                            <span className="block text-xl font-semibold">{label}</span>
                            <span className="block text-base text-white/60">{hint}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {!askKind && (
                    <>
                    <div className="inline-flex rounded-full bg-violet-500/20 px-4 py-1.5 text-base font-semibold text-violet-100 ring-1 ring-violet-400/30">
                      {form.kind === "alquiler" ? "Alquilo un puesto" : "Busco personal"}
                    </div>
                    <label className="block">
                      <span className="mb-1.5 block text-base font-semibold text-white/85">Título</span>
                      <input value={form.title} maxLength={80} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={form.kind === "alquiler" ? "Ej: Puesto disponible" : "Ej: Busco personal para el turno tarde"} className={inputCls} />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 flex items-center gap-2 text-base font-semibold text-white/85">
                        <Clock className="h-5 w-5 text-violet-300" /> Horario
                      </span>
                      <input value={form.schedule} maxLength={80} onChange={(e) => setForm({ ...form, schedule: e.target.value })} placeholder="Ej: Lunes a sábado de 10 a 19" className={inputCls} />
                    </label>
                    {form.kind === "alquiler" && (
                      <label className="block">
                        <span className="mb-1.5 block text-base font-semibold text-white/85">Precio</span>
                        <input value={form.price} maxLength={40} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="Ej: $150.000 por mes" className={inputCls} />
                      </label>
                    )}
                    <label className="block">
                      <span className="mb-1.5 block text-base font-semibold text-white/85">Detalles (opcional)</span>
                      <textarea
                        value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.target.value.slice(0, 300) })}
                        rows={3}
                        placeholder="Pago, beneficios, lo que buscás"
                        className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-lg font-semibold text-white placeholder:text-white/35 focus:border-violet-400/50 focus:outline-none"
                      />
                      <div className="mt-1 text-right text-sm text-white/50">{form.description.length}/300</div>
                    </label>
                    </>
                    )}
                  </div>
                ) : loading ? (
                  <div className="py-10 text-center text-white/60">Cargando…</div>
                ) : rows.length === 0 ? (
                  <div className="py-10 text-center text-lg text-white/60">Todavía no publicaste avisos.</div>
                ) : (
                  <div className="space-y-3">
                    {rows.map((p) => (
                      <div key={p.id} className={cn("rounded-2xl border border-white/10 bg-white/[0.03] p-4", !p.is_active && "opacity-60")} style={cardStyle}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-2">
                            <span
                              className={cn(
                                "inline-flex rounded-full px-3 py-1 text-sm font-semibold ring-1",
                                p.kind === "alquiler" ? "bg-emerald-400/15 text-emerald-200 ring-emerald-300/30" : "bg-violet-500/20 text-violet-100 ring-violet-400/40",
                              )}
                            >
                              {p.kind === "alquiler" ? "Alquiler" : "Personal"}
                            </span>
                            <div className="text-xl font-semibold">{p.title}</div>
                          </div>
                          <Toggle on={p.is_active} onChange={(v) => void toggleActive(p, v)} />
                        </div>
                        <div className="mt-3 flex gap-2">
                          <button type="button" onClick={() => startEdit(p)} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full border border-violet-400/40 bg-violet-500/15 text-base font-semibold text-violet-100">
                            <Pencil className="h-4 w-4" /> Editar
                          </button>
                          <button type="button" onClick={() => void remove(p)} aria-label="Borrar aviso" className="grid h-11 w-11 place-items-center rounded-full border border-red-400/40 bg-red-500/15 text-red-100">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className={cn("shrink-0 items-center gap-2 border-t border-white/10 px-4 pb-1.5 pt-3", editing && askKind ? "hidden" : "flex")}>
                {editing ? (
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={saving}
                    className="h-12 flex-1 rounded-2xl bg-gradient-to-r from-sky-400 to-violet-500 text-base font-bold text-white shadow-[0_6px_22px_-4px_rgba(124,92,255,0.9)] transition active:scale-95 disabled:opacity-50"
                  >
                    {saving ? "Guardando…" : "Guardar"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => startEdit(null)}
                    className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-sky-400 to-violet-500 text-base font-bold text-white shadow-[0_6px_22px_-4px_rgba(124,92,255,0.9)] transition active:scale-95"
                  >
                    <Plus className="h-5 w-5" /> Nuevo aviso
                  </button>
                )}
              </div>
            </div>
          </div>,
        )}
    </>
  );
}
