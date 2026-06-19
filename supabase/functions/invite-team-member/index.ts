// ============================================================================
// Clippr · Edge Function: invite-team-member
// ----------------------------------------------------------------------------
// Crea, actualiza y elimina accesos del equipo usando service_role.
// Permite crear → eliminar → volver a crear desde Clippr sin tocar Supabase.
// ============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

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

function keyKind(k: string): string {
  if (!k) return "MISSING";
  if (k.startsWith("sb_secret_")) return "new-secret";
  if (k.startsWith("sb_publishable_")) return "PUBLISHABLE";
  if (k.startsWith("eyJ")) return "legacy-jwt";
  return "unknown";
}

const SERVICE_ROLE = resolveServiceKey();
const SITE_URL = Deno.env.get("SITE_URL") ?? "http://localhost:3000";

console.log("[init] service key kind:", keyKind(SERVICE_ROLE));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ADMIN_ROLES = new Set(["owner", "admin_general", "socio", "admin_local"]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function isAuthorized(
  admin: SupabaseClient,
  callerId: string,
  callerEmail: string | null,
  businessId: string,
): Promise<boolean> {
  const { data: tm, error: tmErr } = await admin
    .from("team_members")
    .select("role, status")
    .eq("business_id", businessId)
    .eq("auth_user_id", callerId)
    .maybeSingle();

  console.log("[authz] team_member:", JSON.stringify(tm), "| err:", tmErr?.message ?? null);
  if (tm && !["suspended", "deleted", "removed", "inactive"].includes(String(tm.status ?? "")) && ADMIN_ROLES.has(String(tm.role))) {
    return true;
  }

  const { data: prof, error: profErr } = await admin
    .from("profiles")
    .select("business_id, role")
    .eq("id", callerId)
    .maybeSingle();

  console.log("[authz] profile:", JSON.stringify(prof), "| err:", profErr?.message ?? null);
  if (prof?.business_id === businessId) {
    const role = String(prof.role ?? "owner");
    if (role === "owner" || ADMIN_ROLES.has(role)) return true;
  }

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

    if (idCols.some((c) => row[c] != null && String(row[c]) === callerId)) return true;
    if (
      callerEmail &&
      emailCols.some((c) => row[c] != null && String(row[c]).toLowerCase() === callerEmail.toLowerCase())
    ) {
      return true;
    }
  }

  return false;
}

async function findAuthUserByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<{ id: string } | null> {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return null;

    const match = data.users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
    if (match) return { id: match.id };
    if (data.users.length < 200) return null;
  }

  return null;
}

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
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  try {
    if (!SERVICE_ROLE) {
      return json({ error: "Server mal configurado: falta la service/secret key" }, 500);
    }

    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!jwt) return json({ error: "No autorizado" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: caller, error: callerErr } = await admin.auth.getUser(jwt);
    if (callerErr || !caller?.user) return json({ error: "Sesión inválida" }, 401);

    const callerId = caller.user.id;
    const callerEmail = caller.user.email ?? null;
    const body = await req.json().catch(() => ({}));

    const action = String(body.action ?? "create");
    const businessId = String(body.business_id ?? "");

    console.log("[invite] action:", action, "| callerId:", callerId, "| email:", callerEmail, "| businessId:", businessId);
    if (!businessId) return json({ error: "business_id requerido" }, 400);

    const authorized = await isAuthorized(admin, callerId, callerEmail, businessId);
    if (!authorized) return json({ error: "No tenés permisos sobre este negocio" }, 403);

    if (action === "delete") {
      const memberId = String(body.member_id ?? "");
      if (!memberId) return json({ error: "member_id requerido" }, 400);

      const { data: target, error: targetErr } = await admin
        .from("team_members")
        .select("id, auth_user_id, email, full_name, role")
        .eq("id", memberId)
        .eq("business_id", businessId)
        .maybeSingle();

      if (targetErr) return json({ error: targetErr.message }, 400);
      if (!target) return json({ error: "El acceso no existe" }, 404);

      const { data: principal } = await admin
        .from("team_members")
        .select("id")
        .eq("business_id", businessId)
        .eq("role", "admin_general")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (principal && principal.id === target.id) {
        return json({ error: "No se puede eliminar el administrador principal del negocio." }, 403);
      }

      const targetAuthId = target.auth_user_id as string | null;

      const { error: tmDelErr } = await admin
        .from("team_members")
        .delete()
        .eq("id", memberId)
        .eq("business_id", businessId);

      if (tmDelErr) return json({ error: tmDelErr.message }, 400);

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
          await admin.from("profiles").delete().eq("id", targetAuthId).eq("business_id", businessId);
          const { error: authErr } = await admin.auth.admin.deleteUser(targetAuthId);
          if (!authErr) authDeleted = true;
          if (authErr) console.log("[delete] deleteUser error:", authErr.message);
        }
      }

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
      return json({ ok: true, auth_deleted: authDeleted });
    }

    const email = String(body.email ?? "").trim().toLowerCase();
    const role = String(body.role ?? "profesional");
    const fullName = body.full_name ? String(body.full_name).trim() : null;
    const permissions = body.permissions ?? {};
    const professionalId = body.professional_id ?? null;
    const branchId = body.branch_id ?? null;
    const reqStatus = body.status ?? null;

    if (action === "update") {
      const memberId = String(body.member_id ?? "");
      if (!memberId) return json({ error: "member_id requerido" }, 400);

      const update: Record<string, unknown> = {
        role,
        permissions,
        professional_id: professionalId,
        branch_id: branchId,
      };
      if (fullName !== null) update.full_name = fullName;
      if (reqStatus === "active" || reqStatus === "suspended") update.status = reqStatus;

      const { error } = await admin
        .from("team_members")
        .update(update)
        .eq("id", memberId)
        .eq("business_id", businessId);

      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (!email) return json({ error: "Email requerido" }, 400);

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
              if (!fallbackUser) return json({ error: "No se pudo invitar: " + inviteErr.message }, 400);
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
            status: "active",
          })
          .eq("id", existing.id)
          .eq("business_id", businessId);

        if (reactivateErr) return json({ error: reactivateErr.message }, 400);
        return json({ ok: true, reactivated: true, auth_user_id: authUserId });
      }

      return json({ error: "Ya existe un acceso activo o invitado con ese email en este negocio" }, 409);
    }

    let authUserId: string | null = null;

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
        if (!fallbackUser) return json({ error: "No se pudo invitar: " + inviteErr.message }, 400);
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
    console.error("[invite] fatal error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
