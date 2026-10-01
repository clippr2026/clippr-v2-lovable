import * as React from "react";
import { toast } from "sonner";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  validateDailyCode,
  getOpenWorkSession,
  clockIn,
  clockOut,
  type WorkSession,
} from "@/lib/fichaje";
import { ClipprLoader } from "@/components/ui/clippr-loader";
import { CheckCircle2, LogIn, LogOut, Building2 } from "lucide-react";

function cleanSearchParam(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export const Route = createFileRoute("/fichar/$branchId")({
  validateSearch: (search: Record<string, unknown>) => ({
    code: cleanSearchParam(search.code),
  }),
  head: () => ({
    meta: [{ title: "Fichar — Clippr" }],
  }),
  component: FicharPage,
});

// Entrada/salida desde el panel del propio profesional — llega acá al
// escanear el QR/código del kiosco de su sucursal. Mismo código sirve para
// las dos acciones: si ya tiene una jornada abierta hoy, se ofrece
// "Fichar salida"; si no, "Fichar entrada".
function FicharPage() {
  const { branchId } = Route.useParams();
  const { code } = Route.useSearch();
  const { businessId, profile } = useAuth();
  const employeeId = profile?.employee_id ?? null;

  const [branchName, setBranchName] = React.useState("");
  const [codeValid, setCodeValid] = React.useState<boolean | null>(null);
  const [openSession, setOpenSession] = React.useState<WorkSession | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState<"in" | "out" | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!businessId || !employeeId || !code) {
        setLoading(false);
        return;
      }
      setLoading(true);
      const [{ data: branch }, valid, session] = await Promise.all([
        supabase.from("branches" as any).select("name").eq("id", branchId).maybeSingle(),
        validateDailyCode(branchId, code),
        getOpenWorkSession(employeeId),
      ]);
      if (cancelled) return;
      setBranchName(((branch as any)?.name as string) ?? "");
      setCodeValid(valid);
      setOpenSession(session);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId, employeeId, branchId, code]);

  async function handleClockIn() {
    if (!businessId || !employeeId) return;
    setSubmitting(true);
    try {
      await clockIn({ businessId, branchId, employeeId });
      setDone("in");
      toast.success("Entrada registrada");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClockOut() {
    if (!openSession) return;
    setSubmitting(true);
    try {
      await clockOut(openSession.id);
      setDone("out");
      toast.success("Salida registrada");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <div className="grid min-h-[70vh] place-items-center px-4">
        <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-white/[0.02] p-8 text-center">
          {!code ? (
            <p className="text-sm text-destructive">Falta el código de fichaje en el link.</p>
          ) : !employeeId ? (
            <p className="text-sm text-destructive">
              Tu usuario no está vinculado a un profesional — pedile a tu administrador que lo revise.
            </p>
          ) : loading ? (
            <ClipprLoader size="screen" delayMs={130} />
          ) : codeValid === false ? (
            <p className="text-sm text-destructive">
              Ese código ya no es válido. Pedí el código de hoy en el kiosco del local.
            </p>
          ) : done ? (
            <div className="flex flex-col items-center gap-3">
              <CheckCircle2 className="h-10 w-10 text-emerald-400" />
              <div className="text-lg font-semibold text-foreground">
                {done === "in" ? "Entrada registrada" : "Salida registrada"}
              </div>
              <p className="text-sm text-muted-foreground">Ya podés cerrar esta pantalla.</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Building2 className="h-4 w-4" />
                {branchName}
              </div>
              <div className="text-lg font-semibold text-foreground">
                Hola, {profile?.full_name?.split(" ")[0] ?? "profesional"}
              </div>
              {openSession ? (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleClockOut}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-rose-500 to-rose-600 py-3.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  <LogOut className="h-4 w-4" /> {submitting ? "Guardando…" : "Fichar salida"}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleClockIn}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-600 py-3.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  <LogIn className="h-4 w-4" /> {submitting ? "Guardando…" : "Fichar entrada"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
