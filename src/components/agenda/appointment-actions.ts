import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { appendHistorialCobro } from "@/lib/cobro-historial";
import { devolverSena, type DevolucionSena } from "@/components/senas/devolucion-sena";
import { cancelAppointment, setAppointmentStatus, type Appointment } from "@/components/agenda/use-agenda-data";

type ApptStatus = Parameters<typeof setAppointmentStatus>[1];

// Acciones del detalle de un turno (cambiar estado, "No asistió" y cancelar con seña, pedir seña), compartidas por la
// Agenda y por Mi Agenda para que el panel del turno haga lo mismo en los dos lugares.
export type ContextoAccionesTurno = {
  userId?: string | null;
  profile: { id?: string | null; full_name?: string | null; role?: string | null } | null | undefined;
  activeBranchId: string | null | undefined;
  /** Vuelve a pedir los turnos. */
  refresh: () => void;
  /** Cierra el detalle (después de cancelar). */
  onClose?: () => void;
  /** Avisa que el estado del turno ya cambió (para actualizar la copia que se está mostrando). */
  onStatusApplied?: (id: string, status: ApptStatus) => void;
  navigate: (opts: { to: string; search?: Record<string, string> }) => void;
  /** Seña sugerida según la configuración de señas. */
  calcDeposit: (price: number) => number;
  isPast: (a: Appointment) => boolean;
  hasStarted: (a: Appointment) => boolean;
};

export function crearAccionesTurno(ctx: ContextoAccionesTurno) {
  const cambiarEstado = async (a: Appointment, status: ApptStatus, reason?: string) => {
    // Un turno pasado admite "No asistió" o cancelarlo (sin avisar por correo); no confirmarlo ni otros cambios.
    if (a.status !== "blocked" && ctx.isPast(a) && status !== "no_show" && status !== "cancelled") return;
    // Desde que ARRANCA el turno ya no se puede "Confirmar".
    if (a.status !== "blocked" && ctx.hasStarted(a) && status === "confirmed") return;
    if (a.status === "charged" && status !== "charged") {
      toast.error("Este turno ya está cobrado. No se puede cambiar el estado.");
      return;
    }
    try {
      if (status === "cancelled") {
        await cancelAppointment(a.id, {
          userId: ctx.userId,
          name: ctx.profile?.full_name,
          role: ctx.profile?.role,
          reason,
          silent: ctx.isPast(a),
        });
      } else {
        await setAppointmentStatus(a.id, status);
      }
      toast.success("Turno actualizado");
      ctx.onStatusApplied?.(a.id, status);
      ctx.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const pedirSena = (a: Appointment) => {
    if (ctx.isPast(a)) return;
    if (a.deposit_status === "paid") {
      toast.info("Este turno ya tiene seña pagada.");
      return;
    }
    const depositAmount = a.deposit_amount ?? ctx.calcDeposit(Number(a.service_price ?? 0));
    ctx.navigate({
      to: "/cash-register",
      search: {
        depositAppointmentId: a.id,
        depositAmount: String(depositAmount),
        clientName: a.client_name ?? "",
        serviceName: a.service_name ?? "",
        employeeId: a.employee_id ?? "",
      },
    });
  };

  // Turno con seña pagada que NO asistió: se marca "No asistió" (la base deja la seña "a decidir") y se aplica la
  // decisión elegida acá mismo: retenerla o reembolsarla.
  const noAsistioConSena = async (a: Appointment, action: "keep" | "return", devolucion?: DevolucionSena) => {
    try {
      await setAppointmentStatus(a.id, "no_show");
      ctx.onStatusApplied?.(a.id, "no_show");
      const { data: ledger } = await (supabase.from("appointment_deposits" as any) as any)
        .select("id")
        .eq("appointment_id", a.id)
        .maybeSingle();
      if (!ledger?.id) {
        toast.info("Marcado como No asistió. Esta seña es de un registro anterior: resolvela desde Caja.");
        return;
      }
      if (action === "return") {
        if (!devolucion) throw new Error("Faltan los datos de la devolución.");
        const r = await devolverSena(ledger.id, devolucion);
        if (!r.ok) throw new Error(`Quedó marcado como No asistió, pero la seña no se devolvió: ${r.error} Resolvela desde el turno.`);
      } else {
        const { data: res, error } = await (supabase.rpc as any)("decide_deposit_v1", {
          p_deposit_id: ledger.id,
          p_action: "retain",
          p_prof_pct: null,
          p_local_pct: null,
          p_note: "No asistió",
        });
        if (error) throw error;
        if (!res?.ok) throw new Error(res?.error ?? "No se pudo registrar la decisión de la seña.");
      }
      toast.success(action === "keep" ? "Marcado como No asistió. Seña retenida." : "Marcado como No asistió. Seña devuelta.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      ctx.refresh();
    }
  };

  const registrarCancelo = (a: Appointment, reason: string) => {
    if (!ctx.profile?.full_name) return;
    appendHistorialCobro(a.id, {
      time: new Date().toTimeString().slice(0, 5),
      user: ctx.profile.full_name,
      role: ctx.profile.role === "profesional" ? "profesional" : "recepcion",
      action: "Canceló",
      reason: reason.trim() || undefined,
    }).catch(() => {});
  };

  const cancelarConSena = async (a: Appointment, action: "keep" | "return", reason: string, devolucion?: DevolucionSena) => {
    // Seña registrada en el sistema nuevo: se cancela el turno (la base la deja "a decidir") y se aplica la decisión.
    const { data: ledger } = await (supabase.from("appointment_deposits" as any) as any)
      .select("id")
      .eq("appointment_id", a.id)
      .maybeSingle();
    if (ledger?.id) {
      try {
        await cancelAppointment(a.id, { userId: ctx.profile?.id ?? null, name: ctx.profile?.full_name ?? null, role: ctx.profile?.role ?? null, reason, silent: ctx.isPast(a) });
        if (action === "return") {
          if (!devolucion) throw new Error("Faltan los datos de la devolución.");
          const r = await devolverSena(ledger.id, devolucion);
          if (!r.ok) throw new Error(`El turno quedó cancelado, pero la seña no se devolvió: ${r.error} Resolvela desde el turno.`);
        } else {
          const { data: res, error } = await (supabase.rpc as any)("decide_deposit_v1", {
            p_deposit_id: ledger.id,
            p_action: "retain",
            p_prof_pct: null,
            p_local_pct: null,
            p_note: reason || null,
          });
          if (error) throw error;
          if (!res?.ok) throw new Error(res?.error ?? "No se pudo registrar la decisión de la seña.");
        }
        toast.success(action === "keep" ? "Turno cancelado. Seña retenida." : "Turno cancelado. Seña devuelta.");
      } catch (e) {
        toast.error((e as Error).message);
        return;
      } finally {
        ctx.onClose?.();
        ctx.refresh();
      }
      return;
    }
    if (action === "return") {
      try {
        await supabase.from("expenses").insert({
          business_id: a.business_id,
          branch_id: ctx.activeBranchId,
          description: `Reembolso de seña – ${a.client_name ?? "cliente"} – ${a.service_name ?? ""}${reason ? " – " + reason : ""}`,
          amount: Number(a.deposit_paid ?? 0),
          type: "devolucion_sena",
          date: new Date().toISOString().slice(0, 10),
        });
        await supabase.from("appointments").update({ deposit_status: "returned", status: "cancelled" }).eq("id", a.id);
        // Este cancel bypasea cancelAppointment, así que el registro de "quién canceló" se escribe acá.
        registrarCancelo(a, reason);
        toast.success("Seña reembolsada y egreso registrado en Caja");
      } catch (e) {
        toast.error((e as Error).message);
        return;
      }
    } else {
      try {
        await supabase.from("appointments").update({ deposit_status: "lost", status: "cancelled" }).eq("id", a.id);
        registrarCancelo(a, reason);
        toast.success("Seña marcada como perdida");
      } catch (e) {
        toast.error((e as Error).message);
        return;
      }
    }
    ctx.onClose?.();
    ctx.refresh();
  };

  return { cambiarEstado, pedirSena, noAsistioConSena, cancelarConSena };
}
