import * as React from "react";
import { ServiceRow } from "./ServiceRow";
import { ProfessionalPicker } from "./ProfessionalPicker";
import { DatePicker } from "./DatePicker";
import { TimePicker } from "./TimePicker";
import { BookButton } from "./BookButton";
import { Confirmation } from "./Confirmation";
import type { DemoStep } from "./useDemoSequence";

// La "app" mockup del storyboard: tarjeta flotante con el flujo de reserva
// completo. Cada fila (servicio, profesional, día/horario, botón) es su
// propio componente en ./section2, editable por separado. "demoStep" es la
// única fuente de verdad (viene de Section2 vía useDemoSequence) — acá
// solo se traduce a lo que cada fila necesita, ninguna decide nada por su
// cuenta.
export const BookingCard = React.forwardRef<HTMLDivElement, { demoStep: DemoStep }>(
  function BookingCard({ demoStep }, ref) {
    return (
      <div
        ref={ref}
        className="w-full max-w-[380px] rounded-[2rem] border border-white/10 bg-white/[0.03] p-5 shadow-[0_30px_90px_-40px_rgba(0,0,0,0.9)] backdrop-blur-xl sm:p-6 lg:max-w-none lg:p-7 xl:p-8"
      >
        {/* demoStep 5: reemplaza TODO el contenido (título incluido) por
            la confirmación — no queda ni un resto de servicio/profesional/
            día/horario a la vista, ver Confirmation.tsx. */}
        {demoStep === 5 ? (
          <Confirmation />
        ) : (
          <>
            <h3 className="text-center text-lg font-bold text-white lg:text-xl">Reservá tu turno</h3>

            <div className="mt-5">
              <ServiceRow demoStep={demoStep} />
            </div>

            <div className="mt-5">
              <ProfessionalPicker selected={demoStep >= 2 ? "Julián" : undefined} />
            </div>

            <div className="mt-5">
              <DatePicker selected={demoStep >= 3 ? "14" : undefined} />
            </div>

            {/* mt-5, no mt-3: Día y Horario son pasos separados ahora, cada
                uno con su propio encabezado (ver TimePicker) — el espaciado
                pareja los trata como dos bloques distintos, no uno solo. */}
            <div className="mt-5">
              <TimePicker selected={demoStep >= 4 ? "11:30" : undefined} />
            </div>

            <div className="mt-5">
              <BookButton active={demoStep >= 4} />
            </div>
          </>
        )}
      </div>
    );
  },
);
