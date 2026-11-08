import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const invoke = vi.fn();
  const tables: Record<string, any> = {};
  const chain = (table: string): any => {
    const res = () => tables[table] ?? { data: null, error: null };
    const c: any = new Proxy(function () {}, {
      get: (_t, prop) => {
        if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve(res());
        if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve(res());
        return () => c;
      },
      apply: () => c,
    });
    return c;
  };
  return { invoke, tables, chain };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => h.chain(t), functions: { invoke: h.invoke } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { saveAppointment } from "./use-agenda-data";

const future = () => new Date(Date.now() + 2 * 86_400_000).toISOString();
const base = () => ({
  business_id: "biz1",
  client_id: "cli1",
  client_name: "Juan Pérez",
  employee_id: "emp1",
  service_name: "Corte en cabello corto",
  service_price: 25000,
  starts_at: future(),
  duration_min: 60,
  status: "pending" as const,
});
const flush = () => new Promise((r) => setTimeout(r, 30));

beforeEach(() => {
  h.invoke.mockReset();
  h.invoke.mockResolvedValue({ error: null });
  h.tables.clients = { data: { email: "juan@mail.com", phone: "1122334455" }, error: null };
  h.tables.businesses = { data: { timezone: "America/Argentina/Buenos_Aires" }, error: null };
  h.tables.employees = { data: { full_name: "Alan" }, error: null };
  h.tables.closures = { data: [], error: null };
  h.tables.appointments = { data: [{ id: "appt1", manage_token: "tok1" }], error: null };
});

describe("Agenda: correo de confirmación al agendar", () => {
  it("al crear un turno con notifyClient manda UN solo correo de confirmación", async () => {
    await saveAppointment({ ...base(), notifyClient: true });
    await flush();
    expect(h.invoke).toHaveBeenCalledTimes(1);
    const [fn, opts] = h.invoke.mock.calls[0];
    expect(fn).toBe("send-booking-email");
    expect(opts.body.type).toBe("confirmation");
    expect(opts.body.to).toBe("juan@mail.com");
    expect(opts.body.booking.professional).toBe("Alan");
    expect(opts.body.booking.appointmentId).toBe("appt1");
    expect(opts.body.booking.manageToken).toBe("tok1");
    expect(opts.body.booking.total).toBe(25000);
  });

  it("sin notifyClient (series repetidas, regeneradas, importadas) no manda nada", async () => {
    await saveAppointment({ ...base() });
    await flush();
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("editar o reprogramar un turno existente no manda correo de confirmación", async () => {
    await saveAppointment({ ...base(), id: "appt1", notifyClient: true });
    await flush();
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("si el cliente no tiene email, el turno se guarda y no se manda nada", async () => {
    h.tables.clients = { data: { email: null, phone: "1122334455" }, error: null };
    const saved = await saveAppointment({ ...base(), notifyClient: true });
    await flush();
    expect(saved).toBeTruthy();
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("el email escrito al agendar tiene prioridad sobre el guardado", async () => {
    await saveAppointment({ ...base(), client_email: "nuevo@mail.com", notifyClient: true });
    await flush();
    expect(h.invoke.mock.calls[0][1].body.to).toBe("nuevo@mail.com");
  });

  it("un email inválido no dispara el envío", async () => {
    h.tables.clients = { data: { email: "no-es-un-email", phone: null }, error: null };
    await saveAppointment({ ...base(), notifyClient: true });
    await flush();
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("bloqueos y estados que no son turnos nuevos de cliente no mandan correo", async () => {
    await saveAppointment({ ...base(), status: "blocked" as any, notifyClient: true });
    await flush();
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("si falla el envío, el turno igual queda guardado", async () => {
    h.invoke.mockRejectedValue(new Error("boom"));
    const saved = await saveAppointment({ ...base(), notifyClient: true });
    await flush();
    expect(saved).toBeTruthy();
  });
});

describe("Agenda: correo al reprogramar un turno", () => {
  // El mock devuelve la misma fila para leer el horario anterior y para el update.
  const withPrevious = (iso: string) =>
    (h.tables.appointments = { data: Object.assign([{ id: "appt1", manage_token: "tok1" }], { starts_at: iso }), error: null });

  it("al cambiar el horario manda UN correo de reprogramación", async () => {
    withPrevious(new Date(Date.now() + 86_400_000).toISOString());
    await saveAppointment({ ...base(), id: "appt1" });
    await flush();
    expect(h.invoke).toHaveBeenCalledTimes(1);
    const [fn, opts] = h.invoke.mock.calls[0];
    expect(fn).toBe("send-booking-email");
    expect(opts.body.type).toBe("reschedule");
    expect(opts.body.booking.appointmentId).toBe("appt1");
  });

  it("si el horario no cambió (solo cobro, nota, estado) no manda nada", async () => {
    const input = { ...base(), id: "appt1" };
    withPrevious(input.starts_at);
    await saveAppointment(input);
    await flush();
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("un bloqueo no avisa a nadie", async () => {
    withPrevious(new Date(Date.now() + 86_400_000).toISOString());
    await saveAppointment({ ...base(), id: "appt1", status: "blocked" as any });
    await flush();
    expect(h.invoke).not.toHaveBeenCalled();
  });
});
