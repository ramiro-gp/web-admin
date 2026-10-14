import { describe, expect, it } from "vitest";
import { formatMoney, moneyInput, monthlyEquivalent, parseMoney } from "@/lib/money";

describe("dinero sin floating point", () => {
  it("parsea centavos exactos, incluso por encima del rango seguro de Number", () => {
    expect(parseMoney("0.10") + parseMoney("0,20")).toBe(30n);
    expect(parseMoney("90071992547409.93")).toBe(9_007_199_254_740_993n);
    expect(moneyInput(9_007_199_254_740_993n)).toBe("90071992547409.93");
  });
  it("rechaza importes ambiguos, negativos y subcentavos", () => {
    for (const value of ["18.000,00", "-1", "1.001", "1e6", "", "1,2,3", "92233720368547758.08"]) expect(() => parseMoney(value)).toThrow();
  });
  it("deriva el equivalente mensual y redondea sólo para mostrar", () => {
    expect(monthlyEquivalent(10_800_000n, 6)).toBe(1_800_000n);
    expect(monthlyEquivalent(100n, 6)).toBe(17n);
    expect(formatMoney(10_800_000n)).toBe("ARS 108.000,00");
    expect(formatMoney(10_000n, "USD")).toBe("USD 100,00");
  });
});
