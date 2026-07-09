import * as React from "react";
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
};

/**
 * Selector de "¿Cómo nos conociste?" — único lugar que arma esta UI (logos
 * oficiales + emoji, texto libre para "Otro"). Reserva pública, agenda y
 * cualquier flujo futuro que capture el canal de origen usan este mismo
 * componente para no duplicar la lista ni el estilo.
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
}: AcquisitionSourceFieldProps) {
  const selected = ACQUISITION_CHANNELS.find((c) => c.id === value);
  return (
    <div className={wrapperClassName ?? "grid gap-4 sm:grid-cols-2"}>
      <div className={cn(!selected?.requiresText && "col-span-full")}>
        <Select
          value={value}
          onValueChange={(next) => {
            onChange(next);
            const nextChannel = ACQUISITION_CHANNELS.find((c) => c.id === next);
            if (!nextChannel?.requiresText) onCustomChange("");
          }}
        >
          <SelectTrigger id="acquisitionSource" className={triggerClassName} aria-label="¿Cómo nos conociste?">
            <SelectValue placeholder="¿Cómo nos conociste? *" />
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
      </div>
      {selected?.requiresText ? (
        <div className="space-y-2">
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
