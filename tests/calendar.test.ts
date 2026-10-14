import { describe, expect, it } from "vitest";
import { boundaryIndex, duePeriodRanges, nextPeriodStart, parseCalendarDate, periodBoundary, today } from "@/lib/calendar";

describe("calendario comercial", () => {
  it("conserva el ancla 31 sin derivar desde febrero", () => {
    const plan = { billingStart: "2026-01-31", anchorDay: 31, frequencyMonths: 1 };
    expect([0, 1, 2, 3].map((index) => periodBoundary(plan, index))).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(boundaryIndex(plan, "2026-03-28")).toBeNull();
    expect(boundaryIndex(plan, "2026-03-31")).toBe(2);
  });

  it("recupera el 29 de febrero en un contrato anual bisiesto", () => {
    const plan = { billingStart: "2024-02-29", anchorDay: 29, frequencyMonths: 12 };
    expect([0, 1, 2, 3, 4].map((index) => periodBoundary(plan, index))).toEqual(["2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"]);
  });

  it("produce el ejemplo semestral y no avanza según la fecha de pago", () => {
    const plan = { billingStart: "2026-10-01", anchorDay: 1, frequencyMonths: 6 };
    expect(duePeriodRanges(plan, "2026-10-03")).toEqual([{ startsOn: "2026-10-01", endsOn: "2027-04-01", dueOn: "2026-10-01" }]);
    expect(nextPeriodStart(plan, "2026-10-03")).toBe("2027-04-01");
    expect(nextPeriodStart(plan, "2027-04-01")).toBe("2027-10-01");
  });

  it("recupera todos los meses transcurridos y respeta el fin exclusivo", () => {
    const plan = { billingStart: "2026-01-31", anchorDay: 31, frequencyMonths: 1, endedOn: "2026-04-30" };
    expect(duePeriodRanges(plan, "2026-10-14").map((row) => row.startsOn)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(nextPeriodStart(plan, "2026-04-01")).toBeNull();
  });

  it("no genera períodos antes del corte ni futuros", () => {
    const plan = { billingStart: "2026-11-30", anchorDay: 31, frequencyMonths: 1 };
    expect(duePeriodRanges(plan, "2026-10-14")).toEqual([]);
    expect(nextPeriodStart(plan, "2026-10-14")).toBe("2026-11-30");
  });

  it("calcula límites anteriores sólo para cargas históricas explícitas", () => {
    const plan = { billingStart: "2026-01-31", anchorDay: 31, frequencyMonths: 1 };
    expect(boundaryIndex(plan, "2025-12-31")).toBe(-1);
    expect(periodBoundary(plan, -2)).toBe("2025-11-30");
    expect(boundaryIndex(plan, "2025-12-30")).toBeNull();
    expect(duePeriodRanges(plan, "2026-01-31").map((row) => row.startsOn)).toEqual(["2026-01-31"]);
  });

  it("rechaza fechas calendario imposibles", () => {
    for (const value of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-10-00", "14/10/2026"]) {
      expect(() => parseCalendarDate(value)).toThrow();
    }
    expect(parseCalendarDate("2024-02-29")).toBe("2024-02-29");
  });

  it("cambia de día según Buenos Aires y no según UTC", () => {
    expect(today(new Date("2026-10-15T02:59:59Z"))).toBe("2026-10-14");
    expect(today(new Date("2026-10-15T03:00:00Z"))).toBe("2026-10-15");
  });
});
