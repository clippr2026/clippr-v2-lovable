import * as React from "react";
import { ChevronRight, Clock } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import type { Employee } from "@/components/cash-register/use-caja-data";
import {
  CobrarPendienteModal,
  searchPendingDebts,
  usePendingDebtSummary,
  type PendingDebt,
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
        className="flex w-full shrink-0 items-center gap-2.5 rounded-2xl border border-rose-400/45 px-3.5 py-2.5 text-left transition hover:border-rose-400/70"
        style={{ background: "radial-gradient(110% 90% at 100% 0%, rgba(244,63,94,.20), transparent 62%), radial-gradient(90% 80% at 0% 100%, rgba(244,63,94,.10), transparent 65%)", boxShadow: "0 0 26px -12px rgba(244,63,94,.55)" }}
      >
        <Clock className="h-5 w-5 shrink-0 text-rose-300" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold leading-tight text-white">Clientes con saldo pendiente</span>
          <span className="mt-0.5 block text-xs font-semibold text-rose-300">Tocá para cobrar</span>
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

// Ficha del cliente → tarjeta "Saldo pendiente" con el botón para abonar desde ahí. Solo se muestra si ese cliente debe algo.
export function DeudaClienteTarjeta({ clientId, clientName }: { clientId: string; clientName: string }) {
  const { businessId, activeBranchId, profile, session } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [employees, setEmployees] = React.useState<Employee[]>([]);
  const [debts, setDebts] = React.useState<PendingDebt[]>([]);

  const cargar = React.useCallback(async () => {
    if (!businessId) return;
    try {
      setDebts(await searchPendingDebts({ businessId, branchId: activeBranchId, clientId, clientName, status: "todos" }));
    } catch {
      setDebts([]);
    }
  }, [businessId, activeBranchId, clientId, clientName]);

  React.useEffect(() => {
    void cargar();
  }, [cargar]);

  React.useEffect(() => {
    if (!open || !businessId) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.from("employees").select("id, full_name, avatar_url").eq("business_id", businessId);
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

  const saldo = debts.reduce((s, d) => s + Math.max(0, d.total - d.collected_amount), 0);
  if (!businessId || saldo <= 0) return null;

  const email = String(session?.user?.email ?? "").trim();
  const collectedByName = profile?.full_name || (email ? email.split("@")[0] : "Recepción");

  return (
    <>
      <div
        className="flex items-center gap-3 rounded-2xl border border-violet-400/30 bg-white/[0.03] p-4"
        style={{
          background:
            "radial-gradient(110% 90% at 100% 0%, rgba(79,125,255,.16), transparent 62%), radial-gradient(90% 80% at 0% 100%, rgba(139,92,246,.12), transparent 65%)",
        }}
      >
        <Clock className="h-5 w-5 shrink-0 text-violet-300" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white">Saldo pendiente</div>
          <div className="text-lg font-semibold tabular-nums text-white">${Math.round(saldo).toLocaleString("es-AR")}</div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="h-10 shrink-0 rounded-full bg-[linear-gradient(135deg,#34D399,#10B981)] px-5 text-sm font-bold text-white transition hover:brightness-110"
        >
          Abonar
        </button>
      </div>
      {open && (
        <CobrarPendienteModal
          businessId={businessId}
          branchId={activeBranchId}
          employees={employees}
          collectedBy={profile?.id ?? ""}
          collectedByName={collectedByName}
          clientId={clientId}
          clientName={clientName}
          onClose={() => setOpen(false)}
          onCollected={() => void cargar()}
        />
      )}
    </>
  );
}
