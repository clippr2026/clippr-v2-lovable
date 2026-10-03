import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// Comprobantes de transferencia — vinculados a payments.id (nunca a
// clients/appointments, ver 20261003030000_payment_receipts.sql). Bucket
// privado "payment-receipts", path determinístico
// `${businessId}/${paymentId}.webp` — un reintento (cambiar/reemplazar o
// recuperar una subida que falló) sobreescribe con upsert en vez de
// acumular archivos.

export const PAYMENT_RECEIPTS_BUCKET = "payment-receipts";

export function paymentReceiptPath(businessId: string, paymentId: string): string {
  return `${businessId}/${paymentId}.webp`;
}

// Adaptado de compressProfessionalAvatar (equipo-section.tsx): mismo
// patrón canvas → toBlob("image/webp", q) con calidad decreciente, pero
// sin recorte a cuadrado (acá importa preservar toda la imagen del
// comprobante) y con un piso de calidad — "resolución optimizada para
// comprobantes" prioriza siempre poder leer monto/fecha/titular/operación
// por sobre llegar exacto al peso objetivo.
const MAX_DIMENSION = 1600;
const TARGET_MAX_BYTES = 500 * 1024;
const MIN_QUALITY = 0.6;

export async function compressReceiptImage(file: File): Promise<Blob> {
  const imageUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("No se pudo leer la imagen del comprobante"));
      img.src = imageUrl;
    });

    const longestSide = Math.max(image.width, image.height);
    // Nunca agranda una imagen ya chica — solo redimensiona hacia abajo
    // cuando supera el máximo, manteniendo proporción.
    const scale = longestSide > MAX_DIMENSION ? MAX_DIMENSION / longestSide : 1;
    const targetW = Math.round(image.width * scale);
    const targetH = Math.round(image.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No se pudo preparar la imagen del comprobante");
    ctx.drawImage(image, 0, 0, targetW, targetH);

    const toBlob = (quality: number) =>
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) reject(new Error("No se pudo comprimir el comprobante"));
            else resolve(blob);
          },
          "image/webp",
          quality,
        );
      });

    // Arranca alto (calidad media-alta) y solo baja si hace falta — nunca
    // sube de ahí, así nunca se sacrifica legibilidad de más por apuntar
    // al peso mínimo.
    let quality = 0.88;
    let blob = await toBlob(quality);

    while (blob.size > TARGET_MAX_BYTES && quality > MIN_QUALITY) {
      quality -= 0.07;
      blob = await toBlob(quality);
    }

    // Si tras bajar hasta el piso de calidad sigue pesando de más, se deja
    // así igual (nunca se sigue bajando calidad) — "si una imagen necesita
    // pesar un poco más para mantener la legibilidad, priorizar siempre la
    // legibilidad antes que alcanzar un peso exacto".
    return blob;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

// Usado tanto por el browser (cliente anon + RLS) como por el cron de
// limpieza (cliente service-role) — por eso toma el client como parámetro
// en vez de importar uno fijo. Un "no encontrado" cuenta como éxito: el
// objetivo es "que no quede el archivo", no que existiera antes.
export async function removeReceiptObject(
  client: SupabaseClient,
  path: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await client.storage.from(PAYMENT_RECEIPTS_BUCKET).remove([path]);
  if (error && !/not.?found/i.test(error.message)) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

async function uploadReceiptBlob(businessId: string, paymentId: string, blob: Blob): Promise<string> {
  const path = paymentReceiptPath(businessId, paymentId);
  const { error } = await supabase.storage.from(PAYMENT_RECEIPTS_BUCKET).upload(path, blob, {
    upsert: true,
    contentType: "image/webp",
    cacheControl: "0",
  });
  if (error) throw new Error(error.message);
  return path;
}

// Orquesta upload + link — SIEMPRE después de que el pago ya existe
// (nunca antes, ver register-payment.ts/NuevaVentaTab). Si el upload
// funciona pero el UPDATE de payments.receipt_path falla, intenta borrar
// de inmediato el archivo recién subido para no dejar huérfanos; si esa
// limpieza también falla, lo deja bien logueado (no hay forma de
// recuperarlo automáticamente desde el browser, pero sí queda detectable
// en la consola/monitoring). Nunca reintenta registerPayment — este
// helper solo toca Storage + la columna receipt_path de un pago que ya
// quedó confirmado.
export async function attachReceiptToPayment(
  businessId: string,
  paymentId: string,
  file: File,
): Promise<void> {
  const blob = await compressReceiptImage(file);
  const path = await uploadReceiptBlob(businessId, paymentId, blob);

  const { error: updateError } = await supabase
    .from("payments")
    .update({ receipt_path: path })
    .eq("id", paymentId);

  if (updateError) {
    const cleanup = await removeReceiptObject(supabase, path);
    if (!cleanup.ok) {
      console.error(
        `[payment-receipts] subida OK pero UPDATE falló y la limpieza también falló — archivo huérfano en ${path}:`,
        updateError.message,
        cleanup.error,
      );
    } else {
      console.warn(
        `[payment-receipts] UPDATE falló, se borró el archivo recién subido en ${path}:`,
        updateError.message,
      );
    }
    throw new Error(updateError.message);
  }
}

// Solo se llama al tocar "Ver comprobante" — nunca al cargar Caja/
// historial, para no generar tráfico de Storage de más.
export async function getPaymentReceiptSignedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(PAYMENT_RECEIPTS_BUCKET)
    .createSignedUrl(path, 120);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? "No se pudo generar el link del comprobante");
  return data.signedUrl;
}
