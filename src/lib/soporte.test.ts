import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const { describirEquipo, textoCierre } = await import("./soporte");

describe("describirEquipo", () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  it("reconoce aparato y navegador", () => {
    expect(describirEquipo(iphone, false)).toBe("iPhone · Safari");
    expect(describirEquipo(iphone, true)).toBe("iPhone · app instalada");
    expect(describirEquipo("Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36", false)).toBe("Android · Chrome");
    expect(describirEquipo("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15", false, true)).toBe("iPad · Safari");
    expect(describirEquipo("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0", false)).toBe("Windows · Edge");
    expect(describirEquipo(iphone + " Instagram 300.0", false)).toBe("iPhone · dentro de Instagram");
  });
});

describe("cómo se cerró una consulta", () => {
  it("lo dice en el panel", () => {
    expect(textoCierre("automatico")).toBe("Cierre automático");
    expect(textoCierre("cliente")).toBe("Cerrada por el cliente");
    expect(textoCierre("asesor")).toBe("Cerrada por vos");
    expect(textoCierre(null)).toBe("Cerrada");
  });
});
