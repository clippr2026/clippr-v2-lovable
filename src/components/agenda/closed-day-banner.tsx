import * as React from "react";
import { CalendarOff } from "lucide-react";
import { useClosures } from "@/hooks/use-closures";

/** Si el aviso fallara por cualquier motivo, no se muestra: nunca rompe la pantalla que lo contiene. */
class SilentBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {}
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function Banner({ businessId, branchId, from, to }: { businessId: string | null; branchId: string | null; from: string; to: string }) {
  const closures = useClosures(businessId, branchId);
  const closure = (closures.data ?? []).find((c) => from >= c.start_date && to <= c.end_date) ?? null;
  if (!closure) return null;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-3 rounded-2xl bg-rose-500/10 px-4 py-3 ring-1 ring-rose-400/25">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-300">
        <CalendarOff className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div className="text-sm font-bold tracking-wide text-rose-200">CERRADO</div>
        <div className="text-xs text-rose-200/70">{closure.reason?.trim() || "Día cerrado"}</div>
      </div>
    </div>
  );
}

/**
 * Aviso "CERRADO" (Cierres de Agenda) para vistas que no son la Agenda general, como Mi Panel.
 * Mismo criterio y diseño que la Agenda: solo avisa, los turnos existentes no se tocan.
 */
export function ClosedDayBanner(props: { businessId: string | null | undefined; branchId: string | null | undefined; from: string; to: string }) {
  if (!props.businessId) return null;
  return (
    <SilentBoundary>
      <Banner businessId={props.businessId} branchId={props.branchId ?? null} from={props.from} to={props.to} />
    </SilentBoundary>
  );
}
