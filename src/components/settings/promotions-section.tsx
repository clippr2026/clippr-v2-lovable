import React, { useState, useEffect, useCallback, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import {
  Plus,
  Trash2,
  Loader2,
  Tag,
  Image as ImageIcon,
  Camera,
  Info,
  Target,
  Percent,
  Ticket,
  CalendarClock,
  Gauge,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SectionCard,
  Toggle,
  ConfirmDialog,
  Field,
  inputCls,
  processImage,
} from "@/components/settings/shared";
import { DAY_KEYS, type DayKey } from "@/lib/availability";
import {
  type Promotion,
  type PromotionDiscountType,
  type PromoDaySchedule,
  getPromotionUsesRemaining,
  backfillPromotionVigencia,
} from "@/lib/service-pricing";

// Administrado por completo desde acá — Servicios (price_catalog) y Equipo
// (_employeeServiceOverrides) no se tocan ni se duplican, esta sección solo
// los referencia por id/categoría para saber a quién aplica cada promoción.

const DAY_LABELS: Record<DayKey, string> = {
  mon: "Lunes",
  tue: "Martes",
  wed: "Miércoles",
  thu: "Jueves",
  fri: "Viernes",
  sat: "Sábado",
  sun: "Domingo",
};
const WEEKDAYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function formatMoney(value: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);
}

// Ícono + texto coloreados para el label de cada SectionCard — refuerza la
// jerarquía visual sin tocar fondos ni la identidad general de Clippr.
function SectionLabel({
  icon: Icon,
  color,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", color)}>
      <Icon className="h-3.5 w-3.5" />
      <span>{children}</span>
    </span>
  );
}

function defaultDays(): Record<DayKey, PromoDaySchedule> {
  const days = {} as Record<DayKey, PromoDaySchedule>;
  for (const key of DAY_KEYS) days[key] = { enabled: true, start: "", end: "" };
  return days;
}

type ServiceOption = { id: string; name: string; category: string | null };
type EmployeeOption = { id: string; name: string };

type PromoForm = {
  name: string;
  imageUrl: string;
  description: string;
  active: boolean;
  discountType: PromotionDiscountType;
  discountValue: string;
  requiresCode: boolean;
  code: string;
  serviceIds: string[];
  categoryNames: string[];
  employeeIds: string[];
  hasVigencia: boolean;
  startDate: string;
  endDate: string;
  days: Record<DayKey, PromoDaySchedule>;
  useMaxTotal: boolean;
  maxUsesTotal: string;
  useMaxPerClient: boolean;
  maxUsesPerClient: string;
};

function emptyForm(allServiceIds: string[], allEmployeeIds: string[]): PromoForm {
  return {
    name: "",
    imageUrl: "",
    description: "",
    active: true,
    discountType: "percent",
    discountValue: "",
    requiresCode: false,
    code: "",
    serviceIds: [...allServiceIds],
    categoryNames: [],
    employeeIds: [...allEmployeeIds],
    hasVigencia: false,
    startDate: "",
    endDate: "",
    days: defaultDays(),
    useMaxTotal: false,
    maxUsesTotal: "",
    useMaxPerClient: false,
    maxUsesPerClient: "",
  };
}

// Misma construcción para guardar y para la vista previa en vivo — así la
// vista previa nunca puede desincronizarse de lo que realmente se guarda.
function buildPromoFromForm(f: PromoForm, editingPromo: Promotion | null): Promotion {
  return {
    id: editingPromo?.id ?? crypto.randomUUID(),
    name: f.name.trim(),
    imageUrl: f.imageUrl || null,
    description: f.description.trim(),
    active: f.active,
    discountType: f.discountType,
    discountValue: f.discountValue,
    requiresCode: f.requiresCode,
    code: f.code.trim().toUpperCase(),
    serviceIds: f.serviceIds,
    categoryNames: f.categoryNames,
    employeeIds: f.employeeIds,
    hasVigencia: f.hasVigencia,
    startDate: f.startDate,
    endDate: f.endDate,
    days: f.days,
    maxUsesTotal: f.useMaxTotal ? Math.max(0, Number(f.maxUsesTotal) || 0) : null,
    maxUsesPerClient: f.useMaxPerClient
      ? Math.max(0, Number(f.maxUsesPerClient) || 0)
      : null,
    usageCount: editingPromo?.usageCount ?? 0,
    usedByClient: editingPromo?.usedByClient ?? {},
  };
}

export function PromotionsSection() {
  const { businessId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  // Sin esto, el scroll de la pantalla de atrás seguía moviéndose (rubber-
  // band de iOS Safari) mientras el modal estaba abierto y al final del
  // formulario arrastraba todo el fondo. Restaura la posición exacta al
  // cerrar.
  useBodyScrollLock(modalOpen);
  const modalScrollRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (modalOpen) modalScrollRef.current?.scrollTo(0, 0);
  }, [modalOpen]);
  const [editing, setEditing] = useState<Promotion | null>(null);
  const [form, setForm] = useState<PromoForm>(emptyForm([], []));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDel, setConfirmDel] = useState<Promotion | null>(null);

  const load = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [{ data: svcData }, { data: empData }, { data: bsData }] = await Promise.all([
      supabase
        .from("price_catalog")
        .select("id,name,category")
        .eq("business_id", businessId)
        .not("duration_min", "is", null)
        .order("name"),
      supabase
        .from("employees")
        .select("id,full_name,is_active")
        .eq("business_id", businessId)
        .order("full_name"),
      supabase
        .from("business_settings")
        .select("schedule")
        .eq("business_id", businessId)
        .maybeSingle(),
    ]);
    setServices(
      ((svcData ?? []) as Array<{ id: string; name: string; category: string | null }>).map(
        (s) => ({ id: s.id, name: s.name, category: s.category }),
      ),
    );
    setEmployees(
      ((empData ?? []) as Array<{ id: string; full_name: string | null; is_active: boolean | null }>)
        .filter((e) => e.is_active !== false)
        .map((e) => ({ id: e.id, name: e.full_name ?? "Sin nombre" })),
    );
    const schedule = (bsData?.schedule ?? {}) as Record<string, unknown>;
    const raw = Array.isArray(schedule._promotions) ? (schedule._promotions as Promotion[]) : [];
    setPromotions(raw.map(backfillPromotionVigencia));
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  async function persist(next: Promotion[]): Promise<boolean> {
    if (!businessId) return false;
    const { data: existingRow } = await supabase
      .from("business_settings")
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle();
    const existingSchedule = (existingRow?.schedule ?? {}) as Record<string, unknown>;
    const { error } = await supabase.from("business_settings").upsert(
      {
        business_id: businessId,
        schedule: { ...existingSchedule, _promotions: next },
      },
      { onConflict: "business_id" },
    );
    if (error) {
      toast.error("No se pudo guardar: " + error.message);
      return false;
    }
    setPromotions(next);
    return true;
  }

  function openNew() {
    setEditing(null);
    setForm(emptyForm(services.map((s) => s.id), employees.map((e) => e.id)));
    setModalOpen(true);
  }

  function openEdit(promo: Promotion) {
    setEditing(promo);
    setForm({
      name: promo.name,
      imageUrl: promo.imageUrl ?? "",
      description: promo.description,
      active: promo.active,
      discountType: promo.discountType,
      discountValue: promo.discountValue,
      requiresCode: promo.requiresCode,
      code: promo.code,
      serviceIds: promo.serviceIds,
      categoryNames: promo.categoryNames,
      employeeIds: promo.employeeIds,
      hasVigencia: promo.hasVigencia,
      startDate: promo.startDate,
      endDate: promo.endDate,
      days: promo.days,
      useMaxTotal: promo.maxUsesTotal != null,
      maxUsesTotal: promo.maxUsesTotal != null ? String(promo.maxUsesTotal) : "",
      useMaxPerClient: promo.maxUsesPerClient != null,
      maxUsesPerClient:
        promo.maxUsesPerClient != null ? String(promo.maxUsesPerClient) : "",
    });
    setModalOpen(true);
  }

  async function handleImageUpload(file: File) {
    if (!businessId) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Subí una imagen JPG, PNG o WEBP");
      return;
    }
    setUploading(true);
    try {
      const { blob, ext, type } = await processImage(file, 800, 800, 0.7);
      const path = `${businessId}/promotions/${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("business-assets")
        .upload(path, blob, { upsert: true, contentType: type });
      if (error) {
        toast.error("No se pudo subir la imagen: " + error.message);
        return;
      }
      const { data } = supabase.storage.from("business-assets").getPublicUrl(path);
      if (data.publicUrl) {
        setForm((f) => ({ ...f, imageUrl: `${data.publicUrl}?v=${Date.now()}` }));
      }
    } catch (error) {
      toast.error((error as Error).message || "No se pudo procesar la imagen");
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!businessId) return;
    if (!form.name.trim()) return toast.error("Ingresá un nombre");
    if (!form.discountValue || Number(form.discountValue) <= 0)
      return toast.error("Ingresá un descuento válido");
    if (form.requiresCode && !form.code.trim())
      return toast.error("Ingresá un código");

    setSaving(true);
    const promo: Promotion = buildPromoFromForm(form, editing);
    const next = editing
      ? promotions.map((p) => (p.id === promo.id ? promo : p))
      : [...promotions, promo];
    const ok = await persist(next);
    setSaving(false);
    if (ok) {
      toast.success(editing ? "Promoción actualizada." : "Promoción creada.");
      setModalOpen(false);
    }
  }

  async function doDelete() {
    if (!confirmDel) return;
    const next = promotions.filter((p) => p.id !== confirmDel.id);
    setConfirmDel(null);
    const ok = await persist(next);
    if (ok) toast.success("Promoción eliminada.");
  }

  async function toggleActive(promo: Promotion) {
    const next = promotions.map((p) =>
      p.id === promo.id ? { ...p, active: !p.active } : p,
    );
    await persist(next);
  }

  function toggleInArray(
    field: "serviceIds" | "categoryNames" | "employeeIds",
    id: string,
  ) {
    setForm((f) => {
      const arr = f[field];
      const next = arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];
      return { ...f, [field]: next };
    });
  }

  function setDay(key: DayKey, patch: Partial<PromoDaySchedule>) {
    setForm((f) => ({ ...f, days: { ...f.days, [key]: { ...f.days[key], ...patch } } }));
  }

  if (loading) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin inline mr-2" />
        Cargando…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SectionCard label="Promociones">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="text-sm font-semibold">
            Promociones y códigos de descuento
          </div>
          <button
            type="button"
            onClick={openNew}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 px-3.5 py-2 text-sm font-semibold text-white"
          >
            <Plus className="h-4 w-4" /> Nueva promoción
          </button>
        </div>

        {promotions.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No hay promociones cargadas.
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {promotions.map((promo) => {
              const remaining = getPromotionUsesRemaining(promo);
              return (
                <div key={promo.id} className="flex items-center gap-3 py-3">
                  {promo.imageUrl ? (
                    <img
                      src={promo.imageUrl}
                      alt={promo.name}
                      className="h-11 w-11 shrink-0 rounded-xl object-cover ring-1 ring-white/10"
                    />
                  ) : (
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/5 ring-1 ring-white/10">
                      <Tag className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{promo.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {promo.discountType === "percent"
                        ? `${promo.discountValue}%`
                        : `$${Number(promo.discountValue || 0).toLocaleString("es-AR")}`}{" "}
                      de descuento
                      {promo.requiresCode ? ` · Código: ${promo.code}` : ""}
                      {remaining != null
                        ? ` · ${remaining} disponibles (${promo.usageCount} usados)`
                        : ""}
                    </div>
                  </div>
                  <Toggle on={promo.active} onChange={() => toggleActive(promo)} />
                  <button
                    type="button"
                    onClick={() => openEdit(promo)}
                    className="shrink-0 px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-white"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDel(promo)}
                    className="shrink-0 px-1 text-rose-400/70 hover:text-rose-300"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {modalOpen && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto bg-black/70 backdrop-blur-sm p-4 pt-[calc(24px+env(safe-area-inset-top,0px))] pb-[max(1rem,env(safe-area-inset-bottom,0px))] [overscroll-behavior:contain]"
          onClick={() => !saving && setModalOpen(false)}
        >
          {/* Portal a document.body: esta pantalla vive dentro del
              <div className="relative z-10"> de AppShell, que crea su
              propio contexto de apilamiento — ese contexto entero queda
              por debajo del header/bottom-nav de AppSidebar (sticky/fixed,
              z-40, hermanos de <main> a nivel raíz). Sin portal, ningún
              z-index de acá adentro podía ganarle a ese header (lo que el
              usuario veía como "tapado por el banner de Configuración").
              Mismo fix que el modal de info de Asesor IA.
              dvh, no vh: en Safari móvil vh se calcula sobre el viewport
              "grande" (sin descontar la barra de direcciones), así que con
              vh el modal podía terminar más alto que el espacio realmente
              visible y el footer quedaba tapado por la nav inferior. El
              padding-top del overlay usa 24px + safe-area (antes pegaba
              el modal justo contra el borde superior) — el max-height de
              acá abajo espeja exactamente esa misma reserva (arriba y
              abajo) para no restarla dos veces. */}
          <div
            className="relative flex h-[86dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-zinc-950 ring-1 ring-white/10 shadow-2xl [max-height:min(820px,calc(100dvh-24px-env(safe-area-inset-top,0px)-max(1rem,env(safe-area-inset-bottom,0px))))]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header fijo: solo título + subtítulo — el estado, el
                descuento, el código y la vigencia ya se editan dentro del
                formulario, no hace falta repetirlos acá arriba. */}
            <div className="shrink-0 border-b border-white/5 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">
                    {editing ? "Editar promoción" : "Nueva promoción"}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Configurá descuentos, códigos y condiciones de uso.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="shrink-0 rounded-full p-1.5 text-muted-foreground ring-1 ring-white/10 hover:bg-white/5"
                >
                  ✕
                </button>
              </div>
            </div>

            <div ref={modalScrollRef} className="flex-1 space-y-4 overflow-y-auto p-5">
              <SectionCard
                label={
                  <SectionLabel icon={Info} color="text-sky-300">
                    Información
                  </SectionLabel>
                }
              >
                <div className="space-y-3">
                  <Field label="Nombre">
                    <input
                      className={inputCls}
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="Promo UADE"
                    />
                  </Field>
                  <Field label="Imagen (opcional)">
                    <div className="flex items-center gap-3">
                      {form.imageUrl ? (
                        <img
                          src={form.imageUrl}
                          alt={form.name}
                          className="h-14 w-14 rounded-xl object-cover ring-1 ring-white/10"
                        />
                      ) : (
                        <div className="grid h-14 w-14 place-items-center rounded-xl bg-white/5 ring-1 ring-white/10">
                          <ImageIcon className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-white/5 px-3 py-2 text-xs ring-1 ring-white/10 hover:bg-white/10">
                        {uploading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Camera className="h-3.5 w-3.5" />
                        )}
                        Subir imagen
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void handleImageUpload(file);
                            e.currentTarget.value = "";
                          }}
                        />
                      </label>
                    </div>
                  </Field>
                  <Field label="Descripción">
                    <textarea
                      className={cn(inputCls, "min-h-[72px] resize-y")}
                      value={form.description}
                      onChange={(e) =>
                        setForm({ ...form, description: e.target.value.slice(0, 280) })
                      }
                      placeholder="Lo que va a ver el cliente al tocar el ícono de información"
                      maxLength={280}
                    />
                  </Field>
                </div>
              </SectionCard>

              <SectionCard
                label={
                  <SectionLabel icon={Target} color="text-emerald-300">
                    Aplicar a
                  </SectionLabel>
                }
              >
                <div className="space-y-3">
                  <div>
                    <div className="mb-1.5 text-xs font-semibold text-muted-foreground">
                      Servicios ({form.serviceIds.length})
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {services.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => toggleInArray("serviceIds", s.id)}
                          className={cn(
                            "rounded-full px-3 py-1 text-xs ring-1 transition",
                            form.serviceIds.includes(s.id)
                              ? "bg-primary/20 text-white ring-primary/40"
                              : "bg-white/5 text-muted-foreground ring-white/10",
                          )}
                        >
                          {s.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1.5 text-xs font-semibold text-muted-foreground">
                      Profesionales ({form.employeeIds.length})
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {employees.map((e) => (
                        <button
                          key={e.id}
                          type="button"
                          onClick={() => toggleInArray("employeeIds", e.id)}
                          className={cn(
                            "rounded-full px-3 py-1 text-xs ring-1 transition",
                            form.employeeIds.includes(e.id)
                              ? "bg-primary/20 text-white ring-primary/40"
                              : "bg-white/5 text-muted-foreground ring-white/10",
                          )}
                        >
                          {e.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </SectionCard>

              <SectionCard
                label={
                  <SectionLabel icon={Percent} color="text-amber-300">
                    Descuento
                  </SectionLabel>
                }
              >
                <div className="flex items-center gap-2">
                  <select
                    className={cn(inputCls, "w-auto")}
                    value={form.discountType}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        discountType: e.target.value as PromotionDiscountType,
                      })
                    }
                  >
                    <option value="percent">% de descuento</option>
                    <option value="fixed">Monto fijo ($)</option>
                  </select>
                  <input
                    type="number"
                    min={0}
                    className={inputCls}
                    value={form.discountValue}
                    onChange={(e) =>
                      setForm({ ...form, discountValue: e.target.value })
                    }
                    placeholder={form.discountType === "percent" ? "20" : "5000"}
                  />
                </div>
              </SectionCard>

              <SectionCard
                label={
                  <SectionLabel icon={Ticket} color="text-violet-300">
                    Código de descuento
                  </SectionLabel>
                }
              >
                <label className="flex cursor-pointer items-center justify-between">
                  <div className="text-sm font-medium">Requiere código</div>
                  <Toggle
                    on={form.requiresCode}
                    onChange={(v) => setForm({ ...form, requiresCode: v })}
                  />
                </label>
                {form.requiresCode && (
                  <input
                    className={cn(inputCls, "mt-3 uppercase")}
                    value={form.code}
                    onChange={(e) =>
                      setForm({ ...form, code: e.target.value.toUpperCase() })
                    }
                    placeholder="UADE20"
                  />
                )}
              </SectionCard>

              <SectionCard
                label={
                  <SectionLabel icon={CalendarClock} color="text-cyan-300">
                    Vigencia
                  </SectionLabel>
                }
                headerRight={
                  <Toggle
                    on={form.hasVigencia}
                    onChange={(v) => setForm({ ...form, hasVigencia: v })}
                  />
                }
              >
                {form.hasVigencia ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Desde">
                        <input
                          type="date"
                          className={inputCls}
                          value={form.startDate}
                          onChange={(e) =>
                            setForm({ ...form, startDate: e.target.value })
                          }
                        />
                      </Field>
                      <Field label="Hasta">
                        <input
                          type="date"
                          className={inputCls}
                          value={form.endDate}
                          onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                        />
                      </Field>
                    </div>
                    <div className="space-y-1.5">
                      {WEEKDAYS.map((key) => {
                        const d = form.days[key];
                        return (
                          <div
                            key={key}
                            className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-2.5 py-2 ring-1 ring-white/10"
                          >
                            <button
                              type="button"
                              onClick={() => setDay(key, { enabled: !d.enabled })}
                              className={cn(
                                "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                                d.enabled ? "bg-primary" : "bg-white/15",
                              )}
                            >
                              <span
                                className={cn(
                                  "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all",
                                  d.enabled ? "left-[18px]" : "left-0.5",
                                )}
                              />
                            </button>
                            <div className="w-20 text-xs">{DAY_LABELS[key]}</div>
                            {d.enabled && (
                              <>
                                <input
                                  type="time"
                                  value={d.start}
                                  onChange={(e) => setDay(key, { start: e.target.value })}
                                  className="rounded-md bg-white/5 px-2 py-1 text-xs ring-1 ring-white/10 focus:outline-none [color-scheme:dark]"
                                />
                                <span className="text-xs text-muted-foreground">a</span>
                                <input
                                  type="time"
                                  value={d.end}
                                  onChange={(e) => setDay(key, { end: e.target.value })}
                                  className="rounded-md bg-white/5 px-2 py-1 text-xs ring-1 ring-white/10 focus:outline-none [color-scheme:dark]"
                                />
                              </>
                            )}
                          </div>
                        );
                      })}
                      <p className="text-[11px] text-muted-foreground">
                        Dejá el horario vacío para que aplique todo el día.
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Sin fecha de inicio ni fin, y sin restricción de días u
                    horarios — la promoción queda vigente siempre que esté
                    activa. Activá este switch para configurar fechas, días y
                    horarios puntuales.
                  </p>
                )}
              </SectionCard>

              <SectionCard
                label={
                  <SectionLabel icon={Gauge} color="text-orange-300">
                    Límite de usos
                  </SectionLabel>
                }
              >
                <div className="space-y-3">
                  <label className="flex cursor-pointer items-center justify-between">
                    <div className="text-sm font-medium">Límite total de usos</div>
                    <Toggle
                      on={form.useMaxTotal}
                      onChange={(v) => setForm({ ...form, useMaxTotal: v })}
                    />
                  </label>
                  {form.useMaxTotal && (
                    <input
                      type="number"
                      min={1}
                      className={inputCls}
                      value={form.maxUsesTotal}
                      onChange={(e) =>
                        setForm({ ...form, maxUsesTotal: e.target.value })
                      }
                      placeholder="100"
                    />
                  )}
                  <label className="flex cursor-pointer items-center justify-between">
                    <div className="text-sm font-medium">Límite por cliente</div>
                    <Toggle
                      on={form.useMaxPerClient}
                      onChange={(v) => setForm({ ...form, useMaxPerClient: v })}
                    />
                  </label>
                  {form.useMaxPerClient && (
                    <input
                      type="number"
                      min={1}
                      className={inputCls}
                      value={form.maxUsesPerClient}
                      onChange={(e) =>
                        setForm({ ...form, maxUsesPerClient: e.target.value })
                      }
                      placeholder="1"
                    />
                  )}
                  {editing && (
                    <p className="text-xs text-muted-foreground">
                      {editing.usageCount} usos hasta ahora.
                    </p>
                  )}
                </div>
              </SectionCard>
            </div>

            <div
              className="flex shrink-0 items-center gap-2 border-t border-white/5 px-5 pt-4"
              style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
            >
              {editing && (
                <button
                  type="button"
                  onClick={() => {
                    setConfirmDel(editing);
                    setModalOpen(false);
                  }}
                  className="inline-flex items-center gap-2 rounded-xl bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-300 ring-1 ring-red-500/30 hover:bg-red-500/20"
                >
                  <Trash2 className="h-4 w-4" /> Eliminar
                </button>
              )}
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                disabled={saving}
                className="rounded-xl bg-white/5 px-4 py-2.5 text-sm ring-1 ring-white/10 hover:bg-white/10"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="inline-flex min-w-[140px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      <ConfirmDialog
        open={!!confirmDel}
        title="Eliminar promoción"
        message={`¿Deseás eliminar "${confirmDel?.name}"?`}
        onConfirm={doDelete}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  );
}
