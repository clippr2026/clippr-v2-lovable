import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Retención de las selfies de fichaje: 15 días. Disparado por Vercel Cron
// (ver vercel.json), con el mismo esquema de CRON_SECRET que
// cleanup-receipts. Idempotente: solo toma jornadas que todavía tienen
// ruta de selfie, y borra el archivo en Storage ANTES de limpiar la ruta;
// si el borrado falla, la fila queda para la próxima corrida.
//
// Segunda pasada: archivos huérfanos (se subió la selfie pero el servidor
// rechazó el fichaje y nunca hubo fila). Se recorren las carpetas
// <negocio>/<empleado>/ y se borra lo más viejo que la retención.
const BUCKET = "fichaje-selfies";
const RETENTION_DAYS = 15;
const BATCH_SIZE = 300;
const ORPHAN_LIMIT = 500;

async function removeOrphans(admin: SupabaseClient, cutoffMs: number): Promise<{ scanned: number; removed: number }> {
  const storage = admin.storage.from(BUCKET);
  let scanned = 0;
  const toRemove: string[] = [];

  const { data: businesses } = await storage.list("", { limit: 1000 });
  for (const b of businesses ?? []) {
    const { data: employees } = await storage.list(b.name, { limit: 1000 });
    for (const e of employees ?? []) {
      const folder = `${b.name}/${e.name}`;
      const { data: files } = await storage.list(folder, { limit: 1000, sortBy: { column: "created_at", order: "asc" } });
      for (const f of files ?? []) {
        if (!f.id) continue; // subcarpeta, no archivo
        scanned++;
        const created = f.created_at ? new Date(f.created_at).getTime() : NaN;
        if (Number.isFinite(created) && created < cutoffMs) toRemove.push(`${folder}/${f.name}`);
        if (toRemove.length >= ORPHAN_LIMIT) break;
      }
      if (toRemove.length >= ORPHAN_LIMIT) break;
    }
    if (toRemove.length >= ORPHAN_LIMIT) break;
  }

  if (toRemove.length === 0) return { scanned, removed: 0 };
  const { error } = await storage.remove(toRemove);
  if (error) {
    console.error("[cleanup-fichaje-selfies] no se pudieron borrar huérfanos:", error.message);
    return { scanned, removed: 0 };
  }
  return { scanned, removed: toRemove.length };
}

export const Route = createFileRoute("/api/cleanup-fichaje-selfies")({
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
          console.error("[cleanup-fichaje-selfies] faltan VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
          return Response.json({ error: "missing service credentials" }, { status: 500 });
        }

        const admin = createClient(supabaseUrl, serviceRoleKey);
        const cutoffMs = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
        const cutoffIso = new Date(cutoffMs).toISOString();

        const { data: rows, error: selectError } = await admin
          .from("work_sessions")
          .select("id,clock_in_selfie_path,clock_out_selfie_path")
          .or("clock_in_selfie_path.not.is.null,clock_out_selfie_path.not.is.null")
          .lt("clock_in_at", cutoffIso)
          .limit(BATCH_SIZE);

        if (selectError) {
          console.error("[cleanup-fichaje-selfies] error leyendo work_sessions:", selectError.message);
          return Response.json({ error: selectError.message }, { status: 500 });
        }

        let cleaned = 0;
        let failed = 0;
        for (const row of (rows ?? []) as Array<{
          id: string;
          clock_in_selfie_path: string | null;
          clock_out_selfie_path: string | null;
        }>) {
          const paths = [row.clock_in_selfie_path, row.clock_out_selfie_path].filter((p): p is string => Boolean(p));
          // remove() no falla si el archivo ya no existe.
          const { error: removeError } = await admin.storage.from(BUCKET).remove(paths);
          if (removeError) {
            failed++;
            console.error(`[cleanup-fichaje-selfies] no se pudo borrar ${paths.join(", ")} (sesión ${row.id}):`, removeError.message);
            continue;
          }
          const { error: updateError } = await admin
            .from("work_sessions")
            .update({ clock_in_selfie_path: null, clock_out_selfie_path: null })
            .eq("id", row.id);
          if (updateError) {
            failed++;
            console.error(`[cleanup-fichaje-selfies] borrado OK pero no se pudo actualizar sesión ${row.id}:`, updateError.message);
            continue;
          }
          cleaned++;
        }

        const orphans = await removeOrphans(admin, cutoffMs);

        return Response.json({
          bucket: BUCKET,
          retentionDays: RETENTION_DAYS,
          scanned: rows?.length ?? 0,
          cleaned,
          failed,
          orphansScanned: orphans.scanned,
          orphansRemoved: orphans.removed,
        });
      },
    },
  },
});
