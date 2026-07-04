import { useState } from "react";
import { CreditCard, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionCard } from "@/components/settings/shared";

// ─────────── Caja ───────────


export function CuentaSection() {
  const BASE_PRICE = 10000;
  const INCLUDED_PROS = 1;
  const INCLUDED_BRANCHES = 1;
  const EXTRA_PRO_PRICE = 3500;
  const EXTRA_BRANCH_PRICE = 8000;

  const [professionals, setProfessionals] = useState(1);
  const [branches, setBranches] = useState(1);

  const extraPros = Math.max(0, professionals - INCLUDED_PROS);
  const extraBranches = Math.max(0, branches - INCLUDED_BRANCHES);
  const prosTotal = extraPros * EXTRA_PRO_PRICE;
  const branchesTotal = extraBranches * EXTRA_BRANCH_PRICE;
  const monthlyTotal = BASE_PRICE + prosTotal + branchesTotal;
  const renewalDate = new Date(2026, 6, 29);
  const today = new Date();
  const billingCycleDays = 30;
  const daysRemaining = Math.max(
    0,
    Math.min(
      billingCycleDays,
      Math.ceil((renewalDate.getTime() - today.getTime()) / 86_400_000),
    ),
  );
  const prorationRatio = daysRemaining / billingCycleDays;
  const todayProsProration = Math.round(prosTotal * prorationRatio);
  const todayBranchesProration = Math.round(branchesTotal * prorationRatio);
  const todayTotal = todayProsProration + todayBranchesProration;

  const money = (value: number) =>
    new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      maximumFractionDigits: 0,
    }).format(value);

  const included = [
    "Agenda",
    "Caja",
    "Clientes",
    "Reservas online",
    "Perfil público",
    "Asesor IA",
    "Inventario",
    "Roles y permisos",
    "Marketing",
    "Reportes",
    "Todas las futuras funciones",
  ];

  const payments = [
    ["Junio 2026", monthlyTotal, "Pagado"],
    ["Mayo 2026", monthlyTotal, "Pagado"],
    ["Abril 2026", Math.max(BASE_PRICE, monthlyTotal - EXTRA_BRANCH_PRICE), "Pagado"],
  ] as const;

  function CounterCard({
    title,
    subtitle,
    value,
    onMinus,
    onPlus,
    priceLabel,
  }: {
    title: string;
    subtitle: string;
    value: number;
    onMinus: () => void;
    onPlus: () => void;
    priceLabel: string;
  }) {
    return (
      <div className="rounded-3xl bg-white/[0.03] p-5 ring-1 ring-white/10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold">{title}</div>
            <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>
          </div>
          <span className="rounded-full bg-white/[0.05] px-2.5 py-1 text-xs font-semibold text-white/70 ring-1 ring-white/10">
            Incluye 1
          </span>
        </div>

        <div className="mt-5 flex items-center justify-between rounded-2xl bg-white/[0.035] p-2 ring-1 ring-white/10">
          <button
            type="button"
            onClick={onMinus}
            className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.05] text-lg font-semibold ring-1 ring-white/10 transition hover:bg-white/[0.09]"
          >
            −
          </button>
          <div className="text-center">
            <div className="text-3xl font-display font-semibold">{value}</div>
            <div className="text-[11px] text-muted-foreground">total</div>
          </div>
          <button
            type="button"
            onClick={onPlus}
            className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-r from-sky-400 to-violet-500 text-lg font-semibold text-white shadow-[0_10px_30px_-14px_rgba(56,189,248,0.8)] transition hover:opacity-95"
          >
            +
          </button>
        </div>

        <div className="mt-4 rounded-2xl bg-white/[0.025] px-4 py-3 text-sm text-muted-foreground ring-1 ring-white/8">
          {priceLabel}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-display font-semibold">Cuenta</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Suscripción, facturación y estado de tu cuenta.
        </p>
      </div>

      <div className="glass relative overflow-hidden rounded-3xl p-5 ring-1 ring-white/10">
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-sky-400/14 blur-3xl" />
        <div className="pointer-events-none absolute -left-24 -bottom-24 h-64 w-64 rounded-full bg-violet-500/12 blur-3xl" />

        <div className="relative grid gap-5 lg:grid-cols-[1fr_430px] lg:items-center">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-sky-400/10 text-sky-200 ring-1 ring-sky-300/20">
              <CreditCard className="h-6 w-6" />
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Tu suscripción
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h3 className="text-2xl font-display font-semibold">Clippr</h3>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Activa
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Una sola suscripción con todas las funciones. Pagás según la
                cantidad de profesionales y sucursales que necesitás.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl bg-white/[0.035] p-4 ring-1 ring-white/10">
              <div className="text-xs text-muted-foreground">Próximo pago</div>
              <div className="mt-1 font-semibold">29 Jul 2026</div>
            </div>
            <div className="rounded-2xl bg-white/[0.035] p-4 ring-1 ring-white/10">
              <div className="text-xs text-muted-foreground">Total mensual</div>
              <div className="mt-1 font-semibold">{money(monthlyTotal)}</div>
            </div>
            <div className="rounded-2xl bg-white/[0.035] p-4 ring-1 ring-white/10">
              <div className="text-xs text-muted-foreground">Pago</div>
              <div className="mt-1 font-semibold">Visa ****4821</div>
            </div>
          </div>
        </div>
      </div>

      <SectionCard label="Personalizá tu plan">
        <div className="grid gap-4 lg:grid-cols-2">
          <CounterCard
            title="Profesionales"
            subtitle="Barberos o miembros del equipo que usan Clippr."
            value={professionals}
            onMinus={() => setProfessionals((value) => Math.max(1, value - 1))}
            onPlus={() => setProfessionals((value) => value + 1)}
            priceLabel={`+ ${money(EXTRA_PRO_PRICE)} por profesional adicional`}
          />

          <CounterCard
            title="Sucursales"
            subtitle="Locales o puntos de atención de tu negocio."
            value={branches}
            onMinus={() => setBranches((value) => Math.max(1, value - 1))}
            onPlus={() => setBranches((value) => value + 1)}
            priceLabel={`+ ${money(EXTRA_BRANCH_PRICE)} por sucursal adicional`}
          />
        </div>
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <SectionCard label="Resumen de suscripción">
          <div className="space-y-4">
            <div className="rounded-3xl bg-white/[0.03] p-4 ring-1 ring-white/10">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Nuevo total mensual
              </div>

              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">Plan base</span>
                  <span className="font-semibold">{money(BASE_PRICE)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">
                    {extraPros} profesionales adicionales
                  </span>
                  <span className="font-semibold">{money(prosTotal)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">
                    {extraBranches} sucursales adicionales
                  </span>
                  <span className="font-semibold">{money(branchesTotal)}</span>
                </div>
              </div>

              <div className="mt-4 flex items-end justify-between border-t border-white/10 pt-4">
                <span className="text-sm text-muted-foreground">Total mensual</span>
                <div className="text-right">
                  <div className="text-2xl font-display font-semibold">
                    {money(monthlyTotal)}
                  </div>
                  <div className="text-xs text-muted-foreground">desde la próxima renovación</div>
                </div>
              </div>
            </div>

            <div className="rounded-3xl bg-gradient-to-br from-sky-400/12 to-violet-500/12 p-4 ring-1 ring-sky-300/20">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-200/80">
                    Hoy pagarás
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Proporcional por los {daysRemaining} días restantes del período.
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-display font-semibold">
                    {money(todayTotal)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    proporcional
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-2 border-t border-white/10 pt-4">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">
                    {extraPros} profesionales · proporcional
                  </span>
                  <span className="font-semibold">{money(todayProsProration)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">
                    {extraBranches} sucursales · proporcional
                  </span>
                  <span className="font-semibold">{money(todayBranchesProration)}</span>
                </div>
              </div>

              <p className="mt-4 rounded-2xl bg-black/15 px-3 py-2 text-xs leading-relaxed text-white/60 ring-1 ring-white/10">
                El nuevo valor mensual de {money(monthlyTotal)} comenzará a cobrarse automáticamente en tu próxima renovación.
              </p>
            </div>

            <button
              type="button"
              className="w-full rounded-2xl bg-gradient-to-r from-sky-400 to-violet-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-95"
            >
              Actualizar suscripción
            </button>
          </div>
        </SectionCard>

        <SectionCard label="Todo incluido">
          <div className="grid gap-2 sm:grid-cols-2">
            {included.map((item) => (
              <div
                key={item}
                className="flex items-center gap-2 rounded-2xl bg-white/[0.03] px-3 py-2 ring-1 ring-white/8"
              >
                <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                <span className="text-sm">{item}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            No existen límites de uso. Solo pagás por el tamaño de tu negocio.
          </p>
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <SectionCard label="Facturación">
          <div className="space-y-3">
            {[
              ["Método de pago", "Visa terminada en 4821"],
              ["Próximo cobro", "29 Jul 2026"],
              ["Estado", "Pagos al día"],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.03] px-4 py-3 ring-1 ring-white/8"
              >
                <span className="text-sm text-muted-foreground">{label}</span>
                <span className="text-sm font-medium">{value}</span>
              </div>
            ))}

            <button
              type="button"
              className="w-full rounded-2xl bg-white/[0.05] px-4 py-2.5 text-sm font-semibold ring-1 ring-white/10 transition hover:bg-white/[0.09]"
            >
              Cambiar método de pago
            </button>
          </div>
        </SectionCard>

        <SectionCard label="Historial de pagos">
          <div className="overflow-hidden rounded-2xl ring-1 ring-white/10">
            {payments.map(([month, amount, status], index) => (
              <div
                key={month}
                className={cn(
                  "grid grid-cols-[1fr_auto_auto] items-center gap-4 bg-white/[0.025] px-4 py-3 text-sm",
                  index > 0 && "border-t border-white/5",
                )}
              >
                <span className="font-medium">{month}</span>
                <span className="text-muted-foreground">{money(amount)}</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/12 px-2.5 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/25">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {status}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
