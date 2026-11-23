import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { PAYMENT_RECEIPTS_BUCKET, removeReceiptObject } from "@/lib/payment-receipts";
import { dayBoundsBA } from "@/lib/caja-cierre";

// Retención de comprobantes de transferencia: se borran cuando se CIERRA la caja del día del pago
// (corre una vez por día, así que se borran a la madrugada siguiente al cierre). Si ese día nunca se
// cierra, quedan como tope 2 meses desde la fecha del pago (payments.created_at). Una caja reabierta
// deja de estar "cerrada", pero lo ya borrado no vuelve. Disparado por Vercel Cron (ver vercel.json)
// — nunca público: exige Authorization: Bearer <CRON_SECRET>. Vercel
// inyecta ese header solo en sus propias invocaciones de Cron cuando
// existe una env var llamada exactamente CRON_SECRET.
//
// Idempotente por diseño: solo toma filas con receipt_deleted_at is null,
// así que correrlo dos veces (o reintentar un lote a medio terminar)
// nunca reprocesa nada ya limpiado. Si falla el borrado en Storage de una
// fila puntual, esa fila NO se marca — queda para el próximo batch, en
// vez de perder el path sin haber confirmado que el archivo se borró.
const RETENTION_DAYS = 60;
const BATCH_SIZE = 300;

export const Route = createFileRoute("/api/cleanup-receipts")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const cronSecret = process.env.CRON_SECRET;
        const authHeader = request.headers.get("authorization");
        if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
          return new Response("Unauthorized", { status: 401 });
        }

        const supabaseUrl = process.env.VITE_SUPABASE_URL;
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !serviceRoleKey) {
          console.error("[cleanup-receipts] faltan VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
          return Response.json({ error: "missing service credentials" }, { status: 500 });
        }

        // Cliente propio con service role — el cron no tiene sesión de
        // usuario, necesita bypassear RLS para limpiar across-tenant.
        // Nunca se usa para nada más que esto, y nunca se expone al
        // browser (SUPABASE_SERVICE_ROLE_KEY no tiene prefijo VITE_, así
        // que Vite no lo incluye en ningún bundle de cliente).
        const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

        type Row = { id: string; receipt_path: string };
        let cleaned = 0;
        let failed = 0;
        let scanned = 0;
        const seen = new Set<string>();

        async function cleanRows(rows: Row[]) {
          for (const row of rows) {
            if (seen.has(row.id)) continue;
            seen.add(row.id);
            scanned++;
            const removed = await removeReceiptObject(supabaseAdmin, row.receipt_path);
            if (!removed.ok) {
              failed++;
              console.error(`[cleanup-receipts] no se pudo borrar ${row.receipt_path} (payment ${row.id}):`, removed.error);
              continue;
            }
            // Solo se marca receipt_deleted_at DESPUÉS de confirmar que el
            // archivo ya no existe en Storage (removeReceiptObject trata
            // "no encontrado" como éxito) — nunca se limpia el registro
            // antes de esa confirmación.
            const { error: updateError } = await supabaseAdmin
              .from("payments")
              .update({ receipt_path: null, receipt_deleted_at: new Date().toISOString() })
              .eq("id", row.id);
            if (updateError) {
              failed++;
              console.error(`[cleanup-receipts] borrado OK pero no se pudo actualizar payment ${row.id}:`, updateError.message);
              continue;
            }
            cleaned++;
          }
        }

        // 1) Cajas cerradas: comprobantes de los pagos de ese día (y sucursal) de cada cierre reciente.
        const sinceDay = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const { data: cierres, error: cierresError } = await supabaseAdmin
          .from("caja_cierres")
          .select("business_id,branch_id,fecha")
          .eq("estado", "cerrada")
          .gte("fecha", sinceDay);
        if (cierresError) {
          console.error("[cleanup-receipts] error leyendo caja_cierres:", cierresError.message);
        } else {
          for (const c of (cierres ?? []) as Array<{ business_id: string; branch_id: string | null; fecha: string }>) {
            if (scanned >= BATCH_SIZE) break;
            const { start, end } = dayBoundsBA(c.fecha);
            let q = supabaseAdmin
              .from("payments")
              .select("id,receipt_path")
              .eq("business_id", c.business_id)
              .not("receipt_path", "is", null)
              .is("receipt_deleted_at", null)
              .gte("created_at", start.toISOString())
              .lte("created_at", end.toISOString())
              .limit(BATCH_SIZE);
            if (c.branch_id) q = q.eq("branch_id", c.branch_id);
            const { data: rows, error } = await q;
            if (error) {
              console.error("[cleanup-receipts] error leyendo payments de caja cerrada:", error.message);
              continue;
            }
            await cleanRows((rows ?? []) as Row[]);
          }
        }

        // 2) Tope por antigüedad: días que nunca se cerraron.
        const cutoffIso = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
        const { data: oldRows, error: selectError } = await supabaseAdmin
          .from("payments")
          .select("id,receipt_path")
          .not("receipt_path", "is", null)
          .is("receipt_deleted_at", null)
          .lt("created_at", cutoffIso)
          .limit(BATCH_SIZE);
        if (selectError) {
          console.error("[cleanup-receipts] error leyendo payments:", selectError.message);
          return Response.json({ error: selectError.message }, { status: 500 });
        }
        await cleanRows((oldRows ?? []) as Row[]);

        return Response.json({
          bucket: PAYMENT_RECEIPTS_BUCKET,
          scanned,
          cleaned,
          failed,
        });
      },
    },
  },
});
