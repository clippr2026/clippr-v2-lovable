// ============================================================================
// Clippr · Edge Function: request-invite-resend
// ----------------------------------------------------------------------------
// Reenvío SELF-SERVICE de una invitación de equipo vencida, llamado desde
// /set-password cuando Supabase redirige con #error_code=otp_expired. En ese
// caso el link vencido no trae email ni ningún identificador — la persona no
// tiene sesión, así que esta función es deliberadamente anónima (sin JWT de
// usuario, desplegada con --no-verify-jwt).
//
// Por eso vive separada de invite-team-member (que es 100% administrada,
// requiere JWT + permisos sobre el negocio): así el único endpoint anónimo
// de todo el flujo de invitaciones queda acotado, chico y fácil de auditar,
// sin tocar la postura de seguridad de la función administrativa.
//
// Contrato de seguridad: la respuesta es SIEMPRE la misma ({ok:true}),
// exista o no el email, tenga o no invitación pendiente, esté o no en
// cooldown — así no se puede usar para confirmar qué emails están
// invitados a qué negocio. No crea usuarios ni filas nuevas: solo reenvía
// el mismo link de Supabase Auth al mismo auth_user_id ya existente.
// ============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";

function resolveServiceKey(): string {
  const direct = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (direct && direct.trim()) return direct.trim();

  const secretJson = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretJson && secretJson.trim()) {
    try {
      const parsed = JSON.parse(secretJson) as Record<string, string>;
      return parsed.default ?? Object.values(parsed)[0] ?? "";
    } catch {
      return secretJson.trim();
    }
  }

  return "";
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = resolveServiceKey();
const SITE_URL = Deno.env.get("SITE_URL") ?? "http://localhost:3000";

// Mismo valor que el cooldown de reenvío admin en invite-team-member — ver
// el comentario ahí. Server-side, no confiar solo en el debounce del botón.
const RESEND_COOLDOWN_MS = 5 * 60 * 1000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Respuesta genérica única: nunca revela si el email existe, tiene
// invitación pendiente, está en cooldown o si el reenvío realmente se
// disparó. Ver contrato de seguridad en el comment de arriba.
const GENERIC_RESPONSE = { ok: true };

function isEmailShaped(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function performResend(admin: SupabaseClient, email: string) {
  const { data: rows, error } = await admin
    .from("team_members")
    .select("id, auth_user_id, last_invited_at")
    .ilike("email", email)
    .eq("status", "invited")
    .not("auth_user_id", "is", null);

  // Si la columna last_invited_at todavía no existe (migración pendiente de
  // aplicar), se reintenta sin ella: sin cooldown hasta que exista, pero sin
  // romper el reenvío.
  let matches = rows;
  if (error) {
    const missingColumn =
      (error.message ?? "").toLowerCase().includes("last_invited_at") &&
      (error.message ?? "").toLowerCase().includes("column");
    if (!missingColumn) {
      console.log("[self-resend] lookup error:", error.message);
      return;
    }
    const retry = await admin
      .from("team_members")
      .select("id, auth_user_id")
      .ilike("email", email)
      .eq("status", "invited")
      .not("auth_user_id", "is", null);
    if (retry.error) {
      console.log("[self-resend] lookup retry error:", retry.error.message);
      return;
    }
    matches = (retry.data ?? []).map((r) => ({ ...r, last_invited_at: null }));
  }

  if (!matches || matches.length === 0) return;

  const now = Date.now();
  const eligible = matches.filter((row) => {
    const last = (row as { last_invited_at?: string | null }).last_invited_at;
    return !last || now - new Date(last).getTime() >= RESEND_COOLDOWN_MS;
  });
  if (eligible.length === 0) return;

  // Un solo auth_user_id detrás de un mismo email — un solo reenvío alcanza
  // aunque el email tenga invitaciones pendientes en más de un negocio.
  const authUserId = eligible[0].auth_user_id as string;

  // Cortar la carrera de doble click/doble pestaña: se marca el cooldown
  // ANTES de llamar a Auth, no después.
  const ids = eligible.map((row) => row.id as string);
  const nowIso = new Date().toISOString();
  const { error: touchErr } = await admin
    .from("team_members")
    .update({ last_invited_at: nowIso })
    .in("id", ids);
  if (touchErr && !(touchErr.message ?? "").toLowerCase().includes("last_invited_at")) {
    console.log("[self-resend] no se pudo marcar last_invited_at:", touchErr.message);
  }

  const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${SITE_URL}/set-password`,
  });

  if (inviteErr) {
    // Igual que en invite-team-member: si ya se confirmó justo ahora, no es
    // un error real, es que ya no hace falta reenviar. Cualquier otro caso
    // se loguea — la respuesta al cliente ya salió y siempre es genérica,
    // pero esto tiene que quedar visible en los logs de la función para
    // poder diagnosticar si el reenvío está fallando de verdad.
    const { data: userData } = await admin.auth.admin.getUserById(authUserId);
    const confirmed = Boolean(userData?.user?.email_confirmed_at || userData?.user?.confirmed_at);
    console.log(
      "[self-resend] inviteUserByEmail error:",
      inviteErr.message,
      "| ya confirmado:",
      confirmed,
    );
    if (confirmed) {
      await admin.from("team_members").update({ status: "active" }).in("id", ids);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  try {
    if (!SERVICE_ROLE) {
      return json({ error: "Server mal configurado" }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? "").trim().toLowerCase();

    if (!email || !isEmailShaped(email)) {
      // Formato inválido: no hay nada que buscar, pero la respuesta sigue
      // siendo la misma forma genérica (ver contrato de seguridad arriba).
      return json(GENERIC_RESPONSE);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // La llamada a Auth (red + SMTP) se dispara en background: el tiempo de
    // respuesta no debe delatar si hubo un match real o no. Sin esto, un
    // match tarda notablemente más que un no-match y esa diferencia de
    // latencia sería en sí misma una fuga de información.
    const task = performResend(admin, email).catch((e) => {
      console.error("[self-resend] fatal:", e);
    });
    // @ts-ignore — EdgeRuntime es global en el runtime de Supabase Edge Functions (Deno Deploy), no en el typechecker local.
    if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
      // @ts-ignore
      EdgeRuntime.waitUntil(task);
    }

    return json(GENERIC_RESPONSE);
  } catch (e) {
    console.error("[self-resend] fatal error:", e);
    // Ni siquiera un error interno debe cambiar la forma de la respuesta.
    return json(GENERIC_RESPONSE);
  }
});
