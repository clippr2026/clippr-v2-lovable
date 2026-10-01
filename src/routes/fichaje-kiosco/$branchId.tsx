import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { getOrCreateDailyCode } from "@/lib/fichaje";
import { ClipprLoader } from "@/components/ui/clippr-loader";
import { Building2 } from "lucide-react";

export const Route = createFileRoute("/fichaje-kiosco/$branchId")({
  head: () => ({
    meta: [{ title: "Fichaje — Clippr" }],
  }),
  component: KioscoPage,
});

// Pantalla pensada para quedar abierta todo el día en una tablet en el
// local. Muestra el QR + código del día — el mismo código sirve para
// fichar entrada Y salida (el panel del profesional detecta cuál
// corresponde). Se regenera solo al cambiar el día.
function KioscoPage() {
  const { branchId } = Route.useParams();
  const [businessId, setBusinessId] = React.useState<string | null>(null);
  const [branchName, setBranchName] = React.useState<string>("");
  const [code, setCode] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [dateKey, setDateKey] = React.useState(() => new Date().toLocaleDateString("sv-SE"));

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data: branch, error: branchError } = await supabase
        .from("branches" as any)
        .select("id,name,business_id")
        .eq("id", branchId)
        .maybeSingle();
      if (branchError || !branch) {
        if (!cancelled) {
          setError("No se encontró la sucursal.");
          setLoading(false);
        }
        return;
      }
      if (cancelled) return;
      setBusinessId((branch as any).business_id);
      setBranchName((branch as any).name);
      try {
        const dailyCode = await getOrCreateDailyCode((branch as any).business_id, branchId);
        if (!cancelled) setCode(dailyCode);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [branchId, dateKey]);

  // Chequea cada minuto si cambió el día — si cambió, regenera el código.
  React.useEffect(() => {
    const interval = window.setInterval(() => {
      const nowKey = new Date().toLocaleDateString("sv-SE");
      setDateKey((prev) => (prev === nowKey ? prev : nowKey));
    }, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const fichaUrl = code
    ? `${window.location.origin}/fichar/${branchId}?code=${code}`
    : "";
  const qrSrc = fichaUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=360x360&data=${encodeURIComponent(fichaUrl)}`
    : "";

  return (
    <AppShell fullWidth>
      <div className="grid min-h-[80vh] place-items-center">
        {loading ? (
          <ClipprLoader size="screen" delayMs={130} />
        ) : error ? (
          <div className="text-center text-sm text-destructive">{error}</div>
        ) : (
          <div className="flex flex-col items-center gap-6 rounded-3xl border border-white/10 bg-white/[0.02] px-10 py-12 text-center">
            <div className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <Building2 className="h-5 w-5 text-violet-300" />
              {branchName}
            </div>
            <p className="text-sm text-muted-foreground">
              Escaneá el código con tu celular para fichar entrada o salida
            </p>
            {qrSrc ? (
              <img
                src={qrSrc}
                alt="Código QR de fichaje"
                width={300}
                height={300}
                className="rounded-2xl border border-white/10 bg-white p-3"
              />
            ) : null}
            <div className="rounded-xl bg-white/5 px-6 py-3 ring-1 ring-white/10">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
                Código
              </div>
              <div className="mt-1 font-mono text-3xl font-bold tracking-[0.3em] text-foreground">
                {code}
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
