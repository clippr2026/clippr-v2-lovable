// ════════════════════════════════════════════════════════════════════════════
//  useAiRecommendations
//  ----------------------------------------------------------------------------
//  Único punto de entrada del Gerente IA para la capa React. Se encarga de:
//    • Obtener los datos del negocio (clientes, agenda, servicios, equipo).
//    • Ejecutar el motor (src/lib/ai-recommendation-engine.ts).
//    • Ordenar las recomendaciones por score.
//    • Administrar el ciclo de vida en Supabase (active / working / resolved / archived).
//    • Resolver automáticamente lo que mejoró y explicarlo.
//    • Archivar los logros y exponer el historial.
//
//  El componente sólo hace:  const { recommendations } = useAiRecommendations();
//  No debe haber lógica de negocio dentro del componente.
// ════════════════════════════════════════════════════════════════════════════

import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import { useClientsData } from "@/hooks/use-clients-data";
import {
  runRecommendationEngine,
  describeResolution,
  type EngineAppt,
  type EngineService,
  type EngineEmployee,
  type EngineMetrics,
  type Recommendation,
  type RecommendationStatus,
} from "@/lib/ai-recommendation-engine";

// Días que una recomendación resuelta permanece visible como "Objetivo logrado"
// antes de pasar al Historial de logros IA (req. 9 y 10).
const RESOLVED_VISIBLE_DAYS = 3;
const DAY = 86_400_000;

type AiRecommendationState = {
  recommendation_key: string;
  status: RecommendationStatus;
  score: number | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  resolved_at: string | null;
  archived_at: string | null;
  metadata: Record<string, unknown> | null;
};

/** Tarjeta "Objetivo logrado" o ítem del historial, listas para renderizar. */
export type RecommendationAchievement = {
  key: string;
  title: string;
  message: string;
  moneyRecoverable: number;
  resolvedAt: string | null;
  daysSince: number;
};

export type UseAiRecommendationsResult = {
  ready: boolean;
  loading: boolean;
  error: string | null;
  /** Recomendaciones activas/en seguimiento, ordenadas por score de mayor a menor. */
  recommendations: Recommendation[];
  /** Marca una recomendación como "Trabajando en eso". */
  markWorking: (key: string) => Promise<void>;
  /** Resueltas dentro de la ventana de 3 días ("Objetivo logrado"). */
  resolved: RecommendationAchievement[];
  /** Historial de logros IA (ya archivadas). */
  achievements: RecommendationAchievement[];
  avgTicket: number;
  totalOpportunity: number;
  metrics: EngineMetrics;
};

function daysSince(dateIso: string | null, now: number): number {
  if (!dateIso) return 0;
  return Math.max(0, Math.floor((now - new Date(dateIso).getTime()) / DAY));
}

function archiveDueAt(resolvedAtIso: string | null): number | null {
  if (!resolvedAtIso) return null;
  return new Date(resolvedAtIso).getTime() + RESOLVED_VISIBLE_DAYS * DAY;
}

function asAchievement(state: AiRecommendationState, now: number): RecommendationAchievement {
  const meta = (state.metadata ?? {}) as Record<string, unknown>;
  return {
    key: state.recommendation_key,
    title: typeof meta.title === "string" ? meta.title : "Recomendación resuelta",
    message: typeof meta.resolutionMessage === "string" ? meta.resolutionMessage : "Objetivo logrado.",
    moneyRecoverable: Number(meta.moneyRecoverable ?? 0),
    resolvedAt: state.resolved_at,
    daysSince: daysSince(state.resolved_at, now),
  };
}

export function useAiRecommendations(businessId: string | null | undefined): UseAiRecommendationsResult {
  const clientsQuery = useClientsData(businessId ?? null);

  const [appts, setAppts] = React.useState<EngineAppt[]>([]);
  const [services, setServices] = React.useState<EngineService[]>([]);
  const [employees, setEmployees] = React.useState<EngineEmployee[]>([]);
  const [loadingExtra, setLoadingExtra] = React.useState(true);
  const [dataError, setDataError] = React.useState<string | null>(null);

  const [states, setStates] = React.useState<AiRecommendationState[]>([]);
  const [statesReady, setStatesReady] = React.useState(false);

  // Integridad del último fetch. Si alguna query falló (red, RLS, timeout) los
  // datos se setean a [] y el motor devolvería menos recomendaciones de las
  // reales. Sin este guard, una recomendación "ausente por error" se marcaría
  // como resuelta y se archivaría: un falso "Objetivo logrado" irreversible.
  const fetchOkRef = React.useRef(true);

  // ── 1. Obtener datos del negocio (agenda, servicios, equipo) ───────────────
  React.useEffect(() => {
    if (!businessId) {
      setAppts([]);
      setServices([]);
      setEmployees([]);
      setLoadingExtra(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingExtra(true);
      setDataError(null);
      const since = new Date();
      since.setDate(since.getDate() - 90);
      try {
        const [apptRes, svcRes, empRes] = await Promise.all([
          supabase
            .from("appointments")
            .select("id,client_id,client_name,service_name,service_price,starts_at,status,employee_id")
            .eq("business_id", businessId)
            .gte("starts_at", since.toISOString())
            .order("starts_at", { ascending: false }),
          supabase.from("services").select("id,name,price").eq("business_id", businessId),
          supabase.from("employees").select("id,full_name").eq("business_id", businessId),
        ]);
        if (cancelled) return;
        fetchOkRef.current = !(apptRes.error || svcRes.error || empRes.error);
        setAppts(apptRes.error ? [] : ((apptRes.data ?? []) as EngineAppt[]));
        setServices(svcRes.error ? [] : ((svcRes.data ?? []) as EngineService[]));
        setEmployees(empRes.error ? [] : ((empRes.data ?? []) as EngineEmployee[]));
      } catch (e) {
        if (!cancelled) {
          fetchOkRef.current = false;
          setDataError((e as Error).message);
        }
      } finally {
        if (!cancelled) setLoadingExtra(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const clients = clientsQuery.data ?? [];
  const dataLoading = clientsQuery.isLoading || loadingExtra;

  // ── 2. Ejecutar el motor ───────────────────────────────────────────────────
  // La persistencia (hace cuánto se ve cada recomendación) viene del ciclo de
  // vida en base de datos. El motor la usa para el componente "persistencia" del
  // score. Recalcula cuando cambian los datos o los estados.
  const lifecycle = React.useMemo(() => {
    const map: Record<string, { firstSeenAt?: string | null }> = {};
    for (const s of states) map[s.recommendation_key] = { firstSeenAt: s.first_seen_at };
    return map;
  }, [states]);

  const engineResult = React.useMemo(
    () => runRecommendationEngine({ clients, appts, services, employees, lifecycle }),
    [clients, appts, services, employees, lifecycle],
  );

  const currentRecs = engineResult.recommendations;
  const metrics = engineResult.metrics;

  // Firma estable respecto de la persistencia: depende de las KEYS y la plata,
  // no del score (que sí cambia con la persistencia). Evita loops de reconcilia-
  // ción cuando el score se recalcula tras cargar los estados.
  const reconcileSignature = React.useMemo(
    () =>
      currentRecs
        .map((r) => `${r.key}:${r.strategy.moneyRecoverable}:${r.strategy.moneyLost}`)
        .sort()
        .join("|"),
    [currentRecs],
  );

  // Metadata "viva" por key, para persistir títulos/plata actualizados.
  const metaByKey = React.useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    for (const r of currentRecs) {
      map.set(r.key, {
        title: r.title,
        description: r.description,
        category: r.strategy.category,
        tone: r.strategy.tone,
        icon: r.strategy.icon,
        moneyLost: r.strategy.moneyLost,
        moneyRecoverable: r.strategy.moneyRecoverable,
        score: r.score,
      });
    }
    return map;
  }, [currentRecs]);

  // ── 3. Reconciliar el ciclo de vida en Supabase ────────────────────────────
  React.useEffect(() => {
    if (!businessId || dataLoading) return;

    let cancelled = false;
    (async () => {
      setStatesReady(false);
      const now = new Date();
      const nowMs = now.getTime();
      const nowIso = now.toISOString();
      const currentKeys = new Set(currentRecs.map((r) => r.key));

      try {
        const { data, error } = await supabase
          .from("ai_recommendation_states")
          .select("recommendation_key,status,score,first_seen_at,last_seen_at,resolved_at,archived_at,metadata")
          .eq("business_id", businessId);
        if (error) throw error;

        const existing = ((data ?? []) as AiRecommendationState[]).map((row) => ({
          ...row,
          metadata: (row.metadata ?? {}) as Record<string, unknown>,
        }));
        const existingByKey = new Map(existing.map((row) => [row.recommendation_key, row]));

        // (a) Recomendaciones presentes hoy → activas o en seguimiento.
        // Si el usuario marcó "Estoy trabajando en esto", se conserva ese estado
        // mientras el problema siga existiendo. No se puede ocultar ni eliminar.
        const activeRows = currentRecs.map((rec) => {
          const prev = existingByKey.get(rec.key);
          const meta = { ...(prev?.metadata ?? {}), ...(metaByKey.get(rec.key) ?? {}) };
          const nextStatus = prev?.status === "working" ? "working" : "active";
          return {
            business_id: businessId,
            recommendation_key: rec.key,
            status: nextStatus as "active" | "working",
            score: rec.score,
            first_seen_at: prev?.first_seen_at ?? nowIso,
            last_seen_at: nowIso,
            resolved_at: null,
            archived_at: null,
            metadata: meta,
          };
        });

        // (b) Antes activas y hoy ausentes → resueltas (con mensaje dinámico).
        // Sólo si el fetch fue íntegro: si una query falló, la ausencia puede ser
        // por el error y no porque el problema se haya resuelto de verdad.
        const rowsToResolve = (fetchOkRef.current ? existing : [])
          .filter((row) => (row.status === "active" || row.status === "working") && !currentKeys.has(row.recommendation_key))
          .map((row) => {
            const resolvedAt = row.resolved_at ?? nowIso;
            const meta = {
              ...(row.metadata ?? {}),
              resolutionMessage:
                (row.metadata?.resolutionMessage as string | undefined) ??
                describeResolution(row.recommendation_key, metrics),
            };
            return {
              business_id: businessId,
              recommendation_key: row.recommendation_key,
              status: "resolved" as const,
              score: row.score ?? 0,
              first_seen_at: row.first_seen_at,
              last_seen_at: nowIso,
              resolved_at: resolvedAt,
              archived_at: null,
              metadata: meta,
            };
          });

        // (c) Resueltas hace más de 3 días → archivadas (pasan al historial).
        const rowsToArchive = existing
          .filter((row) => {
            if (row.status !== "resolved") return false;
            const due = archiveDueAt(row.resolved_at);
            return due != null && due <= nowMs;
          })
          .map((row) => ({
            business_id: businessId,
            recommendation_key: row.recommendation_key,
            status: "archived" as const,
            score: row.score ?? 0,
            first_seen_at: row.first_seen_at,
            last_seen_at: nowIso,
            resolved_at: row.resolved_at,
            archived_at: row.archived_at ?? nowIso,
            metadata: row.metadata ?? {},
          }));

        const upserts = [...activeRows, ...rowsToResolve, ...rowsToArchive];
        if (upserts.length > 0) {
          await supabase
            .from("ai_recommendation_states")
            .upsert(upserts, { onConflict: "business_id,recommendation_key" });
        }
        if (cancelled) return;

        // Reconstruir el estado local sin re-leer (resultado determinista).
        const next = new Map<string, AiRecommendationState>(existingByKey);
        for (const r of [...activeRows, ...rowsToResolve, ...rowsToArchive]) {
          next.set(r.recommendation_key, {
            recommendation_key: r.recommendation_key,
            status: r.status,
            score: r.score,
            first_seen_at: r.first_seen_at,
            last_seen_at: r.last_seen_at,
            resolved_at: r.resolved_at,
            archived_at: r.archived_at,
            metadata: r.metadata,
          });
        }
        setStates(Array.from(next.values()));
        setStatesReady(true);
      } catch {
        // Degradación segura: si la tabla todavía no existe, el Gerente IA sigue
        // funcionando con las recomendaciones activas (sin historial de logros).
        if (!cancelled) {
          setStates(
            currentRecs.map((rec) => ({
              recommendation_key: rec.key,
              status: "active" as const,
              score: rec.score,
              first_seen_at: nowIso,
              last_seen_at: nowIso,
              resolved_at: null,
              archived_at: null,
              metadata: metaByKey.get(rec.key) ?? {},
            })),
          );
          setStatesReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // reconcileSignature captura los cambios relevantes de currentRecs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, dataLoading, reconcileSignature]);

  // ── 4. Derivar la salida lista para renderizar ─────────────────────────────
  const statusByKey = React.useMemo(
    () => new Map(states.map((s) => [s.recommendation_key, s.status])),
    [states],
  );

  const recommendations = React.useMemo(
    () =>
      currentRecs
        .map((r) => ({
          ...r,
          status: statusByKey.get(r.key) ?? "active",
        }))
        .filter((r) => r.status === "active" || r.status === "working"),
    [currentRecs, statusByKey],
  );

  const markWorking = React.useCallback(
    async (key: string) => {
      if (!businessId) return;
      const nowIso = new Date().toISOString();
      const rec = currentRecs.find((r) => r.key === key);
      const prev = states.find((s) => s.recommendation_key === key);
      const metadata = { ...(prev?.metadata ?? {}), ...(rec ? metaByKey.get(rec.key) ?? {} : {}) };

      setStates((prevStates) => {
        const exists = prevStates.some((s) => s.recommendation_key === key);
        if (exists) {
          return prevStates.map((s) =>
            s.recommendation_key === key
              ? { ...s, status: "working", last_seen_at: nowIso, metadata }
              : s,
          );
        }
        return [
          ...prevStates,
          {
            recommendation_key: key,
            status: "working",
            score: rec?.score ?? 0,
            first_seen_at: nowIso,
            last_seen_at: nowIso,
            resolved_at: null,
            archived_at: null,
            metadata,
          },
        ];
      });

      try {
        await supabase.from("ai_recommendation_states").upsert(
          {
            business_id: businessId,
            recommendation_key: key,
            status: "working",
            score: rec?.score ?? prev?.score ?? 0,
            first_seen_at: prev?.first_seen_at ?? nowIso,
            last_seen_at: nowIso,
            resolved_at: null,
            archived_at: null,
            metadata,
          },
          { onConflict: "business_id,recommendation_key" },
        );
      } catch {
        // Degradación segura: si la tabla aún no existe, el estado queda local.
      }
    },
    [businessId, currentRecs, states, metaByKey],
  );

  const resolved = React.useMemo(() => {
    const now = Date.now();
    return states
      .filter((s) => {
        if (s.status !== "resolved") return false;
        const due = archiveDueAt(s.resolved_at);
        return due == null || due > now;
      })
      .map((s) => asAchievement(s, now))
      .sort((a, b) => (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? ""));
  }, [states]);

  const achievements = React.useMemo(() => {
    const now = Date.now();
    return states
      .filter((s) => s.status === "archived")
      .map((s) => asAchievement(s, now))
      .sort((a, b) => (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? ""))
      .slice(0, 20);
  }, [states]);

  const totalOpportunity = React.useMemo(
    () => recommendations.reduce((s, r) => s + r.strategy.moneyRecoverable, 0),
    [recommendations],
  );

  return {
    ready: statesReady && !dataLoading,
    loading: dataLoading,
    error: dataError || (clientsQuery.error as Error | null)?.message || null,
    recommendations,
    markWorking,
    resolved,
    achievements,
    avgTicket: engineResult.avgTicket,
    totalOpportunity,
    metrics,
  };
}
