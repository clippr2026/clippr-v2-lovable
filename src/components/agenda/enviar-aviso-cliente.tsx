import * as React from "react";
import { BellRing, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

// "Enviar aviso" al celular del cliente (agenda). Solo aparece si el cliente instaló la app y activó los avisos.
export function EnviarAvisoCliente({ clientId }: { clientId: string }) {
  const [celulares, setCelulares] = React.useState<number | null>(null);
  const [abierto, setAbierto] = React.useState(false);
  const [texto, setTexto] = React.useState("");
  const [enviando, setEnviando] = React.useState(false);

  React.useEffect(() => {
    let vivo = true;
    setCelulares(null);
    void supabase.rpc("staff_client_push_count_v1" as any, { p_client_id: clientId }).then(({ data }) => {
      if (vivo) setCelulares(typeof data === "number" ? data : 0);
    });
    return () => {
      vivo = false;
    };
  }, [clientId]);

  if (celulares === null) return null;
  if (celulares === 0) {
    return <p className="text-[11px] text-muted-foreground">Sin app instalada: no recibe avisos al celular.</p>;
  }

  async function enviar() {
    setEnviando(true);
    try {
      const { data: sesion } = await supabase.auth.getSession();
      const res = await fetch("/api/push-cliente", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sesion.session?.access_token ?? ""}` },
        body: JSON.stringify({ clientId, message: texto }),
      });
      const out = (await res.json().catch(() => ({}))) as { sent?: number; error?: string };
      if (!res.ok || out.error || !out.sent) throw new Error(out.error || "No se pudo enviar el aviso");
      toast.success("Aviso enviado al celular del cliente");
      setTexto("");
      setAbierto(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-violet-400/30 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-200 hover:bg-violet-500/20"
      >
        <BellRing className="h-3.5 w-3.5" />
        Enviar aviso al celular
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value.slice(0, 180))}
        rows={2}
        placeholder="Ej: Te esperamos, tu turno ya está listo."
        className="w-full resize-none rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={enviar}
          disabled={enviando || !texto.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {enviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BellRing className="h-3.5 w-3.5" />}
          Enviar
        </button>
        <button type="button" onClick={() => setAbierto(false)} className="text-xs text-muted-foreground">
          Cancelar
        </button>
      </div>
    </div>
  );
}
