import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Lock, ShieldCheck, CheckCircle2, Loader2, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { SectionCard, Field, inputCls, reportSaveStatus } from "@/components/settings/shared";
import {
  hasCajaAuthorizationPassword,
  setCajaAuthorizationPassword,
  getActivityLog,
  type CajaAuthorizationActionType,
  type PaymentAuthorizationLogRow,
} from "@/components/cash-register/caja-authorization";
import { AuthorizationLogRow } from "@/components/cash-register/payment-authorization-history";

// "Autorizaciones de caja" — las contraseñas que Caja pide antes de
// "Corregir cobro"/"Anular venta" (ver authorization-modal.tsx,
// cash-register.tsx). Dos contraseñas independientes, una por acción,
// nunca la misma que la de login — set_caja_authorization_password
// (20261025020000) ya exige server-side que quien la cambia sea owner/
// admin_general, esto solo evita mostrar el formulario a quien de entrada
// no va a poder guardarlo.
function CambiarContrasenaCard({
  businessId,
  actionType,
  title,
  description,
  ownEmail,
}: {
  businessId: string;
  actionType: CajaAuthorizationActionType;
  title: string;
  description: string;
  ownEmail: string | null;
}) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [ownPassword, setOwnPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    hasCajaAuthorizationPassword(businessId, actionType)
      .then((v) => {
        if (!cancelled) setConfigured(v);
      })
      .catch(() => {
        if (!cancelled) setConfigured(null);
      });
    return () => {
      cancelled = true;
    };
  }, [businessId, actionType]);

  function openForm() {
    setOwnPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
    setFormOpen(true);
  }

  async function handleSave() {
    if (!ownEmail) {
      setError("No se pudo identificar tu cuenta — recargá la página e intentá de nuevo.");
      return;
    }
    if (newPassword.trim().length < 4) {
      setError("La contraseña debe tener al menos 4 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    if (!ownPassword) {
      setError("Ingresá tu propia contraseña para confirmar que sos vos.");
      return;
    }
    setSaving(true);
    setError(null);
    reportSaveStatus("saving");
    try {
      // Reautenticación administrativa: antes de tocar la contraseña de
      // autorización, se verifica la contraseña de LOGIN de quien está
      // guardando (no la de autorización — son dos secretos distintos).
      // signInWithPassword vuelve a validar sin alterar la sesión actual
      // (misma sesión ya logueada, solo re-chequea la credencial).
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: ownEmail,
        password: ownPassword,
      });
      if (authError) {
        setError("Tu contraseña no es correcta.");
        setSaving(false);
        return;
      }
      await setCajaAuthorizationPassword(businessId, actionType, newPassword);
      setConfigured(true);
      setFormOpen(false);
      toast.success("Contraseña actualizada");
      reportSaveStatus("saved");
    } catch (e) {
      setError((e as Error).message || "No se pudo guardar la contraseña");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard
      label={title}
      headerRight={
        configured == null ? null : (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
              configured ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-500/10 text-amber-300",
            )}
          >
            {configured ? <CheckCircle2 className="size-3" /> : null}
            {configured ? "Configurada" : "No configurada"}
          </span>
        )
      }
    >
      <p className="text-xs text-muted-foreground mb-3">{description}</p>

      {!formOpen ? (
        <button
          type="button"
          onClick={openForm}
          className="rounded-lg bg-white/5 hover:bg-white/10 px-3 py-2 text-xs font-semibold text-foreground transition"
        >
          {configured ? "Cambiar contraseña" : "Configurar contraseña"}
        </button>
      ) : (
        <div className="space-y-3">
          <Field label="Nueva contraseña">
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={inputCls}
              placeholder="••••••"
            />
          </Field>
          <Field label="Confirmar nueva contraseña">
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={inputCls}
              placeholder="••••••"
            />
          </Field>
          <Field label="Tu contraseña de acceso (para confirmar)">
            <input
              type="password"
              value={ownPassword}
              onChange={(e) => setOwnPassword(e.target.value)}
              className={inputCls}
              placeholder="••••••"
            />
          </Field>
          {error && <p className="text-[11px] font-semibold text-red-300">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              disabled={saving}
              className="rounded-lg bg-white/5 hover:bg-white/10 px-3 py-2 text-xs font-semibold transition disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-sky-400 to-violet-500 px-3 py-2 text-xs font-semibold text-white transition hover:opacity-95 disabled:opacity-50"
            >
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              Guardar
            </button>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

// Historial de actividad — todas las correcciones/anulaciones/
// eliminaciones del negocio (payment_authorization_log), no las de UNA
// venta puntual (eso es PaymentAuthorizationHistoryPanel, en el detalle de
// cada cobro) — mismo componente de fila (AuthorizationLogRow) en los dos
// lugares. Simplificado a propósito: sin filtros, un solo orden
// cronológico descendente, "Cargar más" al final en vez de paginado con
// controles. Solo lectura: no hay ningún botón acá que edite o borre una
// fila de auditoría.
const ACTIVITY_PAGE_SIZE = 30;

function ActivityLogSection({ businessId }: { businessId: string }) {
  const [rows, setRows] = useState<PaymentAuthorizationLogRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getActivityLog(businessId, { limit: ACTIVITY_PAGE_SIZE })
      .then((page) => {
        setRows(page.rows);
        setHasMore(page.hasMore);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [businessId]);

  function loadMore() {
    const last = rows[rows.length - 1];
    if (!last || loadingMore) return;
    setLoadingMore(true);
    getActivityLog(businessId, { beforeCreatedAt: last.createdAt, limit: ACTIVITY_PAGE_SIZE })
      .then((page) => {
        setRows((prev) => [...prev, ...page.rows]);
        setHasMore(page.hasMore);
      })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoadingMore(false));
  }

  return (
    <SectionCard
      label={
        <span className="flex items-center gap-1.5">
          <History className="size-3.5" /> Historial de actividad
        </span>
      }
    >
      <p className="mb-3 text-xs text-muted-foreground">
        Todas las correcciones, anulaciones y eliminaciones de cobros del negocio — de más reciente a
        más antigua. Es de solo lectura: ningún registro de acá se puede editar ni borrar.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Cargando…
        </div>
      ) : error ? (
        <p className="text-xs font-semibold text-red-300">{error}</p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          Todavía no hay correcciones ni anulaciones registradas.
        </p>
      ) : (
        <>
          <div>
            {rows.map((row) => (
              <AuthorizationLogRow key={row.id} row={row} showPaymentRef />
            ))}
          </div>
          {hasMore && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-white/5 hover:bg-white/10 px-3 py-2 text-xs font-semibold text-foreground transition disabled:opacity-50"
            >
              {loadingMore && <Loader2 className="size-3.5 animate-spin" />}
              Cargar más
            </button>
          )}
        </>
      )}
    </SectionCard>
  );
}

export function SeguridadSection() {
  const { profile, user, businessId } = useAuth();
  const isAdmin = !profile?.role || profile.role === "owner" || profile.role === "admin_general";
  const ownEmail = user?.email ?? profile?.email ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-display font-semibold">Seguridad</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Contraseñas de autorización para acciones sensibles de Caja.
        </p>
      </div>

      {!isAdmin || !businessId ? (
        <SectionCard label="Autorizaciones de caja">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Lock className="size-4 shrink-0" />
            Esta sección es visible solo para el dueño o el administrador general del negocio.
          </p>
        </SectionCard>
      ) : (
        <>
          <div className="flex items-start gap-2 rounded-2xl bg-white/[0.025] ring-1 ring-white/10 px-4 py-3 text-xs text-muted-foreground">
            <ShieldCheck className="size-4 shrink-0 text-emerald-300" />
            <span>
              En Caja, "Corregir cobro" y "Anular venta" piden una de estas contraseñas antes de poder
              confirmarse — son independientes entre sí y de tu contraseña de acceso. Se guardan
              encriptadas; nadie puede verlas, solo cambiarlas.
            </span>
          </div>

          <CambiarContrasenaCard
            businessId={businessId}
            actionType="correction"
            title="Contraseña para corregir cobros"
            description='Se pide al tocar "Corregir cobro" en el detalle de una venta.'
            ownEmail={ownEmail}
          />
          <CambiarContrasenaCard
            businessId={businessId}
            actionType="void"
            title="Contraseña para anular ventas"
            description='Se pide al tocar "Anular venta" en el detalle de una venta.'
            ownEmail={ownEmail}
          />

          <ActivityLogSection businessId={businessId} />
        </>
      )}
    </div>
  );
}
