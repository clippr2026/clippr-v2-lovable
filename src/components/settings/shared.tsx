import * as React from "react";
import { cn } from "@/lib/utils";

export function SectionCard({
  label,
  children,
  id,
}: {
  label: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <div id={id} className="glass rounded-2xl p-4 ring-1 ring-white/5">
      {label ? (
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 mb-4">
          {label}
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
