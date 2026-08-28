import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export type PriceRow = {
  id: string;
  name: string;
  price: number;
  duration_min: number | null;
  category: string | null;
  active: boolean | null;
  stock?: number | null;
  cash_discount?: number | null;
  // "Precio efectivo" estándar del servicio — no confundir con
  // cash_discount ("Precio en efectivo", el descuento por pago en
  // efectivo). null = no configurado.
  effective_price?: number | null;
};

export function SectionCard({
  label,
  headerRight,
  children,
  id,
}: {
  // Normalmente un string, pero acepta cualquier nodo (ej. ícono + texto
  // coloreados) para secciones que quieren reforzar su identidad visual.
  label: React.ReactNode;
  // Elemento opcional alineado a la derecha del label (ej. un switch que
  // habilita/deshabilita el contenido de la sección).
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <div id={id} className="glass rounded-2xl p-4 ring-1 ring-white/5">
      {label ? (
        <div className={cn("flex items-center justify-between gap-3", headerRight ? "mb-3" : "mb-4")}>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
            {label}
          </div>
          {headerRight}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function reportSaveStatus(status: "saving" | "saved") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("clippr:save-status", { detail: { status } }),
  );
}

export function markSettingsDirty() {
  // Configuración guarda automáticamente o mediante botones propios de cada panel.
  // No disparamos más el estado global de "cambios sin guardar" para evitar
  // el modal al cambiar de sección/cerrar editores.
}

// Optimiza una imagen del lado del cliente: redimensiona (sin agrandar) dentro de
// maxW x maxH y la convierte a WebP (cae a JPEG si el navegador no soporta WebP).
// Detecta el rectángulo real del contenido no-transparente de una imagen
// (para recortar el "aire" alrededor de logos con mucho padding
// transparente). Escanea sobre una versión achicada (barata en CPU incluso
// para archivos grandes) y mapea el resultado de vuelta a las coordenadas
// originales para no perder resolución al recortar. Devuelve null si no
// hay canvas, si el escaneo falla, o si el contenido ya ocupa casi todo el
// lienzo (no vale la pena recortar un margen insignificante).
function findOpaqueBounds(
  img: HTMLImageElement,
): { x: number; y: number; w: number; h: number } | null {
  const SCAN_MAX = 300;
  const ALPHA_THRESHOLD = 10;
  const scale = Math.min(1, SCAN_MAX / Math.max(img.width, img.height));
  const sw = Math.max(1, Math.round(img.width * scale));
  const sh = Math.max(1, Math.round(img.height * scale));
  const scanCanvas = document.createElement("canvas");
  scanCanvas.width = sw;
  scanCanvas.height = sh;
  const scanCtx = scanCanvas.getContext("2d");
  if (!scanCtx) return null;
  scanCtx.drawImage(img, 0, 0, sw, sh);
  let data: Uint8ClampedArray;
  try {
    data = scanCtx.getImageData(0, 0, sw, sh).data;
  } catch {
    return null;
  }
  let minX = sw, minY = sh, maxX = -1, maxY = -1;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (data[(y * sw + x) * 4 + 3] > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null;
  if (maxX - minX + 1 >= sw * 0.98 && maxY - minY + 1 >= sh * 0.98) return null;
  const scaleBackX = img.width / sw;
  const scaleBackY = img.height / sh;
  const x = Math.max(0, Math.floor(minX * scaleBackX));
  const y = Math.max(0, Math.floor(minY * scaleBackY));
  const w = Math.min(img.width - x, Math.ceil((maxX - minX + 1) * scaleBackX));
  const h = Math.min(img.height - y, Math.ceil((maxY - minY + 1) * scaleBackY));
  return { x, y, w, h };
}

export async function processImage(
  file: File,
  maxW: number,
  maxH: number,
  quality = 0.8,
  // trimTransparent: recorta el margen transparente antes de escalar (ver
  // findOpaqueBounds) — para logos/escudos con mucho padding transparente
  // en el archivo original, así el contenido visible siempre aprovecha el
  // máximo del lienzo final en vez de quedar "flotando" chico adentro.
  // Solo tiene efecto si la imagen realmente tiene canal alfa con margen
  // transparente real; una foto opaca (JPEG) sale sin cambios.
  options?: { trimTransparent?: boolean },
): Promise<{ blob: Blob; ext: string; type: string }> {
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(new Error("No se pudo leer la imagen"));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("No se pudo cargar la imagen"));
    i.src = dataUrl;
  });
  let sx = 0;
  let sy = 0;
  let sw = img.width;
  let sh = img.height;
  if (options?.trimTransparent) {
    const bounds = findOpaqueBounds(img);
    if (bounds) {
      sx = bounds.x;
      sy = bounds.y;
      sw = bounds.w;
      sh = bounds.h;
    }
  }
  const ratio = Math.min(maxW / sw, maxH / sh, 1);
  const w = Math.max(1, Math.round(sw * ratio));
  const h = Math.max(1, Math.round(sh * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo procesar la imagen");
  // "high" en vez del smoothing por defecto del navegador (a veces "low"):
  // se nota sobre todo achicando gráficos con bordes marcados (logos,
  // escudos) — sin esto el downscale puede verse borroso/con artefactos
  // aunque el archivo final tenga buena resolución.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  const toBlob = (type: string) =>
    new Promise<Blob | null>((res) =>
      canvas.toBlob((b) => res(b), type, quality),
    );
  let blob = await toBlob("image/webp");
  let ext = "webp";
  let type = "image/webp";
  if (!blob) {
    blob = await toBlob("image/jpeg");
    ext = "jpg";
    type = "image/jpeg";
  }
  if (!blob) throw new Error("No se pudo procesar la imagen");
  return { blob, ext, type };
}

export function Toggle({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn(
        // shrink-0: sin esto, dentro de una fila flex angosta (ej. un modal
        // en mobile con label largo al lado) el track de 44px podía
        // comprimirse por flexbox mientras el circulito seguía
        // desplazándose translate-x-[22px] fijo, pensado para el ancho
        // completo — el resultado era el circulito saliéndose del track ya
        // achicado. overflow-hidden es una segunda garantía: aunque algo
        // más algún día empuje el circulito de más, nunca se va a ver
        // sobresaliendo del pill redondeado.
        "relative h-6 w-11 shrink-0 overflow-hidden rounded-full transition-colors duration-200 ring-1",
        on
          ? "bg-gradient-to-r from-sky-400 to-violet-500 ring-violet-400/45"
          : "bg-white/5 ring-white/10",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200",
          on ? "translate-x-[20px]" : "translate-x-0",
        )}
      />
    </button>
  );
}

// ─────────── ConfirmDialog ───────────
export function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = "Eliminar",
  danger = true,
}: {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  danger?: boolean;
}) {
  if (!open) return null;
  if (typeof document === "undefined") return null;
  // Portal a document.body (igual que PriceEditorModal/AddEmployeeModal):
  // este diálogo se dispara a menudo desde ADENTRO de otro modal ya
  // porteado a body con z-[9999] (p.ej. "Editar servicio"). Si ConfirmDialog
  // se quedara montado en su lugar normal del árbol, seguiría atrapado
  // dentro del stacking context de AppShell (el <div className="relative
  // z-10"> que envuelve todo el contenido) — y ningún z-index, por alto que
  // sea, puede escapar de ahí para ganarle a un portal-sibling de body con
  // z-index propio. Body no tiene stacking context, así que acá el z-index
  // sí compara de verdad contra el modal de atrás.
  return createPortal(
    // z-[10000]: por encima de los modales de edición (z-[9999], p.ej.
    // "Editar servicio"), que quedan abiertos de fondo cuando este diálogo
    // se dispara desde adentro de ellos.
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass rounded-2xl p-6 max-w-sm w-full mx-4 ring-1 ring-white/10 space-y-4">
        <div>
          <div className="font-display font-semibold text-base text-foreground">
            {title}
          </div>
          <div className="text-sm text-muted-foreground mt-1">{message}</div>
        </div>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-sm bg-white/5 hover:bg-white/10 ring-1 ring-white/10 transition"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className={cn(
              "px-4 py-2 rounded-xl text-sm font-semibold transition",
              danger
                ? "bg-red-500/20 hover:bg-red-500/30 ring-1 ring-red-500/40 text-red-300"
                : "bg-gradient-to-r from-sky-400 to-violet-500 text-white",
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export const inputCls =
  "w-full rounded-lg bg-white/5 ring-1 ring-white/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-primary/40";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 mb-1.5">
        {label}
      </div>
      {children}
      {hint && (
        <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>
      )}
    </div>
  );
}

export function normalizePublicBooleanMap(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key.trim().length > 0)
      .map(([key, next]) => [key, next !== false]),
  );
}

export function getPublicVisibility(schedule: Record<string, unknown>) {
  return (schedule._publicVisibility ?? {}) as Record<string, unknown>;
}
