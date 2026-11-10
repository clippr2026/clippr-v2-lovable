import { describe, expect, it } from "vitest";
import { senasQueBloqueanCierre } from "@/components/senas/cierre-senas-gate";
import { agruparSenasExtension } from "@/components/senas/senas-extension";

const sena = (id: string, proof: string | null) => ({
  id,
  appointment_id: id,
  amount: 1000,
  method: "transfer",
  proof_uploaded_at: proof,
  client_name: null,
  service_name: null,
  starts_at: null,
});

describe("El cierre no se confirma con señas por revisar de ese día o anteriores", () => {
  const items = [
    sena("dom", "2026-11-08T14:00:00-03:00"),
    sena("lun", "2026-11-09T23:30:00-03:00"),
    sena("mar", "2026-11-10T00:10:00-03:00"),
  ];
  it("cerrando el lunes frenan la del domingo y la del lunes, no la del martes", () => {
    expect(senasQueBloqueanCierre(items, "2026-11-09").map((i) => i.id)).toEqual(["dom", "lun"]);
  });
  it("cerrando el domingo solo frena la del domingo", () => {
    expect(senasQueBloqueanCierre(items, "2026-11-08").map((i) => i.id)).toEqual(["dom"]);
  });
  it("sin fecha no frena nada", () => {
    expect(senasQueBloqueanCierre(items, "")).toEqual([]);
  });
});

describe("Señas pendientes de cierre (extensión de una caja ya cerrada)", () => {
  it("se agrupan por día de Buenos Aires, con su total", () => {
    const dias = agruparSenasExtension([
      { id: "a", amount: 5000, method: "cuenta", note: "Seña – Ana – Corte", created_at: "2026-11-07T15:00:00-03:00" },
      { id: "b", amount: 3000, method: "cuenta", note: "Seña – Luis – Barba", created_at: "2026-11-07T23:50:00-03:00" },
      { id: "c", amount: 2000, method: "efectivo", note: null, created_at: "2026-11-08T00:05:00-03:00" },
    ]);
    expect(dias.map((d) => [d.fecha, d.total, d.items.length])).toEqual([
      ["2026-11-07", 8000, 2],
      ["2026-11-08", 2000, 1],
    ]);
  });
});
