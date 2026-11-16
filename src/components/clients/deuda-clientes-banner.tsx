import * as React from "react";
import { ChevronRight, Clock } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import type { Employee } from "@/components/cash-register/use-caja-data";
import {
  CobrarPendienteModal,
  usePendingDebtSummary,
} from "@/components/cash-register/cobrar-pendiente";

// Clientes → aviso "Clientes con saldo pendiente". La deuda es un dato del
// cliente (no un número del día de la caja), por eso vive acá. Solo se pinta
// cuando ya se sabe que hay deuda; toque abre "Cobrar pendiente" (misma
// pantalla que Caja → Ingresar dinero), con la lista de quién debe y cuánto.
export function DeudaClientesBanner() {
  const { businessId, activeBranchId, profile, session } = useAuth();
  const summary = usePendingDebtSummary(businessId, activeBranchId);
  const [open, setOpen] = React.useState(false);
  const [employees, setEmployees] = React.useState<Employee[]>([]);

  // Solo se necesitan los nombres de los profesionales (para mostrar quién
  // hizo cada venta) y únicamente cuando se abre el modal.
  React.useEffect(() => {
    if (!open || !businessId) return;
    let cancelled = false;
    void (async () => {
      // employees no tiene columna `name`: el nombre está en `full_name`. Pedir `name` fallaba
      // en silencio, la lista quedaba vacía y la venta salía sin profesional ("—").
      const { data } = await supabase
        .from("employees")
        .select("id, full_name, avatar_url")
        .eq("business_id", businessId);
      if (cancelled) return;
      setEmployees(
        ((data ?? []) as any[]).map((e) => ({
          id: e.id as string,
          name: (e.full_name as string | null) || "Profesional",
          avatar_url: (e.avatar_url as string | null) ?? null,
          commission_pct: null,
          commission_fixed: null,
          commission_enabled: true,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [open, businessId]);

  if (summary.loading || summary.total <= 0 || !businessId) return null;

  const email = String(session?.user?.email ?? "").trim();
  const collectedByName = profile?.full_name || (email ? email.split("@")[0] : "Recepción");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full shrink-0 items-center sm:mr-auto sm:w-auto sm:min-w-[22rem] gap-2.5 rounded-2xl border border-violet-400/30 bg-white/[0.03] px-3.5 py-2.5 text-left [background-image:radial-gradient(110%_90%_at_100%_0%,rgba(79,125,255,.14),transparent_62%),radial-gradient(90%_80%_at_0%_100%,rgba(139,92,246,.12),transparent_65%)] transition hover:border-violet-400/50"
      >
        <Clock className="h-5 w-5 shrink-0 text-violet-300" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold leading-tight text-white">Clientes con saldo pendiente</span>
          <span className="mt-0.5 block text-xs font-semibold text-violet-300">Tocá para cobrar</span>
        </span>
        <span className="shrink-0 text-base font-semibold tabular-nums text-white">
          ${Math.round(summary.total).toLocaleString("es-AR")}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-white/40" />
      </button>

      {open && (
        <CobrarPendienteModal
          businessId={businessId}
          branchId={activeBranchId}
          employees={employees}
          collectedBy={profile?.id ?? ""}
          collectedByName={collectedByName}
          onClose={() => setOpen(false)}
          onCollected={() => void summary.refresh()}
        />
      )}
    </>
  );
}
