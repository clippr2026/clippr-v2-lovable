import { DAY_KEYS, type DayKey, type DaySchedule } from "@/lib/availability";

// Días y horarios en que un servicio se puede reservar, y —opcional— un horario más acotado para un
// profesional puntual en ese servicio. Se guardan en business_settings.schedule:
//   _serviceSchedules[servicioId]                  → { mon: { enabled, start, end }, ... }
//   _serviceEmployeeSchedules[servicioId][profId]  → igual
// Un servicio (o profesional) sin entrada no tiene restricción: rige el horario general de siempre.
// Las restricciones SOLO acotan: nunca habilitan algo que el horario del local o del profesional no permite.

export type ServiceDayWindow = { enabled: boolean; start: string; end: string };
export type ServiceWindowMap = Partial<Record<DayKey, ServiceDayWindow>>;

export type ServiceScheduleConfig = {
  service: Record<string, ServiceWindowMap>;
  employee: Record<string, Record<string, ServiceWindowMap>>;
};

export const EMPTY_SERVICE_SCHEDULE_CONFIG: ServiceScheduleConfig = { service: {}, employee: {} };

function normalizeWindowMap(value: unknown): ServiceWindowMap | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, any>;
  const out: ServiceWindowMap = {};
  for (const key of DAY_KEYS) {
    const day = source[key];
    if (!day || typeof day !== "object") continue;
    if (typeof day.start !== "string" || typeof day.end !== "string") continue;
    out[key] = { enabled: day.enabled !== false, start: day.start, end: day.end };
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function normalizeServiceScheduleConfig(schedule: unknown): ServiceScheduleConfig {
  if (!schedule || typeof schedule !== "object") return { service: {}, employee: {} };
  const raw = schedule as Record<string, any>;
  const service: Record<string, ServiceWindowMap> = {};
  const employee: Record<string, Record<string, ServiceWindowMap>> = {};
  if (raw._serviceSchedules && typeof raw._serviceSchedules === "object") {
    for (const [svcId, value] of Object.entries(raw._serviceSchedules as Record<string, unknown>)) {
      const map = normalizeWindowMap(value);
      if (map) service[svcId] = map;
    }
  }
  if (raw._serviceEmployeeSchedules && typeof raw._serviceEmployeeSchedules === "object") {
    for (const [svcId, perEmp] of Object.entries(raw._serviceEmployeeSchedules as Record<string, unknown>)) {
      if (!perEmp || typeof perEmp !== "object") continue;
      const inner: Record<string, ServiceWindowMap> = {};
      for (const [empId, value] of Object.entries(perEmp as Record<string, unknown>)) {
        const map = normalizeWindowMap(value);
        if (map) inner[empId] = map;
      }
      if (Object.keys(inner).length > 0) employee[svcId] = inner;
    }
  }
  return { service, employee };
}

function toMin(value: string): number | null {
  const m = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/.exec(String(value ?? ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const fmt = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

// Recorta un día del horario general con una ventana del servicio. null = ese día no se puede.
export function intersectDay(day: DaySchedule, win: ServiceDayWindow | undefined): DaySchedule | null {
  if (!win) return day;
  if (!win.enabled) return null;
  const open = toMin(day.start);
  const close = toMin(day.end);
  const wOpen = toMin(win.start);
  const wClose = toMin(win.end);
  if (open === null || close === null || wOpen === null || wClose === null) return null;
  const start = Math.max(open, wOpen);
  const end = Math.min(close, wClose);
  if (end <= start) return null;
  return { ...day, start: fmt(start), end: fmt(end) };
}

export type SlotRestriction = (employeeId: string, dayKey: DayKey, day: DaySchedule) => DaySchedule | null;

// Restricción para los servicios elegidos: el día queda recortado por cada servicio y, si la hay, por el
// horario propio del profesional en ese servicio. Sin ninguna restricción configurada devuelve undefined.
export function buildServiceRestriction(cfg: ServiceScheduleConfig, serviceIds: string[]): SlotRestriction | undefined {
  const relevant = serviceIds.filter((id) => cfg.service[id] || cfg.employee[id]);
  if (relevant.length === 0) return undefined;
  return (employeeId, dayKey, day) => {
    let current: DaySchedule | null = day;
    for (const id of relevant) {
      if (!current) return null;
      current = intersectDay(current, cfg.service[id]?.[dayKey]);
      if (!current) return null;
      current = intersectDay(current, cfg.employee[id]?.[employeeId]?.[dayKey]);
    }
    return current;
  };
}
