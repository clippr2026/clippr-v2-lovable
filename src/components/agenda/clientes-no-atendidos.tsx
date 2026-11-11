import * as React from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, DoorOpen, UserRound, Users, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const BA = "America/Argentina/Buenos_Aires";

type Profesional = { id: string; full_name: string; avatar_url?: string | null; is_active?: boolean | null };

/** Límites [desde, hasta) del día de hoy en Buenos Aires. */
function rangoHoy() {
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: BA });
  const desde = new Date(`${hoy}T00:00:00-03:00`);
  const hasta = new Date(desde.getTime() + 24 * 60 * 60 * 1000);
  return { desde: desde.toISOString(), hasta: hasta.toISOString() };
}

/**
 * Botón de Agenda "Se fue": registra (con día y hora de ahora) un cliente que entró al
 * local y se fue sin atenderse, y si quería a un profesional en especial o a cualquiera.
 * Pensado para 1 o 2 toques: quien lo carga puede estar trabajando.
 */
export function ClientesNoAtendidosButton({
  businessId,
  branchId,
  createdByName,
  employees,
  className = "",
}: {
  businessId: string | null | undefined;
  branchId: string | null | undefined;
  createdByName?: string | null;
  /** Profesionales de la sucursal elegida (los inactivos no se ofrecen). */
  employees: Profesional[];
  /** Clases extra para el botón de la Agenda (por ejemplo, para que ocupe el ancho que sobra). */
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [eligiendo, setEligiendo] = React.useState(false);
  const [countHoy, setCountHoy] = React.useState(0);
  const [saving, setSaving] = React.useState(false);
  const [tick, setTick] = React.useState(0);
  // Candado contra toques repetidos: el estado `saving` recién se ve en el siguiente render.
  const guardando = React.useRef(false);
  const tabla = () => supabase.from("clientes_no_atendidos" as any) as any;
  const activos = employees.filter((e) => e.is_active !== false);

  React.useEffect(() => {
    if (!businessId) return setCountHoy(0);
    let cancelled = false;
    const { desde, hasta } = rangoHoy();
    let q = tabla().select("id", { count: "exact", head: true }).eq("business_id", businessId).gte("occurred_at", desde).lt("occurred_at", hasta);
    if (branchId) q = q.eq("branch_id", branchId);
    void q.then(({ count, error }: any) => {
      if (!cancelled && !error) setCountHoy(count ?? 0);
    });
    return () => {
      cancelled = true;
    };
  }, [businessId, branchId, tick]);

  const cerrar = () => {
    if (guardando.current) return;
    setOpen(false);
    setEligiendo(false);
  };

  const registrar = async (profesional: Profesional | null) => {
    if (!businessId || guardando.current) return;
    guardando.current = true;
    setSaving(true);
    const { error } = await tabla().insert({
      business_id: businessId,
      branch_id: branchId ?? null,
      created_by_name: createdByName ?? null,
      preferencia: profesional ? "especifico" : "cualquiera",
      requested_employee_id: profesional?.id ?? null,
    });
    guardando.current = false;
    setSaving(false);
    if (error) return toast.error("No se pudo registrar. Probá de nuevo.");
    toast.success(profesional ? `Registrado: quería a ${profesional.full_name}.` : "Registrado.");
    setCountHoy((n) => n + 1);
    setOpen(false);
    setEligiendo(false);
    setTick((t) => t + 1);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setEligiendo(false);
          setOpen(true);
        }}
        className={`inline-flex items-center gap-1.5 rounded-xl bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-foreground ring-1 ring-white/10 transition hover:bg-white/[0.07] ${className}`}
      >
        <DoorOpen className="h-3.5 w-3.5 text-rose-300" />
        Se fue
        <span className="rounded-full bg-rose-400/20 px-1.5 text-[11px] font-semibold tabular-nums text-rose-200">{countHoy}</span>
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[120] grid place-items-end bg-black/70 backdrop-blur-sm sm:place-items-center sm:p-4" onClick={cerrar}>
            <div
              className="relative max-h-[88vh] w-full max-w-sm overflow-y-auto rounded-t-3xl bg-[oklch(0.11_0.04_275)] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] ring-1 ring-rose-300/25 sm:rounded-3xl"
              style={{ boxShadow: "0 0 60px -18px rgba(244,63,94,0.55), 0 30px 80px -30px rgba(0,0,0,0.9)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-rose-300/70 to-transparent" />
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-lg font-bold leading-tight text-white">¿Se fue un cliente sin atender?</h3>
                <button type="button" aria-label="Cerrar" onClick={cerrar} className="-mr-1 -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {!eligiendo ? (
                <>
                  <p className="mt-2 text-[13px] leading-snug text-white/60">
                    Registrá los clientes que se van sin atenderse. Combinando estos datos con la ocupación de la agenda, Clippr te ayuda a decidir
                    cuándo incorporar profesionales, ampliar horarios o aumentar precios.
                  </p>
                  <p className="mt-2.5 text-sm font-medium text-rose-200">
                    Hoy {countHoy === 1 ? "se fue 1 cliente" : `se fueron ${countHoy} clientes`}.
                  </p>
                  <p className="mt-4 text-sm font-semibold text-white">¿Quería atenderse con un barbero en especial?</p>
                  <div className="mt-2.5 grid gap-2.5">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => registrar(null)}
                      className="flex h-14 items-center gap-3 rounded-2xl bg-rose-500/20 px-4 text-left text-[15px] font-semibold text-rose-50 ring-1 ring-rose-300/55 transition hover:bg-rose-500/30 active:scale-[0.99] disabled:opacity-60"
                      style={{ boxShadow: "0 0 22px -8px rgba(244,63,94,0.7)" }}
                    >
                      <Users className="h-5 w-5 shrink-0 text-rose-200" />
                      {saving ? "Registrando…" : "No, cualquiera"}
                    </button>
                    <button
                      type="button"
                      disabled={saving || activos.length === 0}
                      onClick={() => setEligiendo(true)}
                      className="flex h-14 items-center gap-3 rounded-2xl bg-violet-500/15 px-4 text-left text-[15px] font-semibold text-violet-50 ring-1 ring-violet-300/45 transition hover:bg-violet-500/25 active:scale-[0.99] disabled:opacity-40"
                      style={{ boxShadow: "0 0 22px -10px rgba(139,92,246,0.8)" }}
                    >
                      <UserRound className="h-5 w-5 shrink-0 text-violet-200" />
                      Sí, uno en especial
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => setEligiendo(false)} disabled={saving} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-white/60 hover:text-white">
                    <ChevronLeft className="h-3.5 w-3.5" /> Volver
                  </button>
                  <p className="mt-2 text-sm font-semibold text-white">¿Con quién quería atenderse?</p>
                  <p className="text-xs text-white/50">Tocá uno y queda registrado.</p>
                  <div className="mt-3 grid grid-cols-2 gap-2.5">
                    {activos.map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        disabled={saving}
                        onClick={() => registrar(e)}
                        className="flex min-h-14 items-center gap-2.5 rounded-2xl bg-white/[0.05] p-2.5 text-left ring-1 ring-white/12 transition hover:bg-violet-500/20 hover:ring-violet-300/50 active:scale-[0.98] disabled:opacity-50"
                      >
                        {e.avatar_url ? (
                          <img src={e.avatar_url} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-white/20" />
                        ) : (
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violet-500/25 text-sm font-bold text-violet-100 ring-1 ring-violet-300/30">
                            {e.full_name.trim().charAt(0).toUpperCase()}
                          </span>
                        )}
                        <span className="min-w-0 break-words text-sm font-semibold leading-tight text-white">{e.full_name}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
