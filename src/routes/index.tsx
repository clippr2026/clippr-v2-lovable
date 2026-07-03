import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Brain,
  CalendarDays,
  ChartNoAxesCombined,
  CheckCircle2,
  CircleDollarSign,
  Crown,
  Menu,
  Smartphone,
  Sparkles,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import dashboardImg from "@/assets/landing/dashboard.jpeg";
import advisorImg from "@/assets/landing/advisor.jpeg";
import agendaImg from "@/assets/landing/agenda.jpeg";
import cashImg from "@/assets/landing/cash.jpeg";
import clientsImg from "@/assets/landing/clients.jpeg";
import professionalsImg from "@/assets/landing/professionals.jpeg";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Clippr — Software para barberías que quieren crecer" },
      {
        name: "description",
        content:
          "Agenda, caja, clientes, profesionales y Asesor IA para administrar tu barbería como una empresa.",
      },
    ],
  }),
  component: LandingPage,
});

const sections = [
  {
    eyebrow: "Asesor IA",
    title: "Descubrí qué está frenando el crecimiento de tu negocio",
    text: "Clippr analiza ventas, clientes, ocupación, utilidad y rendimiento para mostrarte acciones concretas todos los días.",
    cta: "Conocer Asesor IA",
    icon: Brain,
    image: advisorImg,
    tone: "from-blue-500/25 via-violet-500/20 to-fuchsia-500/25",
  },
  {
    eyebrow: "Agenda",
    title: "Nunca más pierdas un turno",
    text: "Reservas online, agenda sincronizada en tiempo real, estados claros y control completo del día de cada profesional.",
    cta: "Ver agenda",
    icon: CalendarDays,
    image: agendaImg,
    tone: "from-sky-500/25 via-blue-500/15 to-violet-500/25",
  },
  {
    eyebrow: "Caja",
    title: "Sabé exactamente cuánto ganás",
    text: "Controlá ingresos, pendientes, gastos, comisiones, inventario y liquidaciones sin mezclar cuentas.",
    cta: "Ver caja",
    icon: CircleDollarSign,
    image: cashImg,
    tone: "from-violet-500/25 via-blue-500/15 to-emerald-500/20",
  },
  {
    eyebrow: "Clientes",
    title: "Fidelizá y recuperá clientes",
    text: "Identificá VIP, nuevos, activos, inactivos y perdidos para saber a quién cuidar, recuperar o premiar.",
    cta: "Ver clientes",
    icon: Users,
    image: clientsImg,
    tone: "from-fuchsia-500/25 via-violet-500/15 to-amber-400/20",
  },
  {
    eyebrow: "Equipo",
    title: "Medí el rendimiento de tus profesionales",
    text: "Cada profesional tiene agenda, ventas, historial, pagos y métricas para ordenar el trabajo del equipo.",
    cta: "Ver equipo",
    icon: Crown,
    image: professionalsImg,
    tone: "from-cyan-500/20 via-violet-500/15 to-fuchsia-500/20",
  },
];

const benefits = [
  "Sin Excel",
  "Sin turnos duplicados",
  "Con IA para decidir mejor",
  "Todo desde el celular",
];

function LandingPage() {
  const [menuOpen, setMenuOpen] = React.useState(false);

  return (
    <main className="min-h-screen overflow-hidden bg-[#05040b] text-white selection:bg-blue-500/40">
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-blue-500/25 blur-[120px]" />
        <div className="absolute top-[16%] -left-40 h-[520px] w-[520px] rounded-full bg-violet-600/25 blur-[130px]" />
        <div className="absolute top-[46%] -right-44 h-[520px] w-[520px] rounded-full bg-fuchsia-500/20 blur-[130px]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent,rgba(5,4,11,.72)_42%,#05040b_100%)]" />
      </div>

      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#070612]/75 backdrop-blur-2xl">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link to="/" className="flex items-center gap-3">
            <div className="grid h-16 w-16 place-items-center rounded-[1.4rem] bg-gradient-to-br from-blue-400 to-fuchsia-500 font-display text-3xl font-bold shadow-[0_0_54px_rgba(124,85,255,.72)]">
              C
            </div>
            <span className="font-display text-3xl font-semibold tracking-tight">Clippr</span>
          </Link>
          <nav className="hidden items-center gap-8 text-sm font-medium text-white/70 md:flex">
            <a href="#ia" className="transition hover:text-white">Asesor IA</a>
            <a href="#funciones" className="transition hover:text-white">Funciones</a>
            <a href="#app" className="transition hover:text-white">App</a>
            <Link to="/login" className="transition hover:text-white">Ingresar</Link>
          </nav>
          <div className="hidden items-center gap-3 md:flex">
            <Link
              to="/login"
              className="rounded-full border border-white/10 px-5 py-3 text-sm font-semibold text-white/85 transition hover:border-white/25 hover:bg-white/5"
            >
              Iniciar sesión
            </Link>
            <Link
              to="/login"
              className="rounded-full bg-[#4f7dff] px-6 py-3 text-sm font-bold text-white shadow-[0_16px_38px_-18px_rgba(79,125,255,.9)] transition hover:brightness-110"
            >
              Empezar gratis
            </Link>
          </div>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="grid h-12 w-12 place-items-center rounded-full border border-white/10 bg-white/5 md:hidden"
            aria-label="Abrir menú"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {menuOpen && (
          <div className="border-t border-white/10 bg-[#070612] px-5 py-5 md:hidden">
            <div className="grid gap-3 text-lg font-semibold">
              <a href="#ia" onClick={() => setMenuOpen(false)}>Asesor IA</a>
              <a href="#funciones" onClick={() => setMenuOpen(false)}>Funciones</a>
              <a href="#app" onClick={() => setMenuOpen(false)}>App</a>
              <Link to="/login" onClick={() => setMenuOpen(false)}>Ingresar</Link>
              <Link to="/login" className="mt-2 rounded-full bg-[#4f7dff] px-5 py-3 text-center">Empezar gratis</Link>
            </div>
          </div>
        )}
      </header>

      <section className="relative z-10 mx-auto max-w-7xl px-5 pb-20 pt-16 text-center sm:px-8 lg:pb-28 lg:pt-24">
        <div className="mx-auto mb-8 inline-flex items-center gap-3 rounded-full border border-fuchsia-300/50 bg-fuchsia-500/15 px-4 py-2 text-sm font-semibold text-fuchsia-100 shadow-[0_0_40px_rgba(232,121,249,.2)]">
          <Sparkles className="h-4 w-4" />
          Presentamos Clippr IA
          <span className="grid h-8 w-8 place-items-center rounded-full bg-fuchsia-400 text-black">
            <ArrowRight className="h-4 w-4" />
          </span>
        </div>
        <h1 className="mx-auto max-w-5xl font-display text-5xl font-black uppercase leading-[0.95] tracking-[-0.05em] sm:text-7xl lg:text-8xl">
          El software para barberías que quieren crecer
        </h1>
        <p className="mx-auto mt-7 max-w-3xl text-xl leading-relaxed text-white/70 sm:text-2xl">
          Controlá agenda, caja, clientes, equipo y rentabilidad desde un solo lugar. Con IA que analiza tu negocio y te dice qué mejorar.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            to="/login"
            className="inline-flex min-h-14 items-center justify-center rounded-full bg-[#4f7dff] px-8 text-base font-bold text-white shadow-[0_20px_48px_-20px_rgba(79,125,255,.95)] transition hover:scale-[1.02] hover:brightness-110"
          >
            Empezar gratis
          </Link>
          <a
            href="#funciones"
            className="inline-flex min-h-14 items-center justify-center rounded-full border border-white/15 bg-white/5 px-8 text-base font-bold text-white transition hover:border-white/30 hover:bg-white/10"
          >
            Ver cómo funciona
          </a>
        </div>
        <div className="mt-7 flex flex-wrap justify-center gap-3 text-sm text-white/60">
          {benefits.map((benefit) => (
            <span key={benefit} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[.03] px-4 py-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-300" /> {benefit}
            </span>
          ))}
        </div>

        <div className="relative mx-auto mt-16 max-w-[980px]">
          <div className="absolute left-1/2 top-10 h-[78%] w-[82%] -translate-x-1/2 rounded-[3rem] bg-gradient-to-br from-blue-500/35 to-fuchsia-500/30 blur-3xl" />
          <div className="relative overflow-hidden rounded-[2.4rem] border border-white/15 bg-white/[.04] p-3 shadow-[0_50px_120px_-50px_rgba(79,125,255,.6)] backdrop-blur">
            <img src={advisorImg} alt="Asesor IA de Clippr" className="mx-auto max-h-[720px] w-full rounded-[1.8rem] object-cover object-top" />
          </div>
        </div>
      </section>

      <section id="funciones" className="relative z-10 space-y-20 pb-20 lg:space-y-28 lg:pb-28">
        {sections.map((section, index) => (
          <FeatureBlock key={section.title} {...section} reverse={index % 2 === 1} id={index === 0 ? "ia" : undefined} />
        ))}
      </section>

      <section id="app" className="relative z-10 mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_.95fr]">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-fuchsia-300/35 bg-fuchsia-500/10 px-4 py-2 text-sm font-bold text-fuchsia-100">
              <Smartphone className="h-4 w-4" /> App de reservas
            </div>
            <h2 className="font-display text-5xl font-black uppercase leading-none tracking-[-0.05em] sm:text-7xl">
              Tu barbería en el teléfono de tus clientes
            </h2>
            <p className="mt-6 max-w-xl text-xl leading-relaxed text-white/68">
              Tus clientes pueden reservar desde una página pública premium y volver cuando quieran desde su celular. Menos mensajes, menos errores, más turnos.
            </p>
            <Link to="/login" className="mt-8 inline-flex items-center gap-3 rounded-full border border-white/15 bg-white/5 px-7 py-4 text-lg font-bold transition hover:bg-white/10">
              Sé un ícono <span className="grid h-9 w-9 place-items-center rounded-full bg-fuchsia-400 text-black"><ArrowRight className="h-5 w-5" /></span>
            </Link>
          </div>
          <div className="relative min-h-[560px]">
            <div className="absolute inset-x-8 top-10 h-[390px] rounded-[2rem] bg-fuchsia-300" />
            <div className="absolute left-1/2 top-0 w-[70%] -translate-x-1/2 overflow-hidden rounded-[1.6rem] border border-white/25 bg-white/10 shadow-2xl">
              <img src={dashboardImg} alt="Dashboard Clippr" className="h-[420px] w-full object-cover object-top opacity-95" />
            </div>
            <div className="absolute bottom-4 left-1/2 w-[72%] -translate-x-1/2 rounded-[2rem] border border-white/20 bg-[#06040c]/95 p-7 shadow-[0_28px_80px_-30px_rgba(0,0,0,.9)]">
              <div className="mx-auto mb-6 grid h-32 w-32 place-items-center rounded-[2rem] bg-gradient-to-br from-blue-400 to-fuchsia-500 text-6xl font-bold shadow-[0_0_74px_rgba(168,85,247,.72)]">C</div>
              <h3 className="font-display text-4xl font-black uppercase leading-none">Fidelizá a tus clientes</h3>
              <p className="mt-3 text-white/60">Reservas simples, experiencia premium y tu marca siempre presente.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-7xl px-5 py-20 text-center sm:px-8 lg:py-28">
        <div className="relative overflow-hidden rounded-[2.5rem] border border-white/10 bg-white/[.04] px-6 py-16 backdrop-blur-2xl sm:px-12 lg:py-24">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/20 via-violet-500/10 to-fuchsia-500/20" />
          <div className="relative">
            <h2 className="mx-auto max-w-4xl font-display text-5xl font-black uppercase leading-none tracking-[-0.05em] sm:text-7xl">
              Administrá tu barbería como una empresa
            </h2>
            <p className="mx-auto mt-6 max-w-2xl text-xl text-white/68">
              Turnos, clientes, ventas, profesionales y decisiones más inteligentes en un solo sistema.
            </p>
            <Link to="/login" className="mt-9 inline-flex min-h-16 items-center justify-center rounded-full bg-[#4f7dff] px-10 text-lg font-black uppercase tracking-wide shadow-[0_24px_58px_-24px_rgba(79,125,255,.95)] transition hover:scale-[1.02] hover:brightness-110">
              Crear cuenta gratis
            </Link>
          </div>
        </div>
      </section>

      <footer className="relative z-10 border-t border-white/10 px-5 py-10 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 text-white/55 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 text-white">
            <div className="grid h-14 w-14 place-items-center rounded-[1.25rem] bg-gradient-to-br from-blue-400 to-fuchsia-500 text-2xl font-bold shadow-[0_0_40px_rgba(124,85,255,.55)]">C</div>
            <span className="font-display text-2xl font-semibold">Clippr</span>
          </div>
          <div className="text-sm">© 2026 Clippr. Todos los derechos reservados.</div>
        </div>
      </footer>
    </main>
  );
}

function FeatureBlock({
  eyebrow,
  title,
  text,
  cta,
  icon: Icon,
  image,
  tone,
  reverse,
  id,
}: {
  eyebrow: string;
  title: string;
  text: string;
  cta: string;
  icon: React.ComponentType<{ className?: string }>;
  image: string;
  tone: string;
  reverse?: boolean;
  id?: string;
}) {
  return (
    <article id={id} className="mx-auto max-w-7xl px-5 sm:px-8">
      <div className={cn("grid items-center gap-10 lg:grid-cols-2", reverse && "lg:[&>*:first-child]:order-2")}>
        <div className="relative">
          <div className={cn("absolute inset-x-8 top-12 h-[72%] rounded-[2rem] bg-gradient-to-br blur-2xl", tone)} />
          <div className="relative mx-auto max-w-[420px] overflow-hidden rounded-[2rem] border border-white/15 bg-white/[.04] p-2 shadow-[0_42px_100px_-42px_rgba(79,125,255,.55)] backdrop-blur">
            <img src={image} alt={title} className="h-[640px] w-full rounded-[1.45rem] object-cover object-top" />
          </div>
        </div>
        <div className="text-center lg:text-left">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[.05] px-4 py-2 text-sm font-bold text-white/75">
            <Icon className="h-4 w-4 text-blue-300" /> {eyebrow}
          </div>
          <h2 className="font-display text-5xl font-black uppercase leading-none tracking-[-0.05em] sm:text-7xl">
            {title}
          </h2>
          <p className="mt-6 text-xl leading-relaxed text-white/68">{text}</p>
          <Link to="/login" className="mt-8 inline-flex items-center gap-3 rounded-full border border-white/15 bg-white/5 px-7 py-4 text-lg font-bold transition hover:bg-white/10">
            {cta} <span className="grid h-9 w-9 place-items-center rounded-full bg-[#4f7dff] text-white"><ArrowRight className="h-5 w-5" /></span>
          </Link>
        </div>
      </div>
    </article>
  );
}
