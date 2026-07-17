import * as React from "react";
import { cn } from "@/lib/utils";
// Fotos reales de cada profesional (no avatares/ilustraciones): 1536x1024,
// RGBA con fondo exterior transparente y el círculo ya incorporado dentro
// del propio archivo — mismo nombre de archivo, reemplazar sin tocar estos
// imports.
import photoJulian from "@/assets/landing/section2/pro-julian.webp";
import photoMartin from "@/assets/landing/section2/pro-martin.webp";
import photoLucas from "@/assets/landing/section2/pro-lucas.webp";

// Sin ajuste individual de encuadre a propósito: el círculo, el fondo
// interior, el tamaño de cara y la posición ya están resueltos dentro de
// cada archivo (fondo exterior transparente) — el código solo tiene que
// mostrarlos, no compensar nada. Nada de object-fit:cover, object-position
// propio, scale, translate, transform-origin ni clip-path por profesional.
// Si el día de mañana hace falta ajustar alguno, el ajuste va en el
// archivo, no acá.
const PROFESSIONALS = [
  { id: "julian", name: "Julián", photo: photoJulian },
  { id: "martin", name: "Martin", photo: photoMartin },
  { id: "lucas", name: "Lucas", photo: photoLucas },
];

export function ProfessionalPicker({ selected }: { selected?: string }) {
  return (
    <div>
      <div className="text-xs font-medium text-white/80 sm:text-sm">Elegí un profesional</div>
      <div className="mt-2 flex gap-3 sm:mt-3 sm:gap-5">
        {PROFESSIONALS.map((p) => {
          const active = p.name === selected;
          return (
            <div key={p.id} className="flex flex-col items-center gap-1 sm:gap-1.5">
              {/* "aspect-ratio" en un elemento con padding/border propios
                  no da un border-box limpio en 3:2 — probado: el navegador
                  termina calculando el ratio contra el content-box y el
                  resultado queda torcido (1536x1024 medía 96x66.66 =
                  ratio 1.44, no 1.5). Esta caja no tiene padding ni border
                  propios, así que su proporción 3:2 (igual al lienzo real
                  de los archivos) es exacta. No cuadrada, no circular, sin
                  overflow-hidden: no recorta nada, solo encuadra. Mismo
                  tamaño para los tres. */}
              <div className="relative w-16 sm:w-24" style={{ aspectRatio: "3 / 2" }}>
                {/* Sin object-fit:cover, sin object-position propio, sin
                    scale/translate/transform-origin, sin clip-path, sin
                    border-radius: el archivo se muestra completo tal cual
                    fue exportado (contain) — el círculo y el encuadre ya
                    están resueltos adentro del archivo, no acá. */}
                <img
                  src={p.photo}
                  alt={p.name}
                  className="h-full w-full object-contain object-center"
                  style={{
                    transform: "none",
                    // La regla global "img { content-visibility: auto }"
                    // (styles.css, pensada para no pintar fotos fuera de
                    // pantalla) confunde su heurística de relevancia con
                    // este ancestro animado por GSAP (cardRef tiene scroll
                    // parallax) y deja la imagen sin pintar, aunque el
                    // archivo cargó bien. Se anula acá, puntual, no en el
                    // global: a este tamaño el ahorro es insignificante.
                    contentVisibility: "visible",
                  }}
                />
                {/* Único efecto agregado por código al estado
                    seleccionado: borde + glow, en una capa absoluta
                    aparte (-inset-1.5) que no participa del box model de
                    la caja 3:2 de arriba — por eso no le toca tamaño ni
                    posición a la imagen. Siempre montada (no
                    active && <div>), solo transiciona opacidad: así el
                    glow entra/sale de forma suave cuando el demo
                    automático de la tarjeta avanza de paso, en vez de
                    aparecer de golpe. */}
                <div
                  className={cn(
                    "pointer-events-none absolute -inset-1.5 rounded-lg transition-opacity duration-500 ease-out",
                    "shadow-[0_0_16px_-2px_oklch(0.6_0.24_292/0.7)]",
                    active ? "opacity-100" : "opacity-0",
                  )}
                  style={{ border: "2px solid oklch(0.62 0.24 292)" }}
                />
              </div>
              <span className="text-xs font-medium text-white/70">{p.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
