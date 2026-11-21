// En Android el archivo .ics solo se descarga (no abre el calendario): ahí se ofrece Google Calendar, que sí abre la app.
export function esAndroid(): boolean {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

// iPhone con un navegador que no es Safari (Chrome, Firefox, Edge): el .ics solo se descarga y no abre el Calendario.
export function esIosNoSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) && /CriOS|FxiOS|EdgiOS|OPiOS/i.test(navigator.userAgent);
}

// Copia el enlace de la página para pegarlo en Safari.
export async function copiarEnlaceParaSafari(): Promise<void> {
  const url = window.location.href;
  try {
    await navigator.clipboard.writeText(url);
    window.alert("Enlace copiado. Abrí Safari, pegalo en la barra de direcciones y tocá Apple Calendar.");
  } catch {
    window.prompt("Copiá este enlace y abrilo en Safari:", url);
  }
}
