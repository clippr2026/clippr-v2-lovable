import * as React from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ACQUISITION_CHANNELS } from "@/lib/acquisition-channels";
import { AcquisitionChannelIcon } from "@/components/acquisition-channel-icon";
import { cn } from "@/lib/utils";

type AcquisitionSourceFieldProps = {
  value: string;
  onChange: (value: string) => void;
  customValue: string;
  onCustomChange: (value: string) => void;
  wrapperClassName?: string;
  labelClassName?: string;
  triggerClassName?: string;
  inputClassName?: string;
  /** Muestra el label arriba del select (en vez de usarlo como placeholder
   * del propio select). */
  showLabel?: boolean;
  /** El campo de texto libre de "Otro" abre siempre en su propia fila,
   * debajo del select, nunca al costado (ni en mobile ni en desktop). */
  otroBelow?: boolean;
  /** Texto de la pregunta. Por defecto "¿Cómo nos conociste?" (segunda
   * persona, para cuando el propio cliente completa el formulario — Página
   * Pública, Agenda). Los paneles donde el NEGOCIO carga el dato sobre el
   * cliente (ej. Clientes → Nuevo cliente) deben pasar "¿Cómo nos conoció?"
   * (tercera persona) — mismas opciones/emojis/lógica, solo cambia el texto. */
  questionLabel?: string;
  /** Dropdown propio (createPortal a document.body + position:fixed medida
   * contra el trigger real) en vez del <Select> de Radix. Solo para Página
   * Pública: ahí el trigger vive en una página larga sin ningún Dialog
   * envolvente, y en iOS Safari el popper de Radix Select terminaba
   * posicionándose contra todo el documento en vez de contra el campo,
   * abriendo el desplegable pegado al final de la página con un espacio
   * vacío enorme. No se activa por defecto porque en los demás usos (Nuevo
   * cliente, Turno, Caja) este campo vive DENTRO de un Dialog de Radix, y un
   * portal casero no forma parte de la misma "dismissable layer": un click
   * en una opción se vería como un click "afuera" del modal y lo cerraría
   * antes de poder elegir nada. */
  usePortalDropdown?: boolean;
  /** Color de acento: con `usePortalDropdown`, el menú se dibuja en versión "premium" (neón y brillo de ese color). */
  accent?: string;
};

/**
 * Selector de "¿Cómo nos conociste?" — único lugar que arma esta UI (logos
 * oficiales + emoji, texto libre para "Otro"). Reserva pública, agenda y
 * cualquier flujo futuro que capture el canal de origen usan este mismo
 * componente para no duplicar la lista ni el estilo; `showLabel`/`otroBelow`
 * solo ajustan presentación, la lógica y validación son las mismas.
 */
export function AcquisitionSourceField({
  value,
  onChange,
  customValue,
  onCustomChange,
  wrapperClassName,
  labelClassName,
  triggerClassName,
  inputClassName,
  showLabel = false,
  otroBelow = false,
  questionLabel = "¿Cómo nos conociste?",
  usePortalDropdown = false,
  accent,
}: AcquisitionSourceFieldProps) {
  const selected = ACQUISITION_CHANNELS.find((c) => c.id === value);
  const selectSpansFull = !selected?.requiresText || otroBelow;

  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const [open, setOpen] = React.useState(false);
  const [menuStyle, setMenuStyle] = React.useState<React.CSSProperties | null>(null);

  const openMenu = React.useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const viewportH = window.innerHeight;
    const gap = 4;
    const spaceBelow = viewportH - rect.bottom - gap;
    const spaceAbove = rect.top - gap;
    const openUp = spaceBelow < 200 && spaceAbove > spaceBelow;
    setMenuStyle({
      position: "fixed",
      left: rect.left,
      width: rect.width,
      maxHeight: Math.max(160, (openUp ? spaceAbove : spaceBelow)),
      ...(openUp ? { bottom: viewportH - rect.top + gap } : { top: rect.bottom + gap }),
    });
    setOpen(true);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    // Cerrar en vez de re-medir: para un menú de pocas opciones alcanza, y
    // evita que quede "flotando" en la posición vieja mientras la página se
    // mueve debajo (mismo criterio que un <select> nativo en iOS).
    const close = () => setOpen(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={wrapperClassName ?? "grid gap-4 sm:grid-cols-2"}>
      <div className={cn("space-y-2", selectSpansFull && "col-span-full")}>
        {showLabel ? (
          <Label htmlFor="acquisitionSource" className={cn("whitespace-nowrap text-[13px]", labelClassName)}>
            {questionLabel} *
          </Label>
        ) : null}
        {usePortalDropdown ? (
          <>
            <button
              type="button"
              id="acquisitionSource"
              ref={triggerRef}
              aria-label={questionLabel}
              aria-haspopup="listbox"
              aria-expanded={open}
              onClick={() => (open ? setOpen(false) : openMenu())}
              className={cn(
                "flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring [&>span]:line-clamp-1",
                triggerClassName,
              )}
            >
              {selected ? (
                <span className="flex items-center gap-2">
                  <AcquisitionChannelIcon channel={selected} className="h-4 w-4 shrink-0" />
                  {selected.label}
                </span>
              ) : (
                <span className="text-muted-foreground">{showLabel ? "Elegí una opción" : `${questionLabel} *`}</span>
              )}
              <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
            </button>
            {open && typeof document !== "undefined"
              ? createPortal(
                  <>
                    <div className="fixed inset-0 z-[9998]" onClick={() => setOpen(false)} />
                    <div
                      role="listbox"
                      style={
                        accent
                          ? {
                              ...menuStyle,
                              background: "linear-gradient(180deg, #120d26, #0a0716)",
                              borderColor: `color-mix(in oklch, ${accent} 70%, transparent)`,
                              boxShadow: `0 0 0 1px color-mix(in oklch, ${accent} 35%, transparent), 0 0 28px -6px ${accent}, 0 24px 48px -16px rgba(0,0,0,0.85)`,
                            }
                          : (menuStyle ?? undefined)
                      }
                      className={cn(
                        "z-[9999] overflow-y-auto border text-popover-foreground",
                        accent ? "rounded-3xl p-2 text-white [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : "rounded-md bg-popover p-1 shadow-md",
                      )}
                    >
                      {ACQUISITION_CHANNELS.map((channel) => {
                        const isSel = channel.id === value;
                        return (
                          <button
                            key={channel.id}
                            type="button"
                            role="option"
                            aria-selected={isSel}
                            onClick={() => {
                              onChange(channel.id);
                              if (!channel.requiresText) onCustomChange("");
                              setOpen(false);
                            }}
                            className={
                              accent
                                ? "relative flex w-full select-none items-center gap-3 rounded-2xl border border-transparent px-2.5 py-2.5 text-left text-[15px] font-semibold outline-none transition hover:bg-white/[0.06]"
                                : "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                            }
                            style={
                              accent && isSel
                                ? {
                                    background: `color-mix(in oklch, ${accent} 18%, transparent)`,
                                    borderColor: `color-mix(in oklch, ${accent} 55%, transparent)`,
                                    boxShadow: `0 0 14px -6px ${accent}`,
                                  }
                                : undefined
                            }
                          >
                            {accent ? (
                              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.07]">
                                <AcquisitionChannelIcon channel={channel} className="h-[18px] w-[18px] shrink-0" />
                              </span>
                            ) : (
                              <span className="flex items-center gap-2">
                                <AcquisitionChannelIcon channel={channel} className="h-4 w-4 shrink-0" />
                                {channel.label}
                              </span>
                            )}
                            {accent ? <span className="flex-1">{channel.label}</span> : null}
                            {isSel ? (
                              <span
                                className={accent ? "grid h-6 w-6 place-items-center rounded-full" : "absolute right-2 flex h-3.5 w-3.5 items-center justify-center"}
                                style={accent ? { background: accent, color: "#fff" } : undefined}
                              >
                                <Check className={accent ? "h-3.5 w-3.5" : "h-4 w-4"} />
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </>,
                  document.body,
                )
              : null}
          </>
        ) : (
          <Select
            value={value}
            onValueChange={(next) => {
              onChange(next);
              const nextChannel = ACQUISITION_CHANNELS.find((c) => c.id === next);
              if (!nextChannel?.requiresText) onCustomChange("");
            }}
          >
            <SelectTrigger id="acquisitionSource" className={triggerClassName} aria-label={questionLabel}>
              <SelectValue placeholder={showLabel ? "Elegí una opción" : `${questionLabel} *`} />
            </SelectTrigger>
            <SelectContent>
              {ACQUISITION_CHANNELS.map((channel) => (
                <SelectItem key={channel.id} value={channel.id}>
                  <span className={cn("flex items-center gap-2")}>
                    <AcquisitionChannelIcon channel={channel} className="h-4 w-4 shrink-0" />
                    {channel.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {selected?.requiresText ? (
        <div className={cn("space-y-2", otroBelow && "col-span-full")}>
          <Label htmlFor="acquisitionCustom" className={cn("whitespace-nowrap", labelClassName)}>
            Contanos dónde *
          </Label>
          <Input
            id="acquisitionCustom"
            value={customValue}
            onChange={(event) => onCustomChange(event.target.value)}
            className={inputClassName}
            placeholder="Ej: radio, evento, cartel..."
          />
        </div>
      ) : null}
    </div>
  );
}
