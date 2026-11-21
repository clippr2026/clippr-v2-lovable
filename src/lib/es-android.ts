// En Android el archivo .ics solo se descarga (no abre el calendario): ahí se ofrece Google Calendar, que sí abre la app.
export function esAndroid(): boolean {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}
