"use server";

import { domainToASCII } from "node:url";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, type Database } from "@/db";
import { additionalWorks, billingPeriods, clients, domainRenewals, domains, planDomains, planPrices, plans, siteTypes, websites } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { preparePeriods, validateFullPayment } from "@/lib/billing";
import { boundaryIndex, nextPeriodStart, parseCalendarDate, periodBoundary, today } from "@/lib/calendar";
import { parseMoney } from "@/lib/money";
import type { ActionState } from "@/server/action-state";

z.config(z.locales.es());

class InputError extends Error {}
const required = z.string().trim().min(1, "Este campo es obligatorio.").max(200, "Usá hasta 200 caracteres.");
const notes = z.string().trim().max(5000, "Usá hasta 5000 caracteres.").transform((value) => value || null);
const optionalText = z.string().trim().max(200).transform((value) => value || null);
const uuid = z.uuid("El identificador no es válido.");
const optionalId = z.union([uuid, z.literal("")]).transform((value) => value || undefined);
const date = z.string().refine((value) => {
  try { parseCalendarDate(value); return true; } catch { return false; }
}, "Ingresá una fecha válida.");
const optionalDate = z.union([date, z.literal("")]).transform((value) => value || null);
const currency = z.enum(["ARS", "USD"], "Elegí ARS o USD.");
const amount = z.string().transform((value, context) => {
  try { return parseMoney(value); } catch {
    context.addIssue({ code: "custom", message: "Ingresá un importe válido, sin miles y con hasta dos decimales." });
    return z.NEVER;
  }
});
const positiveAmount = amount.refine((value) => value > 0n, "El importe debe ser mayor a cero.");
const optionalAmount = z.union([z.literal("").transform(() => null), amount]);

function field(form: FormData, name: string, ...aliases: string[]): string {
  for (const candidate of [name, ...aliases]) {
    const value = form.get(candidate);
    if (typeof value === "string") return value;
  }
  return "";
}
function checked(form: FormData, name: string): boolean { return ["on", "true", "1"].includes(field(form, name)); }
function common(form: FormData) { return { id: field(form, "id"), notes: field(form, "notes") }; }
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new InputError(message);
}
function paymentDateValid(paidOn: string) { assert(paidOn <= today(), "La fecha de pago no puede ser futura."); }
function validatePayment(expected: bigint, paid: bigint, paidOn: string) {
  try { validateFullPayment(expected, paid, paidOn); } catch (error) {
    throw new InputError(error instanceof Error ? error.message : "El pago no es válido.");
  }
}

function actionError(error: unknown): ActionState {
  if (error instanceof z.ZodError) {
    const names: Record<string, string> = { amountMinor: "amount", paidAmountMinor: "amount", expectedAmountMinor: "amount", salePriceMinor: "salePrice", priceMinor: "price" };
    const errors = z.flattenError(error).fieldErrors;
    const fieldErrors: Record<string, string[]> = {};
    for (const [name, messages] of Object.entries(errors)) {
      if (Array.isArray(messages)) fieldErrors[names[name] ?? name] = messages.filter((message): message is string => typeof message === "string");
    }
    return { error: "Revisá los campos indicados.", fieldErrors };
  }
  if (error instanceof InputError) return { error: error.message };
  const sqlCode = typeof error === "object" && error !== null && "cause" in error
    ? (error.cause as { code?: string } | undefined)?.code
    : (error as { code?: string } | null)?.code;
  if (sqlCode === "23505") return { error: "Ya existe un registro con esos datos. Actualizá la pantalla y revisá el historial." };
  if (sqlCode === "23503") return { error: "No se encontró el registro relacionado. Actualizá la pantalla." };
  if (["23514", "23P01", "P0001"].includes(sqlCode ?? "")) return { error: "La operación contradice el calendario o el historial existente. Revisá los datos." };
  return { error: "No se pudo guardar. Revisá la conexión e intentá nuevamente." };
}

async function runAction(operation: () => Promise<void>, message: string): Promise<ActionState> {
  // Outside the catch: Next redirect errors from missing/expired sessions must propagate.
  await requireAdmin();
  try {
    await operation();
    revalidatePath("/", "layout");
    return { success: message };
  } catch (error) { return actionError(error); }
}

type Executor = Pick<Database, "select" | "insert" | "update" | "delete">;
async function synchronizePeriods(db: Executor, asOf = today()): Promise<void> {
  const [planRows, prices] = await Promise.all([db.select().from(plans), db.select().from(planPrices)]);
  for (const plan of planRows) {
    let values: ReturnType<typeof preparePeriods>;
    try { values = preparePeriods(plan, prices, asOf); } catch {
      throw new InputError("Falta el precio inicial de un plan. Revisá su historial antes de generar períodos.");
    }
    if (values.length) await db.insert(billingPeriods).values(values)
      .onConflictDoNothing({ target: [billingPeriods.planId, billingPeriods.startsOn] });
  }
}

export async function syncPeriods(): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  try {
    await getDb().transaction((tx) => synchronizePeriods(tx));
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) { return { ok: false, error: actionError(error).error }; }
}

export async function saveClient(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const input = z.object({ id: optionalId, contactName: required, companyName: optionalText, phone: optionalText,
      email: z.union([z.email("El email no es válido."), z.literal("")]).transform((value) => value || null), notes,
      active: z.boolean(),
    }).parse({ ...common(form), contactName: field(form, "contactName"), companyName: field(form, "companyName"),
      phone: field(form, "phone"), email: field(form, "email").trim(), active: checked(form, "active") });
    const { id, ...values } = input;
    if (id) {
      const rows = await getDb().update(clients).set({ ...values, updatedAt: new Date() }).where(eq(clients.id, id)).returning({ id: clients.id });
      assert(rows.length, "No se encontró el cliente.");
    } else await getDb().insert(clients).values(values);
  }, "Cliente guardado.");
}

export async function saveSiteType(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const input = z.object({ id: optionalId, name: required, active: z.boolean() }).parse({
      id: field(form, "id"), name: field(form, "name"), active: checked(form, "active"),
    });
    if (input.id) {
      const rows = await getDb().update(siteTypes).set({ name: input.name, active: input.active })
        .where(eq(siteTypes.id, input.id)).returning({ id: siteTypes.id });
      assert(rows.length, "No se encontró el tipo de sitio.");
    } else await getDb().insert(siteTypes).values({ name: input.name, active: input.active });
  }, "Tipo de sitio guardado.");
}

export async function saveWebsite(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const input = z.object({ id: optionalId, clientId: uuid, siteTypeId: uuid, name: required,
      url: z.union([z.url("Ingresá la URL completa, por ejemplo https://ejemplo.com."), z.literal("")])
        .refine((value) => !value || /^https?:\/\//.test(value), "Usá una URL http o https.").transform((value) => value || null),
      description: notes, projectNotes: notes, soldOn: optionalDate, salePriceMinor: optionalAmount, currency,
      salePaymentTracked: z.boolean(), saleDueOn: optionalDate,
    }).parse({ id: field(form, "id"), clientId: field(form, "clientId"), siteTypeId: field(form, "siteTypeId"), name: field(form, "name"),
      url: field(form, "url").trim(), description: field(form, "description"), projectNotes: field(form, "projectNotes"),
      soldOn: field(form, "soldOn"), salePriceMinor: field(form, "salePrice", "salePriceMinor"), currency: field(form, "currency") || "ARS",
      salePaymentTracked: checked(form, "salePaymentTracked"), saleDueOn: field(form, "saleDueOn") });
    assert(!input.salePaymentTracked || (input.salePriceMinor !== null && input.salePriceMinor > 0n), "Para seguir el cobro, indicá un precio de venta mayor a cero.");
    assert(input.salePaymentTracked || !input.saleDueOn, "Activá el seguimiento de cobro para indicar un vencimiento.");
    const { id, ...values } = input;
    await getDb().transaction(async (tx) => {
      if (!id) { await tx.insert(websites).values(values); return; }
      const [existing] = await tx.select().from(websites).where(eq(websites.id, id));
      assert(existing, "No se encontró el sitio.");
      if (existing.clientId !== input.clientId) {
        assert(!existing.salePaymentTracked, "Una venta con seguimiento de cobro conserva su cliente. No se puede trasladar su deuda.");
      }
      if (existing.clientId !== input.clientId || existing.currency !== input.currency) {
        const [sitePlans, siteWorks] = await Promise.all([
          tx.select({ id: plans.id }).from(plans).where(eq(plans.websiteId, id)).limit(1),
          tx.select({ id: additionalWorks.id }).from(additionalWorks).where(eq(additionalWorks.websiteId, id)).limit(1),
        ]);
        assert(!sitePlans.length && !siteWorks.length && !existing.salePaidOn, "No se puede cambiar el cliente o moneda de un sitio con historial.");
      }
      if (existing.salePaidOn) {
        assert(values.salePriceMinor === existing.salePriceMinor && values.currency === existing.currency, "Quitá el pago de venta antes de corregir su importe.");
        assert(values.salePaymentTracked, "Quitá el pago antes de desactivar su seguimiento.");
      }
      await tx.update(websites).set({ ...values, updatedAt: new Date() }).where(eq(websites.id, id));
    });
  }, "Sitio guardado.");
}

export async function archiveWebsite(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const id = uuid.parse(field(form, "websiteId", "id"));
    const rows = await getDb().update(websites).set({ archivedAt: checked(form, "restore") ? null : new Date(), updatedAt: new Date() })
      .where(eq(websites.id, id)).returning({ id: websites.id });
    assert(rows.length, "No se encontró el sitio.");
  }, "Estado del sitio actualizado. Sus planes y pagos se conservan.");
}

export async function savePlan(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const input = z.object({ id: optionalId, websiteId: uuid, name: required,
      frequencyMonths: z.coerce.number().refine((value) => [1, 6, 12].includes(value), "Elegí frecuencia mensual, semestral o anual."),
      currency, startedOn: optionalDate, billingStart: date, anchorDay: z.coerce.number().int().min(1).max(31),
      hostingIncluded: z.boolean(), maintenanceIncluded: z.boolean(), notes,
    }).parse({ ...common(form), websiteId: field(form, "websiteId"), name: field(form, "name"),
      frequencyMonths: field(form, "frequencyMonths"), currency: field(form, "currency") || "ARS", startedOn: field(form, "startedOn"),
      billingStart: field(form, "billingStart"), anchorDay: field(form, "anchorDay") || field(form, "billingStart").slice(-2),
      hostingIncluded: checked(form, "hostingIncluded"), maintenanceIncluded: checked(form, "maintenanceIncluded") });
    assert(periodBoundary(input, 0) === input.billingStart, "El inicio del primer período debe coincidir con el día ancla.");
    assert(!input.startedOn || input.startedOn <= input.billingStart, "El inicio histórico no puede ser posterior al primer período administrado.");
    const includedDomains = z.array(uuid).parse(form.getAll("domainIds").map(String));
    await getDb().transaction(async (tx) => {
      const [website] = await tx.select().from(websites).where(eq(websites.id, input.websiteId));
      assert(website && !website.archivedAt, "Seleccioná un sitio vigente.");
      if (includedDomains.length) {
        const matches = await tx.select().from(domains).where(and(inArray(domains.id, includedDomains), eq(domains.websiteId, input.websiteId)));
        assert(matches.length === new Set(includedDomains).size, "Los dominios incluidos deben pertenecer a este sitio.");
      }
      const { id, ...values } = input;
      let planId = id;
      if (id) {
        const [existing] = await tx.select().from(plans).where(eq(plans.id, id));
        assert(existing, "No se encontró el plan.");
        assert(!existing.endedOn || existing.endedOn > today(), "Los planes finalizados se conservan como historial y no se editan.");
        assert(existing.websiteId === values.websiteId, "El plan no se puede trasladar a otro sitio.");
        assert(existing.frequencyMonths === values.frequencyMonths && existing.currency === values.currency &&
          existing.billingStart === values.billingStart && existing.anchorDay === values.anchorDay,
        "Para cambiar el calendario, frecuencia o moneda, finalizá este plan y creá su sucesor.");
        await tx.update(plans).set({ ...values, updatedAt: new Date() }).where(eq(plans.id, id));
        await tx.delete(planDomains).where(eq(planDomains.planId, id));
      } else {
        const initialAmount = positiveAmount.parse(field(form, "amount"));
        const effectiveFrom = field(form, "effectiveFrom") ? date.parse(field(form, "effectiveFrom")) : input.billingStart;
        assert(effectiveFrom <= input.billingStart, "El precio inicial debe regir desde el primer período o antes.");
        const existingPlans = await tx.select().from(plans).where(eq(plans.websiteId, input.websiteId));
        assert(existingPlans.every((existing) => existing.endedOn && existing.endedOn <= input.billingStart), "Finalizá el plan vigente antes de crear el siguiente.");
        const contractStart = input.startedOn ?? input.billingStart;
        assert(existingPlans.every((existing) => existing.endedOn && existing.endedOn <= contractStart),
          "El inicio del nuevo contrato debe ser igual o posterior a la finalización anterior.");
        const [created] = await tx.insert(plans).values(values).returning({ id: plans.id });
        planId = created!.id;
        await tx.insert(planPrices).values({ planId, amountMinor: initialAmount, effectiveFrom,
          effectiveDateKnown: checked(form, "effectiveDateKnown") && !checked(form, "effectiveDateUnknown") });
      }
      if (includedDomains.length) await tx.insert(planDomains).values([...new Set(includedDomains)].map((domainId) => ({ planId: planId!, domainId })));
    });
  }, "Plan guardado.");
}

export async function schedulePrice(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const input = z.object({ planId: uuid, amountMinor: positiveAmount, effectiveFrom: optionalDate, notes }).parse({
      planId: field(form, "planId"), amountMinor: field(form, "amount"), effectiveFrom: field(form, "effectiveFrom"), notes: field(form, "notes"),
    });
    await getDb().transaction(async (tx) => {
      await synchronizePeriods(tx);
      const [plan] = await tx.select().from(plans).where(eq(plans.id, input.planId));
      assert(plan, "No se encontró el plan.");
      const effectiveFrom = nextPeriodStart(plan);
      assert(effectiveFrom, "El plan finalizó o no tiene otro período antes de finalizar.");
      assert(!input.effectiveFrom || input.effectiveFrom === effectiveFrom, `El nuevo precio debe comenzar el ${effectiveFrom}.`);
      await tx.insert(planPrices).values({ planId: plan.id, amountMinor: input.amountMinor, effectiveFrom, effectiveDateKnown: true, notes: input.notes });
    });
  }, "Nuevo precio programado. Los importes anteriores se conservan.");
}

export async function endPlan(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const input = z.object({ planId: uuid, endedOn: optionalDate }).parse({ planId: field(form, "planId"), endedOn: field(form, "endedOn", "endsOn") });
    await getDb().transaction(async (tx) => {
      await synchronizePeriods(tx);
      const [plan] = await tx.select().from(plans).where(eq(plans.id, input.planId));
      assert(plan, "No se encontró el plan.");
      assert(!plan.endedOn, "Este plan ya tiene una finalización registrada.");
      const end = input.endedOn || nextPeriodStart(plan);
      assert(end && end > today() && boundaryIndex(plan, end) !== null && end > plan.billingStart,
        "La finalización debe ser un límite futuro del calendario del plan.");
      await tx.update(plans).set({ endedOn: end, updatedAt: new Date() }).where(eq(plans.id, plan.id));
    });
  }, "Finalización programada. Los períodos pendientes se conservan.");
}

export async function saveDomain(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const input = z.object({ id: optionalId, websiteId: uuid, name: required, registrar: required,
      registeredOn: optionalDate, expiresOn: date, autoRenew: z.boolean(), notes,
    }).parse({ ...common(form), websiteId: field(form, "websiteId"), name: domainToASCII(field(form, "name", "domain").trim().toLowerCase()),
      registrar: field(form, "registrar"), registeredOn: field(form, "registeredOn"), expiresOn: field(form, "expiresOn"), autoRenew: checked(form, "autoRenew") });
    assert(input.name.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(input.name), "Ingresá el dominio sin https:// ni rutas.");
    assert(!input.registeredOn || input.registeredOn < input.expiresOn, "El vencimiento debe ser posterior al registro.");
    const { id, ...values } = input;
    await getDb().transaction(async (tx) => {
      if (!id) { await tx.insert(domains).values(values); return; }
      const [existing] = await tx.select().from(domains).where(eq(domains.id, id));
      assert(existing, "No se encontró el dominio.");
      assert(existing.websiteId === values.websiteId, "El dominio no se puede trasladar a otro sitio.");
      if (existing.expiresOn !== values.expiresOn) {
        assert(values.expiresOn < existing.expiresOn, "Para extender el vencimiento, usá Registrar renovación y conservá su historial.");
      }
      await tx.update(domains).set({ ...values, updatedAt: new Date() }).where(eq(domains.id, id));
    });
  }, "Dominio guardado.");
}

export async function renewDomain(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const input = z.object({ domainId: uuid, renewedOn: date, newExpiresOn: date, notes }).parse({
      domainId: field(form, "domainId"), renewedOn: field(form, "renewedOn"), newExpiresOn: field(form, "newExpiresOn"), notes: field(form, "notes"),
    });
    assert(input.renewedOn <= today(), "La fecha de renovación no puede ser futura.");
    await getDb().transaction(async (tx) => {
      const [domain] = await tx.select().from(domains).where(eq(domains.id, input.domainId));
      assert(domain, "No se encontró el dominio.");
      assert(input.newExpiresOn > domain.expiresOn, "La renovación debe extender el vencimiento actual.");
      assert(input.newExpiresOn > input.renewedOn, "El nuevo vencimiento debe ser posterior a la renovación.");
      await tx.insert(domainRenewals).values({ ...input, previousExpiresOn: domain.expiresOn });
      await tx.update(domains).set({ expiresOn: input.newExpiresOn, updatedAt: new Date() }).where(eq(domains.id, domain.id));
    });
  }, "Renovación registrada.");
}

export async function savePeriodPayment(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const input = z.object({ periodId: uuid, paidOn: date, paidAmountMinor: positiveAmount }).parse({
      periodId: field(form, "periodId"), paidOn: field(form, "paidOn"), paidAmountMinor: field(form, "amount", "paidAmount"),
    });
    await getDb().transaction(async (tx) => {
      await synchronizePeriods(tx);
      const [period] = await tx.select().from(billingPeriods).where(eq(billingPeriods.id, input.periodId));
      assert(period, "No se encontró el período.");
      validatePayment(period.expectedAmountMinor, input.paidAmountMinor, input.paidOn);
      assert(input.paidOn >= period.startsOn, "V1 no registra pagos anticipados a un período futuro.");
      await tx.update(billingPeriods).set({ paidAmountMinor: input.paidAmountMinor, paidOn: input.paidOn, updatedAt: new Date() }).where(eq(billingPeriods.id, period.id));
    });
  }, "Pago del período guardado.");
}

export async function addHistoricalPeriod(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const input = z.object({ planId: uuid, startsOn: date, expectedAmountMinor: positiveAmount, paidOn: optionalDate,
      notes: z.string().trim().min(1, "Anotá la información conocida de este período histórico.").max(5000),
    }).parse({ planId: field(form, "planId"), startsOn: field(form, "startsOn"), expectedAmountMinor: field(form, "amount"),
      paidOn: field(form, "paidOn"), notes: field(form, "notes") });
    await getDb().transaction(async (tx) => {
      const [plan] = await tx.select().from(plans).where(eq(plans.id, input.planId));
      assert(plan, "No se encontró el plan.");
      const index = boundaryIndex(plan, input.startsOn);
      assert(index !== null && index < 0, "Elegí un inicio del calendario anterior al primer período administrado.");
      assert(input.startsOn <= today(), "No se pueden cargar períodos futuros.");
      if (input.paidOn) {
        validatePayment(input.expectedAmountMinor, input.expectedAmountMinor, input.paidOn);
        assert(input.paidOn >= input.startsOn, "V1 no registra pagos anticipados al inicio de un período.");
      }
      await tx.insert(billingPeriods).values({ planId: plan.id, priceId: null, startsOn: input.startsOn,
        endsOn: periodBoundary(plan, index + 1), dueOn: input.startsOn, expectedAmountMinor: input.expectedAmountMinor,
        paidOn: input.paidOn, paidAmountMinor: input.paidOn ? input.expectedAmountMinor : null, notes: input.notes });
    });
  }, "Período histórico guardado. El corte y los precios del plan se conservan.");
}

export async function clearPeriodPayment(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const id = uuid.parse(field(form, "periodId"));
    const rows = await getDb().update(billingPeriods).set({ paidAmountMinor: null, paidOn: null, updatedAt: new Date() })
      .where(eq(billingPeriods.id, id)).returning({ id: billingPeriods.id });
    assert(rows.length, "No se encontró el período.");
  }, "Pago quitado. El período vuelve a estar pendiente.");
}

export async function adjustPeriod(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const input = z.object({ periodId: uuid, expectedAmountMinor: positiveAmount,
      notes: z.string().trim().min(1, "Explicá el motivo del ajuste.").max(5000),
    }).parse({ periodId: field(form, "periodId"), expectedAmountMinor: field(form, "amount", "expectedAmount"), notes: field(form, "notes") });
    await getDb().transaction(async (tx) => {
      const [period] = await tx.select().from(billingPeriods).where(eq(billingPeriods.id, input.periodId));
      assert(period, "No se encontró el período.");
      assert(!period.paidOn, "Quitá el pago antes de ajustar el importe esperado.");
      await tx.update(billingPeriods).set({ expectedAmountMinor: input.expectedAmountMinor, notes: input.notes, updatedAt: new Date() })
        .where(eq(billingPeriods.id, period.id));
    });
  }, "Importe del período ajustado. El precio del plan se conserva.");
}

export async function saveWork(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const input = z.object({ id: optionalId, websiteId: uuid, description: z.string().trim().min(1, "Describí el pedido.").max(5000),
      requestedOn: date, status: z.enum(["requested", "in_progress", "completed", "cancelled"]), completedOn: optionalDate,
      priceMinor: optionalAmount, currency, dueOn: optionalDate, notes,
    }).parse({ ...common(form), websiteId: field(form, "websiteId"), description: field(form, "description", "title"),
      requestedOn: field(form, "requestedOn"), status: field(form, "status") || "requested", completedOn: field(form, "completedOn"),
      priceMinor: field(form, "price", "priceMinor"), currency: field(form, "currency") || "ARS", dueOn: field(form, "dueOn") });
    assert(input.status !== "completed" || input.completedOn, "Indicá la fecha de finalización.");
    assert(!input.completedOn || input.completedOn >= input.requestedOn, "La finalización no puede ser anterior al pedido.");
    const { id, ...values } = input;
    await getDb().transaction(async (tx) => {
      if (!id) { await tx.insert(additionalWorks).values(values); return; }
      const [existing] = await tx.select().from(additionalWorks).where(eq(additionalWorks.id, id));
      assert(existing, "No se encontró el trabajo.");
      assert(existing.websiteId === input.websiteId, "Un trabajo no se puede trasladar a otro sitio.");
      if (existing.paidOn) assert(existing.priceMinor === input.priceMinor && existing.currency === input.currency,
        "Quitá el pago antes de corregir el importe o moneda del trabajo.");
      await tx.update(additionalWorks).set({ ...values, updatedAt: new Date() }).where(eq(additionalWorks.id, id));
    });
  }, "Trabajo guardado.");
}

export async function saveWorkPayment(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const input = z.object({ workId: uuid, paidOn: date, paidAmountMinor: positiveAmount }).parse({
      workId: field(form, "workId"), paidOn: field(form, "paidOn"), paidAmountMinor: field(form, "amount", "paidAmount"),
    });
    await getDb().transaction(async (tx) => {
      const [work] = await tx.select().from(additionalWorks).where(eq(additionalWorks.id, input.workId));
      assert(work, "No se encontró el trabajo.");
      assert(work.status !== "cancelled" || work.paidOn !== null, "No se puede cobrar un trabajo cancelado.");
      assert(work.priceMinor !== null, "Definí el precio del trabajo antes de registrar el pago.");
      validatePayment(work.priceMinor, input.paidAmountMinor, input.paidOn);
      await tx.update(additionalWorks).set({ paidAmountMinor: input.paidAmountMinor, paidOn: input.paidOn, updatedAt: new Date() })
        .where(eq(additionalWorks.id, work.id));
    });
  }, "Pago del trabajo guardado.");
}

export async function clearWorkPayment(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const id = uuid.parse(field(form, "workId"));
    const rows = await getDb().update(additionalWorks).set({ paidAmountMinor: null, paidOn: null, updatedAt: new Date() })
      .where(eq(additionalWorks.id, id)).returning({ id: additionalWorks.id });
    assert(rows.length, "No se encontró el trabajo.");
  }, "Pago del trabajo quitado.");
}

export async function saveSalePayment(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const input = z.object({ websiteId: uuid, paidOn: date, paidAmountMinor: positiveAmount }).parse({
      websiteId: field(form, "websiteId"), paidOn: field(form, "paidOn"), paidAmountMinor: field(form, "amount", "paidAmount"),
    });
    paymentDateValid(input.paidOn);
    await getDb().transaction(async (tx) => {
      const [website] = await tx.select().from(websites).where(eq(websites.id, input.websiteId));
      assert(website, "No se encontró el sitio.");
      assert(website.salePaymentTracked && website.salePriceMinor !== null, "Activá el seguimiento de cobro y definí el precio de venta.");
      validatePayment(website.salePriceMinor, input.paidAmountMinor, input.paidOn);
      await tx.update(websites).set({ salePaidAmountMinor: input.paidAmountMinor, salePaidOn: input.paidOn, updatedAt: new Date() })
        .where(eq(websites.id, website.id));
    });
  }, "Pago de venta guardado.");
}

export async function clearSalePayment(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const id = uuid.parse(field(form, "websiteId"));
    const rows = await getDb().update(websites).set({ salePaidAmountMinor: null, salePaidOn: null, updatedAt: new Date() })
      .where(eq(websites.id, id)).returning({ id: websites.id });
    assert(rows.length, "No se encontró el sitio.");
  }, "Pago de venta quitado.");
}
