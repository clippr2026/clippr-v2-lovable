import * as React from "react";
import { cn } from "@/lib/utils";

const TIMES = ["10:00", "11:30", "13:00", "14:30"];

export function TimePicker({ selected }: { selected?: string }) {
  return (
    <div>
      {/* Encabezado propio, igual que DatePicker: ahora "día" y "horario"
          son dos pasos separados del demo (3 y 4), no un único bloque
          "día y horario" — el título marca ese quiebre visualmente. */}
      <div className="text-xs font-medium text-white/80 sm:text-sm">Elegí un horario</div>
      <div className="mt-2 grid grid-cols-4 gap-1.5 sm:mt-3 sm:gap-2">
        {TIMES.map((time) => {
          const active = time === selected;
          return (
            <button
              key={time}
              type="button"
              tabIndex={-1}
              className={cn(
                "rounded-xl bg-white/[0.03] py-2 text-xs font-semibold ring-1 transition-all duration-500 ease-out sm:py-2.5 sm:text-sm",
                active ? "text-white ring-transparent" : "text-white/60 ring-white/10",
              )}
              style={{
                // Los dos valores son box-shadow real (nunca "undefined"):
                // así el spread/alpha interpola de 0→1.5px suave en vez de
                // aparecer de golpe cuando el demo automático selecciona
                // el horario.
                boxShadow: active
                  ? "inset 0 0 0 1.5px oklch(0.62 0.24 292)"
                  : "inset 0 0 0 0px oklch(0.62 0.24 292 / 0)",
              }}
            >
              {time}
            </button>
          );
        })}
      </div>
    </div>
  );
}
