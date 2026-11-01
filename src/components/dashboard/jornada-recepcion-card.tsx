import * as React from "react";
import { toast } from "sonner";
import { Loader2, LogIn, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { getJornadaRecepcionMap, jornadaEmailKey } from "@/lib/jornada-recepcion";

type Session = { id: string; clock_in_at: string; clock_out_at: string | null };

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

// Tarjeta de Inicio para la recepcionista que el dueño habilitó en Equipo →
// Accesos: "Iniciar jornada" y "Cerrar jornada" guardan su horario. No
// bloquea ni habilita nada para los demás y nunca genera un descuento.
export function JornadaRecepcionCard({ businessId, branchId }: { businessId: string | null; branchId: string | null }) {
  const { profile, session } = useAuth();
  const userId = session?.user?.id ?? null;
  const email = jornadaEmailKey(session?.user?.email);
  const [enabled, setEnabled] = React.useState(false);
  const [current, setCurrent] = React.useState<Session | null>(null);
  const [busy, setBusy] = React.useState(false);

  const isRecepcionista = profile?.role === "recepcionista";

  const load = React.useCallback(async () => {
    if (!businessId || !userId || !email) return;
    const map = await getJornadaRecepcionMap(businessId);
    const on = map[email] === true;
    setEnabled(on);
    if (!on) return;
    const dayStart = new Date(`${new Date().toLocaleDateString("sv-SE")}T00:00:00`).toISOString();
    const { data } = await supabase
      .from("work_sessions" as any)
      .select("id,clock_in_at,clock_out_at")
      .eq("employee_id", userId)
      .gte("clock_in_at", dayStart)
      .order("clock_in_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setCurrent((data as Session | null) ?? null);
  }, [businessId, userId, email]);

  React.useEffect(() => {
    if (isRecepcionista) load();
  }, [isRecepcionista, load]);

  if (!isRecepcionista || !enabled) return null;

  async function iniciar() {
    if (!businessId || !userId || !branchId) return toast.error("Elegí una sucursal para iniciar la jornada.");
    setBusy(true);
    const { error } = await supabase.from("work_sessions" as any).insert({
      business_id: businessId,
      branch_id: branchId,
      employee_id: userId,
      clock_in_at: new Date().toISOString(),
      late_minutes: 0,
      source: "recepcion",
    });
    setBusy(false);
    if (error) return toast.error("No se pudo iniciar la jornada: " + error.message);
    toast.success("Jornada iniciada");
    await load();
  }

  async function cerrar() {
    if (!current) return;
    setBusy(true);
    const { error } = await supabase
      .from("work_sessions" as any)
      .update({ clock_out_at: new Date().toISOString() })
      .eq("id", current.id);
    setBusy(false);
    if (error) return toast.error("No se pudo cerrar la jornada: " + error.message);
    toast.success("Jornada cerrada");
    await load();
  }

  const open = current && !current.clock_out_at;
  const closed = current && current.clock_out_at;

  return (
    <div className="glass rounded-2xl p-4 sm:p-5 ring-1 ring-white/5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">Jornada de hoy</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {open
              ? `Iniciada a las ${hora(current!.clock_in_at)}`
              : closed
                ? `${hora(current!.clock_in_at)} a ${hora(current!.clock_out_at!)}`
                : "Sin iniciar"}
          </div>
        </div>
        {!closed && (
          <button
            type="button"
            onClick={open ? cerrar : iniciar}
            disabled={busy}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : open ? <LogOut className="size-4" /> : <LogIn className="size-4" />}
            {open ? "Cerrar jornada" : "Iniciar jornada"}
          </button>
        )}
      </div>
    </div>
  );
}
