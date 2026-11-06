import * as React from "react";
import { createPortal } from "react-dom";
import jsQR from "jsqr";
import { toast } from "sonner";
import {
  getOpenWorkSession,
  resolveBranchFromCode,
  validateDailyCode,
  clockIn,
  clockOut,
  distanceMeters,
  getCurrentCoords,
  uploadFichajeSelfie,
  ficharConEvidencia,
  type FichajeCoords,
  type FichajeMethod,
} from "@/lib/fichaje";
import { supabase } from "@/integrations/supabase/client";
import { FichajeSelfieStep } from "@/components/professionals/fichaje-selfie-step";
import { Camera, Keyboard, MapPin, X, CheckCircle2, Loader2 } from "lucide-react";

type FlowStep = "choose" | "scan" | "code" | "selfie" | "done";

// Presencia ya comprobada (QR/código del día o ubicación dentro del radio) a la
// espera de la selfie, que es lo último antes de guardar el fichaje.
type PendingFichaje = {
  method: FichajeMethod;
  branchId: string;
  code: string | null;
  coords: FichajeCoords | null;
};

function horaCorta(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

// Parsea la URL que codifica el QR de Inicio
// (`${origin}/fichar/${branchId}?code=${code}`) — devuelve null si no
// matchea ese formato (QR de otra cosa, código roto, etc).
function parseFichajeUrl(raw: string): { branchId: string; code: string } | null {
  try {
    const url = new URL(raw);
    const match = url.pathname.match(/\/fichar\/([^/]+)/);
    const code = url.searchParams.get("code");
    if (!match || !code) return null;
    return { branchId: match[1], code };
  } catch {
    return null;
  }
}

// Modal compartido "Fichar jornada" — Escanear QR / Ingresar código, mismo
// flujo para el panel del propio profesional y para la vista admin
// (fichando en nombre del barbero seleccionado). Nunca muestra el QR del
// local acá: eso vive solo en Inicio. Valida que el QR/código escaneado
// corresponda a la sucursal activa antes de registrar nada (si
// activeBranchId es null — negocio sin sucursales configuradas — no
// bloquea, mismo criterio "filtro aditivo" que el resto de la app).
// Fichando uno mismo (onBehalf = false) se exige selfie + (QR o ubicación);
// fichando en nombre de un barbero desde la vista admin (onBehalf = true)
// queda como siempre, solo QR/código.
export function FichajeFlowModal({
  businessId,
  employeeId,
  activeBranchId,
  hasOpenSession,
  onBehalf = false,
  onClose,
  onDone,
}: {
  businessId: string | null;
  employeeId: string;
  activeBranchId: string | null;
  hasOpenSession: boolean;
  onBehalf?: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = React.useState<FlowStep>("choose");
  // null = todavía no se sabe. Sin ubicación cargada en la sucursal, el método
  // "Usar mi ubicación" no se puede usar (queda solo el QR).
  const [branchHasLocation, setBranchHasLocation] = React.useState<boolean | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (onBehalf || !activeBranchId) return;
    let cancelled = false;
    void supabase
      .from("branches" as any)
      .select("latitude,longitude")
      .eq("id", activeBranchId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        const b = data as { latitude: number | null; longitude: number | null } | null;
        setBranchHasLocation(error ? null : b?.latitude != null && b?.longitude != null);
      });
    return () => {
      cancelled = true;
    };
  }, [onBehalf, activeBranchId]);
  const [pending, setPending] = React.useState<PendingFichaje | null>(null);
  const [locating, setLocating] = React.useState(false);
  const [result, setResult] = React.useState<{ kind: "in" | "out"; time: string } | null>(null);

  // Bloqueo de scroll de fondo mientras el modal está abierto — antes no
  // existía ninguno acá (a diferencia de FichajeQrModal, que tampoco lo
  // tenía pero sí vive en un portal). Se restaura el valor previo al
  // desmontar, nunca se asume "" (otro modal pudo haberlo dejado distinto).
  React.useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  async function submitCode(branchId: string, code: string) {
    if (!businessId || submitting) return;
    if (activeBranchId && branchId !== activeBranchId) {
      toast.error("Ese QR/código no corresponde a la sucursal activa.");
      return;
    }
    setSubmitting(true);
    try {
      const valid = await validateDailyCode(branchId, code);
      if (!valid) {
        toast.error("Ese código ya no es válido. Pedí el código de hoy en Inicio.");
        setSubmitting(false);
        return;
      }
      if (!onBehalf) {
        // Código válido: falta la selfie, que es lo último antes de guardar.
        setPending({ method: "qr", branchId, code, coords: null });
        setStep("selfie");
        setSubmitting(false);
        return;
      }
      if (hasOpenSession) {
        const session = await getOpenWorkSession(employeeId);
        if (!session) throw new Error("No se encontró la jornada abierta.");
        await clockOut(session.id);
        setResult({ kind: "out", time: horaCorta(new Date().toISOString()) });
      } else {
        await clockIn({ businessId, branchId, employeeId });
        setResult({ kind: "in", time: horaCorta(new Date().toISOString()) });
      }
      setStep("done");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function startLocation() {
    if (!businessId || locating) return;
    if (!activeBranchId) {
      toast.error("No hay una sucursal activa para fichar.");
      return;
    }
    setLocating(true);
    try {
      const { data: branch, error } = await supabase
        .from("branches" as any)
        .select("latitude,longitude,checkin_radius_m")
        .eq("id", activeBranchId)
        .maybeSingle();
      if (error) throw new Error("No se pudo leer la ubicación de la sucursal.");
      const b = branch as { latitude: number | null; longitude: number | null; checkin_radius_m: number | null } | null;
      if (b?.latitude == null || b?.longitude == null) {
        toast.error("Esta sucursal todavía no tiene su ubicación cargada. Usá el QR o pedile al administrador que la configure.");
        return;
      }
      const coords = await getCurrentCoords();
      if (coords.accuracyM > 150) {
        toast.error("Tu ubicación es muy imprecisa. Probá afuera o usá el QR.");
        return;
      }
      const radius = b.checkin_radius_m ?? 150;
      const dist = distanceMeters(coords, { lat: b.latitude, lng: b.longitude });
      if (dist > radius) {
        toast.error(`Tenés que estar en el local para fichar. Estás a ${Math.round(dist)} m.`);
        return;
      }
      setPending({ method: "location", branchId: activeBranchId, code: null, coords });
      setStep("selfie");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLocating(false);
    }
  }

  async function submitSelfie(blob: Blob) {
    if (!businessId || !pending || submitting) return;
    setSubmitting(true);
    try {
      const action = hasOpenSession ? "out" : "in";
      const selfiePath = await uploadFichajeSelfie({ businessId, employeeId, kind: action, blob });
      await ficharConEvidencia({
        action,
        businessId,
        branchId: pending.branchId,
        employeeId,
        method: pending.method,
        code: pending.code,
        coords: pending.coords,
        selfiePath,
      });
      setResult({ kind: action, time: horaCorta(new Date().toISOString()) });
      setStep("done");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  // createPortal al document.body — antes este modal se renderizaba inline
  // dentro de la tarjeta que lo abre (FichajeProfesionalCard/
  // FichajeAdminSummaryCard), y un ancestro con overflow/transform (las
  // tarjetas de Mi Agenda) rompe el position:fixed, mezclando el modal
  // con el resto de la pantalla. Mismo patrón que SaldoComposicionModal/
  // FichajeQrModal, que sí usan portal.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[10000] grid place-items-center bg-black/80 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-3xl border border-white/10 bg-zinc-950 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Fichar jornada</h3>
          <button onClick={onClose} className="text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {step === "choose" && (
          <div className="mt-5 space-y-2.5">
            <button
              type="button"
              onClick={() => setStep("scan")}
              className="flex w-full items-center gap-3 rounded-xl bg-white/5 px-4 py-3.5 text-left ring-1 ring-white/10 transition hover:bg-white/10"
            >
              <Camera className="h-5 w-5 shrink-0 text-violet-300" />
              <div>
                <div className="text-sm font-semibold text-foreground">Escanear QR</div>
                <div className="text-xs text-muted-foreground">Usá la cámara para escanear el código de Inicio</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setStep("code")}
              className="flex w-full items-center gap-3 rounded-xl bg-white/5 px-4 py-3.5 text-left ring-1 ring-white/10 transition hover:bg-white/10"
            >
              <Keyboard className="h-5 w-5 shrink-0 text-sky-300" />
              <div>
                <div className="text-sm font-semibold text-foreground">Ingresar código</div>
                <div className="text-xs text-muted-foreground">Escribí el código de 6 caracteres de Inicio</div>
              </div>
            </button>
            {!onBehalf && (
              <button
                type="button"
                disabled={locating || branchHasLocation === false}
                onClick={() => void startLocation()}
                className="flex w-full items-center gap-3 rounded-xl bg-white/5 px-4 py-3.5 text-left ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-60"
              >
                {locating ? (
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin text-emerald-300" />
                ) : (
                  <MapPin className="h-5 w-5 shrink-0 text-emerald-300" />
                )}
                <div>
                  <div className="text-sm font-semibold text-foreground">Usar mi ubicación</div>
                  <div className="text-xs text-muted-foreground">
                    {branchHasLocation === false
                      ? "Esta sucursal no tiene ubicación cargada: usá el QR"
                      : "Tenés que estar en el local"}
                  </div>
                </div>
              </button>
            )}
            {!onBehalf && (
              <p className="px-1 pt-1 text-center text-xs text-muted-foreground">
                En los dos casos se pide una selfie para confirmar.
              </p>
            )}
          </div>
        )}

        {step === "selfie" && pending && (
          <FichajeSelfieStep
            submitting={submitting}
            confirmLabel={hasOpenSession ? "Fichar salida" : "Fichar entrada"}
            onConfirm={(blob) => void submitSelfie(blob)}
            onBack={() => {
              setPending(null);
              setStep("choose");
            }}
          />
        )}

        {step === "scan" && (
          <ScanStep
            submitting={submitting}
            onDetected={(branchId, code) => submitCode(branchId, code)}
            onBack={() => setStep("choose")}
          />
        )}

        {step === "code" && (
          <CodeStep
            submitting={submitting}
            onSubmit={async (code) => {
              const resolved = await resolveBranchFromCode(code);
              if (!resolved) {
                toast.error("Ese código no es válido.");
                return;
              }
              await submitCode(resolved.branchId, code);
            }}
            onBack={() => setStep("choose")}
          />
        )}

        {step === "done" && result && (
          <div className="mt-6 flex flex-col items-center gap-3 py-4 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-400" />
            <div className="text-lg font-semibold text-foreground">
              {result.kind === "in" ? `Entrada registrada · ${result.time}` : `Salida registrada · ${result.time}`}
            </div>
            <button
              type="button"
              onClick={onDone}
              className="mt-2 rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 px-5 py-2.5 text-sm font-semibold text-white"
            >
              Listo
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function CodeStep({
  submitting,
  onSubmit,
  onBack,
}: {
  submitting: boolean;
  onSubmit: (code: string) => void;
  onBack: () => void;
}) {
  const [code, setCode] = React.useState("");
  return (
    <div className="mt-5 space-y-3">
      <input
        autoFocus
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        maxLength={6}
        placeholder="A7K29P"
        className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3.5 text-center font-mono text-2xl font-bold tracking-[0.3em] text-foreground focus:outline-none focus:border-violet-400/50"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={submitting || code.trim().length < 4}
          onClick={() => onSubmit(code.trim())}
          className="flex-1 rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {submitting ? "Verificando…" : "Confirmar"}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-muted-foreground"
        >
          Volver
        </button>
      </div>
    </div>
  );
}

function ScanStep({
  submitting,
  onDetected,
  onBack,
}: {
  submitting: boolean;
  onDetected: (branchId: string, code: string) => void;
  onBack: () => void;
}) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [cameraError, setCameraError] = React.useState<string | null>(null);
  const detectedRef = React.useRef(false);

  React.useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        tick();
      } catch {
        setCameraError("No se pudo acceder a la cámara. Probá con \"Ingresar código\".");
      }
    }

    function tick() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const result = jsQR(imageData.data, imageData.width, imageData.height);
          if (result && !detectedRef.current) {
            const parsed = parseFichajeUrl(result.data);
            if (parsed) {
              detectedRef.current = true;
              onDetected(parsed.branchId, parsed.code);
              return;
            }
          }
        }
      }
      raf = requestAnimationFrame(tick);
    }

    start();
    return () => {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mt-5 space-y-3">
      {cameraError ? (
        <div className="rounded-xl bg-rose-500/10 px-3 py-3 text-sm text-rose-300 ring-1 ring-rose-500/20">
          {cameraError}
        </div>
      ) : (
        <div className="relative overflow-hidden rounded-2xl bg-black">
          <video ref={videoRef} muted playsInline className="aspect-square w-full object-cover" />
          <canvas ref={canvasRef} className="hidden" />
          {submitting && (
            <div className="absolute inset-0 grid place-items-center bg-black/70">
              <Loader2 className="h-6 w-6 animate-spin text-white" />
            </div>
          )}
          <div className="pointer-events-none absolute inset-6 rounded-2xl border-2 border-white/40" />
        </div>
      )}
      <button
        type="button"
        onClick={onBack}
        className="w-full rounded-xl border border-white/10 px-4 py-2.5 text-sm text-muted-foreground"
      >
        Volver
      </button>
    </div>
  );
}
