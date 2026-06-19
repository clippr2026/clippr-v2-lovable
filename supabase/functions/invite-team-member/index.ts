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

// Resuelve la service/secret key de forma robusta:
//  - Proyectos legacy: SUPABASE_SERVICE_ROLE_KEY (string).
//  - Proyectos con las nuevas API keys: SUPABASE_SECRET_KEYS (JSON {"default":"sb_secret_..."}).
function resolveServiceKey(): string {
  const direct = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (direct && direct.trim()) return direct.trim();

  const secretJson = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretJson && secretJson.trim()) {
    try {
      const parsed = JSON.parse(secretJson) as Record<string, string>;
      return parsed.default ?? Object.values(parsed)[0] ?? "";
    } catch {
      return secretJson.trim(); // por si viniera como string plano
    }
  }
  return "";
}

function keyKind(k: string): string {
  if (!k) return "MISSING (sin privilegios → causará 403)";
  if (k.startsWith("sb_secret_")) return "new-secret (OK, privilegiada)";
  if (k.startsWith("sb_publishable_")) return "PUBLISHABLE (MAL: sin privilegios)";
  if (k.startsWith("eyJ")) return "legacy-jwt (anon o service_role)";
  return "desconocido";
}

const SERVICE_ROLE = resolveServiceKey();
console.log("[init] service key kind:", keyKind(SERVICE_ROLE));

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
  callerEmail: string | null,
  businessId: string,
): Promise<boolean> {
  // a) Es un team_member con rol admin (no suspendido) en este negocio.
  const { data: tm, error: tmErr } = await admin
    .from("team_members")
    .select("role, status")
    .eq("business_id", businessId)
    .eq("auth_user_id", callerId)
    .maybeSingle();
  console.log("[authz] team_member:", JSON.stringify(tm), "| err:", tmErr?.message ?? null);
  if (tm && tm.status !== "suspended" && ADMIN_ROLES.has(tm.role)) {
    console.log("[authz] OK → team_member admin");
    return true;
  }

  // b) Es el dueño / admin del negocio vía profiles.
  const { data: prof, error: profErr } = await admin
    .from("profiles")
    .select("business_id, role")
    .eq("id", callerId)
    .maybeSingle();
  console.log("[authz] profile:", JSON.stringify(prof), "| err:", profErr?.message ?? null);
  if (prof?.business_id === businessId) {
    const role = prof.role ?? "owner";
    if (role === "owner" || ADMIN_ROLES.has(role)) {
      console.log("[authz] OK → profiles role:", role);
      return true;
    }
    console.log("[authz] profiles coincide en negocio pero rol no admin:", role);
  } else if (prof) {
    console.log("[authz] profiles.business_id !== businessId →", prof.business_id, "vs", businessId);
  }

  // c) Es el dueño del negocio según la tabla businesses (la fuente real que usa
  //    el login cuando no hay fila en profiles). Traemos la fila completa y
  //    comparamos contra las columnas de dueño más comunes; el schema puede variar.
  const { data: biz, error: bizErr } = await admin
    .from("businesses")
    .select("*")
    .eq("id", businessId)
    .maybeSingle();
  console.log("[authz] businesses row:", JSON.stringify(biz), "| err:", bizErr?.message ?? null);

  if (biz) {
    const row = biz as Record<string, unknown>;
    const idCols = ["owner_id", "user_id", "created_by"];
    const emailCols = ["owner_email", "email"];

    const matchedIdCol = idCols.find(
      (c) => row[c] != null && String(row[c]) === callerId,
    );
    if (matchedIdCol) {
      console.log(`[authz] OK → businesses.${matchedIdCol} === callerId`);
      return true;
    }

    const matchedEmailCol = callerEmail
      ? emailCols.find(
          (c) => row[c] != null && String(row[c]).toLowerCase() === callerEmail.toLowerCase(),
        )
      : undefined;
    if (matchedEmailCol) {
      console.log(`[authz] OK → businesses.${matchedEmailCol} === callerEmail`);
      return true;
    }

    console.log(
      "[authz] businesses encontrado pero ninguna columna de dueño coincide. Columnas disponibles:",
      Object.keys(row).join(", "),
    );
  }

  console.log(
    "[authz] DENEGADO. callerId:", callerId,
    "| email:", callerEmail,
    "| businessId:", businessId,
  );
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

// Nombre legible de quien ejecuta la acción (para la auditoría).
async function resolveActorName(
  admin: SupabaseClient,
  callerId: string,
  callerEmail: string | null,
): Promise<string> {
  const { data: tm } = await admin
    .from("team_members")
    .select("full_name")
    .eq("auth_user_id", callerId)
    .maybeSingle();
  if (tm?.full_name) return tm.full_name as string;
  const { data: prof } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", callerId)
    .maybeSingle();
  if (prof?.full_name) return prof.full_name as string;
  return callerEmail ?? "Usuario";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  try {
    if (!SERVICE_ROLE) {
      console.error("[init] No hay service/secret key. Configurá las nuevas API keys o reactivá la legacy service_role.");
      return json({ error: "Server mal configurado: falta la service/secret key" }, 500);
    }

    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!jwt) return json({ error: "No autorizado" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Identificar al usuario que llama desde su JWT.
    const { data: caller, error: callerErr } = await admin.auth.getUser(jwt);
    if (callerErr || !caller?.user) return json({ error: "Sesión inválida" }, 401);
    const callerId = caller.user.id;
    const callerEmail = caller.user.email ?? null;

    const body = await req.json().catch(() => ({}));
    const action: string = body.action ?? "create";
    const businessId: string = body.business_id ?? "";
    console.log("[invite] action:", action, "| callerId:", callerId, "| email:", callerEmail, "| businessId:", businessId);
    if (!businessId) return json({ error: "business_id requerido" }, 400);

    if (!(await isAuthorized(admin, callerId, callerEmail, businessId))) {
      console.log("[invite] → 403 (isAuthorized=false)");
      return json({ error: "No tenés permisos sobre este negocio" }, 403);
    }

    // ---- DELETE (eliminación completa) ------------------------------------
    if (action === "delete") {
      const memberId: string = body.member_id ?? "";
      if (!memberId) return json({ error: "member_id requerido" }, 400);

      // 1) Traer el acceso a eliminar.
      const { data: target, error: targetErr } = await admin
        .from("team_members")
        .select("id, auth_user_id, email, full_name, role")
        .eq("id", memberId)
        .eq("business_id", businessId)
        .maybeSingle();
      if (targetErr) return json({ error: targetErr.message }, 400);
      if (!target) return json({ error: "El acceso no existe" }, 404);

      // 2) Proteger al admin_general PRINCIPAL (el más antiguo del negocio).
      const { data: principal } = await admin
        .from("team_members")
        .select("id")
        .eq("business_id", businessId)
        .eq("role", "admin_general")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (principal && principal.id === target.id) {
        console.log("[delete] bloqueado: es el admin principal");
        return json({ error: "No se puede eliminar el administrador principal del negocio." }, 403);
      }

      const targetAuthId = target.auth_user_id as string | null;

      // 3) Borrar la fila de team_members de este negocio.
      const { error: tmDelErr } = await admin
        .from("team_members")
        .delete()
        .eq("id", memberId)
        .eq("business_id", businessId);
      if (tmDelErr) return json({ error: tmDelErr.message }, 400);

      // 4) Borrar el perfil y el usuario de Auth, SOLO si no pertenece a otro negocio.
      let authDeleted = false;
      if (targetAuthId) {
        const { data: otherMemberships } = await admin
          .from("team_members")
          .select("id")
          .eq("auth_user_id", targetAuthId)
          .neq("business_id", businessId)
          .limit(1);
        const belongsElsewhere = (otherMemberships?.length ?? 0) > 0;

        if (!belongsElsewhere) {
          // profiles (acotado a este negocio por seguridad)
          await admin.from("profiles").delete()
            .eq("id", targetAuthId)
            .eq("business_id", businessId);
          // Supabase Auth
          const { error: authErr } = await admin.auth.admin.deleteUser(targetAuthId);
          if (authErr) {
            console.log("[delete] deleteUser error:", authErr.message);
          } else {
            authDeleted = true;
          }
        } else {
          console.log("[delete] el usuario pertenece a otro negocio: no se borra de Auth");
        }
      }

      // 5) Auditoría.
      const actorName = await resolveActorName(admin, callerId, callerEmail);
      const { error: auditErr } = await admin.from("team_member_audit").insert({
        business_id: businessId,
        actor_id: callerId,
        actor_email: callerEmail,
        actor_name: actorName,
        target_auth_user_id: targetAuthId,
        target_email: target.email,
        target_name: target.full_name,
        target_role: target.role,
        action: "delete",
      });
      if (auditErr) console.log("[delete] audit insert error (no bloquea):", auditErr.message);

      console.log(
        `[delete] OK. ${actorName} eliminó acceso de: ${target.full_name ?? "—"} (${target.email}) | authDeleted=${authDeleted}`,
      );
      return json({ ok: true, auth_deleted: authDeleted });
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

    // ---- CREATE (invitación / reactivación) -------------------------------
    if (!email) return json({ error: "Email requerido" }, 400);

    // Importante: los accesos eliminados quedan como tombstone con status='deleted'.
    // Si el mismo negocio vuelve a crear ese email desde Clippr, NO debe fallar:
    // se reactiva/actualiza la misma fila. Así el dueño puede crear, eliminar y
    // volver a crear sin entrar a Supabase.
    const { data: existing, error: existingErr } = await admin
      .from("team_members")
      .select("id, status, auth_user_id")
      .eq("business_id", businessId)
      .ilike("email", email)
      .maybeSingle();
    if (existingErr) return json({ error: existingErr.message }, 400);

    if (existing) {
      const existingStatus = String(existing.status ?? "").toLowerCase();

      if (["deleted", "removed", "suspended", "inactive"].includes(existingStatus)) {
        let authUserId: string | null = existing.auth_user_id as string | null;

        // Si el tombstone no tiene auth_user_id, buscamos el usuario existente en Auth.
        // Si no existe, enviamos invitación normal.
        if (!authUserId) {
          const existingAuthUser = await findAuthUserByEmail(admin, email);
          if (existingAuthUser) {
            authUserId = existingAuthUser.id;
          } else {
            const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
              data: { full_name: fullName, business_id: businessId, role },
              redirectTo: `${SITE_URL}/set-password`,
            });

            if (inviteErr) {
              const fallbackUser = await findAuthUserByEmail(admin, email);
              if (!fallbackUser) {
                return json({ error: "No se pudo invitar: " + inviteErr.message }, 400);
              }
              authUserId = fallbackUser.id;
            } else {
              authUserId = invited?.user?.id ?? null;
            }
          }
        }

        const { error: reactivateErr } = await admin
  .from("team_members")
  .update({
    auth_user_id: authUserId,
    email,
    full_name: fullName,
    role,
    permissions,
    professional_id: professionalId,
    branch_id: branchId,
    status: authUserId ? "active" : "invited",
  })
          .eq("id", existing.id)
          .eq("business_id", businessId);

        if (reactivateErr) return json({ error: reactivateErr.message }, 400);
        return json({ ok: true, reactivated: true, auth_user_id: authUserId });
      }

      return json({ error: "Ya existe un acceso activo o invitado con ese email en este negocio" }, 409);
    }

    let authUserId: string | null = null;

    // Primero buscamos si el usuario ya existe en Auth. Esto evita errores tipo
    // "A user with this email address has already been registered".
    const existingAuthUser = await findAuthUserByEmail(admin, email);
    if (existingAuthUser) {
      authUserId = existingAuthUser.id;
    } else {
      const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName, business_id: businessId, role },
        redirectTo: `${SITE_URL}/set-password`,
      });

      if (inviteErr) {
        const fallbackUser = await findAuthUserByEmail(admin, email);
        if (!fallbackUser) {
          return json({ error: "No se pudo invitar: " + inviteErr.message }, 400);
        }
        authUserId = fallbackUser.id;
      } else {
        authUserId = invited?.user?.id ?? null;
      }
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
      status: authUserId ? "active" : "invited",
    });
    if (insErr) return json({ error: insErr.message }, 400);

    return json({ ok: true, auth_user_id: authUserId });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
