import { addDays, addMonths, duePeriodRanges, nextPeriodStart, today, type PlanCalendar } from "@/lib/calendar";
import type { Currency } from "@/lib/money";

export type PeriodPayment = { dueOn: string; paidAmountMinor: bigint | null; paidOn: string | null };
export type PeriodStatus = "pending" | "paid" | "overdue";
export const PERIOD_LABELS: Record<PeriodStatus, string> = { pending: "Pendiente", paid: "Pagado", overdue: "Vencido" };

export function getPeriodStatus(period: PeriodPayment, asOf: string = today()): PeriodStatus {
  if (period.paidAmountMinor !== null && period.paidOn !== null) return "paid";
  return period.dueOn < asOf ? "overdue" : "pending";
}

export function validateFullPayment(expectedAmount: bigint, paidAmount: bigint, paidOn: string, asOf: string = today()): void {
  if (paidAmount !== expectedAmount) throw new Error("El pago debe coincidir con el importe esperado. Ajustá el período si acordaste un descuento.");
  if (expectedAmount <= 0n) throw new Error("Un registro sin cargo no necesita un pago.");
  if (paidOn > asOf) throw new Error("La fecha de pago no puede ser futura.");
}

export type PriceVersion = { id: string; planId: string; amountMinor: bigint; effectiveFrom: string; effectiveDateKnown: boolean };
export function currentPrice(planId: string, prices: readonly PriceVersion[], asOf: string = today()): PriceVersion | undefined {
  return prices.filter((price) => price.planId === planId && price.effectiveFrom <= asOf)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
}

export function nextPlanDueDate(plan: PlanCalendar & { id: string }, periods: readonly (PeriodPayment & { planId: string })[], asOf: string = today()): string | null {
  const pending = periods.filter((period) => period.planId === plan.id && getPeriodStatus(period, asOf) !== "paid")
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0];
  return pending?.dueOn ?? nextPeriodStart(plan, asOf);
}

/** Snapshots the price that was effective at each period start, never today's price. */
export function preparePeriods(plan: PlanCalendar & { id: string }, prices: readonly PriceVersion[], asOf: string = today()) {
  return duePeriodRanges(plan, asOf).map((range) => {
    const price = currentPrice(plan.id, prices, range.startsOn);
    if (!price) throw new Error("Falta el precio inicial de un plan.");
    return { ...range, planId: plan.id, priceId: price.id, expectedAmountMinor: price.amountMinor };
  });
}

type ClientRow = { id: string; contactName: string; companyName: string | null };
type WebsiteRow = {
  id: string; clientId: string; name: string; currency: Currency; salePriceMinor: bigint | null;
  salePaymentTracked: boolean; saleDueOn: string | null; salePaidAmountMinor: bigint | null; salePaidOn: string | null;
};
type PlanRow = PlanCalendar & { id: string; websiteId: string; name: string; currency: Currency };
type PeriodRow = PeriodPayment & { id: string; planId: string; startsOn: string; endsOn: string; expectedAmountMinor: bigint };
type WorkRow = {
  id: string; websiteId: string; description: string; priceMinor: bigint | null; currency: Currency;
  dueOn: string | null; paidAmountMinor: bigint | null; paidOn: string | null; status: string;
};
type DomainRow = { id: string; websiteId: string; name: string; expiresOn: string; autoRenew: boolean; archivedAt?: Date | null };
export type DashboardSource = {
  clients: readonly ClientRow[]; websites: readonly WebsiteRow[]; plans: readonly PlanRow[];
  prices: readonly PriceVersion[]; periods: readonly PeriodRow[]; works: readonly WorkRow[]; domains: readonly DomainRow[];
};
export type FinancialRow = {
  id: string; source: "period" | "sale" | "work"; label: string; websiteId: string; websiteName: string;
  clientId: string; clientName: string; currency: Currency; amountMinor: bigint; dueOn: string | null; paidOn: string | null;
};
export type CurrencyTotals = Record<Currency, bigint>;
export function buildDashboard(data: DashboardSource, asOf: string = today()) {
  const debts: FinancialRow[] = [];
  const payments: FinancialRow[] = [];
  const totals: CurrencyTotals = { ARS: 0n, USD: 0n };
  const collected: CurrencyTotals = { ARS: 0n, USD: 0n };
  const overdue: CurrencyTotals = { ARS: 0n, USD: 0n };
  const clients = new Map(data.clients.map((client) => [client.id, client]));
  const websites = new Map(data.websites.map((website) => [website.id, website]));
  const plans = new Map(data.plans.map((plan) => [plan.id, plan]));
  const context = (websiteId: string) => {
    const website = websites.get(websiteId)!;
    const client = clients.get(website.clientId)!;
    return { websiteId, websiteName: website.name, clientId: client.id, clientName: client.companyName || client.contactName };
  };
  const push = (row: FinancialRow, paidAmount: bigint | null) => {
    if (paidAmount !== null && row.paidOn) payments.push({ ...row, amountMinor: paidAmount });
    else if (row.amountMinor > 0n) debts.push(row);
  };
  for (const period of data.periods) {
    const plan = plans.get(period.planId)!;
    push({ ...context(plan.websiteId), id: period.id, source: "period", label: plan.name,
      currency: plan.currency, amountMinor: period.expectedAmountMinor, dueOn: period.dueOn, paidOn: period.paidOn }, period.paidAmountMinor);
  }
  for (const website of data.websites) {
    if (website.salePaymentTracked && website.salePriceMinor !== null) push({ ...context(website.id), id: website.id,
      source: "sale", label: "Venta original", currency: website.currency, amountMinor: website.salePriceMinor,
      dueOn: website.saleDueOn, paidOn: website.salePaidOn }, website.salePaidAmountMinor);
  }
  for (const work of data.works) {
    if (work.priceMinor !== null && (work.status !== "cancelled" || work.paidOn !== null)) push({ ...context(work.websiteId),
      id: work.id, source: "work", label: work.description, currency: work.currency, amountMinor: work.priceMinor,
      dueOn: work.dueOn, paidOn: work.paidOn }, work.paidAmountMinor);
  }
  for (const row of debts) {
    totals[row.currency] += row.amountMinor;
    if (row.dueOn && row.dueOn < asOf) overdue[row.currency] += row.amountMinor;
  }
  for (const row of payments) {
    if (row.paidOn!.slice(0, 7) === asOf.slice(0, 7)) collected[row.currency] += row.amountMinor;
  }
  debts.sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"));
  payments.sort((a, b) => b.paidOn!.localeCompare(a.paidOn!));
  const upcoming = data.plans.flatMap((plan) => {
    const projected = nextPeriodStart(plan, asOf);
    const dates = new Set(data.periods.filter((period) => period.planId === plan.id && !period.paidOn &&
      period.dueOn >= asOf && period.dueOn <= addDays(asOf, 7)).map((period) => period.dueOn));
    if (projected && projected <= addDays(asOf, 7)) dates.add(projected);
    return [...dates].flatMap((dueOn) => {
      const existing = data.periods.find((period) => period.planId === plan.id && period.dueOn === dueOn);
      if (existing?.paidOn) return [];
      const price = currentPrice(plan.id, data.prices, dueOn);
      if (!price) return [];
      return [{ ...context(plan.websiteId), planId: plan.id, label: plan.name, dueOn, currency: plan.currency,
        amountMinor: existing?.expectedAmountMinor ?? price.amountMinor, projected: !existing }];
    });
  }).sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const expiringDomains = data.domains.filter((domain) => !domain.archivedAt && domain.expiresOn <= addDays(asOf, 30))
    .map((domain) => ({ ...domain, ...context(domain.websiteId) })).sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
  const stalePlans = data.plans.flatMap((plan) => {
    if (plan.endedOn && plan.endedOn <= asOf) return [];
    const price = currentPrice(plan.id, data.prices, asOf);
    if (!price?.effectiveDateKnown || price.effectiveFrom > addMonths(asOf, -6)) return [];
    return [{ ...context(plan.websiteId), plan, price }];
  }).sort((a, b) => a.price.effectiveFrom.localeCompare(b.price.effectiveFrom));
  return { debts, payments, totals, collected, overdue, upcoming, expiringDomains, stalePlans };
}
