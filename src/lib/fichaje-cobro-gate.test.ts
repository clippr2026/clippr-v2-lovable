import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const readSrc = (rel: string) => fs.readFileSync(path.resolve(__dirname, "../../", rel), "utf8");

describe("Fichaje: cobrar servicios y cerrar la caja", () => {
  it("registerPayment exige que el profesional haya fichado, solo para servicios (no catálogo)", () => {
    const src = readSrc("src/components/cash-register/register-payment.ts");
    expect(src).toContain('import { assertProfessionalClockedIn } from "@/lib/fichaje-cobro-gate"');
    expect(src).toMatch(/input\.employeeId && input\.items\.some\(\(item\) => !item\.isCatalog\)/);
    // el chequeo va antes de llamar a register_sale
    expect(src.indexOf("assertProfessionalClockedIn(input.businessId")).toBeLessThan(src.indexOf('supabase.rpc("register_sale"'));
  });

  it("el bloqueo solo aplica a profesionales programados hoy y nunca frena por un error de consulta", () => {
    const src = readSrc("src/lib/fichaje-cobro-gate.ts");
    expect(src).toContain("getScheduledProfessionalsForDate");
    expect(src).toMatch(/catch \{\s*return;/);
    expect(src).toContain("todavía no fichó su jornada");
  });

  it("el cierre de caja pide la salida de quien quedó sin fichar antes de la confirmación final", () => {
    const src = readSrc("src/routes/cash-register.tsx");
    expect(src).toContain("<CierrePrerequisitosStep");
    const step = readSrc("src/components/cash-register/cierre-prerequisitos-step.tsx");
    expect(step).toContain("<SalidasPendientesPanel");
    expect(step).toContain("showSalida");
    expect(step).toContain("disabled={cargando || pendientes > 0}");
    // la salida queda marcada como cargada al cerrar la caja (nunca como fichada del profesional)
    expect(readSrc("src/lib/work-session-exit.ts")).toContain("Salida cargada al cerrar la caja");
    expect(readSrc("src/components/professionals/salidas-pendientes-panel.tsx")).toContain(".is(\"clock_out_at\", null)");
  });

  it("la jornada de la recepcionista es opcional (Equipo → Accesos), no bloquea a nadie y no genera descuento", () => {
    const equipo = readSrc("src/components/settings/equipo-section.tsx");
    expect(equipo).toContain("Registrar su jornada (inicio y cierre)");
    expect(equipo).toContain('accessForm.role === "recepcionista"');
    const card = readSrc("src/components/dashboard/jornada-recepcion-card.tsx");
    expect(card).toContain('profile?.role === "recepcionista"');
    expect(card).toContain("late_minutes: 0");
    expect(card).toContain("if (!isRecepcionista || !enabled) return null");
    // la regla de cobro solo mira a profesionales, nunca a la recepción
    expect(readSrc("src/lib/fichaje-cobro-gate.ts")).not.toContain("recepcion");
  });

  it("la recepcionista con jornada encendida aparece entre los que ficharon o los pendientes de Inicio", () => {
    const src = readSrc("src/lib/fichaje.ts");
    expect(src).toContain("getJornadaRecepcionMap(businessId)");
    expect(src).toContain('.eq("role", "recepcionista")');
    expect(src).toContain("jornadaMap[jornadaEmailKey(m.email)] !== true");
  });
});
