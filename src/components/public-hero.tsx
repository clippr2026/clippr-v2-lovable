import * as React from "react";
import { COVER_ASPECT_CLASS } from "@/lib/cover-frame";
import { NeonFrame, neonPalette } from "@/components/neon-frame";
import { CoverSweep, avatarFxStyle, coverFxStyle, type EntryEffectKey } from "@/components/entry-effects";
import { PublicDecor, type PublicDecorKey } from "@/components/public-decor";
import type { PublicNeonKey } from "@/lib/public-neon";

// Encabezado de la página pública (portada, logo con neón, nombre, estrellas y años de
// experiencia, con dibujos y colores del negocio). Lo usan la página pública y el Inicio,
// así se ven exactamente iguales.
export type PublicHeroProps = {
  name: string;
  coverUrl: string | null;
  avatarUrl: string | null;
  avatarPosition: string;
  coverPosition: string;
  primary: string;
  secondary: string;
  accent: string;
  light: boolean;
  decor: PublicDecorKey;
  neon: PublicNeonKey;
  // Fondo "Liso": el encabezado no lleva el degradé de color.
  flat: boolean;
  entryEffect: EntryEffectKey;
  playFx: boolean;
  effectRun: number;
  fontFamily?: string | null;
  years: string;
  // Globo del anuncio (arriba del logo).
  bubble?: React.ReactNode;
  // Fondo propio del bloque (en Inicio; en la página pública lo pone la página).
  background?: string;
  className?: string;
  // Versión fina (Inicio): solo portada y logo, sin nombre ni estadísticas.
  compact?: boolean;
  // Contenido extra debajo de las estadísticas (selector de sucursal).
  children?: React.ReactNode;
};

const HERO_CSS = `
  .public-hero[data-theme="light"] [class*="text-white"] { color: #111827 !important; }
  .public-hero[data-theme="dark"]:not([data-decor="none"]) .hero-glow { color: #ffffff !important; font-weight: 700; text-shadow: 0 0 3px rgba(0,0,0,1), 0 0 5px rgba(0,0,0,1), 0 0 7px rgba(0,0,0,1), 0 0 9px rgba(0,0,0,1), 0 0 11px rgba(0,0,0,1), 0 0 12px rgba(0,0,0,1), 0 0 12px rgba(0,0,0,0.9), 0 0 14px rgba(0,0,0,0.8); }
  .public-hero[data-theme="light"]:not([data-decor="none"]) .hero-glow { color: #000000 !important; font-weight: 700; text-shadow: 0 0 3px rgba(255,255,255,1), 0 0 5px rgba(255,255,255,1), 0 0 7px rgba(255,255,255,1), 0 0 9px rgba(255,255,255,1), 0 0 11px rgba(255,255,255,1), 0 0 12px rgba(255,255,255,1), 0 0 12px rgba(255,255,255,0.9), 0 0 14px rgba(255,255,255,0.8); }
  .public-hero[data-theme="dark"]:not([data-decor="none"]) .hero-glow-icon { filter: drop-shadow(0 0 2px rgba(0,0,0,1)) drop-shadow(0 0 4px rgba(0,0,0,1)) drop-shadow(0 0 6px rgba(0,0,0,1)) drop-shadow(0 0 8px rgba(0,0,0,1)) drop-shadow(0 0 10px rgba(0,0,0,1)); }
  .public-hero[data-theme="light"]:not([data-decor="none"]) .hero-glow-icon { filter: drop-shadow(0 0 2px rgba(255,255,255,1)) drop-shadow(0 0 4px rgba(255,255,255,1)) drop-shadow(0 0 6px rgba(255,255,255,1)) drop-shadow(0 0 8px rgba(255,255,255,1)) drop-shadow(0 0 10px rgba(255,255,255,1)); }
  .public-hero.hero-font h1 { font-family: var(--hero-font), sans-serif; line-height: 1.3; padding-bottom: 0.22em; }
  .public-hero.hero-font { font-family: var(--hero-font), sans-serif; }
`;

// Globo del anuncio: siempre con letra normal (legible), aunque el negocio use otra tipografía.
export function AnnouncementBubble({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={
        "absolute bottom-full left-1/2 mb-2 flex w-fit min-w-[150px] max-w-[176px] -translate-x-1/2 flex-col items-center justify-center rounded-2xl bg-white px-2.5 py-2 text-[11px] font-semibold leading-snug text-zinc-950 shadow-xl ring-1 ring-black/5 sm:min-w-[190px] sm:max-w-[224px] " +
        className
      }
      style={{ fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", letterSpacing: "normal", fontWeight: 600, color: "#111111" }}
    >
      <span className="block whitespace-pre-line break-words text-center [word-break:normal]">{children}</span>
      <span className="absolute left-1/2 top-full h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-white" />
    </div>
  );
}

export function PublicHero(p: PublicHeroProps) {
  const logoNeon = p.neon === "logo" || p.neon === "ambos" || p.neon === "marco" || p.neon === "todo";
  const bannerGlow = p.neon === "banner" || p.neon === "ambos";
  const hasFont = Boolean(p.fontFamily);
  return (
    <div
      className={"public-hero" + (hasFont ? " hero-font" : "") + (p.className ? ` ${p.className}` : "")}
      data-theme={p.light ? "light" : "dark"}
      data-decor={p.decor}
      style={
        {
          ["--c-primary" as any]: p.primary,
          ["--c-secondary" as any]: p.secondary,
          ["--c-accent" as any]: p.accent,
          ...(hasFont ? { ["--hero-font" as any]: p.fontFamily } : {}),
          ...(p.background ? { background: p.background } : {}),
          color: p.light ? "#111827" : "#ffffff",
        } as React.CSSProperties
      }
    >
      <style>{HERO_CSS}</style>
      <section className={"relative overflow-hidden " + (p.decor === "none" ? "border-b border-white/[0.06]" : "")}>
        <div
          className="absolute inset-0"
          style={{
            background: p.flat
              ? "none"
              : "linear-gradient(90deg, color-mix(in oklch, var(--c-primary) 26%, transparent) 0%, transparent 48%, color-mix(in oklch, var(--c-secondary) 26%, transparent) 100%)",
          }}
        />
        <PublicDecor decor={p.decor} primary={p.primary} secondary={p.secondary} accent={p.accent} light={p.light} />
        <div className={"relative mx-auto max-w-6xl px-4 " + (p.compact ? "py-3 sm:py-4" : "py-5 sm:py-10")}>
          <div className="relative" key={`cover-${p.effectRun}`}>
            {bannerGlow ? (
              <div
                className="pointer-events-none absolute -inset-3 -z-10 rounded-[2.5rem] opacity-70 blur-2xl sm:-inset-5"
                style={{
                  background:
                    "radial-gradient(60% 90% at 25% 40%, color-mix(in oklch, var(--c-primary) 55%, transparent), transparent 70%), radial-gradient(60% 90% at 78% 55%, color-mix(in oklch, var(--c-secondary) 45%, transparent), transparent 70%)",
                }}
              />
            ) : null}
            <div
              className={`relative ${p.compact ? "aspect-[3.2/1] sm:aspect-[5/1]" : COVER_ASPECT_CLASS} overflow-hidden rounded-[2rem] border border-white/20`}
              style={{
                ...(p.entryEffect !== "zoom" ? coverFxStyle(p.entryEffect, p.playFx) : {}),
                background: "linear-gradient(90deg, var(--c-primary), var(--c-secondary))",
                boxShadow: bannerGlow
                  ? "0 0 0 1px rgb(255 255 255 / 0.06), 0 0 34px color-mix(in oklch, var(--c-primary) 55%, transparent), 0 0 80px color-mix(in oklch, var(--c-secondary) 30%, transparent), 0 18px 50px rgb(0 0 0 / 0.35)"
                  : p.neon === "marco" || p.neon === "todo"
                    ? "0 0 0 2px var(--c-secondary), 0 0 12px var(--c-secondary), 0 0 30px color-mix(in oklch, var(--c-primary) 70%, transparent), inset 0 0 14px color-mix(in oklch, var(--c-secondary) 45%, transparent)"
                    : "0 0 0 1px rgb(255 255 255 / 0.06), 0 14px 40px rgb(0 0 0 / 0.30)",
              }}
            >
              {p.coverUrl ? (
                <img
                  loading="lazy"
                  src={p.coverUrl}
                  alt="Portada del negocio"
                  className="h-full w-full object-cover"
                  style={{ objectPosition: p.coverPosition, ...(p.entryEffect === "zoom" ? coverFxStyle("zoom", p.playFx) : {}) }}
                  decoding="async"
                />
              ) : null}
              <CoverSweep effect={p.entryEffect} play={p.playFx} />
            </div>
          </div>
          <div className={"relative z-10 flex flex-col px-4 sm:px-8 " + (p.compact ? "-mt-9 sm:-mt-10" : "-mt-12 sm:-mt-14")}>
            <div className="relative w-max">
              {p.bubble}
              <div key={`avatar-${p.effectRun}`} className="fx-anim" style={avatarFxStyle(p.entryEffect, p.playFx)}>
                <NeonFrame plain={!logoNeon} colors={neonPalette(p.primary)} mode={p.entryEffect === "neon" && p.playFx ? "intro" : "static"}>
                  <div className={"grid shrink-0 place-items-center text-3xl font-bold text-zinc-950 " + (p.compact ? "h-20 w-20 sm:h-24 sm:w-24" : "h-28 w-28 sm:h-32 sm:w-32")}>
                    {p.avatarUrl ? (
                      <img
                        loading="lazy"
                        src={p.avatarUrl}
                        alt={p.name}
                        className="h-full w-full object-cover"
                        style={{ objectPosition: p.avatarPosition }}
                        decoding="async"
                      />
                    ) : (
                      p.name.slice(0, 1)
                    )}
                  </div>
                </NeonFrame>
              </div>
            </div>
            {p.compact ? null : (
            <div className="mt-4">
              <div className="min-w-0">
                {/* Nombre a la izquierda; los años de experiencia a la derecha, a la altura del nombre. */}
                <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
                  <div className="flex items-center gap-2 sm:gap-3">
                    <h1 className="hero-glow text-3xl font-semibold tracking-tight sm:text-5xl">{p.name}</h1>
                    <span className="inline-grid h-8 w-8 place-items-center text-white sm:h-9 sm:w-9" aria-label="Negocio verificado" title="Negocio verificado">
                      <svg viewBox="0 0 24 24" className="h-8 w-8 drop-shadow-sm sm:h-9 sm:w-9" aria-hidden="true">
                        <path
                          d="M12 1.6l1.75 1.52 2.3-.29.99 2.1 2.2.72.07 2.32 1.64 1.63-1.1 2.04.46 2.27-1.94 1.27-.58 2.24-2.29.2-1.5 1.77L12 18.22l-2 1.17-1.5-1.77-2.29-.2-.58-2.24-1.94-1.27.46-2.27-1.1-2.04 1.64-1.63.07-2.32 2.2-.72.99-2.1 2.3.29L12 1.6z"
                          fill="#1DA1F2"
                        />
                        <path d="M10.45 14.7 6.9 11.15l1.45-1.45 2.1 2.1 5.2-5.2 1.45 1.45-6.65 6.65z" fill="white" />
                      </svg>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="hero-glow whitespace-nowrap text-2xl font-bold leading-none tracking-tight sm:text-3xl">{p.years}</div>
                    <div className="hero-glow text-xs font-medium leading-4 text-white sm:text-sm">
                      Años de
                      <br />
                      experiencia
                    </div>
                  </div>
                </div>
                {p.children}
              </div>
            </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
