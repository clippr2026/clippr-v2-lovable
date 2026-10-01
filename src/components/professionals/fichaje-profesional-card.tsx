import * as React from "react";
import jsQR from "jsqr";
import { toast } from "sonner";
import {
  getOpenWorkSession,
  resolveBranchFromCode,
  validateDailyCode,
  clockIn,
  clockOut,
  type WorkSession,
} from "@/lib/fichaje";
import { ScanLine, Camera, Keyboard, X, CheckCircle2, Loader2 } from "lucide-react";

type FlowStep = "choose" | "scan" | "code" | "done";

function horaCorta(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

// Parsea la URL que codifica el QR del kiosco
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

// "Fichar jornada" — sección del panel del propio profesional. A
// diferencia del kiosco (que muestra el QR), acá el profesional nunca ve
// el QR del local: solo puede escanearlo (cámara) o tipear el código a
// mano. Mismo código sirve para entrada y salida — se decide solo según
// si ya tiene una jornada abierta hoy.
export function FichajeProfesionalCard({
  businessId,
  employeeId,
}: {
  businessId: string | null;
  employeeId: string | null;
}) {
  const [openSession, setOpenSession] = React.useState<WorkSession | null>(null);
  const [loadingStatus, setLoadingStatus] = React.useState(true);
  const [modalOpen, setModalOpen] = React.useState(false);

  const loadStatus = React.useCallback(async () => {
    if (!employeeId) {
      setLoadingStatus(false);
      return;
    }
    setLoadingStatus(true);
    const session = await getOpenWorkSession(employeeId);
    setOpenSession(session);
    setLoadingStatus(false);
  }, [employeeId]);

  React.useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  if (!employeeId) return null;

  return (
    <div className="glass rounded-2xl p-4 sm:p-5 ring-1 ring-white/5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ScanLine className="h-4 w-4 text-emerald-300" />
            Jornada de hoy
          </div>
          <div className="mt-1.5 text-sm text-muted-foreground">
            {loadingStatus ? (
              "Cargando…"
            ) : !openSession ? (
              "Sin iniciar"
            ) : openSession.clock_out_at ? (
              <>Entrada {horaCorta(openSession.clock_in_at)} · Salida {horaCorta(openSession.clock_out_at)}</>
            ) : (
              <>Entrada {horaCorta(openSession.clock_in_at)}</>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="shrink-0 rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 px-4 py-2.5 text-sm font-semibold text-white"
        >
          Fichar jornada
        </button>
      </div>

      {modalOpen && (
        <FichajeFlowModal
          businessId={businessId}
          employeeId={employeeId}
          hasOpenSession={Boolean(openSession && !openSession.clock_out_at)}
          onClose={() => setModalOpen(false)}
          onDone={() => {
            setModalOpen(false);
            loadStatus();
          }}
        />
      )}
    </div>
  );
}

function FichajeFlowModal({
  businessId,
  employeeId,
  hasOpenSession,
  onClose,
  onDone,
}: {
  businessId: string | null;
  employeeId: string;
  hasOpenSession: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = React.useState<FlowStep>("choose");
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<{ kind: "in" | "out"; time: string } | null>(null);

  async function submitCode(branchId: string, code: string) {
    if (!businessId || submitting) return;
    setSubmitting(true);
    try {
      const valid = await validateDailyCode(branchId, code);
      if (!valid) {
        toast.error("Ese código ya no es válido. Pedí el código de hoy en el kiosco del local.");
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

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4" onClick={onClose}>
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
                <div className="text-xs text-muted-foreground">Usá la cámara para escanear el código del local</div>
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
                <div className="text-xs text-muted-foreground">Escribí el código que ves en el local</div>
              </div>
            </button>
          </div>
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
    </div>
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
