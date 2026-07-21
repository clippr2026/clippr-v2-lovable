import React, { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import {
  Upload,
  Plus,
  Trash2,
  Instagram,
  GripVertical,
  Star,
  Loader2,
  Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { applyCatalogOrder as applyItemOrder } from "@/lib/catalog-order";
import { ServiceImage } from "@/components/ui/service-image";
import { ClipprLoader } from "@/components/ui/clippr-loader";
import {
  Toggle,
  ConfirmDialog,
  SectionCard,
  reportSaveStatus,
  processImage,
  markSettingsDirty,
  Field,
  inputCls,
  normalizePublicBooleanMap,
  getPublicVisibility,
  type PriceRow,
} from "@/components/settings/shared";

// ─────────── Servicios y Catálogo ───────────
type PriceForm = {
  name: string;
  price: string;
  discount: string;
  duration: string;
  status: "Activo" | "Inactivo";
  category: string;
  description: string;
  reservable: boolean;
  stock: string;
  warnStock: string;
  criticalStock: string;
  // Reservas online (solo catálogo)
  bookingShow: boolean;
  bookingOffer: string;
  miniDesc: string;
  // Imagen general (catálogo y servicios)
  image: string;
  imagePosition: string;
};

const emptyPriceForm = (
  category = "Servicios",
  isService = true,
): PriceForm => ({
  name: "",
  price: "0",
  discount: "0",
  duration: isService ? "30" : "",
  status: "Activo",
  category,
  description: "",
  reservable: true,
  stock: "0",
  warnStock: "0",
  criticalStock: "0",
  bookingShow: false,
  bookingOffer: "none",
  miniDesc: "",
  image: "",
  imagePosition: "50% 50%",
});

const defaultServiceCategories: string[] = [];
const serviceCategories = defaultServiceCategories;
const defaultCatalogCategories = ["Productos", "Bebidas", "Indumentaria"];

const MAX_CATEGORIES = 8;

// Reordena una lista arrastrando con Pointer Events (mouse, touch o pen) en
// vez de drag&drop nativo de HTML5 — el nativo no dispara en navegadores
// mobile, que es donde más se usa esta pantalla. En cada movimiento reubica
// el ítem según qué otro elemento tiene el centro más cercano al puntero;
// esa distancia 2D (no solo eje X o Y) resuelve también grids que arman
// varias filas (categorías) sin necesitar lógica de fila/columna aparte.
// `touch-action: none` en el handle evita que el gesto también scrollee la
// página mientras se arrastra.
//
// El elemento arrastrado sigue al dedo/mouse en tiempo real (transform
// imperativo, sin pasar por React en cada pixel — más fluido) y el resto de
// los ítems desliza a su nueva posición con una animación FLIP (se toma la
// posición ANTES de reordenar y se anima desde ahí) en vez de saltar
// instantáneo, para que se note claramente el hueco que se abre en destino.
function usePointerReorder<T>(
  items: T[],
  getId: (item: T) => string,
  onChange: (next: T[]) => void,
  onDragEnd: (finalItems: T[]) => void,
  // "x": el elemento arrastrado solo se desplaza horizontal (categorías,
  // en su misma fila). "y": solo vertical (ítems, dentro de su columna/
  // lista). Tanto el transform visual como el cálculo de "a qué posición
  // se mueve" quedan atados al mismo eje — así nunca se compara/salta
  // contra la distancia del eje que no debería importar.
  axis: "x" | "y",
  dragScale = 1.06,
) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const nodesRef = useRef(new Map<string, HTMLElement>());
  const rectsBeforeRef = useRef<Map<string, DOMRect>>(new Map());

  const setNodeRef = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) nodesRef.current.set(id, el);
      else nodesRef.current.delete(id);
    },
    [],
  );

  // FLIP de los ítems NO arrastrados: corre después de cada render (sin
  // deps — el check de tamaño de abajo lo hace barato en el caso común) y
  // solo hace algo cuando handleMove acaba de dejar un snapshot de
  // posiciones "antes" listo para animar.
  useLayoutEffect(() => {
    const before = rectsBeforeRef.current;
    if (before.size === 0) return;
    rectsBeforeRef.current = new Map();
    for (const it of items) {
      const id = getId(it);
      if (id === draggingIdRef.current) continue;
      const node = nodesRef.current.get(id);
      const prevRect = before.get(id);
      if (!node || !prevRect) continue;
      const newRect = node.getBoundingClientRect();
      const dx = prevRect.left - newRect.left;
      const dy = prevRect.top - newRect.top;
      if (!dx && !dy) continue;
      node.style.transition = "none";
      node.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        node.style.transition = "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)";
        node.style.transform = "";
      });
    }
  });

  const startDrag = useCallback(
    (id: string, event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      draggingIdRef.current = id;
      setDraggingId(id);

      const startX = event.clientX;
      const startY = event.clientY;
      // Cuánto tiene que moverse el puntero desde el último reordenamiento
      // antes de volver a evaluar si corresponde otro. Sin esto, el
      // temblor natural de la mano (un par de px) hace que el algoritmo de
      // "más cercano" oscile entre dos posiciones — el ítem "tiembla"/se
      // sigue moviendo aunque el dedo esté prácticamente quieto.
      const MIN_COMMIT_DELTA = 16;
      let lastCommitPos = axis === "x" ? startX : startY;
      const draggedNode = nodesRef.current.get(id);
      if (draggedNode) draggedNode.style.willChange = "transform";

      const handleMove = (moveEvent: PointerEvent) => {
        const x = moveEvent.clientX;
        const y = moveEvent.clientY;
        const current = itemsRef.current;
        const fromIndex = current.findIndex((it) => getId(it) === id);
        if (fromIndex < 0) return;

        const node = nodesRef.current.get(id);
        if (node) {
          const tx = axis === "x" ? x - startX : 0;
          const ty = axis === "y" ? y - startY : 0;
          node.style.transform = `translate(${tx}px, ${ty}px) scale(${dragScale})`;
        }

        // El elemento ya sigue al dedo con fluidez (arriba). Lo que sigue
        // — decidir si corresponde reordenar — solo se reevalúa si hubo
        // movimiento real desde el último cambio de posición.
        const pos = axis === "x" ? x : y;
        if (Math.abs(pos - lastCommitPos) < MIN_COMMIT_DELTA) return;

        let bestIndex = fromIndex;
        let bestDist = Infinity;
        current.forEach((it, i) => {
          const itId = getId(it);
          if (itId === id) return; // sigue al puntero: no compite consigo mismo
          const el = nodesRef.current.get(itId);
          if (!el) return;
          const rect = el.getBoundingClientRect();
          // Solo se compara en el eje permitido — el otro eje no debe
          // hacer "saltar" el reorden hacia una fila/columna distinta.
          const dist =
            axis === "x"
              ? (x - (rect.left + rect.width / 2)) ** 2
              : (y - (rect.top + rect.height / 2)) ** 2;
          if (dist < bestDist) {
            bestDist = dist;
            bestIndex = i;
          }
        });
        if (bestIndex !== fromIndex) {
          lastCommitPos = pos;
          const next = [...current];
          const [moved] = next.splice(fromIndex, 1);
          next.splice(bestIndex, 0, moved);
          rectsBeforeRef.current = new Map(
            current
              .filter((it2) => getId(it2) !== id)
              .map((it2) => {
                const nid = getId(it2);
                const el2 = nodesRef.current.get(nid);
                return el2 ? ([nid, el2.getBoundingClientRect()] as const) : null;
              })
              .filter((v): v is readonly [string, DOMRect] => v !== null),
          );
          onChange(next);
        }
      };

      const finish = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        const node = nodesRef.current.get(id);
        if (node) {
          node.style.transition = "transform 180ms cubic-bezier(0.22, 1, 0.36, 1)";
          node.style.transform = "";
          node.style.willChange = "";
          window.setTimeout(() => {
            if (node) node.style.transition = "";
          }, 200);
        }
        draggingIdRef.current = null;
        setDraggingId(null);
        onDragEnd(itemsRef.current);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    },
    [getId, onChange, onDragEnd, axis, dragScale],
  );

  return { draggingId, setNodeRef, startDrag };
}
const MAX_CATEGORY_NAME_LENGTH = 18;
const MAX_ITEM_NAME_LENGTH = 28;

function priceToCash(price: string, discount: string) {
  const p = Number(price) || 0;
  const d = Number(discount) || 0;
  return Math.max(0, Math.round(p - (p * d) / 100));
}

// El estado sigue guardando solo dígitos (lo que espera Number(form.price)
// al persistir) — esto formatea esos dígitos con separador de miles
// argentino solo para mostrarlos en el input.
function formatThousands(digits: string) {
  const n = Number(digits);
  return digits && Number.isFinite(n) ? n.toLocaleString("es-AR") : "";
}

function clampPercent(digits: string) {
  if (!digits) return "";
  return String(Math.min(100, Number(digits)));
}

function rowToForm(row: PriceRow, isService: boolean): PriceForm {
  return {
    name: row.name ?? "",
    price: String(row.price ?? 0),
    discount: String(row.cash_discount ?? 0), // ← read real value
    duration: row.duration_min
      ? String(row.duration_min)
      : isService
        ? "30"
        : "",
    status: row.active === false ? "Inactivo" : "Activo",
    category: row.category || (isService ? "Servicios" : "Productos"),
    description: "",
    reservable: true,
    stock: String(row.stock ?? 0),
    warnStock: "0",
    criticalStock: "0",
    bookingShow: false,
    bookingOffer: "none",
    miniDesc: "",
    image: "",
    imagePosition: "50% 50%",
  };
}


function clampImagePositionValue(value: number) {
  return Math.max(0, Math.min(100, value));
}

function parseImagePosition(position?: string | null): { x: number; y: number } {
  const fallback = { x: 50, y: 50 };
  if (!position) return fallback;
  const [xRaw, yRaw] = position.split(/\s+/);
  const x = Number(String(xRaw ?? "").replace("%", ""));
  const y = Number(String(yRaw ?? "").replace("%", ""));
  return {
    x: Number.isFinite(x) ? clampImagePositionValue(x) : fallback.x,
    y: Number.isFinite(y) ? clampImagePositionValue(y) : fallback.y,
  };
}

/**
 * Geometría real del recorte: a partir del tamaño natural de la foto y el
 * tamaño real del marco, calcula cuánto "sobra" de imagen (overflow) en cada
 * eje una vez aplicado object-fit: cover. Ese sobrante es el único rango
 * válido de arrastre — no un porcentaje inventado.
 */
type CropGeometry = {
  scale: number;
  scaledW: number;
  scaledH: number;
  overflowX: number;
  overflowY: number;
};

function computeCropGeometry(
  container: { w: number; h: number },
  natural: { w: number; h: number },
): CropGeometry | null {
  if (!container.w || !container.h || !natural.w || !natural.h) return null;
  const scale = Math.max(container.w / natural.w, container.h / natural.h);
  const scaledW = natural.w * scale;
  const scaledH = natural.h * scale;
  return {
    scale,
    scaledW,
    scaledH,
    overflowX: Math.max(0, scaledW - container.w),
    overflowY: Math.max(0, scaledH - container.h),
  };
}

// object-position "X% Y%" <-> transform: translate(x px, y px) real, según la geometría.
function offsetToTranslate(position: string, geometry: CropGeometry) {
  const { x: px, y: py } = parseImagePosition(position);
  return {
    x: -geometry.overflowX * (px / 100),
    y: -geometry.overflowY * (py / 100),
  };
}

function translateToOffset(translate: { x: number; y: number }, geometry: CropGeometry) {
  const x = geometry.overflowX > 0 ? clampImagePositionValue((-translate.x / geometry.overflowX) * 100) : 50;
  const y = geometry.overflowY > 0 ? clampImagePositionValue((-translate.y / geometry.overflowY) * 100) : 50;
  // Redondeo a 1 decimal: precisión de sobra para el recorte, strings más cortos para persistir.
  return `${Math.round(x * 10) / 10}% ${Math.round(y * 10) / 10}%`;
}

function clampTranslate(translate: { x: number; y: number }, geometry: CropGeometry) {
  return {
    x: Math.max(-geometry.overflowX, Math.min(0, translate.x)),
    y: Math.max(-geometry.overflowY, Math.min(0, translate.y)),
  };
}

/**
 * Editor de imagen tipo Instagram / Mercado Libre: el marco nunca se mueve,
 * solo la fotografía, arrastrada con transform: translate() y con límites
 * calculados con el tamaño real de la imagen y del marco (no con porcentajes
 * fijos). Se puede llevar hasta los bordes reales de la foto, sin rebote.
 */
function DraggableImageCrop({
  src,
  alt,
  value,
  onChange,
  onPickImage,
  className,
}: {
  src: string;
  alt: string;
  value: string;
  onChange: (value: string) => void;
  onPickImage?: () => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const initializedForRef = useRef<string>("");

  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startTranslateX: number;
    startTranslateY: number;
  } | null>(null);

  // Mide el marco real (no un porcentaje asumido) y reacciona si cambia de tamaño.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setContainerSize({ w: rect.width, h: rect.height });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Si la imagen ya está cargada desde caché al montar, captura su tamaño natural igual.
  useLayoutEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth) {
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    }
  }, [src]);

  const geometry = useMemo(
    () => computeCropGeometry(containerSize, naturalSize),
    [containerSize, naturalSize],
  );

  // Al cambiar de foto (o apenas se conoce la geometría real por primera vez),
  // arranca desde la posición guardada — nunca recentra si ya había una guardada.
  useEffect(() => {
    if (!geometry) return;
    const key = `${src}|${Math.round(geometry.scaledW)}x${Math.round(geometry.scaledH)}`;
    if (initializedForRef.current === key) return;
    initializedForRef.current = key;
    setTranslate(clampTranslate(offsetToTranslate(value, geometry), geometry));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry, src]);

  const applyTranslate = (next: { x: number; y: number }) => {
    if (!geometry) return;
    const clamped = clampTranslate(next, geometry);
    setTranslate(clamped);
    return clamped;
  };

  const commit = (next: { x: number; y: number }) => {
    if (!geometry) return;
    onChange(translateToOffset(next, geometry));
  };

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        role="button"
        tabIndex={0}
        className={cn(
          "relative aspect-square w-full cursor-grab touch-none select-none overflow-hidden rounded-2xl bg-white/5 ring-1 ring-white/10 active:cursor-grabbing",
          dragging && "ring-2 ring-primary/50",
          className,
        )}
        title="Arrastrá la imagen para acomodarla"
        onPointerDown={(event) => {
          if (!geometry) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          dragRef.current = {
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startTranslateX: translate.x,
            startTranslateY: translate.y,
          };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || !geometry) return;
          // 1:1 real: la foto acompaña el cursor/dedo exactamente, sin multiplicadores artificiales.
          const dx = event.clientX - drag.startClientX;
          const dy = event.clientY - drag.startClientY;
          applyTranslate({ x: drag.startTranslateX + dx, y: drag.startTranslateY + dy });
        }}
        onPointerUp={(event) => {
          const drag = dragRef.current;
          dragRef.current = null;
          setDragging(false);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          if (!drag || !geometry) return;
          const dx = event.clientX - drag.startClientX;
          const dy = event.clientY - drag.startClientY;
          const final = applyTranslate({ x: drag.startTranslateX + dx, y: drag.startTranslateY + dy });
          if (final) commit(final);
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          setDragging(false);
        }}
        onDoubleClick={onPickImage}
        onKeyDown={(event) => {
          if (!geometry) return;
          const step = 12; // px reales por pulsación de flecha
          let next = translate;
          if (event.key === "ArrowLeft") next = { x: translate.x + step, y: translate.y };
          else if (event.key === "ArrowRight") next = { x: translate.x - step, y: translate.y };
          else if (event.key === "ArrowUp") next = { x: translate.x, y: translate.y + step };
          else if (event.key === "ArrowDown") next = { x: translate.x, y: translate.y - step };
          else if (event.key === "Enter" && onPickImage) return onPickImage();
          else return;
          event.preventDefault();
          const clamped = applyTranslate(next);
          if (clamped) commit(clamped);
        }}
      >
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          draggable={false}
          loading="lazy"
          onLoad={(event) => {
            const img = event.currentTarget;
            setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
          }}
          style={
            geometry
              ? {
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: geometry.scaledW,
                  height: geometry.scaledH,
                  maxWidth: "none",
                  transform: `translate(${translate.x}px, ${translate.y}px)`,
                  willChange: "transform",
                }
              : {
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  objectPosition: value,
                }
          }
        />
      </div>
      <div className="text-center text-[10px] text-muted-foreground">
        Arrastrá la imagen para acomodarla.
      </div>
    </div>
  );
}

const NEW_CATEGORY_OPTION = "__new_category__";

function PriceEditorModal({
  open,
  mode,
  isService,
  form,
  setForm,
  onClose,
  onSave,
  onDelete,
  saving,
  catalogCategories = defaultCatalogCategories,
  onUploadImage,
  onCreateCategory,
  featuredOthers = 0,
}: {
  open: boolean;
  mode: "new" | "edit";
  isService: boolean;
  form: PriceForm;
  setForm: (form: PriceForm) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
  saving: boolean;
  catalogCategories?: string[];
  onUploadImage?: (file: File) => Promise<string | null>;
  onCreateCategory?: (name: string) => boolean;
  featuredOthers?: number;
}) {
  const [uploadingImg, setUploadingImg] = useState(false);
  const bookingFileRef = useRef<HTMLInputElement | null>(null);
  useBodyScrollLock(open);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (open) scrollRef.current?.scrollTo(0, 0);
  }, [open]);
  // Crear categoría sin salir del modal: al elegir "+ Crear nueva
  // categoría" en el <select>, en vez de asignar ese valor literal se
  // muestra un input inline acá mismo — el resto del formulario (nombre,
  // precio, imagen...) sigue intacto, no se pierde nada.
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  if (!open) return null;
  const cashPrice = priceToCash(form.price, form.discount);
  const title = `${mode === "edit" ? "Editar" : "Nuevo"} ${isService ? "servicio" : "producto"}`;
  const availableCatalogCategories = Array.from(
    new Set([...(form.category ? [form.category] : []), ...catalogCategories]),
  );
  function handleCreateCategory() {
    const clean = newCategoryName.trim();
    if (!clean) return;
    const exists = availableCatalogCategories.some(
      (c) => c.toLowerCase() === clean.toLowerCase(),
    );
    if (exists) return toast.error("Ya existe una categoría con ese nombre");
    const created = onCreateCategory?.(clean) ?? true;
    if (!created) return;
    setForm({ ...form, category: clean });
    setCreatingCategory(false);
    setNewCategoryName("");
  }
  const categoryField = creatingCategory ? (
    <div className="space-y-2">
      <input
        autoFocus
        value={newCategoryName}
        onChange={(e) => setNewCategoryName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleCreateCategory();
          }
          if (e.key === "Escape") {
            setCreatingCategory(false);
            setNewCategoryName("");
          }
        }}
        placeholder="Nombre de la categoría"
        maxLength={MAX_CATEGORY_NAME_LENGTH}
        className={inputCls}
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setCreatingCategory(false);
            setNewCategoryName("");
          }}
          className="rounded-lg bg-white/5 hover:bg-white/10 ring-1 ring-white/10 px-3 py-2 text-sm"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleCreateCategory}
          className="flex-1 rounded-lg bg-gradient-to-r from-sky-400 to-violet-500 text-white font-semibold px-3 py-2 text-sm"
        >
          Guardar categoría
        </button>
      </div>
    </div>
  ) : (
    <select
      value={form.category}
      onChange={(e) => {
        if (e.target.value === NEW_CATEGORY_OPTION) {
          setNewCategoryName("");
          setCreatingCategory(true);
          return;
        }
        setForm({ ...form, category: e.target.value });
      }}
      className={inputCls}
    >
      {availableCatalogCategories.map((category) => (
        <option key={category}>{category}</option>
      ))}
      <option value={NEW_CATEGORY_OPTION}>+ Crear nueva categoría</option>
    </select>
  );

  if (typeof document === "undefined") return null;

  return createPortal(
    // Portal a document.body: esta pantalla vive dentro del <div
    // className="relative z-10"> de AppShell, que crea su propio contexto
    // de apilamiento — pierde contra el header/bottom-nav de AppSidebar
    // (z-40, sticky/fixed, hermanos de <main> a nivel raíz). Mismo fix que
    // "Agregar profesional" (commit a084001). padding-bottom reserva el
    // alto real del nav inferior (3.5rem + safe-area en mobile).
    <div className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto bg-black/70 backdrop-blur-sm p-4 pt-[calc(24px+env(safe-area-inset-top,0px))] pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] lg:pb-4 [overscroll-behavior:contain]">
      <div className="relative flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-[oklch(0.12_0.02_275)] ring-1 ring-white/10 shadow-2xl max-h-[calc(100dvh-24px-env(safe-area-inset-top,0px)-3.5rem-env(safe-area-inset-bottom,0px))] lg:max-h-[calc(100dvh-24px-env(safe-area-inset-top,0px)-1rem)]">
        <div className="flex shrink-0 items-center justify-between px-5 py-4 border-b border-white/5">
          <h3 className="font-display text-lg font-semibold">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-white/5"
          >
            ✕
          </button>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3 [overscroll-behavior:contain]">
          {isService ? (
            <>
              <SectionCard label="Información principal">
                <div className="space-y-3">
                  <Field label="Nombre del servicio">
                    <input
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className={inputCls}
                      placeholder="Corte + Barba"
                      maxLength={MAX_ITEM_NAME_LENGTH}
                    />
                  </Field>
                  <Field label="Categoría">{categoryField}</Field>
                  <Field label="Duración">
                    <div className="relative">
                      <input
                        type="number"
                        min={0}
                        value={form.duration}
                        onChange={(e) => setForm({ ...form, duration: e.target.value })}
                        className={cn(inputCls, "pr-12")}
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        min
                      </span>
                    </div>
                  </Field>
                </div>
              </SectionCard>

              <SectionCard label="Precios">
                <div className="space-y-3">
                  <Field label="Precio de lista">
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        $
                      </span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={formatThousands(form.price)}
                        onChange={(e) =>
                          setForm({ ...form, price: e.target.value.replace(/\D/g, "") })
                        }
                        className={cn(inputCls, "pl-6")}
                        placeholder="0"
                      />
                    </div>
                  </Field>
                  <Field label="Descuento en efectivo">
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={form.discount}
                        onChange={(e) =>
                          setForm({ ...form, discount: clampPercent(e.target.value.replace(/\D/g, "")) })
                        }
                        className={cn(inputCls, "pr-8")}
                        placeholder="0"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        %
                      </span>
                    </div>
                  </Field>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 mb-1.5">
                      Precio en efectivo
                    </div>
                    <div className="text-lg font-semibold text-[oklch(0.82_0.14_75)]">
                      ${cashPrice.toLocaleString("es-AR")}
                    </div>
                  </div>
                </div>
              </SectionCard>

              <SectionCard label="Imagen del servicio">
                <input
                  ref={bookingFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file || !onUploadImage) return;
                    setUploadingImg(true);
                    const url = await onUploadImage(file);
                    setUploadingImg(false);
                    if (url) setForm({ ...form, image: url, imagePosition: "50% 50%" });
                  }}
                />
                {form.image ? (
                  <div className="space-y-3">
                    <DraggableImageCrop
                      src={form.image}
                      alt={form.name || "Servicio"}
                      value={form.imagePosition}
                      onChange={(imagePosition) => setForm({ ...form, imagePosition })}
                      onPickImage={() => bookingFileRef.current?.click()}
                      className="mx-auto max-w-[220px]"
                    />
                    <div className="flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => bookingFileRef.current?.click()}
                        disabled={uploadingImg}
                        className="rounded-xl bg-white/5 hover:bg-white/10 ring-1 ring-white/10 px-4 py-2 text-sm disabled:opacity-50"
                      >
                        Cambiar imagen
                      </button>
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, image: "", imagePosition: "50% 50%" })}
                        disabled={uploadingImg}
                        className="rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-300 ring-1 ring-red-500/20 px-4 py-2 text-sm disabled:opacity-50"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => bookingFileRef.current?.click()}
                    disabled={uploadingImg}
                    className="mx-auto grid aspect-square w-full max-w-[220px] place-items-center overflow-hidden rounded-2xl bg-white/5 ring-1 ring-white/10 hover:bg-white/10 disabled:opacity-50"
                  >
                    {uploadingImg ? (
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    ) : (
                      <span className="flex flex-col items-center gap-1 text-muted-foreground/80">
                        <Upload className="h-5 w-5" />
                        <span className="text-[11px]">Subir imagen</span>
                      </span>
                    )}
                  </button>
                )}
              </SectionCard>

              <SectionCard label="Reserva online">
                <label className="flex items-center justify-between gap-4 cursor-pointer">
                  <div className="text-sm font-medium">Se puede reservar online</div>
                  <Toggle
                    on={form.reservable}
                    onChange={(v) => setForm({ ...form, reservable: v })}
                  />
                </label>
              </SectionCard>

              <SectionCard label="Descripción">
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className={cn(inputCls, "min-h-[72px] resize-y")}
                  placeholder="Detalles del servicio (opcional)"
                />
              </SectionCard>
            </>
          ) : (
            <>
              <SectionCard label="Información principal">
                <div className="space-y-3">
                  <Field label="Nombre del producto">
                    <input
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className={inputCls}
                      placeholder="Nombre del producto"
                      maxLength={MAX_ITEM_NAME_LENGTH}
                    />
                  </Field>
                  <Field label="Categoría">{categoryField}</Field>
                </div>
              </SectionCard>

              <SectionCard label="Precios">
                <div className="space-y-3">
                  <Field label="Precio de lista">
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        $
                      </span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={formatThousands(form.price)}
                        onChange={(e) =>
                          setForm({ ...form, price: e.target.value.replace(/\D/g, "") })
                        }
                        className={cn(inputCls, "pl-6")}
                        placeholder="0"
                      />
                    </div>
                  </Field>
                  <Field label="Descuento en efectivo">
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={form.discount}
                        onChange={(e) =>
                          setForm({ ...form, discount: clampPercent(e.target.value.replace(/\D/g, "")) })
                        }
                        className={cn(inputCls, "pr-8")}
                        placeholder="0"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        %
                      </span>
                    </div>
                  </Field>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 mb-1.5">
                      Precio en efectivo
                    </div>
                    <div className="text-lg font-semibold text-[oklch(0.82_0.14_75)]">
                      ${cashPrice.toLocaleString("es-AR")}
                    </div>
                  </div>
                </div>
              </SectionCard>

              <SectionCard label="Imagen del producto">
                <input
                  ref={bookingFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file || !onUploadImage) return;
                    setUploadingImg(true);
                    const url = await onUploadImage(file);
                    setUploadingImg(false);
                    if (url) setForm({ ...form, image: url, imagePosition: "50% 50%" });
                  }}
                />
                {form.image ? (
                  <div className="space-y-3">
                    <DraggableImageCrop
                      src={form.image}
                      alt={form.name || "Producto"}
                      value={form.imagePosition}
                      onChange={(imagePosition) => setForm({ ...form, imagePosition })}
                      onPickImage={() => bookingFileRef.current?.click()}
                      className="mx-auto max-w-[220px]"
                    />
                    <div className="flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => bookingFileRef.current?.click()}
                        disabled={uploadingImg}
                        className="rounded-xl bg-white/5 hover:bg-white/10 ring-1 ring-white/10 px-4 py-2 text-sm disabled:opacity-50"
                      >
                        Cambiar imagen
                      </button>
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, image: "", imagePosition: "50% 50%" })}
                        disabled={uploadingImg}
                        className="rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-300 ring-1 ring-red-500/20 px-4 py-2 text-sm disabled:opacity-50"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => bookingFileRef.current?.click()}
                    disabled={uploadingImg}
                    className="mx-auto grid aspect-square w-full max-w-[220px] place-items-center overflow-hidden rounded-2xl bg-white/5 ring-1 ring-white/10 hover:bg-white/10 disabled:opacity-50"
                  >
                    {uploadingImg ? (
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    ) : (
                      <span className="flex flex-col items-center gap-1 text-muted-foreground/80">
                        <Upload className="h-5 w-5" />
                        <span className="text-[11px]">Subir imagen</span>
                      </span>
                    )}
                  </button>
                )}
              </SectionCard>

              <SectionCard label="Reservas online">
                <div className="space-y-3">
                  {(() => {
                    const featuredTotal = featuredOthers + (form.bookingShow ? 1 : 0);
                    const limitReached = !form.bookingShow && featuredOthers >= 3;
                    return (
                      <>
                        <label className="flex items-center justify-between gap-4 cursor-pointer">
                          <div>
                            <div className="text-sm font-medium">Mostrar en reservas online</div>
                            <div className="text-xs text-muted-foreground">Aparece en reserva online.</div>
                          </div>
                          <Toggle
                            on={form.bookingShow}
                            onChange={(v) => {
                              if (v && limitReached) return;
                              setForm({ ...form, bookingShow: v });
                            }}
                          />
                        </label>
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                          <span className="font-medium text-muted-foreground">
                            Productos destacados: {featuredTotal} de 3
                          </span>
                          {limitReached ? (
                            <span className="text-amber-300">Solo podés destacar hasta 3 productos.</span>
                          ) : null}
                        </div>
                      </>
                    );
                  })()}
                  <div
                    className={cn(
                      "grid grid-cols-1 gap-3 sm:grid-cols-2 transition-opacity",
                      !form.bookingShow && "pointer-events-none opacity-40",
                    )}
                  >
                    <Field label="Oferta %">
                      <input
                        type="number"
                        min={0}
                        max={90}
                        disabled={!form.bookingShow}
                        value={form.bookingOffer === "none" || form.bookingOffer === "special" ? "" : form.bookingOffer}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            bookingOffer: e.target.value.trim() ? e.target.value : "none",
                          })
                        }
                        className={inputCls}
                        placeholder="20"
                      />
                    </Field>
                    <Field label="Mini descripción">
                      <input
                        value={form.miniDesc}
                        disabled={!form.bookingShow}
                        onChange={(e) => setForm({ ...form, miniDesc: e.target.value })}
                        className={inputCls}
                        maxLength={60}
                        placeholder="Fijación fuerte y acabado mate natural."
                      />
                    </Field>
                  </div>
                </div>
              </SectionCard>

              <SectionCard label="Stock">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <div className="mb-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">Actual</div>
                    <input
                      type="number"
                      value={form.stock}
                      onChange={(e) => setForm({ ...form, stock: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <div className="mb-1.5 text-[10px] uppercase tracking-[0.18em] text-amber-300/80">Aviso</div>
                    <input
                      type="number"
                      value={form.warnStock}
                      onChange={(e) => setForm({ ...form, warnStock: e.target.value })}
                      className={cn(inputCls, "ring-1 ring-amber-400/20 focus:ring-amber-400/40")}
                    />
                  </div>
                  <div>
                    <div className="mb-1.5 text-[10px] uppercase tracking-[0.18em] text-red-400/80">Crítico</div>
                    <input
                      type="number"
                      value={form.criticalStock}
                      onChange={(e) => setForm({ ...form, criticalStock: e.target.value })}
                      className={cn(inputCls, "ring-1 ring-red-500/20 focus:ring-red-500/40")}
                    />
                  </div>
                </div>
              </SectionCard>
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 px-5 py-4 border-t border-white/5">
          {mode === "edit" && onDelete && (
          <button
            onClick={onDelete}
            disabled={saving}
            className="rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-300 ring-1 ring-red-500/20 px-4 py-2.5 text-sm">
            Eliminar
          </button>)}
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-xl bg-white/5 hover:bg-white/10 ring-1 ring-white/10 px-4 py-2.5 text-sm">
            Cancelar
          </button>
          <button
            onClick={onSave}
            disabled={saving || !form.name.trim()}
            className="flex-1 rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 text-white font-semibold px-4 py-2.5 text-sm disabled:opacity-50"
          >
            {saving
              ? "Guardando…"
              : `Guardar ${isService ? "servicio" : "producto"}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PriceCatalogSection({ kind }: { kind: "servicios" | "catalogo" }) {
  const isService = kind === "servicios";
  const { businessId } = useAuth();
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [serviceReservableMap, setServiceReservableMap] = useState<
    Record<string, boolean>
  >({});
  // Reservas online del catálogo: { [productId]: { show, offer, miniDesc } }
  const [bookingConfig, setBookingConfig] = useState<
    Record<string, { show: boolean; offer: string; miniDesc?: string }>
  >({});
  // Imagen general por item (servicios y productos): { [id]: url }
  const [imageMap, setImageMap] = useState<Record<string, string>>({});
  // Posición del recorte de cada imagen: { [id]: "50% 50%" }
  const [imagePositionMap, setImagePositionMap] = useState<Record<string, string>>({});
  // `ready` se setea UNA sola vez, con el primer (y único) fetch combinado de
  // items + categorías. A diferencia del esquema anterior (loading +
  // categoriesLoading + initialCategoryReady derivados en cada render), acá
  // nunca vuelve a false: un refresh en segundo plano (realtime, evento de
  // guardado, etc.) actualiza los datos in-place sin volver a tapar el panel
  // con el loader, que es lo que producía el "doble render" visible.
  const [ready, setReady] = useState(false);
  const activeCatStorageKey = React.useMemo(
    () => `clippr:${businessId ?? "local"}:${isService ? "servicios" : "catalogo"}:active-category`,
    [businessId, isService],
  );
  const [cat, setCat] = useState<string>(() => {
    if (typeof window === "undefined") return isService ? "" : "Productos";
    return window.localStorage.getItem(activeCatStorageKey) || (isService ? "" : "Productos");
  });
  const [editing, setEditing] = useState<PriceRow | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<PriceForm>(
    emptyPriceForm(isService ? "Servicios" : "Productos", isService),
  );
  const [confirmDelItem, setConfirmDelItem] = useState<PriceRow | null>(null);
  // Pending changes — written to Supabase only when global Save is pressed
  type PendingItem = {
    tempId: string;
    payload: Record<string, unknown>;
    isNew: boolean;
  };
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set());
  const [confirmDelCat, setConfirmDelCat] = useState<string | null>(null);
  const [customCatalogCategories, setCustomCatalogCategories] = useState<
    string[]
  >(defaultCatalogCategories);
  const [customServiceCategories, setCustomServiceCategories] = useState<
    string[]
  >(defaultServiceCategories);
  // Orden manual (drag&drop) de ítems dentro de cada categoría: { [categoria]: [ids] }.
  const [itemOrderMap, setItemOrderMap] = useState<Record<string, string[]>>({});

  // Carga inicial: items (price_catalog) + categorías/config (business_settings)
  // en paralelo con Promise.all, y UN SOLO commit de estado al final con todo
  // ya resuelto (incluida la categoría activa). Antes esto eran dos efectos
  // independientes que terminaban en momentos distintos, cada uno con su
  // propio setState — eso es lo que producía el segundo render/"recarga"
  // visible del panel inferior.
  useEffect(() => {
    let cancelled = false;

    if (!businessId) {
      setReady(true);
      return;
    }

    (async () => {
      const [catalogRes, settingsRes] = await Promise.all([
        supabase
          .from("price_catalog")
          .select("id,name,price,duration_min,category,active,stock,cash_discount")
          .eq("business_id", businessId)
          .order("category")
          .order("name"),
        supabase
          .from("business_settings")
          .select("schedule")
          .eq("business_id", businessId)
          .maybeSingle(),
      ]);

      if (cancelled) return;

      if (catalogRes.error) toast.error("Error: " + catalogRes.error.message);
      const rawFetchedRows = (catalogRes.data ?? []) as PriceRow[];

      const schedule = (settingsRes.data?.schedule ?? {}) as Record<string, unknown>;
      const cats = (schedule._categories ?? {}) as Record<string, unknown>;
      const visibility = getPublicVisibility(schedule);
      const itemOrder = (schedule._itemOrder ?? {}) as Record<string, unknown>;
      const nextItemOrderMap = ((itemOrder[isService ? "service" : "catalog"] ?? {}) as Record<
        string,
        string[]
      >);
      const fetchedRows = applyItemOrder(
        rawFetchedRows,
        nextItemOrderMap,
        isService ? "Servicios" : "Productos",
      );

      let nextServiceReservable = serviceReservableMap;
      let nextServiceCats = customServiceCategories;
      if (isService) {
        nextServiceReservable = normalizePublicBooleanMap(
          visibility.services ?? schedule._serviceReservable,
        );
        if (Array.isArray(cats.service))
          nextServiceCats = cats.service as string[];
      }

      let nextCatalogCats = customCatalogCategories;
      if (!isService && Array.isArray(cats.catalog))
        nextCatalogCats = cats.catalog as string[];

      const imgs = (schedule._catalogImages ?? {}) as Record<string, unknown>;
      const imgMap: Record<string, string> = {};
      for (const [pid, url] of Object.entries(imgs)) {
        if (pid.trim() && typeof url === "string" && url) imgMap[pid] = url;
      }
      const positions = (schedule._catalogImagePositions ?? {}) as Record<string, unknown>;
      const posMap: Record<string, string> = {};
      for (const [pid, value] of Object.entries(positions)) {
        if (pid.trim() && typeof value === "string" && value.trim()) posMap[pid] = value;
      }

      let nextBookingConfig = bookingConfig;
      if (!isService) {
        const bp = (schedule._bookingProducts ?? {}) as Record<string, unknown>;
        const cfg = (bp.config ?? {}) as Record<string, unknown>;
        const normalized: Record<
          string,
          { show: boolean; offer: string; miniDesc?: string }
        > = {};
        for (const [pid, value] of Object.entries(cfg)) {
          if (!pid.trim()) continue;
          const v = (value ?? {}) as Record<string, unknown>;
          normalized[pid] = {
            show: v.show === true,
            offer: typeof v.offer === "string" ? v.offer : "none",
            miniDesc: typeof v.miniDesc === "string" ? v.miniDesc : "",
          };
        }
        nextBookingConfig = normalized;
      }

      // Resolver la categoría activa con los datos YA frescos (no con el
      // estado — todavía viejo — del render anterior).
      const visibleForCats = fetchedRows.filter((row) => {
        const category = (row.category || "Productos").toLowerCase();
        if (isService) return row.duration_min != null;
        return row.duration_min == null && !category.includes("servicio");
      });
      const resolvedCategories = isService
        ? Array.from(
            new Set([
              ...nextServiceCats,
              ...visibleForCats.map((r) => r.category || "Servicios"),
            ]),
          )
        : Array.from(
            new Set([
              ...nextCatalogCats,
              ...visibleForCats.map((r) => r.category || "Productos"),
            ]),
          );
      const savedCat =
        typeof window !== "undefined"
          ? window.localStorage.getItem(activeCatStorageKey) || ""
          : "";
      const resolvedCat = resolvedCategories.includes(savedCat)
        ? savedCat
        : (resolvedCategories[0] ?? "");

      // Un solo commit de estado (React los agrupa en un único render).
      setRows(fetchedRows);
      if (isService) {
        setServiceReservableMap(nextServiceReservable);
        setCustomServiceCategories(nextServiceCats);
      } else {
        setCustomCatalogCategories(nextCatalogCats);
        setBookingConfig(nextBookingConfig);
      }
      setImageMap(imgMap);
      setImagePositionMap(posMap);
      setItemOrderMap(nextItemOrderMap);
      setCat(resolvedCat);
      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [businessId, isService]);

  // Save categories to Supabase (called by global save)
  const persistCategories = useCallback(async () => {
    if (!businessId) return;
    const { data: existingRow } = await supabase
      .from("business_settings")
      .select("schedule")
      .eq("business_id", businessId)
      .maybeSingle();
    const existingSchedule = (existingRow?.schedule ?? {}) as Record<
      string,
      unknown
    >;
    const existingCats = (existingSchedule._categories ?? {}) as Record<
      string,
      unknown
    >;
    const updatedCats = isService
      ? { ...existingCats, service: customServiceCategories }
      : { ...existingCats, catalog: customCatalogCategories };
    await supabase
      .from("business_settings")
      .upsert(
        {
          business_id: businessId,
          schedule: { ...existingSchedule, _categories: updatedCats },
        },
        { onConflict: "business_id" },
      );
  }, [businessId, isService, customServiceCategories, customCatalogCategories]);

  // Guarda el orden de categorías en el momento en que el usuario lo cambia.
  // Esto evita que, al salir y volver a Configuración, las pestañas se reordenen
  // por el orden alfabético de Supabase o por la primera categoría con ítems.
  const persistCategoryList = useCallback(
    async (next: string[], type: "catalog" | "service") => {
      if (!businessId) return;
      const { data: existingRow } = await supabase
        .from("business_settings")
        .select("schedule")
        .eq("business_id", businessId)
        .maybeSingle();
      const existingSchedule = (existingRow?.schedule ?? {}) as Record<string, unknown>;
      const existingCats = (existingSchedule._categories ?? {}) as Record<string, unknown>;
      const updatedCats =
        type === "service"
          ? { ...existingCats, service: next }
          : { ...existingCats, catalog: next };
      await supabase.from("business_settings").upsert(
        {
          business_id: businessId,
          schedule: { ...existingSchedule, _categories: updatedCats },
        },
        { onConflict: "business_id" },
      );
    },
    [businessId],
  );

  // Persistencia silenciosa e inmediata del orden de ítems dentro de una
  // categoría (drag&drop). Mismo criterio que persistCategoryList: se guarda
  // apenas el usuario suelta el ítem, sin esperar al Guardar global.
  const persistItemOrder = useCallback(
    async (category: string, orderedIds: string[]) => {
      if (!businessId) return;
      const { data: existingRow } = await supabase
        .from("business_settings")
        .select("schedule")
        .eq("business_id", businessId)
        .maybeSingle();
      const existingSchedule = (existingRow?.schedule ?? {}) as Record<string, unknown>;
      const existingOrder = (existingSchedule._itemOrder ?? {}) as Record<string, unknown>;
      const kind = isService ? "service" : "catalog";
      const existingKindOrder = (existingOrder[kind] ?? {}) as Record<string, unknown>;
      const updatedOrder = {
        ...existingOrder,
        [kind]: { ...existingKindOrder, [category]: orderedIds },
      };
      await supabase.from("business_settings").upsert(
        {
          business_id: businessId,
          schedule: { ...existingSchedule, _itemOrder: updatedOrder },
        },
        { onConflict: "business_id" },
      );
    },
    [businessId, isService],
  );

  const saveCategories = useCallback(
    (next: string[], type: "catalog" | "service") => {
      const clean = Array.from(
        new Set(next.map((c) => c.trim()).filter(Boolean)),
      );
      const normalized =
        clean.length > 0
          ? clean
          : type === "service"
            ? []
            : defaultCatalogCategories;

      if (type === "service") {
        setCustomServiceCategories(normalized);
      } else {
        setCustomCatalogCategories(normalized);
      }

      // Persistencia silenciosa e inmediata del orden de pestañas.
      void persistCategoryList(normalized, type);
    },
    [persistCategoryList],
  );

  // Refresh silencioso de items (realtime, eventos de guardado, etc.).
  // A propósito NO toca `ready`: una vez que el panel se mostró la primera
  // vez, un refresh en segundo plano actualiza `rows` in-place sin volver a
  // tapar el panel con el loader.
  const load = useCallback(async () => {
    if (!businessId) return;
    const { data, error } = await supabase
      .from("price_catalog")
      .select("id,name,price,duration_min,category,active,stock,cash_discount")
      .eq("business_id", businessId)
      .order("category")
      .order("name");
    if (error) return toast.error("Error: " + error.message);
    setRows(
      applyItemOrder(
        (data ?? []) as PriceRow[],
        itemOrderRef.current,
        isService ? "Servicios" : "Productos",
      ),
    );
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;

    const onCatalogStockSaved = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        { productId?: string; stock?: number } | undefined;

      if (detail?.productId && typeof detail.stock === "number") {
        setRows((prev) =>
          prev.map((row) =>
            row.id === detail.productId ? { ...row, stock: detail.stock } : row,
          ),
        );
        return;
      }

      load();
    };

    window.addEventListener("clippr:catalog-stock-saved", onCatalogStockSaved);

    const channel = supabase
      .channel(`settings_price_catalog_${businessId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "price_catalog",
          filter: `business_id=eq.${businessId}`,
        },
        () => load(),
      )
      .subscribe();

    return () => {
      window.removeEventListener(
        "clippr:catalog-stock-saved",
        onCatalogStockSaved,
      );
      supabase.removeChannel(channel);
    };
  }, [businessId, load]);

  // Global Save: persist pending + categories + show toast
  const persistCategoriesRef = useRef(persistCategories);
  useEffect(() => {
    persistCategoriesRef.current = persistCategories;
  }, [persistCategories]);
  const pendingItemsRef = useRef(pendingItems);
  const pendingDeletesRef = useRef(pendingDeletes);
  const serviceReservableMapRef = useRef(serviceReservableMap);
  const bookingConfigRef = useRef(bookingConfig);
  const rowsRef = useRef(rows);
  const imageMapRef = useRef(imageMap);
  const imagePositionMapRef = useRef(imagePositionMap);
  const itemOrderRef = useRef(itemOrderMap);
  useEffect(() => {
    bookingConfigRef.current = bookingConfig;
  }, [bookingConfig]);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  useEffect(() => {
    imageMapRef.current = imageMap;
  }, [imageMap]);
  useEffect(() => {
    itemOrderRef.current = itemOrderMap;
  }, [itemOrderMap]);
  useEffect(() => {
    imagePositionMapRef.current = imagePositionMap;
  }, [imagePositionMap]);
  useEffect(() => {
    pendingItemsRef.current = pendingItems;
  }, [pendingItems]);
  useEffect(() => {
    pendingDeletesRef.current = pendingDeletes;
  }, [pendingDeletes]);
  useEffect(() => {
    serviceReservableMapRef.current = serviceReservableMap;
  }, [serviceReservableMap]);

  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail ?? {};
      const section = detail?.section;
      const silent = detail?.silent === true;
      const mySection = isService ? "servicios" : "catalogo";
      if (!section || section === mySection) {
        if (silent) reportSaveStatus("saving");
        const items = pendingItemsRef.current;
        const deletes = pendingDeletesRef.current;
        const errors: string[] = [];

        let nextServiceReservableMap = { ...serviceReservableMapRef.current };
        const nextBookingConfig = { ...bookingConfigRef.current };
        const nextImageMap = { ...imageMapRef.current };
        const nextImagePositionMap = { ...imagePositionMapRef.current };
        const tempIdToReal: Record<string, string> = {};

        // Flush deletes
        for (const id of deletes) {
          const { error } = await supabase
            .from("price_catalog")
            .delete()
            .eq("id", id);
          if (error) errors.push(error.message);
          if (isService) delete nextServiceReservableMap[id];
          else delete nextBookingConfig[id];
          delete nextImageMap[id];
          delete nextImagePositionMap[id];
        }

        // Flush upserts
        for (const { tempId, payload, isNew } of items) {
          if (isNew) {
            const { data: inserted, error } = await supabase
              .from("price_catalog")
              .insert(payload)
              .select("id")
              .single();
            if (error || !inserted) {
              errors.push(error?.message ?? "No se pudo crear el servicio");
            } else if (isService) {
              const realId = String(inserted.id);
              const reservable = nextServiceReservableMap[tempId] !== false;
              delete nextServiceReservableMap[tempId];
              nextServiceReservableMap[realId] = reservable;
              tempIdToReal[tempId] = realId;
              if (nextImageMap[tempId]) {
                nextImageMap[realId] = nextImageMap[tempId];
                delete nextImageMap[tempId];
              }
              if (nextImagePositionMap[tempId]) {
                nextImagePositionMap[realId] = nextImagePositionMap[tempId];
                delete nextImagePositionMap[tempId];
              }
            } else {
              const realId = String(inserted.id);
              tempIdToReal[tempId] = realId;
              if (nextBookingConfig[tempId]) {
                nextBookingConfig[realId] = nextBookingConfig[tempId];
                delete nextBookingConfig[tempId];
              }
              if (nextImageMap[tempId]) {
                nextImageMap[realId] = nextImageMap[tempId];
                delete nextImageMap[tempId];
              }
              if (nextImagePositionMap[tempId]) {
                nextImagePositionMap[realId] = nextImagePositionMap[tempId];
                delete nextImagePositionMap[tempId];
              }
            }
          } else {
            const { error } = await supabase
              .from("price_catalog")
              .update(payload)
              .eq("id", tempId);
            if (error) errors.push(error.message);
          }
        }

        // Imagen general por item: se guarda en schedule._catalogImages.
        // Cada instancia (servicios/productos) solo toca sus propios ids y
        // preserva los de la otra para evitar pisarse al guardar.
        const ownImageIds = () => {
          const ids = new Set<string>();
          for (const r of rowsRef.current) {
            const category = (
              r.category || (isService ? "Servicios" : "Productos")
            ).toLowerCase();
            const mine = isService
              ? r.duration_min != null
              : r.duration_min == null && !category.includes("servicio");
            if (mine) ids.add(tempIdToReal[r.id] ?? r.id);
          }
          for (const id of deletes) ids.add(id);
          return ids;
        };
        const mergeCatalogImages = (
          existingSchedule: Record<string, unknown>,
        ): Record<string, string> => {
          const existing = (existingSchedule._catalogImages ?? {}) as Record<
            string,
            unknown
          >;
          const ids = ownImageIds();
          const merged: Record<string, string> = {};
          for (const [k, v] of Object.entries(existing)) {
            if (!ids.has(k) && typeof v === "string" && v) merged[k] = v;
          }
          for (const id of ids) {
            const url = nextImageMap[id];
            if (url) merged[id] = url;
          }
          return merged;
        };

        const mergeCatalogImagePositions = (
          existingSchedule: Record<string, unknown>,
        ): Record<string, string> => {
          const existing = (existingSchedule._catalogImagePositions ?? {}) as Record<string, unknown>;
          const ids = ownImageIds();
          const merged: Record<string, string> = {};
          for (const [k, v] of Object.entries(existing)) {
            if (!ids.has(k) && typeof v === "string" && v.trim()) merged[k] = v;
          }
          for (const id of ids) {
            const position = nextImagePositionMap[id];
            const hasImage = Boolean(nextImageMap[id]);
            if (hasImage && position) merged[id] = position;
          }
          return merged;
        };

        // Coordenadas de recorte explícitas (no solo el string CSS de object-position),
        // para que el recorte se pueda reconstruir con la geometría real de cada pantalla.
        const mergeCatalogImageOffsets = (
          existingSchedule: Record<string, unknown>,
        ): Record<string, { image_offset_x: number; image_offset_y: number }> => {
          const existing = (existingSchedule._catalogImageOffsets ?? {}) as Record<string, unknown>;
          const ids = ownImageIds();
          const merged: Record<string, { image_offset_x: number; image_offset_y: number }> = {};
          for (const [k, v] of Object.entries(existing)) {
            if (ids.has(k)) continue;
            const entry = v as Record<string, unknown>;
            const ox = Number(entry?.image_offset_x);
            const oy = Number(entry?.image_offset_y);
            if (Number.isFinite(ox) && Number.isFinite(oy)) merged[k] = { image_offset_x: ox, image_offset_y: oy };
          }
          for (const id of ids) {
            const position = nextImagePositionMap[id];
            const hasImage = Boolean(nextImageMap[id]);
            if (!hasImage || !position) continue;
            const { x, y } = parseImagePosition(position);
            merged[id] = { image_offset_x: x / 100, image_offset_y: y / 100 };
          }
          return merged;
        };

        // Categoría por servicio, espejada en business_settings.schedule para
        // que la Página Pública (rol anon) pueda armar las pestañas de
        // categoría sin acceso a price_catalog (sin RLS pública) ni depender
        // de que la vista public_booking_services exponga esa columna —
        // mismo criterio que ya se usa acá arriba para "recomendados" del
        // Catálogo.
        const mergeServiceCategories = (
          existingSchedule: Record<string, unknown>,
        ): Record<string, string> => {
          const merged = {
            ...((existingSchedule._serviceCategories ?? {}) as Record<
              string,
              string
            >),
          };
          for (const r of rowsRef.current) {
            if (r.duration_min == null) continue;
            const realId = tempIdToReal[r.id] ?? r.id;
            merged[realId] = r.category?.trim() || "Otro";
          }
          for (const id of deletes) delete merged[id];
          return merged;
        };

        imageMapRef.current = nextImageMap;
        setImageMap(nextImageMap);
        imagePositionMapRef.current = nextImagePositionMap;
        setImagePositionMap(nextImagePositionMap);

        if (isService && businessId) {
          serviceReservableMapRef.current = nextServiceReservableMap;
          setServiceReservableMap(nextServiceReservableMap);
          const { data: existingRow } = await supabase
            .from("business_settings")
            .select("schedule")
            .eq("business_id", businessId)
            .maybeSingle();
          const existingSchedule = (existingRow?.schedule ?? {}) as Record<
            string,
            unknown
          >;
          const visibility = getPublicVisibility(existingSchedule);
          await supabase.from("business_settings").upsert(
            {
              business_id: businessId,
              schedule: {
                ...existingSchedule,
                _catalogImages: mergeCatalogImages(existingSchedule),
                _catalogImagePositions: mergeCatalogImagePositions(existingSchedule),
                _catalogImageOffsets: mergeCatalogImageOffsets(existingSchedule),
                _serviceCategories: mergeServiceCategories(existingSchedule),
                _publicVisibility: {
                  ...visibility,
                  services: nextServiceReservableMap,
                },
              },
            },
            { onConflict: "business_id" },
          );
        }

        if (!isService && businessId) {
          bookingConfigRef.current = nextBookingConfig;
          setBookingConfig(nextBookingConfig);

          // Snapshot de recomendados: respeta el orden actual del Catálogo,
          // toma los primeros 3 productos activos con "Mostrar en reservas
          // online". Se guarda nombre/precio/oferta para que la reserva pública
          // (anon) los lea desde business_settings sin acceder a price_catalog.
          const orderedProducts = rowsRef.current.filter((r) => {
            const category = (r.category || "Productos").toLowerCase();
            return r.duration_min == null && !category.includes("servicio");
          });
          const recommended = orderedProducts
            .map((r) => ({ row: r, id: tempIdToReal[r.id] ?? r.id }))
            .filter(
              ({ id, row }) =>
                row.active !== false && nextBookingConfig[id]?.show === true,
            )
            .slice(0, 3)
            .map(({ id, row }) => ({
              id,
              name: row.name,
              price: Number(row.price) || 0,
              offer: nextBookingConfig[id]?.offer ?? "none",
              image: nextImageMap[id] ?? "",
              description: nextBookingConfig[id]?.miniDesc ?? "",
            }));

          const { data: existingRow } = await supabase
            .from("business_settings")
            .select("schedule")
            .eq("business_id", businessId)
            .maybeSingle();
          const existingSchedule = (existingRow?.schedule ?? {}) as Record<
            string,
            unknown
          >;
          await supabase.from("business_settings").upsert(
            {
              business_id: businessId,
              schedule: {
                ...existingSchedule,
                _catalogImages: mergeCatalogImages(existingSchedule),
                _catalogImagePositions: mergeCatalogImagePositions(existingSchedule),
                _catalogImageOffsets: mergeCatalogImageOffsets(existingSchedule),
                _bookingProducts: {
                  config: nextBookingConfig,
                  recommended,
                },
              },
            },
            { onConflict: "business_id" },
          );
        }

        await persistCategoriesRef.current();

        if (errors.length > 0) {
          toast.error("Error guardando: " + errors[0]);
        } else {
          setPendingItems([]);
          setPendingDeletes(new Set());
          window.dispatchEvent(new CustomEvent("clippr:catalog-stock-saved"));
          if (!silent) {
            toast.success(
              isService
                ? "Servicios guardados correctamente"
                : "Catálogo guardado correctamente",
            );
          } else {
            reportSaveStatus("saved");
          }
          load();
        }
      }
    };
    window.addEventListener("clippr:save-settings", handler);
    return () => window.removeEventListener("clippr:save-settings", handler);
  }, [isService]);

  const visibleRows = rows.filter((row) => {
    const category = (row.category || "Productos").toLowerCase();
    if (isService) return row.duration_min != null;
    return row.duration_min == null && !category.includes("servicio");
  });
  const categories = isService
    ? Array.from(
        new Set([
          ...customServiceCategories,
          ...visibleRows.map((r) => r.category || "Servicios"),
        ]),
      )
    : Array.from(
        new Set([
          ...customCatalogCategories,
          ...visibleRows.map((r) => r.category || "Productos"),
        ]),
      );

  // La categoría activa inicial ya se resuelve dentro del fetch combinado de
  // arriba (junto con rows/categorías, en un solo commit). Acá solo
  // persistimos a localStorage cuando el usuario cambia de categoría.
  useEffect(() => {
    if (!ready || !cat) return;
    if (typeof window === "undefined") return;
    window.localStorage.setItem(activeCatStorageKey, cat);
  }, [ready, cat, activeCatStorageKey]);

  const selectCategory = React.useCallback((category: string) => {
    setCat(category);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(activeCatStorageKey, category);
    }
  }, [activeCatStorageKey]);

  const activeCat = ready && categories.includes(cat) ? cat : "";

  const filtered = visibleRows.filter(
    (r) => (r.category || (isService ? "Servicios" : "Productos")) === activeCat,
  );

  async function uploadBookingImage(file: File): Promise<string | null> {
    if (!businessId) {
      toast.error("No se encontró el negocio");
      return null;
    }

    if (!file.type.startsWith("image/")) {
      toast.error("Subí una imagen JPG, PNG o WEBP");
      return null;
    }

    try {
      // Las imágenes de servicios/productos se muestran como miniaturas cuadradas.
      // Las comprimimos antes de subirlas para que carguen rápido en Configuración,
      // Caja, Agenda y página pública. 512px es más que suficiente para estos usos.
      const { blob, ext, type } = await processImage(file, 512, 512, 0.62);
      const path = `${businessId}/catalog/booking/${Date.now()}.${ext}`;

      const { error } = await supabase.storage
        .from("business-assets")
        .upload(path, blob, { upsert: true, contentType: type });
      if (error) {
        toast.error("No se pudo subir la imagen: " + error.message);
        return null;
      }
      const { data: urlData } = supabase.storage
        .from("business-assets")
        .getPublicUrl(path);
      return urlData.publicUrl ? `${urlData.publicUrl}?v=${Date.now()}` : null;
    } catch (error) {
      toast.error((error as Error).message || "No se pudo procesar la imagen");
      return null;
    }
  }

  function openNew() {
    setEditing(null);
    setForm(emptyPriceForm(cat, isService));
    setModalOpen(true);
  }

  function openEdit(row: PriceRow) {
    setEditing(row);
    const cfg = bookingConfig[row.id];
    setForm({
      ...rowToForm(row, isService),
      reservable: isService ? serviceReservableMap[row.id] !== false : true,
      bookingShow: !isService && cfg?.show === true,
      bookingOffer: !isService ? cfg?.offer ?? "none" : "none",
      miniDesc: !isService ? cfg?.miniDesc ?? "" : "",
      image: imageMap[row.id] ?? "",
      imagePosition: imagePositionMap[row.id] ?? "50% 50%",
    });
    setModalOpen(true);
  }

  function saveItem() {
    if (!businessId) return toast.error("No se encontró el negocio");
    if (!form.name.trim()) return toast.error("Ingresá un nombre");
    const payload: Record<string, unknown> = {
      business_id: businessId,
      name: form.name.trim(),
      price: Number(form.price) || 0,
      cash_discount: Number(form.discount) || 0,
      category: form.category,
      active: form.status === "Activo",
      duration_min: isService ? Number(form.duration) || 30 : null,
    };
    if (!isService) payload.stock = Number(form.stock) || 0;

    if (editing) {
      if (isService)
        setServiceReservableMap((current) => ({
          ...current,
          [editing.id]: form.reservable,
        }));
      else
        setBookingConfig((current) => ({
          ...current,
          [editing.id]: {
            show: form.bookingShow,
            offer: Number(form.bookingOffer) > 0 ? String(Number(form.bookingOffer)) : "none",
            miniDesc: form.miniDesc,
          },
        }));
      setImageMap((current) => {
        const next = { ...current };
        if (form.image) next[editing.id] = form.image;
        else delete next[editing.id];
        return next;
      });
      setImagePositionMap((current) => {
        const next = { ...current };
        if (form.image) next[editing.id] = form.imagePosition || "50% 50%";
        else delete next[editing.id];
        return next;
      });
      // Update existing row locally
      setRows((prev) =>
        prev.map((r) =>
          r.id === editing.id ? ({ ...r, ...payload } as PriceRow) : r,
        ),
      );
      setPendingItems((prev) => {
        const next = prev.filter((p) => p.tempId !== editing.id);
        return [
          ...next,
          { tempId: editing.id, payload: { ...payload }, isNew: false },
        ];
      });
    } else {
      // New row — temp negative id until saved
      const tempId = `new_${Date.now()}`;
      if (isService)
        setServiceReservableMap((current) => ({
          ...current,
          [tempId]: form.reservable,
        }));
      else
        setBookingConfig((current) => ({
          ...current,
          [tempId]: {
            show: form.bookingShow,
            offer: Number(form.bookingOffer) > 0 ? String(Number(form.bookingOffer)) : "none",
            miniDesc: form.miniDesc,
          },
        }));
      if (form.image) {
        setImageMap((current) => ({ ...current, [tempId]: form.image }));
        setImagePositionMap((current) => ({ ...current, [tempId]: form.imagePosition || "50% 50%" }));
      }
      setRows((prev) => [...prev, { id: tempId, ...payload } as PriceRow]);
      setPendingItems((prev) => [
        ...prev,
        { tempId, payload: { ...payload }, isNew: true },
      ]);
    }
    setModalOpen(false);
    markSettingsDirty();

    // Persistencia inmediata: "Guardar producto" debe quedar guardado aunque el usuario recargue la página.
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("clippr:save-settings", {
          detail: { section: isService ? "servicios" : "catalogo" },
        }),
      );
    }, 150);
  }

  function toggle(row: PriceRow) {
    const newActive = !row.active;
    setRows((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, active: newActive } : r)),
    );
    setPendingItems((prev) => {
      const existing = prev.find((p) => p.tempId === row.id);
      if (existing)
        return prev.map((p) =>
          p.tempId === row.id
            ? { ...p, payload: { ...p.payload, active: newActive } }
            : p,
        );
      return [
        ...prev,
        { tempId: row.id, payload: { active: newActive }, isNew: false },
      ];
    });
    markSettingsDirty();

    // Persistencia inmediata — mismo motivo que en saveItem(): activar o
    // desactivar un servicio/producto (el switch que determina si aparece en
    // la Página Pública) no puede quedar solo en la cola local a la espera
    // del "Guardar" global de Configuración. Sin este dispatch, un servicio
    // marcado como "Activo" acá podía seguir figurando como inactivo en
    // Supabase — y por lo tanto invisible en la reserva online — hasta que
    // alguien tocara ese otro botón.
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("clippr:save-settings", {
          detail: { section: isService ? "servicios" : "catalogo", silent: true },
        }),
      );
    }, 150);
  }

  // Un servicio/ítem con historial (turno agendado, venta en Caja, etc.) nunca
  // se borra físicamente para no romper esas referencias — solo se puede
  // desactivar. Los ítems nuevos (sin guardar todavía, tempId "new_...")
  // nunca tienen historial real.
  async function hasHistoricalUsage(row: PriceRow): Promise<boolean> {
    if (!businessId || row.id.startsWith("new_")) return false;
    const idFilter = JSON.stringify([{ id: row.id }]);
    const checks = [
      supabase
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .filter("items", "cs", idFilter),
    ];
    if (isService) {
      checks.push(
        supabase
          .from("appointments")
          .select("id", { count: "exact", head: true })
          .eq("business_id", businessId)
          .eq("service_id", row.id),
      );
    }
    const results = await Promise.all(checks);
    return results.some((r) => (r.count ?? 0) > 0);
  }

  async function requestDeleteItem(row: PriceRow) {
    const used = await hasHistoricalUsage(row);
    if (used) {
      toast.error(
        isService
          ? "Este servicio ya posee historial y no puede eliminarse. Podés desactivarlo."
          : "Este producto ya posee historial y no puede eliminarse. Podés desactivarlo.",
      );
      return;
    }
    setConfirmDelItem(row);
  }

  async function remove(row: PriceRow) {
    await requestDeleteItem(row);
  }

  async function doRemoveItem() {
    if (!confirmDelItem) return;
    const row = confirmDelItem;
    setConfirmDelItem(null);
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    if (isService)
      setServiceReservableMap((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
    else
      setBookingConfig((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
    setImageMap((current) => {
      const next = { ...current };
      delete next[row.id];
      return next;
    });
    // If it was a new (unsaved) item, just remove from pending
    if (row.id.startsWith("new_")) {
      setPendingItems((prev) => prev.filter((p) => p.tempId !== row.id));
    } else {
      setPendingItems((prev) => prev.filter((p) => p.tempId !== row.id));
      setPendingDeletes((prev) => new Set([...prev, row.id]));
    }
    setEditing(null);
    setModalOpen(false);
    toast.success(isService ? "Servicio eliminado" : "Producto eliminado");
    markSettingsDirty();
  }

  // Reordenar ítems dentro de la categoría activa (drag&drop con Pointer
  // Events — funciona igual en mobile y desktop). El cambio visual es
  // inmediato en cada movimiento; el guardado en business_settings recién
  // se dispara una vez, al soltar.
  const handleItemsReorderChange = useCallback(
    (next: PriceRow[]) => {
      setRows((prev) => {
        const others = prev.filter((r) => r.category !== activeCat);
        return [...others, ...next];
      });
    },
    [activeCat],
  );
  const handleItemsReorderEnd = useCallback(
    (final: PriceRow[]) => {
      const ids = final.map((r) => r.id);
      setItemOrderMap((prev) => ({ ...prev, [activeCat]: ids }));
      void persistItemOrder(activeCat, ids);
    },
    [activeCat, persistItemOrder],
  );
  const itemReorder = usePointerReorder<PriceRow>(
    filtered,
    (r) => r.id,
    handleItemsReorderChange,
    handleItemsReorderEnd,
    "y",
    1.02,
  );

  // Inline input modal para renombrar categoría (evita el prompt() del navegador).
  // Crear categoría ya no pasa por acá — se creó desde el modal de
  // servicio/producto (ver PriceEditorModal), así que este modal solo
  // renombra categorías existentes (se abre desde el modo Organizar).
  const [catModal, setCatModal] = useState<{ current: string } | null>(null);
  const [catInputVal, setCatInputVal] = useState("");
  // Modo Organizar: reordenar categorías/ítems con drag&drop. Fuera de
  // este modo no se ven controles de arrastre ni de eliminar categoría.
  const [organizing, setOrganizing] = useState(false);
  // Qué categoría tiene abierto su menú de acciones (Editar nombre /
  // Eliminar categoría) dentro del modo Organizar.
  const [catActionMenu, setCatActionMenu] = useState<string | null>(null);
  // Si la categoría a eliminar todavía tiene ítems, en vez de borrarlos se
  // pide elegir a dónde moverlos primero.
  const [moveItemsModal, setMoveItemsModal] = useState<{
    category: string;
    itemCount: number;
  } | null>(null);
  const [moveTargetCategory, setMoveTargetCategory] = useState("");
  // Edición rápida de nombre por doble click (servicio/ítem), sin abrir el modal completo.
  const [itemRenameTarget, setItemRenameTarget] = useState<PriceRow | null>(null);
  const [itemRenameVal, setItemRenameVal] = useState("");

  function openItemRename(row: PriceRow) {
    setItemRenameVal(row.name);
    setItemRenameTarget(row);
  }

  function submitItemRename() {
    const clean = itemRenameVal.trim();
    const row = itemRenameTarget;
    setItemRenameTarget(null);
    if (!row || !clean || clean === row.name) return;
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, name: clean } : r)));
    setPendingItems((prev) => {
      const existing = prev.find((p) => p.tempId === row.id);
      if (existing)
        return prev.map((p) =>
          p.tempId === row.id ? { ...p, payload: { ...p.payload, name: clean } } : p,
        );
      return [...prev, { tempId: row.id, payload: { name: clean }, isNew: false }];
    });
    markSettingsDirty();
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("clippr:save-settings", {
          detail: { section: isService ? "servicios" : "catalogo" },
        }),
      );
    }, 150);
  }

  async function renameCategory(category: string) {
    setCatActionMenu(null);
    setCatInputVal(category);
    setCatModal({ current: category });
  }

  // Reordenar categorías (drag&drop con Pointer Events, mismo mecanismo que
  // los ítems). Cambia visualmente en cada movimiento; se persiste una sola
  // vez al soltar.
  const handleCategoriesReorderChange = useCallback(
    (next: string[]) => {
      if (isService) setCustomServiceCategories(next);
      else setCustomCatalogCategories(next);
    },
    [isService],
  );
  const handleCategoriesReorderEnd = useCallback(
    (final: string[]) => {
      void persistCategoryList(final, isService ? "service" : "catalog");
    },
    [isService, persistCategoryList],
  );
  const categoryReorder = usePointerReorder<string>(
    categories,
    (c) => c,
    handleCategoriesReorderChange,
    handleCategoriesReorderEnd,
    "x",
    1.04,
  );

  // Pista visual de que la fila de categorías sigue hacia los costados.
  // IntersectionObserver sobre dos "centinelas" invisibles (uno antes de
  // la primera categoría, otro después de la última) en vez de matemática
  // manual con scrollLeft/scrollWidth/clientWidth: se recalcula solo con
  // cada scroll/resize, sin listeners propios que mantener a mano ni
  // cálculos que puedan quedar desincronizados.
  const catScrollRef = useRef<HTMLDivElement | null>(null);
  const catRightSentinelRef = useRef<HTMLDivElement | null>(null);
  // Ref (no state): la animación de pista solo debe reproducirse una vez
  // por visita a la pantalla.
  const catHintPlayedRef = useRef(false);

  useEffect(() => {
    const root = catScrollRef.current;
    const rightEl = catRightSentinelRef.current;
    if (!root || !rightEl) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target === rightEl) {
            // La primera vez que se detecta que hay categorías tapadas a
            // la derecha, un movimiento leve de ida y vuelta (una sola vez,
            // sin flechas ni botones visibles) muestra que la fila se
            // puede deslizar.
            if (!entry.isIntersecting && !catHintPlayedRef.current) {
              catHintPlayedRef.current = true;
              root.scrollBy({ left: 28, behavior: "smooth" });
              window.setTimeout(() => {
                root.scrollBy({ left: -28, behavior: "smooth" });
              }, 420);
            }
          }
        }
      },
      { root, threshold: 1 },
    );
    observer.observe(rightEl);
    return () => observer.disconnect();
  }, [categories]);

  async function submitCatModal() {
    const clean = catInputVal.trim();
    const category = catModal?.current;
    setCatModal(null);
    if (!clean || !category || clean === category) return;
    if (isService) {
      const next = customServiceCategories.includes(category)
        ? customServiceCategories.map((c) => (c === category ? clean : c))
        : [...customServiceCategories, clean];
      saveCategories(next, "service");
    } else {
      const next = customCatalogCategories.includes(category)
        ? customCatalogCategories.map((c) => (c === category ? clean : c))
        : [...customCatalogCategories, clean];
      saveCategories(next, "catalog");
    }
    if (businessId) {
      await supabase
        .from("price_catalog")
        .update({ category: clean })
        .eq("business_id", businessId)
        .eq("category", category);
    }
    selectCategory(clean);
    toast.success("Categoría actualizada");
    load();
  }

  // Eliminar una categoría nunca borra sus ítems en silencio: si está
  // vacía se confirma y se borra directo; si tiene ítems, primero hay que
  // elegir a dónde moverlos (moveItemsModal).
  function deleteCategory(category: string) {
    setCatActionMenu(null);
    const itemsInCategory = rows.filter(
      (r) => (r.category || (isService ? "Servicios" : "Productos")) === category,
    );
    if (itemsInCategory.length === 0) {
      setConfirmDelCat(category);
    } else {
      setMoveItemsModal({ category, itemCount: itemsInCategory.length });
      setMoveTargetCategory(categories.find((c) => c !== category) ?? "");
    }
  }

  function removeCategoryFromList(category: string) {
    const currentCategories = categories.filter((c) => c !== category);
    if (isService)
      saveCategories(
        customServiceCategories.filter((c) => c !== category),
        "service",
      );
    else
      saveCategories(
        customCatalogCategories.filter((c) => c !== category),
        "catalog",
      );
    if (category === activeCat || !currentCategories.includes(activeCat)) {
      selectCategory(currentCategories[0]);
    }
  }

  // Solo se llama para categorías ya vacías (ver deleteCategory) — acá no
  // hace falta tocar ítems para nada.
  async function doDeleteCategory() {
    if (!confirmDelCat) return;
    const category = confirmDelCat;
    setConfirmDelCat(null);
    if (categories.filter((c) => c !== category).length === 0)
      return toast.error("Debe quedar al menos una categoría");
    removeCategoryFromList(category);
    toast.success("Categoría eliminada");
    markSettingsDirty();
  }

  async function moveItemsAndDeleteCategory() {
    if (!moveItemsModal || !businessId) return;
    const { category } = moveItemsModal;
    const target = moveTargetCategory;
    if (!target || target === category) return;
    setMoveItemsModal(null);
    await supabase
      .from("price_catalog")
      .update({ category: target })
      .eq("business_id", businessId)
      .eq("category", category);
    setRows((prev) =>
      prev.map((r) => (r.category === category ? { ...r, category: target } : r)),
    );
    removeCategoryFromList(category);
    toast.success("Ítems movidos y categoría eliminada");
    markSettingsDirty();
    load();
  }

  return (
    <>
      {/* Oculto en mobile: el drill-down de Configuración ya muestra "←
          Servicios"/"← Catálogo" arriba — repetirlo acá era redundante.
          Desktop no tiene ese header, sigue siendo la única referencia. */}
      <div className="hidden lg:block">
        <h2 className="text-xl font-display font-semibold">
          {isService ? "Servicios" : "Catálogo"}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {isService ? "Servicios que ofrecés." : "Productos para la venta."}
        </p>
      </div>

      <div className="glass overflow-visible rounded-2xl ring-1 ring-white/5">
        {!ready ? (
          <div className="grid place-items-center py-16">
            <ClipprLoader size="screen" delayMs={130} />
          </div>
        ) : (
          <>
        <div className="relative flex items-start gap-2 px-3 pt-3 pr-1 border-b border-white/5 overflow-visible">
          {/* Fila horizontal deslizable en vez de grid multi-fila: cada
              categoría se dimensiona a su propio contenido (shrink-0 +
              whitespace-nowrap, sin truncate) y la fila entera scrollea
              horizontal si no entran todas — nunca se corta un nombre. Sin
              flechas ni degradados superpuestos: solo scroll táctil, con un
              pequeño empujón de una sola vez (ver catHintPlayedRef) para
              avisar que se puede deslizar. */}
          <div className="relative min-w-0 flex-1">
            <div
              ref={catScrollRef}
              className="overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <div className="flex items-center gap-0.5">
                {categories.map((category) => {
                  const active = category === activeCat;
                  return (
                    <div
                      key={category}
                      ref={categoryReorder.setNodeRef(category)}
                      className={cn(
                        "flex shrink-0 items-center whitespace-nowrap rounded-t-lg transition-colors duration-150",
                        active && !organizing
                          ? "bg-white/5 text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                        categoryReorder.draggingId === category &&
                          "z-50 rounded-lg bg-white/10 text-foreground shadow-[0_8px_22px_-6px_rgba(139,92,246,0.6)] ring-2 ring-violet-400/60",
                      )}
                    >
                      {organizing && (
                        <span
                          onPointerDown={(event) =>
                            categoryReorder.startDrag(category, event)
                          }
                          className="grid h-9 w-7 shrink-0 touch-none select-none place-items-center rounded-md cursor-grab text-white/40 [-webkit-touch-callout:none] active:cursor-grabbing active:bg-white/5"
                        >
                          <GripVertical className="h-4 w-4" />
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          organizing
                            ? setCatActionMenu(category)
                            : selectCategory(category)
                        }
                        title={category}
                        className="flex items-center whitespace-nowrap px-2 py-2 text-sm select-none"
                      >
                        {category}
                      </button>
                    </div>
                  );
                })}
                <div ref={catRightSentinelRef} className="h-px w-px shrink-0" />
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-1.5 pl-2 pr-0">
            <button
              type="button"
              onClick={() => setOrganizing((v) => !v)}
              className={cn(
                "grid h-8 place-items-center rounded-xl px-2.5 text-xs font-semibold transition",
                organizing
                  ? "bg-gradient-to-r from-sky-400 to-violet-500 text-white"
                  : "bg-white/5 text-white/60 ring-1 ring-white/10 hover:bg-white/10 hover:text-white",
              )}
              aria-label={organizing ? "Salir de organizar" : "Organizar"}
            >
              {organizing ? "Listo" : <GripVertical className="h-4 w-4" />}
            </button>
            {!organizing && (
              <button
                type="button"
                onClick={openNew}
                className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 text-white shadow-[0_8px_24px_-10px_rgba(56,189,248,0.75)] transition hover:opacity-95"
                aria-label="Agregar"
              >
                <Plus className="h-4.5 w-4.5" strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            No hay ítems en esta sección.
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {filtered.map((row) => (
              <div
                key={row.id}
                ref={itemReorder.setNodeRef(row.id)}
                className={cn(
                  "relative flex items-center gap-3 px-5 py-3 transition-colors duration-150",
                  itemReorder.draggingId === row.id &&
                    "z-50 rounded-2xl bg-white/[0.07] shadow-[0_8px_20px_-6px_rgba(139,92,246,0.5)] ring-2 ring-violet-400/50",
                )}
              >
                {organizing && (
                  <span
                    onPointerDown={(event) => itemReorder.startDrag(row.id, event)}
                    className="grid h-10 w-9 shrink-0 touch-none select-none place-items-center rounded-lg cursor-grab text-white/35 [-webkit-touch-callout:none] active:cursor-grabbing active:bg-white/5"
                  >
                    <GripVertical className="h-4 w-4" />
                  </span>
                )}
                <ServiceImage
                  src={imageMap[row.id]}
                  alt={row.name}
                  position={imagePositionMap[row.id]}
                  className="h-11 w-11 rounded-2xl bg-white/5 ring-1 ring-white/10"
                  fallback={<span className="h-2.5 w-2.5 rounded-full bg-[oklch(0.72_0.2_245)]" />}
                />
                {/* min-w-0 + flex-1: antes este bloque competía por ancho
                    con el badge "Online", el precio del catálogo y los dos
                    botones, todos en la misma fila — con poco espacio el
                    nombre se truncaba enseguida. Ahora es el único elemento
                    flexible de la fila (Online y precio pasan a la
                    segunda línea, Activo/Editar se apilan en una columna
                    angosta a la derecha), así se lleva todo el ancho
                    disponible. line-clamp-2 en vez de truncate de una sola
                    línea: dos líneas antes de cortar con "…". */}
                <div className="min-w-0 flex-1">
                  <div
                    className="text-sm font-medium leading-snug [-webkit-box-orient:vertical] [display:-webkit-box] [-webkit-line-clamp:2] overflow-hidden"
                    title={row.name}
                    onDoubleClick={() => openItemRename(row)}
                  >
                    {row.name}
                  </div>
                  <div className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
                    {isService ? (
                      // Duración primero, precio después — mismo orden que
                      // Equipo → Comisiones, para que los dos datos
                      // principales del servicio se lean juntos.
                      <div>
                        {`${row.duration_min ? `${row.duration_min} min` : "—"} · $${Number(row.price ?? 0).toLocaleString("es-AR")}`}
                      </div>
                    ) : (
                      <>
                        <div>{`$${Number(row.price ?? 0).toLocaleString("es-AR")}`}</div>
                        {typeof row.stock === "number" && (
                          <div>{`Stock: ${row.stock}`}</div>
                        )}
                      </>
                    )}
                    {!isService && bookingConfig[row.id]?.show && (
                      <span className="mt-1 inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-500/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-violet-200 ring-1 ring-violet-400/25">
                        <Star className="h-3 w-3 fill-current" />
                        Online
                      </span>
                    )}
                  </div>
                </div>

                {/* Activo/Editar apilados en columna, alineados a la
                    derecha — antes iban uno al lado del otro compitiendo
                    por ancho con el nombre. */}
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => toggle(row)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full ring-1 px-2 py-0.5 text-[10px] uppercase tracking-wider transition hover:brightness-110",
                      row.active !== false
                        ? "bg-[oklch(0.78_0.17_140/0.12)] ring-[oklch(0.78_0.17_140/0.3)] text-[oklch(0.85_0.17_140)]"
                        : "bg-white/5 ring-white/10 text-muted-foreground hover:bg-white/10",
                    )}
                    title={row.active !== false ? "Desactivar" : "Activar"}
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        row.active !== false
                          ? "bg-[oklch(0.78_0.17_140)]"
                          : "bg-muted-foreground",
                      )}
                    />{" "}
                    {row.active !== false ? "Activo" : "Inactivo"}
                  </button>
                  <button
                    onClick={() => openEdit(row)}
                    className="rounded-lg bg-white/5 hover:bg-white/10 ring-1 ring-white/10 px-3 py-1.5 text-xs"
                  >
                    Editar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
          </>
        )}
      </div>

      <PriceEditorModal
        open={modalOpen}
        mode={editing ? "edit" : "new"}
        isService={isService}
        form={form}
        setForm={setForm}
        onClose={() => setModalOpen(false)}
        onSave={saveItem}
        onDelete={() => editing && requestDeleteItem(editing)}
        saving={saving}
        catalogCategories={categories}
        onUploadImage={uploadBookingImage}
        onCreateCategory={(name) => {
          if (categories.length >= MAX_CATEGORIES) {
            toast.error(`Máximo ${MAX_CATEGORIES} categorías alcanzado`);
            return false;
          }
          saveCategories([...categories, name], isService ? "service" : "catalog");
          return true;
        }}
        featuredOthers={
          Object.entries(bookingConfig).filter(
            ([id, c]) => c.show && id !== editing?.id,
          ).length
        }
      />
      <ConfirmDialog
        open={!!confirmDelItem}
        title={isService ? "Eliminar servicio" : "Eliminar producto"}
        message={`¿Deseás eliminar "${confirmDelItem?.name}"?`}
        onConfirm={doRemoveItem}
        onCancel={() => setConfirmDelItem(null)}
      />
      {/* Category rename modal */}
      {catModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass rounded-2xl p-6 max-w-sm w-full mx-4 ring-1 ring-white/10 space-y-4">
            <div className="font-display font-semibold text-base">
              Renombrar categoría
            </div>
            <input
              autoFocus
              value={catInputVal}
              onChange={(e) => setCatInputVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitCatModal();
                if (e.key === "Escape") setCatModal(null);
              }}
              placeholder="Nombre de la categoría"
              maxLength={MAX_CATEGORY_NAME_LENGTH}
              className="w-full rounded-xl bg-white/5 ring-1 ring-white/10 px-4 py-2.5 text-sm focus:outline-none focus:ring-primary/40"
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setCatModal(null)}
                className="px-4 py-2 rounded-xl text-sm bg-white/5 hover:bg-white/10 ring-1 ring-white/10 transition"
              >
                Cancelar
              </button>
              <button
                onClick={submitCatModal}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-sky-400 to-violet-500 text-white transition"
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Item/service quick rename modal (double click) */}
      {itemRenameTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass rounded-2xl p-6 max-w-sm w-full mx-4 ring-1 ring-white/10 space-y-4">
            <div className="font-display font-semibold text-base">
              Renombrar {isService ? "servicio" : "ítem"}
            </div>
            <input
              autoFocus
              value={itemRenameVal}
              onChange={(e) => setItemRenameVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitItemRename();
                if (e.key === "Escape") setItemRenameTarget(null);
              }}
              placeholder={isService ? "Nombre del servicio" : "Nombre del ítem"}
              maxLength={MAX_ITEM_NAME_LENGTH}
              className="w-full rounded-xl bg-white/5 ring-1 ring-white/10 px-4 py-2.5 text-sm focus:outline-none focus:ring-primary/40"
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setItemRenameTarget(null)}
                className="px-4 py-2 rounded-xl text-sm bg-white/5 hover:bg-white/10 ring-1 ring-white/10 transition"
              >
                Cancelar
              </button>
              <button
                onClick={submitItemRename}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-sky-400 to-violet-500 text-white transition"
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Acciones de categoría (modo Organizar): editar nombre o eliminar.
          Modal centrado en vez de un menú anclado a la pestaña — la fila de
          categorías tiene scroll horizontal, así que un dropdown pegado a
          la pestaña quedaría recortado por el propio contenedor. */}
      {catActionMenu && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
          onClick={() => setCatActionMenu(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="glass w-full max-w-sm rounded-t-2xl p-2 ring-1 ring-white/10 space-y-1 sm:rounded-2xl sm:mx-4"
          >
            <div className="px-3 py-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {catActionMenu}
            </div>
            <button
              type="button"
              onClick={() => renameCategory(catActionMenu)}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-3 text-left text-sm text-white/85 transition hover:bg-white/10 hover:text-white"
            >
              <Pencil className="h-4 w-4 text-sky-300" />
              Editar nombre
            </button>
            <button
              type="button"
              disabled={categories.length <= 1}
              onClick={() => deleteCategory(catActionMenu)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-xl px-3 py-3 text-left text-sm transition",
                categories.length <= 1
                  ? "cursor-not-allowed text-white/30"
                  : "text-red-300 hover:bg-red-500/10",
              )}
            >
              <Trash2 className="h-4 w-4" />
              Eliminar categoría
            </button>
            <button
              type="button"
              onClick={() => setCatActionMenu(null)}
              className="flex w-full items-center justify-center rounded-xl px-3 py-3 text-sm text-muted-foreground transition hover:bg-white/5"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!confirmDelCat}
        title="Eliminar categoría"
        message={`¿Deseás eliminar la categoría "${confirmDelCat}"? Está vacía, no tiene ${isService ? "servicios" : "productos"}.`}
        onConfirm={doDeleteCategory}
        onCancel={() => setConfirmDelCat(null)}
      />
      {/* La categoría tiene ítems: hay que decidir a dónde van antes de
          poder borrarla — nunca se eliminan ni desactivan automáticamente. */}
      {moveItemsModal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass rounded-2xl p-6 max-w-sm w-full ring-1 ring-white/10 space-y-4">
            <div>
              <div className="font-display font-semibold text-base">
                Mover {isService ? "servicios" : "productos"} antes de eliminar
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                "{moveItemsModal.category}" tiene {moveItemsModal.itemCount}{" "}
                {isService ? "servicio" : "producto"}
                {moveItemsModal.itemCount === 1 ? "" : "s"}. Elegí a dónde
                moverlos para poder eliminar la categoría.
              </p>
            </div>
            <select
              value={moveTargetCategory}
              onChange={(e) => setMoveTargetCategory(e.target.value)}
              className="w-full rounded-xl bg-white/5 ring-1 ring-white/10 px-4 py-2.5 text-sm focus:outline-none focus:ring-primary/40"
            >
              {categories
                .filter((c) => c !== moveItemsModal.category)
                .map((c) => (
                  <option key={c}>{c}</option>
                ))}
            </select>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setMoveItemsModal(null)}
                className="px-4 py-2 rounded-xl text-sm bg-white/5 hover:bg-white/10 ring-1 ring-white/10 transition"
              >
                Cancelar
              </button>
              <button
                onClick={moveItemsAndDeleteCategory}
                disabled={!moveTargetCategory}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-sky-400 to-violet-500 text-white transition disabled:opacity-50"
              >
                Mover y eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function ServiciosSection() {
  return <PriceCatalogSection kind="servicios" />;
}

export function CatalogoSection() {
  return <PriceCatalogSection kind="catalogo" />;
}
