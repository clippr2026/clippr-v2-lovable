import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, EyeOff, Eye, Loader2, Pencil, Plus, Star, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { SectionCard, ConfirmDialog, Field, inputCls } from "@/components/settings/shared";

type ReviewStatus = "pending" | "published" | "hidden";
type ReviewRow = {
  id: string;
  professional_id: string | null;
  client_name: string;
  rating: number;
  comment: string | null;
  review_date: string;
  status: ReviewStatus;
  source: "manual" | "page";
  origin_note: string | null;
  created_at: string;
};
type Barber = { id: string; full_name: string };

const MAX_MANUAL = 50;
const TABS: { key: ReviewStatus; label: string }[] = [
  { key: "pending", label: "Pendientes" },
  { key: "published", label: "Publicadas" },
  { key: "hidden", label: "Ocultas" },
];

function todayAR(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

function Stars({ value, onChange, size = 18 }: { value: number; onChange?: (n: number) => void; size?: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(n)}
          className={cn(onChange ? "cursor-pointer" : "cursor-default")}
          aria-label={`${n} estrellas`}
        >
          <Star
            style={{ width: size, height: size }}
            className={n <= value ? "fill-amber-400 text-amber-400" : "text-white/25"}
          />
        </button>
      ))}
    </span>
  );
}

type Draft = {
  id: string | null;
  client_name: string;
  rating: number;
  comment: string;
  professional_id: string;
  review_date: string;
  origin_note: string;
};

const emptyDraft = (): Draft => ({
  id: null,
  client_name: "",
  rating: 5,
  comment: "",
  professional_id: "",
  review_date: todayAR(),
  origin_note: "",
});

export function ResenasSection() {
  const { businessId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [tab, setTab] = useState<ReviewStatus>("pending");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<ReviewRow | null>(null);

  const load = useCallback(async () => {
    if (!businessId) return;
    const [rv, em] = await Promise.all([
      (supabase.from("reviews" as any) as any)
        .select("id,professional_id,client_name,rating,comment,review_date,status,source,origin_note,created_at")
        .eq("business_id", businessId)
        .order("review_date", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase.from("employees").select("id,full_name").eq("business_id", businessId).order("full_name"),
    ]);
    if (rv.error) toast.error("No se pudieron cargar las reseñas");
    setRows((rv.data ?? []) as ReviewRow[]);
    setBarbers(((em.data ?? []) as Barber[]).filter((b) => b.full_name));
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    void load();
  }, [load]);

  const barberName = useMemo(() => new Map(barbers.map((b) => [b.id, b.full_name])), [barbers]);
  const counts = useMemo(
    () => ({
      pending: rows.filter((r) => r.status === "pending").length,
      published: rows.filter((r) => r.status === "published").length,
      hidden: rows.filter((r) => r.status === "hidden").length,
    }),
    [rows],
  );
  const manualCount = rows.filter((r) => r.source === "manual").length;
  const published = rows.filter((r) => r.status === "published");
  const avg = published.length ? published.reduce((s, r) => s + r.rating, 0) / published.length : null;
  const visible = rows.filter((r) => r.status === tab);

  async function setStatus(r: ReviewRow, status: ReviewStatus) {
    const { error } = await (supabase.from("reviews" as any) as any)
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", r.id);
    if (error) return toast.error("No se pudo actualizar la reseña");
    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, status } : x)));
    toast.success(status === "published" ? "Reseña publicada" : status === "hidden" ? "Reseña oculta" : "Reseña pendiente");
  }

  async function remove(r: ReviewRow) {
    const { error } = await (supabase.from("reviews" as any) as any).delete().eq("id", r.id);
    setToDelete(null);
    if (error) return toast.error("No se pudo borrar la reseña");
    setRows((prev) => prev.filter((x) => x.id !== r.id));
    toast.success("Reseña borrada");
  }

  async function saveDraft() {
    if (!draft || !businessId) return;
    const name = draft.client_name.trim();
    if (!name) return toast.error("Poné el nombre del cliente");
    if (draft.review_date > todayAR()) return toast.error("La fecha no puede ser futura");
    setSaving(true);
    const payload = {
      client_name: name.slice(0, 80),
      rating: draft.rating,
      comment: draft.comment.trim() ? draft.comment.trim().slice(0, 600) : null,
      professional_id: draft.professional_id || null,
      review_date: draft.review_date,
      origin_note: draft.origin_note.trim() ? draft.origin_note.trim().slice(0, 60) : null,
    };
    const q = draft.id
      ? (supabase.from("reviews" as any) as any)
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", draft.id)
      : (supabase.from("reviews" as any) as any).insert({
          ...payload,
          business_id: businessId,
          source: "manual",
          status: "published",
        });
    const { error } = await q;
    setSaving(false);
    if (error) return toast.error(error.message || "No se pudo guardar la reseña");
    toast.success(draft.id ? "Reseña actualizada" : "Reseña cargada y publicada");
    setDraft(null);
    setTab("published");
    void load();
  }

  if (loading) {
    return (
      <div className="grid place-items-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-white/60" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionCard
        label="Reseñas"
        headerRight={
          <button
            type="button"
            disabled={manualCount >= MAX_MANUAL}
            onClick={() => setDraft(emptyDraft())}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" /> Cargar reseña
          </button>
        }
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="text-3xl font-bold">{avg ? avg.toFixed(1).replace(".", ",") : "—"}</span>
            <Stars value={Math.round(avg ?? 0)} size={16} />
          </div>
          <div className="text-xs text-white/55">
            {published.length} publicadas · {counts.pending} pendientes · cargadas por vos {manualCount}/{MAX_MANUAL}
          </div>
        </div>
        <p className="mt-3 text-xs text-white/50">
          Las reseñas que dejan los clientes desde tu página llegan como pendientes: se publican cuando las aprobás. Las que cargás vos se
          publican al guardarlas. Cada cliente puede dejar una reseña por barbero con el que se atendió.
        </p>
      </SectionCard>

      <div className="grid grid-cols-3 gap-1 rounded-2xl border border-white/10 bg-white/[0.035] p-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "rounded-xl px-2 py-2 text-xs font-semibold transition sm:text-sm",
              tab === t.key
                ? "bg-gradient-to-r from-sky-400 to-violet-500 text-white"
                : "text-muted-foreground hover:bg-white/[0.08] hover:text-foreground",
            )}
          >
            {t.label} ({counts[t.key]})
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-white/50">
          {tab === "pending" ? "No hay reseñas pendientes." : tab === "published" ? "Todavía no hay reseñas publicadas." : "No hay reseñas ocultas."}
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((r) => (
            <div key={r.id} className="glass rounded-2xl p-4 ring-1 ring-white/5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{r.client_name}</span>
                    {r.professional_id && barberName.get(r.professional_id) ? (
                      <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-white/70 ring-1 ring-white/10">
                        Para {barberName.get(r.professional_id)}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <Stars value={r.rating} size={15} />
                    <span className="text-xs text-white/45">{r.review_date}</span>
                  </div>
                </div>
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/50">
                  {r.source === "page" ? "Desde la página" : r.origin_note ? `Cargada · ${r.origin_note}` : "Cargada por vos"}
                </span>
              </div>
              {r.comment ? <p className="mt-2 text-sm text-white/80">"{r.comment}"</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {r.status !== "published" && (
                  <button
                    type="button"
                    onClick={() => setStatus(r, "published")}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/90 px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    {r.status === "pending" ? <Check className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    {r.status === "pending" ? "Aprobar" : "Publicar"}
                  </button>
                )}
                {r.status !== "hidden" && (
                  <button
                    type="button"
                    onClick={() => setStatus(r, "hidden")}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-xs font-semibold ring-1 ring-white/10 hover:bg-white/10"
                  >
                    <EyeOff className="h-3.5 w-3.5" /> Ocultar
                  </button>
                )}
                {r.source === "manual" && (
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        id: r.id,
                        client_name: r.client_name,
                        rating: r.rating,
                        comment: r.comment ?? "",
                        professional_id: r.professional_id ?? "",
                        review_date: r.review_date,
                        origin_note: r.origin_note ?? "",
                      })
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-xs font-semibold ring-1 ring-white/10 hover:bg-white/10"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Editar
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setToDelete(r)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 ring-1 ring-red-500/20 hover:bg-red-500/20"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Borrar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {draft ? (
        <div className="fixed inset-0 z-[300] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setDraft(null)}>
          <div
            className="max-h-[92vh] w-full max-w-md space-y-4 overflow-y-auto rounded-3xl border border-white/10 bg-[#0d0b14] p-5 text-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">{draft.id ? "Editar reseña" : "Cargar reseña"}</h3>
              <button type="button" onClick={() => setDraft(null)} className="rounded-full p-1.5 hover:bg-white/10" aria-label="Cerrar">
                <X className="h-4 w-4" />
              </button>
            </div>
            <Field label="Nombre del cliente">
              <input
                className={inputCls}
                value={draft.client_name}
                maxLength={80}
                placeholder="Ej: Mateo A."
                onChange={(e) => setDraft({ ...draft, client_name: e.target.value })}
              />
            </Field>
            <Field label="Estrellas">
              <Stars value={draft.rating} onChange={(n) => setDraft({ ...draft, rating: n })} size={28} />
            </Field>
            <Field label="Comentario">
              <textarea
                className={cn(inputCls, "min-h-[90px] resize-y")}
                value={draft.comment}
                maxLength={600}
                placeholder="Tal cual lo escribió el cliente"
                onChange={(e) => setDraft({ ...draft, comment: e.target.value })}
              />
            </Field>
            <Field label="Barbero (opcional)">
              <select
                className={inputCls}
                value={draft.professional_id}
                onChange={(e) => setDraft({ ...draft, professional_id: e.target.value })}
              >
                <option value="">Sin barbero</option>
                {barbers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.full_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Fecha de la reseña" hint="Poné la fecha original de la reseña. No puede ser futura.">
              <input
                type="date"
                className={inputCls}
                value={draft.review_date}
                max={todayAR()}
                onChange={(e) => setDraft({ ...draft, review_date: e.target.value })}
              />
            </Field>
            <Field label="Nota privada (opcional)" hint="Solo la ves vos. Por ejemplo: Google, WhatsApp, Instagram.">
              <input
                className={inputCls}
                value={draft.origin_note}
                maxLength={60}
                onChange={(e) => setDraft({ ...draft, origin_note: e.target.value })}
              />
            </Field>
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveDraft()}
              className="w-full rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? "Guardando…" : draft.id ? "Guardar cambios" : "Cargar y publicar"}
            </button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(toDelete)}
        title="Borrar reseña"
        message="Se borra para siempre y deja de verse en tu página. Si la dejó un cliente desde la página, ese cliente va a poder volver a escribirla. ¿Seguro?"
        confirmLabel="Borrar"
        onConfirm={() => toDelete && void remove(toDelete)}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
