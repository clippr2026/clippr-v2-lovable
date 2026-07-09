import type { AcquisitionChannel } from "@/lib/acquisition-channels";

/** Ícono de un canal de "¿Cómo nos conociste?" — logo oficial de marca o
 * emoji, según lo defina la entrada en ACQUISITION_CHANNELS. No conoce la
 * lista de canales: solo renderiza lo que le llega, para que agregar un
 * canal nuevo no requiera tocar este componente. */
export function AcquisitionChannelIcon({
  channel,
  className,
}: {
  channel: AcquisitionChannel;
  className?: string;
}) {
  if (channel.icon.kind === "brand") {
    const Brand = channel.icon.component;
    return <Brand className={className} color={channel.icon.color} />;
  }
  return <span className={className}>{channel.icon.value}</span>;
}
