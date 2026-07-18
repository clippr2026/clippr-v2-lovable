import * as React from "react";
import { X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { useIsMobile } from "@/hooks/use-mobile";

/**
 * Shared right-side drawer for every Agenda panel (detail, add/edit turno,
 * block hours). Same branding, width, background, animation and behavior:
 * non-modal (agenda stays visible & usable), no overlay, no heavy blur.
 *
 * `lockOutside` (default true) is for FORM drawers: they must NOT close on an
 * outside click or Esc so half-filled data isn't lost — only the X (built into
 * SheetContent), Cancelar or Guardar close them. The read-only detail drawer
 * passes lockOutside={false} so click-outside / Esc close it.
 */
export function AgendaDrawer({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  footer,
  lockOutside = true,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  lockOutside?: boolean;
}) {
  // modal={false} en el Sheet es a propósito (ver comentario del
  // componente): en desktop este panel es angosto y la Agenda de fondo
  // sigue siendo útil/visible al lado. Pero en mobile el panel ocupa
  // w-full — no queda nada usable de la Agenda detrás, así que dejar el
  // fondo scrolleable ahí no aporta nada y era justo la causa de que la
  // pantalla de atrás se moviera al scrollear el formulario. Por eso el
  // bloqueo de scroll se activa solo en mobile.
  const isMobileView = useIsMobile();
  useBodyScrollLock(open && isMobileView);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        hideOverlay
        hideClose
        onInteractOutside={lockOutside ? (e) => e.preventDefault() : undefined}
        onEscapeKeyDown={lockOutside ? (e) => e.preventDefault() : undefined}
        className="w-full sm:max-w-[372px] p-0 flex flex-col border-white/10 bg-[#08070f] shadow-[0_24px_80px_-24px_rgba(0,0,0,0.85)] data-[state=open]:duration-100 data-[state=closed]:duration-100"
        aria-describedby={undefined}
      >
        <SheetHeader className="relative px-4 pt-4 pb-3 border-b border-white/10 bg-white/[0.025] text-left space-y-0 shrink-0">
          <SheetTitle className="text-[18px] leading-tight font-display tracking-tight pr-9">
            {title}
          </SheetTitle>
          {subtitle && <div className="text-xs text-muted-foreground mt-0.5 pr-9">{subtitle}</div>}
          <button
            type="button"
            aria-label="Cerrar"
            onClick={() => onOpenChange(false)}
            className="absolute right-3 top-3.5 inline-flex h-7 w-7 items-center justify-center rounded-full text-white/55 hover:text-white hover:bg-white/[0.08] transition"
          >
            <X className="h-4 w-4" />
          </button>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4">{children}</div>

        {/* pb usa env(safe-area-inset-bottom) — en iPhone con home indicator
            (sin barra física de "atrás"), un padding fijo de 12px podía
            quedar justo debajo del gesto de swipe, muy pegado o tapado por
            esa zona. max(...) asegura al menos 12px en dispositivos sin
            safe area (Android, desktop) y respeta la real cuando existe. */}
        {footer && (
          <div className="shrink-0 border-t border-white/10 bg-white/[0.025] px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex items-center justify-between gap-2">
            {footer}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Misma cabecera/pie y mismo contenido que AgendaDrawer, pero centrado en
 * pantalla en vez de panel lateral — para paneles que se abren desde fuera
 * de la Agenda general (ej. Mi Agenda) donde un drawer lateral no encaja
 * con el resto de la pantalla. No es un componente nuevo de verdad, es la
 * misma cáscara visual con otro layout de posicionamiento.
 */
export function AgendaCenteredModal({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  footer,
  lockOutside = true,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  lockOutside?: boolean;
}) {
  React.useEffect(() => {
    if (!open || lockOutside) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, lockOutside, onOpenChange]);

  // A diferencia de AgendaDrawer (Sheet con modal={false}, pensado para
  // convivir con la Agenda de fondo en desktop), este modal centrado se abre
  // sobre paneles como Mi Agenda / Profesionales y debe comportarse como un
  // modal real: con el contenido de atrás completamente bloqueado mientras
  // está abierto, para que el scroll dentro del formulario no arrastre la
  // pantalla que queda debajo.
  useBodyScrollLock(open);

  if (!open) return null;

  // Mismo lenguaje visual que el modal de Nueva venta / Cobro de Mi Agenda
  // (glass-strong, rounded-3xl, max-w-md, centrado con items-center) para
  // que los dos se sientan parte del mismo sistema — solo el layout de
  // header/contenido/footer es propio de este wrapper, no la lógica.
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-black/75"
      onClick={() => !lockOutside && onOpenChange(false)}
    >
      <div
        // max-h-[92dvh], no 92vh: mismo motivo que en sheet.tsx (ver
        // comentario ahí) — 100vh en iOS Safari no contempla el colapso
        // dinámico de la barra de direcciones, así que un 92vh "de sobra"
        // podía en la práctica seguir siendo más alto que el viewport
        // real visible, empujando el footer fuera de pantalla.
        className="glass-strong relative flex w-full max-w-md max-h-[92dvh] flex-col rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative shrink-0 border-b border-white/10 px-4 pt-4 pb-3">
          <div className="text-[18px] leading-tight font-display tracking-tight pr-9">{title}</div>
          {subtitle && <div className="text-xs text-muted-foreground mt-0.5 pr-9">{subtitle}</div>}
          <button
            type="button"
            aria-label="Cerrar"
            onClick={() => onOpenChange(false)}
            className="absolute right-3 top-3.5 inline-flex h-7 w-7 items-center justify-center rounded-full text-white/55 hover:text-white hover:bg-white/[0.08] transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">{children}</div>

        {/* pb usa env(safe-area-inset-bottom) — en iPhone con home indicator
            (sin barra física de "atrás"), un padding fijo de 12px podía
            quedar justo debajo del gesto de swipe, muy pegado o tapado por
            esa zona. max(...) asegura al menos 12px en dispositivos sin
            safe area (Android, desktop) y respeta la real cuando existe. */}
        {footer && (
          <div className="shrink-0 border-t border-white/10 bg-white/[0.025] px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex items-center justify-between gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
