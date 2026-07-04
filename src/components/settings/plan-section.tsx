import {
  Check,
  CalendarDays,
  Rocket,
  ChevronRight,
  Store,
  Cloud,
  RefreshCw,
  Headphones,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─────────── Plan & facturación ───────────
const fmtARS = (n: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(n);

const plans = [
  {
    id: "pro",
    name: "Pro",
    icon: Rocket,
    tagline: "Ideal para barberías y salones con una sucursal.",
    monthly: 29900,
    badge: "60 DÍAS GRATIS",
    highlight: true,
    cta: "Comenzar prueba gratuita",
    features: [
      "1 sucursal",
      "Profesionales ilimitados",
      "Agenda online",
      "Caja y cobros",
      "Clientes",
      "Comisiones",
      "Página de reservas",
      "Asesor IA",
      "Estadísticas del negocio",
    ],
  },
  {
    id: "business",
    name: "Business",
    icon: Store,
    tagline: "Para negocios con más de una sucursal.",
    monthly: 49900,
    badge: "MULTISUCURSAL",
    highlight: false,
    cta: "Comenzar prueba gratuita",
    features: [
      "Todo lo incluido en Pro",
      "2 sucursales incluidas",
      "Comparativa entre sucursales",
      "Dashboard consolidado",
      "Métricas por local",
      "Roles y permisos avanzados",
      "Gestión centralizada",
      "Soporte prioritario",
    ],
    extra: "+ $10.000 / mes por cada sucursal adicional",
    examples: [
      "2 sucursales → $49.900",
      "3 sucursales → $59.900",
      "4 sucursales → $69.900",
    ],
  },
];

const trustItems = [
  {
    icon: ShieldCheck,
    title: "Sin tarjeta",
    desc: "Probá 60 días sin compromiso.",
  },
  {
    icon: Cloud,
    title: "Tus datos seguros",
    desc: "Guardados en la nube.",
  },
  {
    icon: RefreshCw,
    title: "Actualizaciones incluidas",
    desc: "Mejoras sin costo extra.",
  },
  { icon: Headphones, title: "Soporte humano", desc: "Estamos para ayudarte." },
];

export function PlanSection() {
  const trialTotal = 60;
  const trialLeft = 43;
  const trialPct = ((trialTotal - trialLeft) / trialTotal) * 100;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Planes</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Probá Clippr gratis y después elegí el plan según la cantidad de
            sucursales.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_oklch(0.78_0.15_150)]" />
          60 días gratis
        </div>
      </div>

      <div className="relative overflow-hidden rounded-2xl p-5 ring-1 ring-[oklch(0.62_0.25_295/0.28)] bg-gradient-to-br from-[oklch(0.18_0.07_290/0.78)] via-[oklch(0.12_0.04_285/0.9)] to-[oklch(0.08_0.03_275)] shadow-[0_0_60px_-30px_oklch(0.62_0.25_295/0.65)]">
        <div className="pointer-events-none absolute -top-24 -right-20 h-56 w-56 rounded-full bg-[oklch(0.72_0.22_305/0.16)] blur-3xl" />
        <div className="relative grid gap-5 lg:grid-cols-[1fr_280px] lg:items-center">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 shrink-0 rounded-xl grid place-items-center bg-[oklch(0.62_0.25_295/0.14)] ring-1 ring-[oklch(0.62_0.25_295/0.35)]">
              <CalendarDays className="h-5 w-5 text-[oklch(0.82_0.18_300)]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[oklch(0.82_0.18_300)]">
                Prueba gratuita activa
              </div>
              <h2 className="mt-1 text-xl font-semibold">
                Todas las funciones de Clippr por 60 días
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Sin tarjeta de crédito. Sin compromisos. Al finalizar la prueba,
                elegís Pro o Business para continuar.
              </p>
              <div className="mt-4 h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[oklch(0.72_0.22_305)] to-[oklch(0.55_0.27_285)]"
                  style={{ width: `${trialPct}%` }}
                />
              </div>
            </div>
          </div>
          <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/10 p-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Tiempo restante
            </div>
            <div className="mt-1 text-3xl font-semibold tabular-nums">
              {trialLeft} días
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Después se activa el plan que elijas.
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={cn(
              "relative rounded-2xl p-6 ring-1 transition overflow-hidden",
              plan.highlight
                ? "bg-gradient-to-b from-[oklch(0.18_0.07_290)] to-[oklch(0.10_0.05_280)] ring-[oklch(0.62_0.25_295/0.5)] shadow-[0_0_50px_-18px_oklch(0.62_0.25_295/0.6)]"
                : "glass ring-white/5",
            )}
          >
            <div className="pointer-events-none absolute -top-24 -right-20 h-52 w-52 rounded-full bg-[oklch(0.62_0.25_295/0.12)] blur-3xl" />
            <div className="relative space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div
                    className={cn(
                      "h-12 w-12 rounded-xl grid place-items-center ring-1 shrink-0",
                      plan.highlight
                        ? "bg-[oklch(0.62_0.25_295/0.15)] ring-[oklch(0.62_0.25_295/0.4)]"
                        : "bg-white/5 ring-white/10",
                    )}
                  >
                    <plan.icon
                      className={cn(
                        "h-5 w-5",
                        plan.highlight
                          ? "text-[oklch(0.82_0.18_300)]"
                          : "text-muted-foreground",
                      )}
                    />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-2xl font-semibold">{plan.name}</h2>
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ring-1",
                          plan.highlight
                            ? "bg-[oklch(0.62_0.25_295/0.18)] text-[oklch(0.82_0.18_300)] ring-[oklch(0.62_0.25_295/0.35)]"
                            : "bg-white/5 text-muted-foreground ring-white/10",
                        )}
                      >
                        {plan.badge}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground max-w-md">
                      {plan.tagline}
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Luego de la prueba
                </div>
                <div className="mt-1 flex items-end gap-1">
                  <span className="text-4xl font-semibold tracking-tight">
                    {fmtARS(plan.monthly)}
                  </span>
                  <span className="pb-1 text-sm text-muted-foreground">
                    / mes
                  </span>
                </div>
                {plan.extra && (
                  <div className="mt-2 text-sm text-[oklch(0.82_0.18_300)]">
                    {plan.extra}
                  </div>
                )}
              </div>

              <ul className="space-y-2 text-sm">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 shrink-0 text-[oklch(0.82_0.18_300)]" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              {plan.examples && (
                <div className="rounded-2xl bg-white/[0.035] ring-1 ring-white/10 p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    Ejemplos de precio
                  </div>
                  <div className="mt-3 grid gap-2 text-sm">
                    {plan.examples.map((example) => (
                      <div
                        key={example}
                        className="flex items-center justify-between rounded-xl bg-white/[0.035] px-3 py-2 ring-1 ring-white/5"
                      >
                        <span>{example.split("→")[0].trim()}</span>
                        <span className="font-semibold text-white/90">
                          {example.split("→")[1].trim()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition bg-gradient-to-r from-[oklch(0.72_0.22_305)] to-[oklch(0.55_0.27_285)] text-white shadow-[0_8px_30px_-10px_oklch(0.62_0.25_295/0.8)] hover:brightness-110">
                {plan.cta} <ChevronRight className="h-4 w-4" />
              </button>
              <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                <Lock className="h-3 w-3" /> Sin permanencia. Cancelás cuando
                quieras.
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="glass rounded-2xl p-5 ring-1 ring-white/5 grid grid-cols-2 md:grid-cols-4 gap-4">
        {trustItems.map((t) => (
          <div key={t.title} className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl grid place-items-center bg-[oklch(0.62_0.25_295/0.12)] ring-1 ring-[oklch(0.62_0.25_295/0.3)]">
              <t.icon className="h-4.5 w-4.5 text-[oklch(0.82_0.18_300)]" />
            </div>
            <div>
              <div className="text-sm font-medium">{t.title}</div>
              <div className="text-xs text-muted-foreground">{t.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
