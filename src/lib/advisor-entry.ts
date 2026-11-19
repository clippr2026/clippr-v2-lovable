// Recomendación principal que muestra el Asesor IA al entrar: sale de los datos reales del análisis.

export type EntryAction =
  | { kind: "clientes"; grupo: string; label: string }
  | { kind: "agenda"; label: string };

export type EntryRecommendation = {
  title: string;
  body: string;
  action: EntryAction | null;
};

export type EntryInput = {
  grupoCounts: Record<string, number>;
  occupancy: number | null;
  // Día más tranquilo y más rentable (nombre del día y facturación promedio por jornada), si se pudieron calcular.
  diaTranquilo: { dia: string; promedio: number } | null;
  diaRentable: { dia: string; promedio: number } | null;
};

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

export function buildEntryRecommendation(i: EntryInput): EntryRecommendation {
  const unaVisita = i.grupoCounts["una_visita"] ?? 0;
  if (unaVisita > 0) {
    return {
      title: "Hoy empezaría por los clientes que vinieron una sola vez.",
      body: `Hay ${unaVisita} ${plural(unaVisita, "cliente que hizo", "clientes que hicieron")} su primera visita hace más de 30 días y todavía no ${plural(unaVisita, "volvió", "volvieron")}. Si no vuelven, a los 60 días pasan a Perdidos.`,
      action: { kind: "clientes", grupo: "una_visita", label: "Ver clientes" },
    };
  }
  const perdidos = i.grupoCounts["perdido"] ?? 0;
  if (perdidos > 0) {
    return {
      title: "Hoy empezaría por reconquistar a los clientes perdidos.",
      body: `Hay ${perdidos} ${plural(perdidos, "cliente que dejó", "clientes que dejaron")} de venir. Cuanto antes los contactes, más fácil es que vuelvan.`,
      action: { kind: "clientes", grupo: "perdido", label: "Ver clientes" },
    };
  }
  if (i.occupancy != null && i.occupancy < 70 && i.diaTranquilo) {
    const money = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;
    const contra =
      i.diaRentable && i.diaRentable.dia !== i.diaTranquilo.dia
        ? `, contra ${money(i.diaRentable.promedio)} del ${i.diaRentable.dia}`
        : "";
    return {
      title: `Hoy empezaría por llenar el ${i.diaTranquilo.dia}.`,
      body: `Es tu día más tranquilo: factura ${money(i.diaTranquilo.promedio)} por jornada${contra}. Tu agenda está ocupada al ${i.occupancy}%.`,
      action: { kind: "agenda", label: "Ver agenda" },
    };
  }
  return {
    title: "Tu negocio viene ordenado: hoy mantendría el ritmo.",
    body: "No encontré nada urgente en tus clientes ni en tu agenda. Revisá más abajo el detalle del mes.",
    action: null,
  };
}
