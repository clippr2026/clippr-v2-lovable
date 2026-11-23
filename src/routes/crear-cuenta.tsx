import * as React from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff, KeyRound, Mail, MailCheck, Store, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { StartShell } from "@/components/auth/start-shell";

type Tipo = "negocio" | "profesional" | "embajador";

export const Route = createFileRoute("/crear-cuenta")({
  validateSearch: (search: Record<string, unknown>): { tipo: Tipo } => ({
    tipo: search.tipo === "profesional" || search.tipo === "embajador" ? search.tipo : "negocio",
  }),
  head: () => ({
    meta: [
      { title: "Crear cuenta — Clippr" },
      { name: "description", content: "Creá tu cuenta de Clippr." },
    ],
  }),
  component: CrearCuentaPage,
});

const inputCls =
  "h-14 w-full min-w-0 rounded-2xl border border-white/10 bg-black/30 pl-12 pr-4 text-lg font-semibold text-white placeholder:text-white/35 focus:border-violet-400/50 focus:outline-none";

function CrearCuentaPage() {
  const { tipo } = Route.useSearch();
  const navigate = useNavigate();
  const [nombre, setNombre] = React.useState("");
  const [negocio, setNegocio] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [show, setShow] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState(false);
  const [sentTo, setSentTo] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!nombre.trim()) return setError("Ingresá tu nombre.");
    if (tipo === "negocio" && !negocio.trim()) return setError("Ingresá el nombre de tu barbería.");
    if (!cleanEmail) return setError("Ingresá tu correo.");
    if (password.length < 8) return setError("La contraseña debe tener al menos 8 caracteres.");
    setError(null);
    setSending(true);
    const { data, error: err } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
        data: {
          full_name: nombre.trim(),
          account_type: tipo,
          ...(tipo === "negocio" ? { business_name: negocio.trim() } : {}),
          ...(tipo === "profesional" ? { role: "profesional" } : {}),
        },
      },
    });
    setSending(false);
    if (err) {
      setError(
        /registered|already/i.test(err.message)
          ? "Ese correo ya tiene cuenta. Iniciá sesión."
          : "No se pudo crear la cuenta. Probá de nuevo.",
      );
      return;
    }
    // Con la confirmación por correo apagada Supabase devuelve la sesión directo: se sigue al panel.
    if (data.session) {
      navigate({ to: "/login", replace: true });
      return;
    }
    setSentTo(cleanEmail);
  }

  if (sentTo) {
    return (
      <StartShell>
        <div className="mx-auto grid h-20 w-20 place-items-center rounded-3xl bg-violet-500/20 text-violet-300 ring-1 ring-violet-300/25">
          <MailCheck className="h-10 w-10" />
        </div>
        <h1 className="mt-6 text-center font-display text-3xl font-bold">Revisá tu correo</h1>
        <p className="mt-3 text-center text-lg text-white/65">
          Te enviamos un mail a <b className="text-white">{sentTo}</b>. Tocá el botón del mail para activar tu cuenta.
        </p>
        <Link
          to="/login"
          className="mt-8 inline-flex h-14 items-center justify-center rounded-full bg-gradient-to-r from-sky-400 to-violet-500 text-lg font-semibold text-white shadow-[0_0_22px_-6px_rgba(139,92,246,0.8)]"
        >
          Ir a iniciar sesión
        </Link>
      </StartShell>
    );
  }

  return (
    <StartShell back={{ to: "/empezar", label: "Volver" }}>
      <h1 className="font-display text-4xl font-bold leading-tight">Creá tu cuenta</h1>
      <p className="mt-2 text-lg text-white/65">
        {tipo === "negocio"
          ? "Empezá a armar tu barbería."
          : tipo === "profesional"
            ? "Después tu barbería te suma al equipo."
            : "Recomendá Clippr y ganá recompensas."}
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
        <label className="block">
          <span className="mb-1.5 block text-base font-semibold text-white/85">Nombre completo</span>
          <span className="relative block">
            <UserRound className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-violet-300" />
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="name" placeholder="Tu nombre y apellido" className={inputCls} />
          </span>
        </label>

        {tipo === "negocio" && (
          <label className="block">
            <span className="mb-1.5 block text-base font-semibold text-white/85">Nombre de tu barbería</span>
            <span className="relative block">
              <Store className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-violet-300" />
              <input value={negocio} onChange={(e) => setNegocio(e.target.value)} autoComplete="organization" placeholder="Ej: Barbería Central" className={inputCls} />
            </span>
          </label>
        )}

        <label className="block">
          <span className="mb-1.5 block text-base font-semibold text-white/85">Correo</span>
          <span className="relative block">
            <Mail className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-violet-300" />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="nombre@correo.com" className={inputCls} />
          </span>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-base font-semibold text-white/85">Contraseña</span>
          <span className="relative block">
            <KeyRound className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-violet-300" />
            <input
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="Mínimo 8 caracteres"
              className={`${inputCls} pr-14`}
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? "Ocultar contraseña" : "Ver contraseña"}
              className="absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full text-violet-300"
            >
              {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </span>
        </label>

        {error && <div className="rounded-2xl bg-red-500/10 px-4 py-3 text-base text-red-200 ring-1 ring-red-400/30">{error}</div>}

        <button
          type="submit"
          disabled={sending}
          className="h-14 w-full rounded-full bg-gradient-to-r from-sky-400 to-violet-500 text-lg font-semibold text-white shadow-[0_0_22px_-6px_rgba(139,92,246,0.8)] transition active:scale-[0.99] disabled:opacity-60"
        >
          {sending ? "Creando…" : "Crear cuenta"}
        </button>
      </form>

      <p className="mt-auto pt-8 text-center text-base text-white/60">
        ¿Ya tenés cuenta?{" "}
        <Link to="/login" className="font-semibold text-white underline underline-offset-4">
          Iniciar sesión
        </Link>
      </p>
    </StartShell>
  );
}
