import { describe, expect, it } from "vitest";
import type { Promotion } from "@/lib/service-pricing";
import { activePromoOffersForService } from "./promo-view";

const day = { enabled: true, start: "", end: "" };
const days = { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day };
const mk = (o: Partial<Promotion>): Promotion => ({
  id: "p",
  name: "Promo",
  imageUrl: null,
  description: "",
  active: true,
  discountType: "percent",
  discountValue: "20",
  requiresCode: false,
  code: "",
  serviceIds: ["s1"],
  categoryNames: [],
  employeeIds: [],
  hasVigencia: false,
  startDate: "",
  endDate: "",
  days,
  maxUsesTotal: null,
  maxUsesPerClient: null,
  usageCount: 0,
  usedByClient: {},
  ...o,
});
const NOW = new Date("2026-10-30T12:00:00");

describe("precio con promo en un servicio", () => {
  const svc = { id: "s1", price: 20000, category: "Cortes" };
  it("calcula el precio sobre la lista y ordena de menor a mayor", () => {
    const offers = activePromoOffersForService(
      svc,
      [mk({ id: "x", discountValue: "10" }), mk({ id: "y", discountType: "fixed", discountValue: "5000" })],
      NOW,
    );
    expect(offers.map((o) => [o.promo.id, o.price])).toEqual([["y", 15000], ["x", 18000]]);
  });

  it("ignora promos con código, pausadas, vencidas, agotadas o de otro servicio", () => {
    const offers = activePromoOffersForService(
      svc,
      [
        mk({ id: "code", requiresCode: true, code: "ABC" }),
        mk({ id: "off", active: false }),
        mk({ id: "old", hasVigencia: true, endDate: "2026-01-01" }),
        mk({ id: "full", maxUsesTotal: 1, usageCount: 1 }),
        mk({ id: "other", serviceIds: ["s2"] }),
      ],
      NOW,
    );
    expect(offers).toEqual([]);
  });

  it("aplica también por categoría", () => {
    const offers = activePromoOffersForService(svc, [mk({ serviceIds: [], categoryNames: ["Cortes"] })], NOW);
    expect(offers).toHaveLength(1);
  });
});
