import * as React from "react";
import { Maximize2, Monitor, Smartphone, X } from "lucide-react";
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
  large = false,
}: {
  slug: string;
  draft: PreviewDraft;
  refreshKey: number;
  onClose?: () => void;
  large?: boolean;
}) {
  const [mode, setMode] = React.useState<"mobile" | "web">("mobile");
  const [expanded, setExpanded] = React.useState(false);
  const [boxHpx, setBoxHpx] = React.useState(0);
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const [boxW, setBoxW] = React.useState(360);

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

  // Móvil: la página a 390 px de ancho llenando el panel. Web: a 1100 px de ancho,
  // achicada para entrar (con "Ampliar" se ve grande).
  const deviceW = mode === "mobile" ? 390 : 1100;
  const scale = mode === "mobile" ? Math.min(boxW / 390, large ? 1.15 : 1.4) : boxW / deviceW;
  const boxH = large ? Math.round(window.innerHeight * 0.78) : mode === "mobile" ? 700 : Math.round(boxW * 0.7);
  const deviceH = Math.round(boxH / scale);
  void boxHpx;

  const post = React.useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage({ type: "clippr:preview-draft", draft }, window.location.origin);
  }, [draft]);

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
      <div
        ref={boxRef}
        className="relative w-full overflow-hidden rounded-xl border border-white/10 bg-black/30"
        style={{ height: boxH }}
      >
        <div className="relative mx-auto h-full overflow-hidden" style={{ width: Math.round(deviceW * scale) }}>
        <iframe
          key={`${mode}-${refreshKey}`}
          ref={iframeRef}
          title="Vista previa de la página pública"
          src={`${window.location.origin}/negocio/${slug}?preview=1`}
          onLoad={post}
          style={{
            width: deviceW,
            height: deviceH,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            border: 0,
            background: "#fff",
          }}
        />
        </div>
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
