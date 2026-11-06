import * as React from "react";
import { Maximize2, Monitor, Pencil, Smartphone, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type PreviewDraft = {
  colors: { primary: string; secondary: string; accent: string; buttonText: string };
  theme: "dark" | "light";
  font: string | null;
  coverPosition: string;
  avatarPosition: string;
  coverUrl: string;
  avatarUrl: string;
  name: string;
};

// Vista previa de la página pública, en vivo: el iframe carga la página real
// (?preview=1) y recibe por postMessage lo que se está editando (colores, letra,
// imágenes y nombre) sin esperar al guardado. El resto de los datos se ve al
// recargarse la vista, que ocurre sola después de guardar (refreshKey).
export function PublicPagePreview({
  slug,
  draft,
  refreshKey,
  onClose,
  onEditor,
  large = false,
}: {
  slug: string;
  draft: PreviewDraft;
  refreshKey: number;
  onClose?: () => void;
  onEditor?: () => void;
  large?: boolean;
}) {
  const [mode, setMode] = React.useState<"mobile" | "web">("mobile");
  const [expanded, setExpanded] = React.useState(false);
  const [boxHpx, setBoxHpx] = React.useState(0);
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const [boxW, setBoxW] = React.useState(360);
  const [vh, setVh] = React.useState(() => (typeof window === "undefined" ? 800 : window.innerHeight));
  React.useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  React.useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setBoxW(el.clientWidth);
      setBoxHpx(el.clientHeight);
    });
    ro.observe(el);
    setBoxW(el.clientWidth);
    setBoxHpx(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const post = React.useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage({ type: "clippr:preview-draft", draft }, window.location.origin);
  }, [draft]);

  // Móvil: celular (390 px de ancho real) dentro de un marco con notch, centrado.
  // Web: ventana de navegador (1100 px de ancho real) achicada para entrar.
  const frameW = Math.max(200, boxW - 8);
  // Alto disponible: casi todo el alto de la pantalla (menos el encabezado del panel).
  const maxH = Math.max(420, large ? vh - 150 : vh - 170);
  const deviceW = mode === "mobile" ? 390 : 1100;
  const mobileInnerW = Math.min(frameW - 20, Math.floor(maxH / 2.05), large ? 560 : 520);
  const innerW = mode === "mobile" ? mobileInnerW : frameW - 2;
  const scale = innerW / deviceW;
  const innerH = mode === "mobile" ? Math.round(innerW * 2.05) : Math.min(Math.round(innerW * 0.66), maxH);
  const deviceH = Math.round(innerH / scale);
  void boxHpx;
  const previewUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/negocio/${slug}?preview=1`;
  const frame = (
    <iframe
      key={`${mode}-${refreshKey}`}
      ref={iframeRef}
      title="Vista previa de la página pública"
      src={previewUrl}
      onLoad={post}
      style={{
        width: deviceW,
        height: deviceH,
        transform: `scale(${scale})`,
        transformOrigin: "top left",
        border: 0,
        background: "#fff",
        display: "block",
      }}
    />
  );

  React.useEffect(() => {
    post();
  }, [post]);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">Vista previa</div>
        <div className="flex items-center gap-2">
          <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
            {(
              [
                { key: "mobile", label: "Móvil", Icon: Smartphone },
                { key: "web", label: "Web", Icon: Monitor },
              ] as const
            ).map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setMode(key)}
                className={cn(
                  "inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition",
                  mode === key ? "bg-white text-slate-950" : "text-white/65 hover:bg-white/10 hover:text-white",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
          {onEditor ? (
            <button
              type="button"
              onClick={onEditor}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-r from-sky-400 to-violet-500 px-3 text-xs font-semibold text-white"
              title="Editar la página pública"
            >
              <Pencil className="h-3.5 w-3.5" />
              Editar
            </button>
          ) : null}
          {!large ? (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="grid h-8 w-8 place-items-center rounded-lg bg-white/5 text-white/70 ring-1 ring-white/10 hover:bg-white/10"
              aria-label="Ampliar vista previa"
              title="Ampliar"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          ) : null}
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-lg bg-white/5 text-white/70 ring-1 ring-white/10 hover:bg-white/10"
              aria-label="Cerrar vista previa"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
      <div ref={boxRef} className="flex w-full justify-center py-2">
        {mode === "mobile" ? (
          <div
            className="relative rounded-[2.6rem] bg-zinc-900 p-[9px] shadow-[0_20px_60px_rgba(0,0,0,0.6)] ring-1 ring-white/20"
            style={{ width: innerW + 18 }}
          >
            <div className="pointer-events-none absolute left-1/2 top-[14px] z-10 h-[18px] w-[72px] -translate-x-1/2 rounded-full bg-black/90" />
            <div className="overflow-hidden rounded-[2.1rem] bg-white" style={{ width: innerW, height: innerH }}>
              {frame}
            </div>
          </div>
        ) : (
          <div
            className="overflow-hidden rounded-xl bg-zinc-900 shadow-[0_20px_60px_rgba(0,0,0,0.5)] ring-1 ring-white/20"
            style={{ width: innerW + 2 }}
          >
            <div className="flex items-center gap-2 bg-zinc-800 px-3 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-300/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
              <span className="ml-2 min-w-0 flex-1 truncate rounded-md bg-black/40 px-2 py-0.5 text-[10px] text-white/55">
                myclippr.com/negocio/{slug}
              </span>
            </div>
            <div className="overflow-hidden bg-white" style={{ width: innerW, height: innerH, margin: "0 auto" }}>
              {frame}
            </div>
          </div>
        )}
      </div>
      {expanded ? (
        <div className="fixed inset-0 z-[90] overflow-y-auto bg-black/80 p-4 backdrop-blur-sm">
          <div className="mx-auto max-w-6xl">
            <PublicPagePreview
              slug={slug}
              draft={draft}
              refreshKey={refreshKey}
              large
              onClose={() => setExpanded(false)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
