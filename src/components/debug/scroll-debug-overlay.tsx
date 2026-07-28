import * as React from "react";

// Overlay de diagnóstico TEMPORAL — no altera ningún comportamiento (todos
// los listeners son passive y nunca llaman preventDefault; el panel tiene
// pointerEvents:"none" así que no puede él mismo interferir con el touch).
// Objetivo: capturar evidencia real de qué pasa en el momento exacto del
// primer touch en iPhone, en vez de seguir corrigiendo a partir de
// hipótesis. Sacar este componente y su import apenas se identifique la
// causa real.
export function ScrollDebugOverlay() {
  const [log, setLog] = React.useState<string[]>([]);
  const [snapshots, setSnapshots] = React.useState<string[]>([]);

  React.useEffect(() => {
    function push(line: string) {
      const t = performance.now().toFixed(0).padStart(5, "0");
      setLog((prev) => [...prev.slice(-19), `${t}ms ${line}`]);
    }

    function snap(label: string) {
      const de = document.documentElement;
      const body = document.body;
      const csDe = getComputedStyle(de);
      const csBody = getComputedStyle(body);
      const mainEl = document.querySelector(".clippr-app-main");
      const csMain = mainEl ? getComputedStyle(mainEl) : null;
      const line =
        `[${label}] standalone=${(window.navigator as any).standalone ?? "n/a"} ` +
        `de(scroll=${de.scrollHeight},client=${de.clientHeight},ovY=${csDe.overflowY}) ` +
        `body(scroll=${body.scrollHeight},client=${body.clientHeight},ovY=${csBody.overflowY},pos=${csBody.position}) ` +
        `main(ovY=${csMain?.overflowY ?? "n/a"},h=${csMain?.height ?? "n/a"}) ` +
        `innerH=${window.innerHeight} vvH=${window.visualViewport?.height ?? "n/a"} scrollY=${window.scrollY}`;
      setSnapshots((prev) => [...prev, line]);
    }

    snap("mount");
    const t1 = setTimeout(() => snap("+300ms"), 300);
    const t2 = setTimeout(() => snap("+1000ms"), 1000);
    const t3 = setTimeout(() => snap("+2500ms"), 2500);

    const onTouchStart = (e: TouchEvent) =>
      push(`touchstart y=${e.touches[0]?.clientY.toFixed(0)} scrollY=${window.scrollY} target=${(e.target as HTMLElement)?.tagName}.${(e.target as HTMLElement)?.className?.toString().slice(0, 30)}`);
    const onTouchMove = (e: TouchEvent) =>
      push(`touchmove y=${e.touches[0]?.clientY.toFixed(0)} scrollY=${window.scrollY} defaultPrevented=${e.defaultPrevented}`);
    const onTouchEnd = () => push(`touchend scrollY=${window.scrollY}`);
    const onTouchCancel = () => push(`touchcancel scrollY=${window.scrollY}`);
    const onScroll = () => push(`scroll scrollY=${window.scrollY}`);
    const onResize = () => {
      push(`resize innerH=${window.innerHeight} vvH=${window.visualViewport?.height ?? "n/a"}`);
      snap("resize");
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true, capture: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true, capture: true });
    document.addEventListener("touchcancel", onTouchCancel, { passive: true, capture: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    window.visualViewport?.addEventListener("resize", onResize);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      document.removeEventListener("touchstart", onTouchStart, true);
      document.removeEventListener("touchmove", onTouchMove, true);
      document.removeEventListener("touchend", onTouchEnd, true);
      document.removeEventListener("touchcancel", onTouchCancel, true);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, []);

  const fullText = [...snapshots, "── eventos ──", ...log].join("\n");

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 999999,
        pointerEvents: "none",
        fontSize: 8.5,
        lineHeight: 1.35,
        fontFamily: "monospace",
        color: "#0f0",
        background: "rgba(0,0,0,0.82)",
        padding: "4px 6px",
        maxHeight: "46vh",
        overflow: "hidden",
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
      }}
    >
      <button
        type="button"
        style={{
          pointerEvents: "auto",
          color: "#000",
          background: "#0f0",
          border: "none",
          borderRadius: 4,
          padding: "2px 6px",
          fontSize: 9,
          marginBottom: 3,
        }}
        onClick={() => {
          navigator.clipboard?.writeText(fullText).catch(() => {});
        }}
      >
        COPIAR DEBUG
      </button>
      {snapshots.map((s, i) => (
        <div key={`s${i}`}>{s}</div>
      ))}
      <div>── eventos ──</div>
      {log.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  );
}
