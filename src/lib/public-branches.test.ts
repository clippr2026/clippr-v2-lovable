import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hiddenPublicBranchIds } from "./public-branches";

const readSrc = (rel: string) => fs.readFileSync(path.resolve(__dirname, "../../", rel), "utf8");

describe("Sucursales ocultas en la página pública", () => {
  it("lee la lista de ids ocultos y tolera datos ausentes o raros", () => {
    expect(hiddenPublicBranchIds({ _publicHiddenBranches: ["a", "b"] })).toEqual(["a", "b"]);
    expect(hiddenPublicBranchIds({ _publicHiddenBranches: ["a", 3, null] })).toEqual(["a"]);
    expect(hiddenPublicBranchIds({})).toEqual([]);
    expect(hiddenPublicBranchIds(null)).toEqual([]);
  });

  it("las dos páginas públicas filtran las ocultas (y nunca quedan sin sucursales)", () => {
    for (const f of ["src/routes/negocio/$slug.tsx", "src/routes/reservar/$slug.tsx"]) {
      const src = readSrc(f);
      expect(src).toContain("hiddenPublicBranchIds");
      expect(src).toContain("visibleBranches.length > 0 ? visibleBranches : allBranches");
    }
  });

  it("Configuración → Sucursales ofrece 'Mostrar en la página pública' solo para sucursales activas", () => {
    const src = readSrc("src/components/settings/sucursales-section.tsx");
    expect(src).toContain("Mostrar en la página pública");
    expect(src).toMatch(/\{b\.is_active && \(\s*\n\s*<div className="flex items-center justify-between gap-3 border-t/);
  });
});
