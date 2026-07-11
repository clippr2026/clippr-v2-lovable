import * as React from "react";
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
export async function processImage(
  file: File,
  maxW: number,
  maxH: number,
  quality = 0.8,
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
  const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
  const w = Math.max(1, Math.round(img.width * ratio));
  const h = Math.max(1, Math.round(img.height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo procesar la imagen");
  ctx.drawImage(img, 0, 0, w, h);
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
      onClick={() => onChange(!on)}
      className={cn(
        "relative h-6 w-11 rounded-full transition-colors ring-1",
        on
          ? "bg-gradient-to-r from-sky-400 to-violet-500 ring-violet-400/45"
          : "bg-white/5 ring-white/10",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
          on ? "translate-x-[22px]" : "translate-x-0.5",
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
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
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
    </div>
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
