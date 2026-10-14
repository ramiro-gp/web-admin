import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { buildDashboard } from "@/lib/billing";
import { periodBoundary } from "@/lib/calendar";

const mocked = vi.hoisted(() => ({ db: undefined as unknown, authorize: vi.fn(async () => undefined), revalidate: vi.fn() }));
vi.mock("@/db", () => ({ getDb: () => mocked.db }));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocked.authorize }));
vi.mock("next/cache", () => ({ revalidatePath: mocked.revalidate }));
vi.mock("@/lib/calendar", async (original) => ({ ...await original<typeof import("@/lib/calendar")>(), today: () => "2026-10-14" }));

import { addHistoricalPeriod, adjustPeriod, clearPeriodPayment, clearWorkPayment, endPlan, renewDomain, savePeriodPayment, savePlan, saveSalePayment, saveWebsite, saveWork, saveWorkPayment, schedulePrice, syncPeriods } from "@/server/actions";
import { getWorkspace } from "@/server/queries";

let pg: PGlite;
const ids = {
  client: "20000000-0000-4000-8000-000000000001", type: "20000000-0000-4000-8000-000000000002",
  website: "20000000-0000-4000-8000-000000000003", plan: "20000000-0000-4000-8000-000000000004",
  price: "20000000-0000-4000-8000-000000000005", domain: "20000000-0000-4000-8000-000000000006",
};
function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeAll(async () => {
  pg = new PGlite();
  mocked.db = drizzle(pg, { schema });
  await migrate(drizzle(pg), { migrationsFolder: "./drizzle" });
}, 30_000);

beforeEach(async () => {
  vi.clearAllMocks();
  await pg.exec("TRUNCATE clients,site_types CASCADE;");
  await pg.query("INSERT INTO clients(id,contact_name,active) VALUES($1,'Ana',false)", [ids.client]);
  await pg.query("INSERT INTO site_types(id,name) VALUES($1,'Institucional')", [ids.type]);
  await pg.query("INSERT INTO websites(id,client_id,site_type_id,name) VALUES($1,$2,$3,'Estudio')", [ids.website, ids.client, ids.type]);
  await pg.query("INSERT INTO plans(id,website_id,name,frequency_months,billing_start,anchor_day) VALUES($1,$2,'Mantenimiento',1,'2026-01-31',31)", [ids.plan, ids.website]);
  await pg.query("INSERT INTO plan_prices(id,plan_id,amount_minor,effective_from) VALUES($1,$2,1800000,'2026-01-31')", [ids.price, ids.plan]);
  await pg.query("INSERT INTO domains(id,website_id,name,registrar,expires_on,auto_renew) VALUES($1,$2,'estudio.com','Registrador','2026-10-31',true)", [ids.domain, ids.website]);
});
afterAll(async () => { await pg?.close(); });

describe("acciones de negocio contra PostgreSQL", () => {
  it("genera períodos repetidamente sin duplicar y mantiene deuda de clientes inactivos", async () => {
    expect(await syncPeriods()).toEqual({ ok: true });
    expect(await syncPeriods()).toEqual({ ok: true });
    const result = await pg.query<{ count: number; last: string }>("SELECT count(*)::integer AS count, max(starts_on)::text AS last FROM billing_periods");
    expect(result.rows[0]).toEqual({ count: 9, last: "2026-09-30" });
    expect(mocked.authorize).toHaveBeenCalledTimes(2);
  });

  it("las lecturas privadas no crean períodos ni escriben datos", async () => {
    const workspace = await getWorkspace();
    expect(workspace.plans).toHaveLength(1);
    expect(workspace.periods).toHaveLength(0);
    expect(mocked.authorize).toHaveBeenCalled();
    expect((await pg.query<{ count: number }>("SELECT count(*)::integer AS count FROM billing_periods")).rows[0]?.count).toBe(0);
  });

  it("programa el aumento futuro conservando todos los períodos previos", async () => {
    const result = await schedulePrice({}, form({ planId: ids.plan, amount: "25000", effectiveFrom: "2026-10-31" }));
    expect(result.success).toBeDefined();
    const prices = await pg.query<{ amount: string; effective: string }>("SELECT amount_minor::text AS amount,effective_from::text AS effective FROM plan_prices ORDER BY effective_from");
    expect(prices.rows).toEqual([{ amount: "1800000", effective: "2026-01-31" }, { amount: "2500000", effective: "2026-10-31" }]);
    const periods = await pg.query<{ total: string }>("SELECT sum(expected_amount_minor)::text AS total FROM billing_periods");
    expect(periods.rows[0]?.total).toBe("16200000");
    expect(await syncPeriods()).toEqual({ ok: true });
  });

  it("rechaza pago parcial, registra uno completo y permite corregir su fecha o quitarlo", async () => {
    await syncPeriods();
    const [period] = (await pg.query<{ id: string }>("SELECT id FROM billing_periods ORDER BY starts_on LIMIT 1")).rows;
    const partial = await savePeriodPayment({}, form({ periodId: period!.id, amount: "9000", paidOn: "2026-02-03" }));
    expect(partial.error).toContain("coincidir");
    expect((await savePeriodPayment({}, form({ periodId: period!.id, amount: "18000", paidOn: "2026-02-03" }))).success).toBeDefined();
    expect((await savePeriodPayment({}, form({ periodId: period!.id, amount: "18000", paidOn: "2026-03-01" }))).success).toBeDefined();
    const paid = await pg.query<{ starts: string; paid: string }>("SELECT starts_on::text AS starts,paid_on::text AS paid FROM billing_periods WHERE id=$1", [period!.id]);
    expect(paid.rows[0]).toEqual({ starts: "2026-01-31", paid: "2026-03-01" });
    expect((await clearPeriodPayment({}, form({ periodId: period!.id }))).success).toBeDefined();
    expect((await pg.query<{ paid: string | null }>("SELECT paid_on AS paid FROM billing_periods WHERE id=$1", [period!.id])).rows[0]?.paid).toBeNull();
  });

  it("ajusta un período impago con nota sin sobrescribir el precio histórico", async () => {
    await syncPeriods();
    const [period] = (await pg.query<{ id: string }>("SELECT id FROM billing_periods ORDER BY starts_on LIMIT 1")).rows;
    expect((await adjustPeriod({}, form({ periodId: period!.id, amount: "15000", notes: "Descuento excepcional" }))).success).toBeDefined();
    const price = await pg.query<{ amount: string }>("SELECT amount_minor::text AS amount FROM plan_prices WHERE id=$1", [ids.price]);
    expect(price.rows[0]?.amount).toBe("1800000");
    expect((await savePeriodPayment({}, form({ periodId: period!.id, amount: "15000", paidOn: "2026-02-03" }))).success).toBeDefined();
    expect((await adjustPeriod({}, form({ periodId: period!.id, amount: "14000", notes: "Otro descuento" }))).error).toContain("Quitá el pago");
  });

  it("rechaza fechas imposibles y futuras sin modificar pagos", async () => {
    await syncPeriods();
    const [period] = (await pg.query<{ id: string }>("SELECT id FROM billing_periods ORDER BY starts_on LIMIT 1")).rows;
    expect((await savePeriodPayment({}, form({ periodId: period!.id, amount: "18000", paidOn: "2026-02-30" }))).error).toBeDefined();
    expect((await savePeriodPayment({}, form({ periodId: period!.id, amount: "18000", paidOn: "2026-10-15" }))).error).toContain("futura");
  });

  it("renueva el dominio conservando su fecha anterior sin tocar períodos", async () => {
    await syncPeriods();
    const result = await renewDomain({}, form({ domainId: ids.domain, renewedOn: "2026-10-14", newExpiresOn: "2027-10-31", notes: "Renovado" }));
    expect(result.success).toBeDefined();
    const renewal = await pg.query<{ old: string; next: string }>("SELECT previous_expires_on::text AS old,new_expires_on::text AS next FROM domain_renewals");
    expect(renewal.rows[0]).toEqual({ old: "2026-10-31", next: "2027-10-31" });
    const resultPeriod = await pg.query<{ count: number }>("SELECT count(*)::integer AS count FROM billing_periods WHERE paid_on IS NOT NULL");
    expect(resultPeriod.rows[0]?.count).toBe(0);
  });

  it("gratuito, sin definir y cancelado no aceptan pagos ficticios", async () => {
    for (const [price, status] of [["0", "requested"], ["", "requested"], ["1000", "cancelled"]]) {
      const result = await saveWork({}, form({ websiteId: ids.website, description: `Ajuste ${status} ${price}`, requestedOn: "2026-10-01", price: price!, status: status!, currency: "ARS" }));
      expect(result.success).toBeDefined();
      const [work] = (await pg.query<{ id: string }>("SELECT id FROM additional_works ORDER BY created_at DESC LIMIT 1")).rows;
      expect((await saveWorkPayment({}, form({ workId: work!.id, amount: "1000", paidOn: "2026-10-14" }))).error).toBeDefined();
    }
  });

  it("finaliza en un límite y admite un sucesor que conserva ancla 31", async () => {
    expect((await endPlan({}, form({ planId: ids.plan, endedOn: "2026-10-31" }))).success).toBeDefined();
    const result = await savePlan({}, form({ websiteId: ids.website, name: "Plan semestral", frequencyMonths: "6", currency: "ARS",
      billingStart: "2026-10-31", anchorDay: "31", amount: "108000", effectiveDateKnown: "on", hostingIncluded: "on" }));
    expect(result.success).toBeDefined();
    const rows = await pg.query<{ count: number }>("SELECT count(*)::integer AS count FROM plans");
    expect(rows.rows[0]?.count).toBe(2);
  });

  it("propaga el rechazo de autorización antes de ejecutar una operación", async () => {
    mocked.authorize.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(schedulePrice({}, form({ planId: ids.plan, amount: "25000" }))).rejects.toThrow("NEXT_REDIRECT");
    const result = await pg.query<{ count: number }>("SELECT count(*)::integer AS count FROM billing_periods");
    expect(result.rows[0]?.count).toBe(0);
  });

  it("carga un período histórico conocido sin cambiar el corte ni inventar precios", async () => {
    const result = await addHistoricalPeriod({}, form({ planId: ids.plan, startsOn: "2025-12-31", amount: "17500",
      paidOn: "2026-01-03", notes: "Comprobante anterior al uso de la aplicación" }));
    expect(result.success).toBeDefined();
    expect(await syncPeriods()).toEqual({ ok: true });
    const history = await pg.query<{ starts: string; ends: string; amount: string; paid: string; price: string | null }>(
      "SELECT starts_on::text AS starts,ends_on::text AS ends,expected_amount_minor::text AS amount,paid_on::text AS paid,price_id AS price FROM billing_periods WHERE starts_on < '2026-01-31'");
    expect(history.rows).toEqual([{ starts: "2025-12-31", ends: "2026-01-31", amount: "1750000", paid: "2026-01-03", price: null }]);
    const plan = await pg.query<{ cut: string }>("SELECT billing_start::text AS cut FROM plans WHERE id=$1", [ids.plan]);
    expect(plan.rows[0]?.cut).toBe("2026-01-31");
    const prices = await pg.query<{ count: number }>("SELECT count(*)::integer AS count FROM plan_prices");
    expect(prices.rows[0]?.count).toBe(1);
  });

  it("exige inicio histórico válido, nota e importe explícito", async () => {
    for (const values of [
      { startsOn: "2026-01-31", amount: "17500", notes: "No es histórico" },
      { startsOn: "2025-12-30", amount: "17500", notes: "No coincide con ancla" },
      { startsOn: "2025-12-31", amount: "17500", notes: "" },
      { startsOn: "2025-12-31", amount: "", notes: "Importe desconocido" },
    ]) expect((await addHistoricalPeriod({}, form({ planId: ids.plan, ...values }))).error).toBeDefined();
    const result = await pg.query<{ count: number }>("SELECT count(*)::integer AS count FROM billing_periods");
    expect(result.rows[0]?.count).toBe(0);
  });

  it("registra las tres fuentes y calcula caja mediante sus fechas efectivas", async () => {
    expect((await saveWebsite({}, form({ id: ids.website, clientId: ids.client, siteTypeId: ids.type, name: "Estudio",
      salePrice: "300000", salePaymentTracked: "on", currency: "ARS", soldOn: "2026-09-01", saleDueOn: "2026-09-01" }))).success).toBeDefined();
    expect((await saveSalePayment({}, form({ websiteId: ids.website, amount: "300000", paidOn: "2026-10-04" }))).success).toBeDefined();
    expect((await saveWork({}, form({ websiteId: ids.website, description: "Página extra", requestedOn: "2026-10-01", status: "requested", price: "100", currency: "USD" }))).success).toBeDefined();
    const [work] = (await pg.query<{ id: string }>("SELECT id FROM additional_works")).rows;
    expect((await saveWorkPayment({}, form({ workId: work!.id, amount: "100", paidOn: "2026-10-07" }))).success).toBeDefined();
    await syncPeriods();
    const [period] = (await pg.query<{ id: string }>("SELECT id FROM billing_periods WHERE starts_on='2026-09-30'")).rows;
    expect((await savePeriodPayment({}, form({ periodId: period!.id, amount: "18000", paidOn: "2026-10-03" }))).success).toBeDefined();
    const dashboard = buildDashboard(await getWorkspace(), "2026-10-14");
    expect(dashboard.collected).toEqual({ ARS: 31_800_000n, USD: 10_000n });
    expect(dashboard.payments.map((row) => row.source)).toEqual(["work", "sale", "period"]);
    expect(dashboard.debts.filter((row) => row.source !== "period")).toEqual([]);
  });

  it("conserva y permite corregir un pago existente de un trabajo después cancelado", async () => {
    await saveWork({}, form({ websiteId: ids.website, description: "Página cancelada", requestedOn: "2026-10-01", status: "requested", price: "100", currency: "ARS" }));
    const [work] = (await pg.query<{ id: string }>("SELECT id FROM additional_works")).rows;
    expect((await saveWorkPayment({}, form({ workId: work!.id, amount: "100", paidOn: "2026-10-07" }))).success).toBeDefined();
    expect((await saveWork({}, form({ id: work!.id, websiteId: ids.website, description: "Página cancelada", requestedOn: "2026-10-01", status: "cancelled", price: "100", currency: "ARS" }))).success).toBeDefined();
    expect((await saveWorkPayment({}, form({ workId: work!.id, amount: "100", paidOn: "2026-10-06" }))).success).toBeDefined();
    expect(buildDashboard(await getWorkspace(), "2026-10-14").collected.ARS).toBe(10_000n);
    expect((await clearWorkPayment({}, form({ workId: work!.id }))).success).toBeDefined();
    const dashboard = buildDashboard(await getWorkspace(), "2026-10-14");
    expect(dashboard.collected.ARS).toBe(0n);
    expect(dashboard.debts).toEqual([]);
  });

  it.each([29, 30, 31])("crea un sucesor sin solapar el inicio histórico y conserva el ancla %i", async (anchor) => {
    const day = String(anchor).padStart(2, "0");
    const originalStart = `2025-12-${day}`;
    const cut = `2026-01-${day}`;
    const endedOn = `2026-10-${day}`;
    await pg.query("UPDATE plans SET started_on=$1,billing_start=$2,anchor_day=$3 WHERE id=$4", [originalStart, cut, anchor, ids.plan]);
    await pg.query("UPDATE plan_prices SET effective_from=$1 WHERE id=$2", [cut, ids.price]);
    expect((await endPlan({}, form({ planId: ids.plan, endedOn }))).success).toBeDefined();
    const values = { websiteId: ids.website, name: "Contrato sucesor", frequencyMonths: "1", currency: "ARS",
      billingStart: endedOn, anchorDay: day, amount: "25000", effectiveDateKnown: "on" };
    const invalid = await savePlan({}, form({ ...values, startedOn: originalStart }));
    expect(invalid.error).toContain("inicio del nuevo contrato");
    expect((await savePlan({}, form({ ...values, startedOn: endedOn }))).success).toBeDefined();
    const [successor] = (await pg.query<{ startedOn: string; billingStart: string; anchorDay: number; frequencyMonths: number }>(
      'SELECT started_on::text AS "startedOn",billing_start::text AS "billingStart",anchor_day AS "anchorDay",frequency_months AS "frequencyMonths" FROM plans WHERE name=$1', ["Contrato sucesor"])).rows;
    expect(successor?.startedOn).toBe(endedOn);
    expect(successor?.anchorDay).toBe(anchor);
    expect(periodBoundary(successor!, 4)).toBe("2027-02-28");
    expect(periodBoundary(successor!, 5)).toBe(`2027-03-${day}`);
  });

  it("un sucesor que comienza el 28 de febrero recupera marzo 31 al emitir sus períodos", async () => {
    await pg.query("UPDATE plans SET started_on='2026-01-31',ended_on='2026-02-28' WHERE id=$1", [ids.plan]);
    const values = { websiteId: ids.website, name: "Sucesor en febrero", frequencyMonths: "1", currency: "ARS",
      billingStart: "2026-02-28", anchorDay: "31", amount: "25000", effectiveDateKnown: "on" };
    expect((await savePlan({}, form({ ...values, startedOn: "2026-01-31" }))).error).toContain("inicio del nuevo contrato");
    expect((await savePlan({}, form({ ...values, startedOn: "2026-02-28" }))).success).toBeDefined();
    expect(await syncPeriods()).toEqual({ ok: true });
    const periods = await pg.query<{ start: string; end: string }>(
      "SELECT starts_on::text AS start,ends_on::text AS end FROM billing_periods WHERE plan_id != $1 ORDER BY starts_on LIMIT 2", [ids.plan]);
    expect(periods.rows).toEqual([{ start: "2026-02-28", end: "2026-03-31" }, { start: "2026-03-31", end: "2026-04-30" }]);
  });

  it.each([true, false])("seguimiento de venta %s determina si un sitio sin otros antecedentes conserva su dueño", async (tracked) => {
    const otherClientId = "40000000-0000-4000-8000-000000000001";
    await pg.query("INSERT INTO clients(id,contact_name) VALUES($1,'Beto')", [otherClientId]);
    const values = { clientId: ids.client, siteTypeId: ids.type, name: "Sitio sin planes ni trabajos", salePrice: "1000",
      currency: "ARS", salePaymentTracked: tracked ? "on" : "" };
    expect((await saveWebsite({}, form(values))).success).toBeDefined();
    const [website] = (await pg.query<{ id: string }>("SELECT id FROM websites WHERE name=$1", [values.name])).rows;
    const change = await saveWebsite({}, form({ ...values, id: website!.id, clientId: otherClientId }));
    if (tracked) expect(change.error).toContain("No se puede trasladar su deuda");
    else expect(change.success).toBeDefined();
    const [stored] = (await pg.query<{ clientId: string; paidOn: string | null }>(
      'SELECT client_id AS "clientId",sale_paid_on AS "paidOn" FROM websites WHERE id=$1', [website!.id])).rows;
    expect(stored?.clientId).toBe(tracked ? ids.client : otherClientId);
    expect(stored?.paidOn).toBeNull();
  });
});
