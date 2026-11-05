import * as React from "react";
import { Camera, Loader2 } from "lucide-react";

const MAX_SIDE = 480;

// Selfie en el momento: cámara frontal, sin elegir de la galería. Devuelve un
// JPEG liviano (lado mayor 480 px, ~25 KB) para guardarlo como evidencia del fichaje.
export function FichajeSelfieStep({
  submitting,
  confirmLabel,
  onConfirm,
  onBack,
}: {
  submitting: boolean;
  confirmLabel: string;
  onConfirm: (blob: Blob) => void;
  onBack: () => void;
}) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(false);
  const [shot, setShot] = React.useState<{ blob: Blob; url: string } | null>(null);

  const stopCamera = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = React.useCallback(async () => {
    setCameraError(null);
    setReady(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setReady(true);
    } catch {
      setCameraError("No se pudo acceder a la cámara. Permití el acceso a la cámara para fichar.");
    }
  }, []);

  // La cámara corre solo mientras no hay foto tomada; al repetir, el <video> se vuelve a montar.
  React.useEffect(() => {
    if (shot) return;
    void startCamera();
    return stopCamera;
  }, [shot, startCamera, stopCamera]);

  React.useEffect(() => {
    return () => {
      if (shot) URL.revokeObjectURL(shot.url);
    };
  }, [shot]);

  function takePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        stopCamera();
        setShot({ blob, url: URL.createObjectURL(blob) });
      },
      "image/jpeg",
      0.5,
    );
  }

  function retake() {
    setShot(null);
  }

  return (
    <div className="mt-5 space-y-3">
      <p className="text-center text-sm text-muted-foreground">
        {shot ? "¿Se ve bien tu cara?" : "Sacate una selfie para confirmar tu fichaje."}
      </p>
      {cameraError ? (
        <div className="rounded-xl bg-rose-500/10 px-3 py-3 text-sm text-rose-300 ring-1 ring-rose-500/20">
          {cameraError}
        </div>
      ) : (
        <div className="relative overflow-hidden rounded-2xl bg-black">
          {shot ? (
            <img src={shot.url} alt="Tu selfie" className="aspect-square w-full -scale-x-100 object-cover" />
          ) : (
            <video ref={videoRef} muted playsInline className="aspect-square w-full -scale-x-100 object-cover" />
          )}
          {submitting && (
            <div className="absolute inset-0 grid place-items-center bg-black/70">
              <Loader2 className="h-6 w-6 animate-spin text-white" />
            </div>
          )}
        </div>
      )}
      <div className="flex gap-2">
        {shot ? (
          <>
            <button
              type="button"
              disabled={submitting}
              onClick={() => onConfirm(shot.blob)}
              className="flex-1 rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {submitting ? "Guardando…" : confirmLabel}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={retake}
              className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-muted-foreground disabled:opacity-50"
            >
              Repetir
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={!ready || Boolean(cameraError)}
              onClick={takePhoto}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Camera className="h-4 w-4" /> Sacar selfie
            </button>
            <button
              type="button"
              onClick={onBack}
              className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-muted-foreground"
            >
              Volver
            </button>
          </>
        )}
      </div>
    </div>
  );
}
