// Reduce la foto del comprobante (máx. 1400 px, JPEG) para que pese poco; los PDF van tal cual.
export async function prepareProof(file: File): Promise<{ mime: string; data: string }> {
  const toB64 = (buf: ArrayBuffer) => {
    let bin = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  if (file.type === "application/pdf") return { mime: file.type, data: toB64(await file.arrayBuffer()) };
  if (!file.type.startsWith("image/")) throw new Error("Subí una foto, una captura o un PDF.");
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo preparar la imagen.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("No se pudo preparar la imagen."))), "image/jpeg", 0.72));
  return { mime: "image/jpeg", data: toB64(await blob.arrayBuffer()) };
}
