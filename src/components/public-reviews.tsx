import * as React from "react";
import { publicButtonStyle } from "@/lib/public-button";
import { AlertCircle, Check, ChevronLeft, ChevronRight, Loader2, MessageSquarePlus, Star, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export type PublicReview = {
  id: string;
  professional_id: string | null;
  professional_name: string | null;
  client_name: string;
  rating: number;
  comment: string | null;
  review_date: string;
  featured?: boolean;
};

type BarberRow = { professional_id: string; professional_name: string | null; last_visit: string; already_reviewed: boolean };

export function formatReviewDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

export function StarRow({ value, size = 16, onChange }: { value: number; size?: number; onChange?: (n: number) => void }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} de 5 estrellas`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(n)}
          className={onChange ? "cursor-pointer" : "cursor-default"}
          aria-label={`${n} estrellas`}
        >
          <Star
            style={{ width: size, height: size, color: "#F5B301" }}
            className={n <= value ? "fill-current" : "fill-transparent opacity-40"}
          />
        </button>
      ))}
    </span>
  );
}

// Flujo para dejar una reseña (WhatsApp → barberos que lo atendieron → estrellas y comentario).
// La reseña queda pendiente hasta que el negocio la aprueba.
export function LeaveReviewModal({
  businessId,
  open,
  onClose,
  accent,
  buttonText,
  light = false,
}: {
  businessId: string;
  open: boolean;
  onClose: () => void;
  accent: string;
  buttonText: string;
  light?: boolean;
}) {
  const [phone, setPhone] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [notFound, setNotFound] = React.useState(false);
  const [barbers, setBarbers] = React.useState<BarberRow[] | null>(null);
  const [target, setTarget] = React.useState<BarberRow | null>(null);
  const [rating, setRating] = React.useState(5);
  const [comment, setComment] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  function reset() {
    onClose();
    setPhone("");
    setBarbers(null);
    setTarget(null);
    setRating(5);
    setComment("");
    setError(null);
    setDone(false);
    setNotFound(false);
  }

  async function lookup() {
    setError(null);
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 8) return setError("Ingresá tu WhatsApp completo");
    setBusy(true);
    const { data, error: err } = await (supabase as any).rpc("public_find_review_barbers", {
      p_business_id: businessId,
      p_phone: phone,
    });
    setBusy(false);
    if (err) return setError("No pudimos verificar tu número. Probá de nuevo.");
    const rows = (data ?? []) as BarberRow[];
    if (rows.length === 0) return setNotFound(true);
    setBarbers(rows);
  }

  async function submit() {
    if (!target) return;
    setError(null);
    setBusy(true);
    const { error: err } = await (supabase as any).rpc("public_submit_review", {
      p_business_id: businessId,
      p_phone: phone,
      p_professional_id: target.professional_id,
      p_rating: rating,
      p_comment: comment.trim() || null,
    });
    setBusy(false);
    if (err) return setError(err.message || "No pudimos guardar tu reseña");
    setDone(true);
    setBarbers((prev) => (prev ?? []).map((b) => (b.professional_id === target.professional_id ? { ...b, already_reviewed: true } : b)));
    setTarget(null);
    setRating(5);
    setComment("");
  }

  // En modo blanco la ventana es blanca (la página remapea text-white a oscuro); en negro, oscura.
  const panel = `w-full max-w-md rounded-3xl border border-white/10 ${light ? "bg-white" : "bg-[#0d0b14]"} p-5 text-white shadow-2xl`;

  return (
    <>
      {open && !notFound ? (
        <div className="fixed inset-0 z-[250] grid place-items-center overflow-y-auto bg-black/75 p-4 backdrop-blur-sm" onClick={reset}>
          <div className={panel} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">{barbers ? "¿A quién querés opinar?" : "Dejá tu reseña"}</h3>
              <button type="button" onClick={reset} className="rounded-full p-1.5 hover:bg-white/10" aria-label="Cerrar">
                <X className="h-4 w-4" />
              </button>
            </div>

            {!barbers ? (
              <div className="mt-4 space-y-3">
                <p className="text-sm text-white/65">Ingresá el WhatsApp con el que reservaste para verificar que te atendiste.</p>
                <input
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Ingresá tu WhatsApp"
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-base text-white outline-none placeholder:text-white/40 focus:border-white/30"
                />
                {error ? <p className="text-sm text-rose-300">{error}</p> : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void lookup()}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold disabled:opacity-60"
                  style={publicButtonStyle(accent, buttonText)}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Verificar
                </button>
              </div>
            ) : target ? (
              <div className="mt-4 space-y-3">
                <p className="text-sm text-white/70">
                  Tu opinión para <b className="text-white">{target.professional_name ?? "tu barbero"}</b>
                </p>
                <StarRow value={rating} size={34} onChange={setRating} />
                <textarea
                  value={comment}
                  maxLength={600}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Contanos cómo fue tu experiencia (opcional)"
                  className="min-h-[110px] w-full resize-y rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-base text-white outline-none placeholder:text-white/40 focus:border-white/30"
                />
                {error ? <p className="text-sm text-rose-300">{error}</p> : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void submit()}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold disabled:opacity-60"
                  style={publicButtonStyle(accent, buttonText)}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Enviar reseña
                </button>
                <button type="button" onClick={() => setTarget(null)} className="w-full text-center text-sm text-white/55 underline">
                  Volver
                </button>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {done ? (
                  <div className="flex items-start gap-2 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 p-3 text-sm text-emerald-200">
                    <Check className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>¡Gracias! Tu reseña se publica cuando el negocio la apruebe.</span>
                  </div>
                ) : (
                  <p className="text-sm text-white/65">Podés dejarle una reseña a cada barbero que te atendió.</p>
                )}
                {barbers.map((b) => (
                  <div key={b.professional_id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{b.professional_name ?? "Barbero"}</div>
                      <div className="text-xs text-white/50">Última visita: {formatReviewDate(b.last_visit.slice(0, 10))}</div>
                    </div>
                    {b.already_reviewed ? (
                      <span className="shrink-0 text-xs font-semibold text-emerald-300">Ya dejaste tu reseña</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setDone(false);
                          setError(null);
                          setTarget(b);
                        }}
                        className="shrink-0 rounded-xl px-3 py-2 text-xs font-bold"
                        style={publicButtonStyle(accent, buttonText)}
                      >
                        Dejar reseña
                      </button>
                    )}
                  </div>
                ))}
                {barbers.every((b) => b.already_reviewed) && !done ? (
                  <p className="text-center text-sm text-white/55">Ya les dejaste tu reseña a todos tus barberos. ¡Gracias!</p>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {open && notFound ? (
        <div className="fixed inset-0 z-[260] grid place-items-center bg-black/80 p-4 backdrop-blur-sm">
          <div className={`${panel} text-center`}>
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full" style={{ background: accent, color: buttonText }}>
              <AlertCircle className="h-7 w-7" />
            </div>
            <p className="mt-4 text-base text-white/75">
              No encontramos tu número. Debes haber agendado al menos una vez para dejar una opinión.
            </p>
            <button
              type="button"
              onClick={() => setNotFound(false)}
              className="mt-5 w-full rounded-full py-3 text-sm font-bold uppercase tracking-wide"
              style={publicButtonStyle(accent, buttonText)}
            >
              Aceptar
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

export const FEATURED_MAX = 10;

function ReviewCard({ r, className = "" }: { r: PublicReview; className?: string }) {
  return (
    <div className={"min-w-0 rounded-3xl border border-white/10 bg-white/[0.04] p-4 " + className}>
      <div className="flex items-center justify-between gap-2">
        <StarRow value={r.rating} size={15} />
        <span className="text-[11px] text-white/50">{formatReviewDate(r.review_date)}</span>
      </div>
      {r.comment ? <p className="mt-2 line-clamp-4 break-words text-sm text-white/85">"{r.comment}"</p> : null}
      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">{r.client_name}</span>
        {r.professional_name ? <span className="text-xs text-white/55">· para {r.professional_name}</span> : null}
      </div>
    </div>
  );
}

// Carrusel de reseñas destacadas (hasta 10, las que elige el negocio; si no eligió ninguna, las más
// nuevas de 4 y 5 estrellas), con "Ver todas" al final y "Dejar mi reseña" arriba a la derecha.
export function ReviewsStrip({
  businessId,
  reviews,
  accent,
  buttonText,
  light = false,
  average,
  count,
}: {
  businessId: string;
  reviews: PublicReview[];
  accent: string;
  buttonText: string;
  light?: boolean;
  average: number | null;
  count: number;
}) {
  const [allOpen, setAllOpen] = React.useState(false);
  const [leaveOpen, setLeaveOpen] = React.useState(false);
  const scroller = React.useRef<HTMLDivElement | null>(null);

  const picks = React.useMemo(() => {
    const featured = reviews.filter((r) => r.featured).slice(0, FEATURED_MAX);
    if (featured.length > 0) return featured;
    const good = reviews.filter((r) => r.rating >= 4);
    const withText = good.filter((r) => r.comment && r.comment.trim());
    const rest = good.filter((r) => !(r.comment && r.comment.trim()));
    return [...withText, ...rest].slice(0, FEATURED_MAX);
  }, [reviews]);

  function scrollBy(dir: 1 | -1) {
    const el = scroller.current;
    if (el) el.scrollBy({ left: dir * Math.max(240, el.clientWidth * 0.8), behavior: "smooth" });
  }

  return (
    <div className="p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <h2 className="shrink-0 whitespace-nowrap text-[clamp(1.05rem,5.2vw,1.5rem)] font-semibold leading-tight">Lo que dicen nuestros clientes</h2>
        {count > 0 && average != null ? (
          <div className="flex items-center gap-1.5">
            <StarRow value={Math.round(average)} size={16} />
            <span className="text-sm font-bold">{average.toFixed(1).replace(".", ",")}</span>
          </div>
        ) : null}
      </div>

      {picks.length > 0 ? (
        <div className="group relative">
          <div
            ref={scroller}
            className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {picks.map((r) => (
              <ReviewCard key={r.id} r={r} className="w-[80%] shrink-0 snap-start sm:w-[calc((100%-1.5rem)/3)]" />
            ))}
            {count > 0 ? (
              <button
                type="button"
                onClick={() => setAllOpen(true)}
                className="grid w-[56%] shrink-0 snap-start place-items-center rounded-3xl border border-dashed border-white/25 bg-white/[0.03] p-4 text-center sm:w-[calc((100%-1.5rem)/3)]"
              >
                <span>
                  <span className="block text-sm font-bold" style={{ color: accent }}>
                    Ver todas
                  </span>
                  <span className="mt-0.5 block text-xs text-white/55">{count} {count === 1 ? "reseña" : "reseñas"}</span>
                </span>
              </button>
            ) : null}
          </div>
          {picks.length > 1 ? (
            <>
              <button
                type="button"
                onClick={() => scrollBy(-1)}
                aria-label="Anteriores"
                className="absolute -left-3 top-1/2 hidden h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white shadow-lg ring-1 ring-white/20 backdrop-blur hover:bg-black/80 sm:grid"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => scrollBy(1)}
                aria-label="Siguientes"
                className="absolute -right-3 top-1/2 hidden h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white shadow-lg ring-1 ring-white/20 backdrop-blur hover:bg-black/80 sm:grid"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          ) : null}
        </div>
      ) : (
        <p className="rounded-3xl border border-dashed border-white/15 p-4 text-sm text-white/55">
          Todavía no hay reseñas. ¡Sé el primero en opinar!
        </p>
      )}

      <button
        type="button"
        onClick={() => setLeaveOpen(true)}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold"
        style={publicButtonStyle(accent, buttonText)}
      >
        <MessageSquarePlus className="h-4 w-4" /> Dejar mi reseña
      </button>

      {allOpen ? (
        <div className="fixed inset-0 z-[240] grid place-items-center bg-black/75 p-3 backdrop-blur-sm" onClick={() => setAllOpen(false)}>
          <div
            className={`flex max-h-[90vh] w-full max-w-2xl flex-col rounded-3xl border border-white/10 ${light ? "bg-white" : "bg-[#0d0b14]"} text-white shadow-2xl`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-white/10 p-5">
              <div>
                <h3 className="text-lg font-semibold">Opiniones de clientes</h3>
                {count > 0 && average != null ? (
                  <div className="mt-1 flex items-center gap-2 text-sm">
                    <StarRow value={Math.round(average)} />
                    <span className="font-bold">{average.toFixed(1).replace(".", ",")}</span>
                    <span className="text-white/55">· {count} {count === 1 ? "reseña" : "reseñas"}</span>
                  </div>
                ) : null}
              </div>
              <button type="button" onClick={() => setAllOpen(false)} className="rounded-full p-1.5 hover:bg-white/10" aria-label="Cerrar">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
              {reviews.map((r) => (
                <ReviewCard key={r.id} r={r} />
              ))}
            </div>
            <div className="border-t border-white/10 p-4">
              <button
                type="button"
                onClick={() => setLeaveOpen(true)}
                className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold"
                style={publicButtonStyle(accent, buttonText)}
              >
                <MessageSquarePlus className="h-4 w-4" /> Dejar mi reseña
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <LeaveReviewModal businessId={businessId} open={leaveOpen} onClose={() => setLeaveOpen(false)} accent={accent} buttonText={buttonText} light={light} />
    </div>
  );
}
