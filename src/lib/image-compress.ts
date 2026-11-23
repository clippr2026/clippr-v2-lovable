// Achica una imagen al mínimo razonable: lado máximo y calidad bajos. Prueba WebP y, si el navegador no
// lo soporta (Safari/iPhone devuelve PNG pesado), pasa a JPEG.
export async function compressImage(file: File, maxSide: number, quality: number): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("No se pudo leer la imagen"));
      el.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No se pudo preparar la imagen");
    ctx.drawImage(img, 0, 0, w, h);
    const toBlob = (mime: string) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));
    const webp = await toBlob("image/webp");
    if (webp && webp.type === "image/webp") return webp;
    const jpg = await toBlob("image/jpeg");
    if (!jpg) throw new Error("No se pudo comprimir la imagen");
    return jpg;
  } finally {
    URL.revokeObjectURL(url);
  }
}
