import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const VIEW = 280;

// Recorte redondo de una foto: se arrastra para centrar y se agranda con el deslizador.
// Devuelve un cuadrado (el círculo se ve al mostrarlo con bordes redondos).
export function AvatarCropper({
  src,
  onCancel,
  onDone,
}: {
  src: string;
  onCancel: () => void;
  onDone: (file: File) => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = new Image();
    el.onload = () => setImg(el);
    el.src = src;
  }, [src]);

  const base = img ? Math.max(VIEW / img.width, VIEW / img.height) : 1;
  const scale = base * zoom;
  const clamp = (x: number, y: number, s = scale) => {
    if (!img) return { x: 0, y: 0 };
    const mx = Math.max(0, (img.width * s - VIEW) / 2);
    const my = Math.max(0, (img.height * s - VIEW) / 2);
    return { x: Math.min(mx, Math.max(-mx, x)), y: Math.min(my, Math.max(-my, y)) };
  };

  function save() {
    if (!img) return;
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const left = VIEW / 2 + pos.x - (img.width * scale) / 2;
    const top = VIEW / 2 + pos.y - (img.height * scale) / 2;
    ctx.drawImage(img, -left / scale, -top / scale, VIEW / scale, VIEW / scale, 0, 0, size, size);
    canvas.toBlob(
      (blob) => {
        if (blob) onDone(new File([blob], "foto.webp", { type: "image/webp" }));
      },
      "image/webp",
      0.9,
    );
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[10050] grid place-items-center bg-black/80 p-4">
      <div className="w-full max-w-sm rounded-[28px] border border-violet-400/45 bg-[#08070f] p-5 shadow-2xl">
        <div className="text-lg font-semibold text-white">Centrá la foto</div>
        <div
          className="relative mx-auto mt-4 touch-none overflow-hidden rounded-full bg-black ring-2 ring-violet-400/50"
          style={{ width: VIEW, height: VIEW }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            setPos(clamp(d.x + e.clientX - d.px, d.y + e.clientY - d.py));
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        >
          {img && (
            <img
              src={src}
              alt=""
              draggable={false}
              className="pointer-events-none absolute max-w-none select-none"
              style={{
                width: img.width * scale,
                height: img.height * scale,
                left: VIEW / 2 + pos.x - (img.width * scale) / 2,
                top: VIEW / 2 + pos.y - (img.height * scale) / 2,
              }}
            />
          )}
        </div>
        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          aria-label="Zoom"
          onChange={(e) => {
            const z = Number(e.target.value);
            setZoom(z);
            setPos((p) => clamp(p.x, p.y, base * z));
          }}
          className="mt-4 w-full accent-violet-400"
        />
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-12 flex-1 rounded-full bg-white/5 text-base text-white/70 ring-1 ring-white/10"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!img}
            className="h-12 flex-1 rounded-full bg-gradient-to-r from-sky-400 to-violet-500 text-base font-semibold text-white shadow-[0_0_22px_-6px_rgba(139,92,246,0.8)] disabled:opacity-50"
          >
            Listo
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
