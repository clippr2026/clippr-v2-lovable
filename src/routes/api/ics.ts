import { createFileRoute } from "@tanstack/react-router";

// Evento de calendario (.ics) de un turno, servido desde una URL real (no un archivo descargado desde el
// navegador): así iPhone/Safari abre directo "Agregar al calendario" en vez de guardar el archivo sin
// mostrar nada. Público a propósito y sin base de datos: solo arma el archivo con lo que viene en la URL.
// GET /api/ics?title=...&start=<ISO>&end=<ISO>&location=...&description=...&alarm=60
const esc = (t: string) =>
  t.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export const Route = createFileRoute("/api/ics")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = new URL(request.url);
        const start = new Date(u.searchParams.get("start") ?? "");
        const end = new Date(u.searchParams.get("end") ?? "");
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
          return new Response("Parámetros inválidos", { status: 400 });
        }
        const clip = (k: string, n: number) => (u.searchParams.get(k) ?? "").slice(0, n);
        const title = clip("title", 200) || "Turno";
        const location = clip("location", 300);
        const description = clip("description", 600);
        const alarm = Math.min(1440, Math.max(0, Number(u.searchParams.get("alarm") ?? 60) || 0));
        const uid = `${fmt(start)}-${Buffer.from(title).toString("hex").slice(0, 12)}@clippr`;
        const lines = [
          "BEGIN:VCALENDAR",
          "VERSION:2.0",
          "PRODID:-//Clippr//Reservas//ES",
          "CALSCALE:GREGORIAN",
          "METHOD:PUBLISH",
          "BEGIN:VEVENT",
          `UID:${uid}`,
          `DTSTAMP:${fmt(new Date())}`,
          `DTSTART:${fmt(start)}`,
          `DTEND:${fmt(end)}`,
          `SUMMARY:${esc(title)}`,
          ...(location ? [`LOCATION:${esc(location)}`] : []),
          ...(description ? [`DESCRIPTION:${esc(description)}`] : []),
          ...(alarm > 0
            ? ["BEGIN:VALARM", `TRIGGER:-PT${alarm}M`, "ACTION:DISPLAY", "DESCRIPTION:Recordatorio de tu turno", "END:VALARM"]
            : []),
          "END:VEVENT",
          "END:VCALENDAR",
        ];
        return new Response(lines.join("\r\n"), {
          headers: {
            "Content-Type": "text/calendar; charset=utf-8",
            "Content-Disposition": 'inline; filename="turno.ics"',
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
