import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cajaDateKeyBA } from "@/lib/caja-cierre";

export type DevolucionSena = { motivo: string; origen: "caja" | "otros"; medio: "efectivo" | "cuenta" | null };

// Roles que pueden devolver una seña (lo vuelve a validar la base en refund_deposit_v1).
const ROLES_DEVOLUCION = ["admin_general", "owner", "socio", "admin_local", "recepcionista"];

const money = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-AR")}`;

/** Devuelve la seña de un turno cancelado o "No asistió". El resultado trae el error de la base tal cual. */
export async function devolverSena(depositId: string, d: DevolucionSena): Promise<{ ok: boolean; error?: string; code?: string }> {
  const { data, error } = await (supabase.rpc as any)("refund_deposit_v1", {
    p_deposit_id: depositId,
    p_reason: d.motivo,
    p_funds_source: d.origen,
    p_method: d.origen === "caja" ? d.medio : null,
  });
  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: data?.error ?? "No se pudo registrar la devolución.", code: data?.code };
  return { ok: true };
}

/**
 * Formulario único de devolución de seña (panel de la seña, cancelar turno y "No asistió"): motivo, de dónde sale la
 * plata (Caja del día o Fondos externos) y, si sale de la caja, de Efectivo o de Dinero en cuenta. Sin contraseña.
 */
export function DevolucionSenaForm({
  monto,
  motivoExterno,
  motivoInicial = "",
  busy = false,
  onConfirm,
}: {
  monto?: number | null;
  /** Si el motivo ya se escribe en otro campo (el de cancelación), se usa ese y acá no se vuelve a pedir. */
  motivoExterno?: string;
  motivoInicial?: string;
  busy?: boolean;
  onConfirm: (d: DevolucionSena) => void;
}) {
  const { businessId, activeBranchId, profile } = useAuth();
  const [motivoPropio, setMotivoPropio] = React.useState(motivoInicial);
  const [origen, setOrigen] = React.useState<"caja" | "otros" | null>(null);
  const [medio, setMedio] = React.useState<"efectivo" | "cuenta" | null>(null);
  // null = todavía no se sabe. Con la caja de hoy cerrada no se puede descontar de ahí.
  const [cajaCerrada, setCajaCerrada] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    void (supabase.rpc as any)("is_caja_closed_now", {
      p_business_id: businessId,
      p_branch_id: activeBranchId ?? null,
      p_fecha: cajaDateKeyBA(),
    }).then(({ data, error }: { data: boolean | null; error: unknown }) => {
      if (!cancelled) setCajaCerrada(error ? false : Boolean(data));
    });
    return () => {
      cancelled = true;
    };
  }, [businessId, activeBranchId]);

  if (!ROLES_DEVOLUCION.includes(String(profile?.role ?? ""))) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs text-white/70">
        Tu usuario no puede devolver señas. Pedíselo a recepción o a un administrador.
      </div>
    );
  }

  const motivo = (motivoExterno ?? motivoPropio).trim();
  const listo = motivo.length > 0 && origen !== null && (origen === "otros" || medio !== null);
  const opcion = (activo: boolean) =>
    `h-10 rounded-full border px-2 text-xs font-semibold transition disabled:opacity-40 ${
      activo ? "border-violet-400/50 bg-violet-500/20 text-violet-100" : "border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08]"
    }`;

  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-left">
      {motivoExterno === undefined && (
        <div>
          <label className="mb-1.5 block text-sm font-semibold text-white">Motivo de la devolución</label>
          <textarea
            value={motivoPropio}
            onChange={(e) => setMotivoPropio(e.target.value.slice(0, 200))}
            rows={2}
            placeholder="Ej: canceló con aviso"
            className="w-full resize-none rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 focus:border-violet-400/50"
          />
        </div>
      )}
      <div>
        <div className="mb-1.5 text-sm font-semibold text-white">¿De dónde sale el dinero?</div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={busy || cajaCerrada === true} onClick={() => setOrigen("caja")} className={opcion(origen === "caja")}>
            Caja del día
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setOrigen("otros");
              setMedio(null);
            }}
            className={opcion(origen === "otros")}
          >
            Fondos externos
          </button>
        </div>
        {cajaCerrada === true && (
          <p className="mt-1.5 text-[11px] leading-snug text-amber-200/90">
            La caja de hoy ya está cerrada: no se puede descontar de ahí. Usá Fondos externos, o reabrí la caja de hoy.
          </p>
        )}
      </div>
      {origen === "caja" && (
        <div>
          <div className="mb-1.5 text-sm font-semibold text-white">¿De qué sale?</div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={busy} onClick={() => setMedio("efectivo")} className={opcion(medio === "efectivo")}>
              Efectivo
            </button>
            <button type="button" disabled={busy} onClick={() => setMedio("cuenta")} className={opcion(medio === "cuenta")}>
              Dinero en cuenta
            </button>
          </div>
        </div>
      )}
      <button
        type="button"
        disabled={busy || !listo}
        onClick={() => origen && onConfirm({ motivo, origen, medio: origen === "caja" ? medio : null })}
        className="h-11 w-full rounded-full border border-rose-400/50 bg-rose-500/15 text-sm font-bold text-rose-100 transition hover:bg-rose-500/25 disabled:opacity-40"
      >
        {monto ? `Devolver ${money(monto)}` : "Devolver la seña"}
      </button>
      <p className="text-[11px] leading-snug text-white/50">
        {origen === "otros"
          ? "No toca la caja de hoy. La seña queda como Devuelta y su ingreso original se conserva."
          : "Sale como gasto de hoy. La seña queda como Devuelta y su ingreso original se conserva."}
        {motivoExterno !== undefined && !motivo ? " Escribí el motivo arriba para poder devolver." : ""}
      </p>
    </div>
  );
}
