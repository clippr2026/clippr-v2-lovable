import * as React from "react";
import { Clock } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import type { Employee } from "@/components/cash-register/use-caja-data";
import {
  CobrarPendienteModal,
  searchPendingDebts,
  type PendingDebt,
} from "@/components/cash-register/cobrar-pendiente";

// Ventana de cobro de deudas que carga sola los nombres de los profesionales (notificaciones y cobro de un turno).
export function CobrarDeudas({ soloIds, onClose, onCollected }: { soloIds?: string[]; onClose: () => void; onCollected: () => void }) {
  const { businessId, activeBranchId, profile, session } = useAuth();
  const [employees, setEmployees] = React.useState<Employee[]>([]);

  React.useEffect(() => {
    if (!businessId) return;
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
  }, [businessId]);

  if (!businessId) return null;
  const email = String(session?.user?.email ?? "").trim();

  return (
    // La ventana se dibuja en <body>, pero sus toques no tienen que llegar a la pantalla que la abrió.
    <div className="contents" onClick={(e) => e.stopPropagation()}>
      <CobrarPendienteModal
        businessId={businessId}
        branchId={activeBranchId}
        employees={employees}
        collectedBy={profile?.id ?? ""}
        collectedByName={profile?.full_name || (email ? email.split("@")[0] : "Recepción")}
        soloIds={soloIds}
        onClose={onClose}
        onCollected={onCollected}
      />
    </div>
  );
}

// Cobro (Nueva venta / Cobrar turno) → si el cliente debe algo, se ve ahí y se puede cobrar. El cobro de la deuda va
// aparte de la venta actual.
export function AvisoDeudaEnCobro({
  clientId,
  clientName,
  appointmentId,
  puedeCobrar,
  onCollected,
}: {
  /** Ficha del cliente; null si el cobro viene de un turno y todavía no se sabe. */
  clientId: string | null;
  clientName: string;
  appointmentId?: string | null;
  /** false cuando el profesional solo envía el cobro a Caja. */
  puedeCobrar: boolean;
  onCollected: () => void;
}) {
  const { businessId, activeBranchId } = useAuth();
  const [debts, setDebts] = React.useState<PendingDebt[]>([]);
  const [open, setOpen] = React.useState(false);

  const cargar = React.useCallback(async () => {
    const nombre = clientName.trim();
    if (!businessId || (!clientId && !nombre)) return setDebts([]);
    try {
      let id = clientId;
      if (!id && appointmentId) {
        const { data } = await supabase.from("appointments").select("client_id").eq("id", appointmentId).maybeSingle();
        id = (data?.client_id as string | null | undefined) ?? null;
      }
      const filas = await searchPendingDebts({
        businessId,
        branchId: activeBranchId,
        clientId: id,
        clientName: nombre,
        query: id ? undefined : nombre,
        status: "todos",
      });
      // Sin ficha solo vale el mismo nombre completo (la búsqueda trae también parecidos).
      const propias = id ? filas : filas.filter((d) => (d.client_name ?? "").trim().toLowerCase() === nombre.toLowerCase());
      setDebts(propias.filter((d) => d.total - d.collected_amount > 0));
    } catch {
      setDebts([]);
    }
  }, [businessId, activeBranchId, clientId, clientName, appointmentId]);

  React.useEffect(() => {
    setDebts([]);
    void cargar();
  }, [cargar]);

  const ids = React.useMemo(() => debts.map((d) => d.id), [debts]);
  const total = debts.reduce((s, d) => s + Math.max(0, d.total - d.collected_amount), 0);
  if (total <= 0 && !open) return null;

  return (
    <>
      <div className="relative z-10 flex shrink-0 items-center gap-3 rounded-2xl border border-rose-400/50 bg-rose-500/10 px-4 py-2.5">
        <Clock className="h-5 w-5 shrink-0 text-rose-300" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold leading-tight text-white">
            Debe ${Math.round(total).toLocaleString("es-AR")}
          </span>
          <span className="block truncate text-xs text-white/60">
            {debts.length === 1 ? debts[0].service_name || "Saldo anterior" : `${debts.length} saldos anteriores`}
          </span>
        </span>
        {puedeCobrar && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-9 shrink-0 items-center rounded-full border border-rose-400/50 bg-rose-400/15 px-4 text-sm font-semibold text-rose-100"
          >
            Cobrar deuda
          </button>
        )}
      </div>

      {open && (
        <CobrarDeudas
          soloIds={ids}
          onClose={() => setOpen(false)}
          onCollected={() => {
            void cargar();
            onCollected();
          }}
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
        className="flex items-center gap-3 rounded-2xl border border-rose-400/45 bg-white/[0.03] p-4"
        style={{
          background:
            "radial-gradient(110% 90% at 100% 0%, rgba(244,63,94,.20), transparent 62%), radial-gradient(90% 80% at 0% 100%, rgba(244,63,94,.10), transparent 65%)",
          boxShadow: "0 0 26px -12px rgba(244,63,94,.55)",
        }}
      >
        <Clock className="h-5 w-5 shrink-0 text-rose-300" />
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
