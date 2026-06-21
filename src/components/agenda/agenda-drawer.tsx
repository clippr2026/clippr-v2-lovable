import * as React from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { X } from "lucide-react";

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
  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        hideOverlay
        onInteractOutside={lockOutside ? (e) => e.preventDefault() : undefined}
        onEscapeKeyDown={lockOutside ? (e) => e.preventDefault() : undefined}
        className="w-full sm:max-w-[372px] p-0 flex flex-col border-white/10 bg-[#08070f] shadow-[0_24px_80px_-24px_rgba(0,0,0,0.85)] data-[state=open]:duration-100 data-[state=closed]:duration-100"
        aria-describedby={undefined}
      >
        <SheetHeader className="relative px-4 pt-4 pb-3 border-b border-white/10 bg-white/[0.025] text-left space-y-0 shrink-0">
          <button
            type="button"
            aria-label="Cerrar"
            onClick={() => onOpenChange(false)}
            className="absolute right-3 top-3 z-20 grid h-8 w-8 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-white/70 transition hover:bg-white/[0.1] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
          <SheetTitle className="text-[18px] leading-tight font-display tracking-tight pr-10">
            {title}
          </SheetTitle>
          {subtitle && <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4">{children}</div>

        {footer && (
          <div className="shrink-0 border-t border-white/10 bg-white/[0.025] px-4 py-3 flex items-center justify-between gap-2">
            {footer}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
