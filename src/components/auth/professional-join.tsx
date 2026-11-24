import * as React from "react";
import { Building2, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { startCardCls, startCardStyle } from "@/components/auth/start-shell";

type MyRequest = { id: string; business_name: string; initiated_by: string; status: string; created_at: string };

const STATUS: Record<string, { label: string; cls: string }> = {
  invited: { label: "Te solicitó", cls: "bg-sky-400/15 text-sky-200 ring-sky-300/30" },
  pending: { label: "Pendiente", cls: "bg-amber-400/15 text-amber-200 ring-amber-300/30" },
  accepted: { label: "Sumado", cls: "bg-emerald-400/15 text-emerald-200 ring-emerald-300/30" },
  rejected: { label: "Rechazada", cls: "bg-white/10 text-white/60 ring-white/15" },
  unlinked: { label: "Desvinculado", cls: "bg-white/10 text-white/60 ring-white/15" },
};

const ERRORS: Record<string, string> = {
  codigo_invalido: "Ese código no existe. Revisalo con la barbería.",
  perfil_incompleto: "Primero guardá tu perfil.",
  ya_sos_parte: "Ya sos parte de ese negocio.",
};

function errorText(message: string): string {
  const key = Object.keys(ERRORS).find((k) => message.includes(k));
  return key ? ERRORS[key] : "No se pudo enviar la solicitud. Probá de nuevo.";
}

// Pestaña "Unirme": el profesional escribe el código que está en Equipo de la barbería.
export function ProfessionalJoin() {
  const [code, setCode] = React.useState("");
  const [sending, setSending] = React.useState(false);
  async function send() {
    if (code.trim().length < 4) return toast.error("Escribí el código del negocio");
    setSending(true);
    const { data, error } = await (supabase as any).rpc("request_join_by_code", { p_code: code });
    setSending(false);
    if (error) return toast.error(errorText(error.message ?? ""));
    toast.success(`Solicitud enviada a ${(data as { business_name?: string })?.business_name ?? "la barbería"}`);
    setCode("");
    toast.info("Tus solicitudes enviadas se ven en la pestaña Mi bolsa.");
  }

  return (
    <div className="space-y-4">
      <div className={`${startCardCls} p-4`} style={startCardStyle}>
        <div className="flex items-center gap-3 text-xl font-semibold">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-violet-500/20 text-violet-300">
            <KeyRound className="h-5 w-5" />
          </span>
          ¿Ya te sumaste a un negocio?
        </div>
        <p className="mt-2 text-base text-white/60">Escribí el código que te da la barbería.</p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
          placeholder="Ej: 7K3PQ9"
          autoCapitalize="characters"
          autoComplete="off"
          className="mt-4 h-14 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-center text-2xl font-bold uppercase tracking-[0.3em] text-white placeholder:text-base placeholder:font-semibold placeholder:tracking-normal placeholder:text-white/35 focus:border-violet-400/50 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending}
          className="mt-3 h-14 w-full rounded-full bg-gradient-to-r from-sky-400 to-violet-500 text-lg font-semibold text-white shadow-[0_0_22px_-6px_rgba(139,92,246,0.8)] transition active:scale-[0.99] disabled:opacity-60"
        >
          {sending ? "Enviando…" : "Enviar solicitud"}
        </button>
      </div>

    </div>
  );
}

// Solicitudes que envió la persona (por código o desde una oferta) y cómo van. Las invitaciones de los negocios
// (estado "invited") se responden aparte, en la tarjeta "Barberías que te solicitaron".
export function MyRequestsList() {
  const [rows, setRows] = React.useState<MyRequest[]>([]);
  React.useEffect(() => {
    void (async () => {
      const { data } = await (supabase as any).rpc("my_join_requests");
      setRows(((data as MyRequest[] | null) ?? []).filter((r) => r.status !== "invited"));
    })();
  }, []);
  if (rows.length === 0) return null;
  return (
    <div className="space-y-3">
      <div className="text-lg font-semibold text-white/85">Tus solicitudes</div>
      {rows.map((r) => {
        const st = STATUS[r.status] ?? STATUS.pending;
        return (
          <div key={r.id} className={`${startCardCls} flex items-center gap-3 p-4`} style={startCardStyle}>
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet-500/20 text-violet-300">
              <Building2 className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-semibold">{r.business_name}</div>
              <div className="text-sm text-white/50">{r.initiated_by === "business" ? "Te solicitó la barbería" : "Enviaste la solicitud"}</div>
            </div>
            <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ring-1 ${st.cls}`}>{st.label}</span>
          </div>
        );
      })}
    </div>
  );
}
