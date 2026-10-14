import { describe, expect, it } from "vitest";
import { buildDashboard, currentPrice, getPeriodStatus, nextPlanDueDate, preparePeriods, validateFullPayment, type DashboardSource } from "@/lib/billing";

const plan = { id: "plan", websiteId: "web", name: "Hosting y mantenimiento", frequencyMonths: 1, currency: "ARS" as const,
  billingStart: "2026-01-31", anchorDay: 31, endedOn: null };
const prices = [
  { id: "old", planId: "plan", amountMinor: 1_800_000n, effectiveFrom: "2026-01-31", effectiveDateKnown: true },
  { id: "new", planId: "plan", amountMinor: 2_500_000n, effectiveFrom: "2026-07-31", effectiveDateKnown: true },
];

function fixture(): DashboardSource {
  return {
    clients: [{ id: "client", contactName: "Ana", companyName: null }],
    websites: [{ id: "web", clientId: "client", name: "Estudio", currency: "ARS", salePriceMinor: 500_000n,
      salePaymentTracked: true, saleDueOn: "2026-09-01", salePaidAmountMinor: 500_000n, salePaidOn: "2026-10-04" }],
    plans: [plan], prices,
    periods: [
      { id: "late", planId: "plan", startsOn: "2026-08-31", endsOn: "2026-09-30", dueOn: "2026-08-31", expectedAmountMinor: 2_500_000n, paidAmountMinor: null, paidOn: null },
      { id: "paid", planId: "plan", startsOn: "2026-09-30", endsOn: "2026-10-31", dueOn: "2026-09-30", expectedAmountMinor: 2_500_000n, paidAmountMinor: 2_500_000n, paidOn: "2026-10-03" },
    ],
    works: [{ id: "work", websiteId: "web", description: "Página adicional", priceMinor: 100_000n, currency: "USD", dueOn: null, paidAmountMinor: 100_000n, paidOn: "2026-10-07", status: "completed" }],
    domains: [{ id: "domain", websiteId: "web", name: "estudio.com", expiresOn: "2026-10-10", autoRenew: true }],
  };
}

describe("períodos y pagos directos", () => {
  it("vencimiento de hoy pendiente, ayer vencido, pago tardío pagado", () => {
    const row = { dueOn: "2026-10-14", paidAmountMinor: null, paidOn: null };
    expect(getPeriodStatus(row, "2026-10-14")).toBe("pending");
    expect(getPeriodStatus(row, "2026-10-15")).toBe("overdue");
    expect(getPeriodStatus({ ...row, paidAmountMinor: 1_000n, paidOn: "2026-10-16" }, "2026-10-17")).toBe("paid");
  });
  it("cada período captura el precio vigente en su inicio", () => {
    const periods = preparePeriods(plan, prices, "2026-08-14");
    expect(periods.find((period) => period.startsOn === "2026-06-30")!.expectedAmountMinor).toBe(1_800_000n);
    expect(periods.find((period) => period.startsOn === "2026-07-31")!.expectedAmountMinor).toBe(2_500_000n);
    expect(currentPrice("plan", prices, "2026-10-14")!.id).toBe("new");
    expect(prices[0]!.amountMinor).toBe(1_800_000n);
  });
  it("no inventa una tarifa cuando falta la versión inicial", () => {
    expect(() => preparePeriods(plan, [prices[1]!], "2026-10-14")).toThrow("precio inicial");
  });
  it("no oculta deuda antigua porque esté pagado un período posterior", () => {
    expect(nextPlanDueDate(plan, fixture().periods, "2026-10-14")).toBe("2026-08-31");
  });
  it("admite solamente el pago completo y una fecha real no futura", () => {
    expect(() => validateFullPayment(10_800_000n, 10_800_000n, "2026-10-03", "2026-10-14")).not.toThrow();
    expect(() => validateFullPayment(10_800_000n, 5_400_000n, "2026-10-03", "2026-10-14")).toThrow("coincidir");
    expect(() => validateFullPayment(10_800_000n, 10_800_000n, "2026-10-15", "2026-10-14")).toThrow("futura");
  });
});

describe("dashboard desde fechas e importes reales", () => {
  it("suma tres fuentes de cobro por fecha de pago y mantiene monedas separadas", () => {
    const result = buildDashboard(fixture(), "2026-10-14");
    expect(result.collected).toEqual({ ARS: 3_000_000n, USD: 100_000n });
    expect(result.totals).toEqual({ ARS: 2_500_000n, USD: 0n });
    expect(result.overdue).toEqual({ ARS: 2_500_000n, USD: 0n });
    expect(result.payments.map((payment) => payment.id)).toEqual(["work", "web", "paid"]);
    expect(result.expiringDomains).toHaveLength(1); // Auto-renew does not confirm a renewal.
  });
  it("no convierte venta sin seguimiento, precio desconocido o trabajo gratuito en deuda", () => {
    const data = fixture();
    data.websites = data.websites.map((web) => ({ ...web, salePaymentTracked: false, salePaidOn: null, salePaidAmountMinor: null }));
    data.works = [
      { ...data.works[0]!, id: "unknown", priceMinor: null, paidOn: null, paidAmountMinor: null },
      { ...data.works[0]!, id: "free", priceMinor: 0n, paidOn: null, paidAmountMinor: null },
      { ...data.works[0]!, id: "cancelled", status: "cancelled", paidOn: null, paidAmountMinor: null },
    ];
    expect(buildDashboard(data, "2026-10-14").debts.map((row) => row.id)).toEqual(["late"]);
  });
  it("corregir la fecha mueve el cobro al mes correspondiente", () => {
    const data = fixture();
    data.periods = data.periods.map((row) => row.id === "paid" ? { ...row, paidOn: "2026-09-30" } : row);
    expect(buildDashboard(data, "2026-10-14").collected.ARS).toBe(500_000n);
  });
  it("muestra el próximo cobro aunque exista deuda anterior", () => {
    const result = buildDashboard(fixture(), "2026-10-28");
    expect(result.upcoming[0]!.dueOn).toBe("2026-10-31");
    expect(result.upcoming[0]!.projected).toBe(true);
  });
  it("no inventa antigüedad cuando la fecha de precio es desconocida", () => {
    const data = fixture();
    data.prices = data.prices.map((price) => ({ ...price, effectiveDateKnown: false }));
    expect(buildDashboard(data, "2027-10-14").stalePlans).toHaveLength(0);
  });
});
