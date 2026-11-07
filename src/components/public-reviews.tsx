import * as React from "react";
import { AlertCircle, Check, Loader2, MessageSquarePlus, Star, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export type PublicReview = {
  id: string;
  professional_id: string | null;
  professional_name: string | null;
  client_name: string;
  rating: number;
  comment: string | null;
  review_date: string;
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

const INITIAL_VISIBLE = 6;

// "Opiniones de clientes": lista de reseñas publicadas + flujo para dejar una.
// El cliente pone su WhatsApp; si se atendió, ve con qué barberos y le puede dejar
// una reseña a cada uno (la reseña queda pendiente hasta que el negocio la aprueba).
export function PublicReviews({
  businessId,
  reviews,
  average,
  count,
  accent,
  buttonText,
  light = false,
}: {
  businessId: string;
  reviews: PublicReview[];
  average: number | null;
  count: number;
  accent: string;
  buttonText: string;
  light?: boolean;
}) {
  const [showAll, setShowAll] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [phone, setPhone] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [notFound, setNotFound] = React.useState(false);
  const [barbers, setBarbers] = React.useState<BarberRow[] | null>(null);
  const [target, setTarget] = React.useState<BarberRow | null>(null);
  const [rating, setRating] = React.useState(5);
  const [comment, setComment] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  const visible = showAll ? reviews : reviews.slice(0, INITIAL_VISIBLE);

  function reset() {
    setOpen(false);
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
    <div className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Opiniones de clientes</h2>
          {count > 0 && average != null ? (
            <div className="mt-1 flex items-center gap-2 text-sm">
              <StarRow value={Math.round(average)} />
              <span className="font-bold">{average.toFixed(1).replace(".", ",")}</span>
              <span className="text-white/55">· {count} {count === 1 ? "reseña" : "reseñas"}</span>
            </div>
          ) : (
            <p className="mt-1 text-sm text-white/55">Todavía no hay reseñas. ¡Sé el primero en opinar!</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-bold"
          style={{ background: accent, color: buttonText }}
        >
          <MessageSquarePlus className="h-4 w-4" /> Dejar mi reseña
        </button>
      </div>

      {visible.length > 0 ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {visible.map((r) => (
            <div key={r.id} className="min-w-0 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{r.client_name}</span>
                {r.professional_name ? (
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/70">
                    Para {r.professional_name}
                  </span>
                ) : null}
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <StarRow value={r.rating} size={15} />
                <span className="text-xs text-white/50">{formatReviewDate(r.review_date)}</span>
              </div>
              {r.comment ? <p className="mt-2 break-words text-sm text-white/80">"{r.comment}"</p> : null}
            </div>
          ))}
        </div>
      ) : null}

      {reviews.length > INITIAL_VISIBLE ? (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-4 text-sm font-semibold underline underline-offset-4"
          style={{ color: accent }}
        >
          {showAll ? "Ver menos" : `Ver todas (${reviews.length})`}
        </button>
      ) : null}

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
                  style={{ background: accent, color: buttonText }}
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
                  style={{ background: accent, color: buttonText }}
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
                        style={{ background: accent, color: buttonText }}
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
              style={{ background: accent, color: buttonText }}
            >
              Aceptar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Tira corta de reseñas destacadas, justo debajo del encabezado: prueba social antes de reservar.
// Muestra las 3 más nuevas de 4 y 5 estrellas (con comentario cuando hay).
export function ReviewsStrip({ reviews, accent }: { reviews: PublicReview[]; accent: string }) {
  const picks = React.useMemo(() => {
    const good = reviews.filter((r) => r.rating >= 4);
    const withText = good.filter((r) => r.comment && r.comment.trim());
    const rest = good.filter((r) => !(r.comment && r.comment.trim()));
    return [...withText, ...rest].slice(0, 3);
  }, [reviews]);
  if (picks.length === 0) return null;
  return (
    <section className="mx-auto max-w-6xl px-4 pt-5">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold sm:text-lg">Lo que dicen nuestros clientes</h2>
        <a href="#opiniones" className="text-xs font-semibold underline underline-offset-4" style={{ color: accent }}>
          Ver todas
        </a>
      </div>
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {picks.map((r) => (
          <div
            key={r.id}
            className="w-[78%] shrink-0 snap-start rounded-3xl border border-white/10 bg-white/[0.04] p-4 sm:w-auto sm:min-w-0"
          >
            <div className="flex items-center justify-between gap-2">
              <StarRow value={r.rating} size={15} />
              <span className="text-[11px] text-white/50">{formatReviewDate(r.review_date)}</span>
            </div>
            {r.comment ? <p className="mt-2 line-clamp-3 break-words text-sm text-white/85">"{r.comment}"</p> : null}
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold">{r.client_name}</span>
              {r.professional_name ? <span className="text-xs text-white/55">· para {r.professional_name}</span> : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
