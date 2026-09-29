import { Banknote, Landmark, CreditCard, QrCode } from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionCard } from "@/components/settings/shared";

// Métodos de pago fijos del sistema — ya no dependen de switches ni de
// business_settings.schedule._caja.methods (esa configuración se sacó por
// completo). "Tarjeta débito/crédito" combinada y "Mercado Pago" pasan a
// ser Débito, Crédito y QR: métodos independientes también a nivel de
// datos (PayMethod en register-payment.ts), no solo de texto — así cada
// uno puede tener su propia comisión/configuración más adelante sin
// migrar nada. Mismo orden que usa el selector de Caja → Nueva venta.
const METODOS_FIJOS = [
  { icon: Banknote, label: "Efectivo", tint: "text-[oklch(0.82_0.14_75)]" },
  { icon: Landmark, label: "Transferencia", tint: "text-[oklch(0.78_0.17_140)]" },
  { icon: CreditCard, label: "Débito", tint: "text-[oklch(0.72_0.2_245)]" },
  { icon: CreditCard, label: "Crédito", tint: "text-[oklch(0.72_0.2_245)]" },
  { icon: QrCode, label: "QR", tint: "text-[oklch(0.7_0.25_300)]" },
] as const;

export function CajaSection() {
  return (
    <>
      {/* Oculto en mobile: el drill-down de Configuración ya muestra "←
          Caja" arriba — repetirlo acá era redundante. Desktop no tiene ese
          header, sigue siendo la única referencia. */}
      <div className="hidden lg:block">
        <h2 className="text-xl font-display font-semibold">Caja</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Cobros y medios de pago.
        </p>
      </div>

      <SectionCard label="Métodos de pago">
        <div className="divide-y divide-white/5">
          {METODOS_FIJOS.map((m) => {
            const Icon = m.icon;
            return (
              <div
                key={m.label}
                className="flex items-center gap-4 py-3.5 first:pt-0 last:pb-0"
              >
                <div className="h-10 w-10 rounded-xl bg-white/5 ring-1 ring-white/10 grid place-items-center">
                  <Icon className={cn("h-4.5 w-4.5", m.tint)} />
                </div>
                <div className="flex-1 font-medium text-sm">{m.label}</div>
                <span className="text-xs text-muted-foreground/60">
                  Siempre disponible
                </span>
              </div>
            );
          })}
        </div>
      </SectionCard>
    </>
  );
}
