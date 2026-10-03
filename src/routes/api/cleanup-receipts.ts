import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { PAYMENT_RECEIPTS_BUCKET, removeReceiptObject } from "@/lib/payment-receipts";

// Retención de comprobantes de transferencia: 2 meses desde la fecha del
// pago (payments.created_at). Disparado por Vercel Cron (ver vercel.json)
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

        const cutoffIso = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

        const { data: rows, error: selectError } = await supabaseAdmin
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

        let cleaned = 0;
        let failed = 0;
        for (const row of (rows ?? []) as Array<{ id: string; receipt_path: string }>) {
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

        return Response.json({
          bucket: PAYMENT_RECEIPTS_BUCKET,
          scanned: rows?.length ?? 0,
          cleaned,
          failed,
        });
      },
    },
  },
});
