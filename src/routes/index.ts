// ============================================================================
// Clippr · Edge Function: invite-team-member
// ----------------------------------------------------------------------------
// Crea / actualiza / elimina accesos del equipo usando la service_role key
// (server-side, NUNCA expuesta al frontend). Para "create" invita al usuario
// por email vía Supabase Auth (sin contraseña) y crea la fila en team_members.
//
// Deploy:  supabase functions deploy invite-team-member
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y SITE_URL se inyectan/
//          configuran en el proyecto (ver notas al final del chat).
// ============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// URL pública de la app, a donde vuelve el usuario tras aceptar la invitación.
const SITE_URL = Deno.env.get("SITE_URL") ?? "http://localhost:3000";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Roles con permiso para administrar el equipo.
const ADMIN_ROLES = new Set([
  "owner",
  "admin_general",
  "socio",
  "admin_local",
]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ¿El usuario que llama puede administrar el equipo de este negocio?
async function isAuthorized(
  admin: SupabaseClient,
  callerId: string,
  businessId: string,
): Promise<boolean> {
  // a) Es un team_member con rol admin (no suspendido) en este negocio.
  const { data: tm } = await admin
    .from("team_members")
    .select("role, status")
    .eq("business_id", businessId)
    .eq("auth_user_id", callerId)
    .maybeSingle();
  if (tm && tm.status !== "suspended" && ADMIN_ROLES.has(tm.role)) return true;

  // b) Es el dueño / admin del negocio vía profiles (no tiene fila en team_members).
  const { data: prof } = await admin
    .from("profiles")
    .select("business_id, role")
    .eq("id", callerId)
    .maybeSingle();
  if (prof?.business_id === businessId) {
    const role = prof.role ?? "owner";
    if (role === "owner" || ADMIN_ROLES.has(role)) return true;
  }
  return false;
}

// Busca un usuario de Auth por email (para enlazar si ya existe en otro negocio).
async function findAuthUserByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<{ id: string } | null> {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return null;
    const match = data.users.find(
      (u) => (u.email ?? "").toLowerCase() === email.toLowerCase(),
    );
    if (match) return { id: match.id };
    if (data.users.length < 200) return null;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!jwt) return json({ error: "No autorizado" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Identificar al usuario que llama desde su JWT.
    const { data: caller, error: callerErr } = await admin.auth.getUser(jwt);
    if (callerErr || !caller?.user) return json({ error: "Sesión inválida" }, 401);
    const callerId = caller.user.id;

    const body = await req.json().catch(() => ({}));
    const action: string = body.action ?? "create";
    const businessId: string = body.business_id ?? "";
    if (!businessId) return json({ error: "business_id requerido" }, 400);

    if (!(await isAuthorized(admin, callerId, businessId))) {
      return json({ error: "No tenés permisos sobre este negocio" }, 403);
    }

    // ---- DELETE ------------------------------------------------------------
    if (action === "delete") {
      const memberId: string = body.member_id ?? "";
      if (!memberId) return json({ error: "member_id requerido" }, 400);
      const { error } = await admin
        .from("team_members")
        .delete()
        .eq("id", memberId)
        .eq("business_id", businessId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    // Campos comunes.
    const email = String(body.email ?? "").trim().toLowerCase();
    const role = String(body.role ?? "profesional");
    const fullName = body.full_name ? String(body.full_name).trim() : null;
    const permissions = body.permissions ?? {};
    const professionalId = body.professional_id ?? null;
    const branchId = body.branch_id ?? null;
    const reqStatus = body.status ?? null; // 'active' | 'suspended' (solo update)

    // ---- UPDATE ------------------------------------------------------------
    if (action === "update") {
      const memberId: string = body.member_id ?? "";
      if (!memberId) return json({ error: "member_id requerido" }, 400);
      const update: Record<string, unknown> = {
        role,
        permissions,
        professional_id: professionalId,
        branch_id: branchId,
      };
      if (fullName !== null) update.full_name = fullName;
      if (reqStatus === "active" || reqStatus === "suspended") {
        update.status = reqStatus;
      }
      const { error } = await admin
        .from("team_members")
        .update(update)
        .eq("id", memberId)
        .eq("business_id", businessId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    // ---- CREATE (invitación) ----------------------------------------------
    if (!email) return json({ error: "Email requerido" }, 400);

    const { data: existing } = await admin
      .from("team_members")
      .select("id")
      .eq("business_id", businessId)
      .ilike("email", email)
      .maybeSingle();
    if (existing) {
      return json({ error: "Ya existe un acceso con ese email en este negocio" }, 409);
    }

    let authUserId: string | null = null;

    const { data: invited, error: inviteErr } = await admin.auth.admin
      .inviteUserByEmail(email, {
        data: { full_name: fullName, business_id: businessId, role },
        redirectTo: `${SITE_URL}/set-password`,
      });

    if (inviteErr) {
      // Si el usuario ya existe en Auth (p. ej. invitado a otro negocio),
      // lo enlazamos a este negocio sin volver a invitarlo.
      const existingUser = await findAuthUserByEmail(admin, email);
      if (!existingUser) {
        return json({ error: "No se pudo invitar: " + inviteErr.message }, 400);
      }
      authUserId = existingUser.id;
    } else {
      authUserId = invited?.user?.id ?? null;
    }

    const { error: insErr } = await admin.from("team_members").insert({
      business_id: businessId,
      auth_user_id: authUserId,
      email,
      full_name: fullName,
      role,
      permissions,
      professional_id: professionalId,
      branch_id: branchId,
      status: "invited",
    });
    if (insErr) return json({ error: insErr.message }, 400);

    return json({ ok: true, auth_user_id: authUserId });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
