import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { addDays, addMonths, formatDate } from "../src/lib/calendar";

const fixture = JSON.parse(readFileSync(".local/qa-fixtures.json", "utf8")) as {
  asOf: string; monthStart: string; origin: string; client: string; website: string; plan: string; domainExpiresOn: string;
};
test.use({ actionTimeout: 15_000 });

async function openDisclosure(page: Page, title: string) {
  const disclosure = page.locator("details.form-disclosure").filter({ has: page.locator("summary").filter({ hasText: title }) }).first();
  if (await disclosure.getAttribute("open") === null) await disclosure.locator(":scope > summary").click();
  return disclosure;
}

test.beforeEach(async ({ baseURL }) => {
  expect(baseURL).toBe(fixture.origin); // QA must never follow the development/production URL.
});

test("dashboard privado y navegación usable en mobile", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Resumen", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Quién te debe/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Dominios próximos a vencer/ })).toBeVisible();
  await expect(page.getByText("rivera-qa.example", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Resumen", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("link", { name: "Clientes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Clientes", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Estudio Rivera QA", exact: true })).toBeVisible();
});

test("cliente, sitio, plan, pagos, historia, trabajo y dominio conservan sus datos", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = Date.now().toString(36);
  const company = `Estudio E2E ${suffix}`;
  const websiteName = `Web E2E ${suffix}`;
  const planName = `Plan semestral E2E ${suffix}`;
  const domainName = `${suffix}.example`;
  await page.goto("/clientes");
  const clientForm = await openDisclosure(page, "Nuevo cliente");
  await clientForm.getByLabel("Nombre de contacto").fill("Ana E2E");
  await clientForm.getByLabel("Empresa / nombre comercial").fill(company);
  await clientForm.getByLabel("Email", { exact: true }).fill(`${suffix}@example.com`);
  await clientForm.getByRole("button", { name: "Crear cliente", exact: true }).click();
  await expect(page.getByRole("link", { name: company, exact: true })).toBeVisible();
  await page.getByRole("link", { name: company, exact: true }).click();
  const siteForm = await openDisclosure(page, "Agregar sitio de este cliente");
  await siteForm.getByLabel("Nombre del sitio").fill(websiteName);
  await siteForm.getByLabel("URL", { exact: true }).fill("https://example.com");
  await siteForm.getByLabel("Tipo vendido").selectOption({ label: "Institucional" });
  await siteForm.getByLabel("Fecha de venta").fill(fixture.asOf);
  await siteForm.getByLabel("Precio original de venta").fill("250000");
  await siteForm.getByRole("button", { name: "Crear sitio", exact: true }).click();
  await expect(page.getByRole("link", { name: websiteName, exact: true })).toBeVisible();
  await page.getByRole("link", { name: websiteName, exact: true }).click();
  await expect(page).toHaveURL(/\/sitios\/[0-9a-f-]+$/);
  const siteUrl = page.url();

  const domainForm = await openDisclosure(page, "Agregar dominio");
  await domainForm.getByLabel("Dominio").fill(domainName);
  await domainForm.getByLabel("Registrador").fill("Registrador E2E");
  await domainForm.getByLabel("Vencimiento real").fill(addDays(fixture.asOf, 10));
  await domainForm.getByLabel("Renovación automática activada").check();
  await domainForm.getByRole("button", { name: "Agregar dominio", exact: true }).click();
  await expect(page.getByRole("link", { name: domainName, exact: true })).toBeVisible();

  const planForm = await openDisclosure(page, "Crear plan recurrente");
  await planForm.getByLabel("Nombre del plan").fill(planName);
  await planForm.getByLabel("Frecuencia").selectOption("6");
  await planForm.getByLabel("Importe total del período").fill("108000");
  await planForm.getByLabel(/^Primer período administrado/).fill(fixture.monthStart);
  await planForm.getByLabel("Día ancla del calendario").fill("1");
  await planForm.getByLabel("Incluye hosting").check();
  await planForm.getByLabel("Incluye mantenimiento").check();
  await planForm.getByLabel(domainName, { exact: true }).check();
  await planForm.getByRole("button", { name: "Crear plan", exact: true }).click();
  await expect(page.getByRole("link", { name: planName, exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: planName, exact: true }).first().click();
  await expect(page).toHaveURL(/\/planes\/[0-9a-f-]+$/);
  const planUrl = page.url();
  const coverage = `${formatDate(fixture.monthStart)} → ${formatDate(addMonths(fixture.monthStart, 6))}`;
  const period = page.locator("tbody tr").filter({ hasText: coverage });
  await expect(period).toHaveCount(1);
  await period.locator("summary").filter({ hasText: /^Registrar pago$/ }).click();
  const paymentForm = period.locator("form").first();
  await paymentForm.getByLabel("Importe pagado").fill("54000");
  await paymentForm.getByLabel("Fecha real del pago").fill(fixture.asOf);
  await paymentForm.getByRole("button", { name: "Registrar pago", exact: true }).click();
  await expect(paymentForm.getByRole("alert")).toContainText("coincidir");
  await paymentForm.getByLabel("Importe pagado").fill("108000");
  await paymentForm.getByRole("button", { name: "Registrar pago", exact: true }).click();
  await expect(period.locator(".badge-paid")).toHaveCount(1);
  await expect(period).toContainText(coverage); // Late payment does not shift coverage.

  const priceForm = await openDisclosure(page, "Programar cambio de precio");
  await priceForm.locator('input[name="amount"]').fill("125000");
  await priceForm.getByRole("button", { name: "Programar nuevo precio", exact: true }).click();
  await expect(priceForm.getByRole("status")).toContainText("Los importes anteriores");
  const history = await openDisclosure(page, "Agregar un período histórico conocido");
  const historicalStart = addMonths(fixture.monthStart, -6);
  await history.getByLabel("Inicio del período histórico").fill(historicalStart);
  await history.locator('input[name="amount"]').fill("90000");
  await history.getByLabel("Fecha real del pago (opcional)").fill(addDays(historicalStart, 2));
  await history.getByLabel("Referencia o motivo de la carga histórica").fill("Comprobante previo al corte E2E");
  await history.getByRole("button", { name: "Agregar período histórico", exact: true }).click();
  await expect(page.getByText("Histórico manual · fin exclusivo", { exact: true })).toBeVisible();
  await expect(period.locator(".badge-paid")).toHaveCount(1);

  await page.goto(siteUrl);
  const workForm = await openDisclosure(page, "Registrar trabajo adicional");
  const workName = `Cuarta página ${suffix}`;
  await workForm.getByLabel("Qué pidió el cliente").fill(workName);
  await workForm.getByLabel("Precio acordado").fill("15000");
  await workForm.getByRole("button", { name: "Registrar trabajo", exact: true }).click();
  await expect(page.getByRole("link", { name: workName, exact: true })).toBeVisible();
  await page.getByRole("link", { name: workName, exact: true }).click();
  const work = await openDisclosure(page, `${workName} · ${websiteName}`);
  const workPay = work.locator("form").filter({ has: page.getByRole("button", { name: "Registrar pago", exact: true }) });
  await workPay.getByLabel("Fecha real del pago").fill(fixture.asOf);
  await workPay.getByRole("button", { name: "Registrar pago", exact: true }).click();
  await expect(work.getByRole("status")).toContainText("Pago del trabajo guardado");
  await page.goto(siteUrl);
  await expect(page.locator("section").filter({ has: page.getByRole("heading", { name: "Venta original", exact: true }) })).toContainText("ARS 250.000,00");

  await page.getByRole("link", { name: domainName, exact: true }).click();
  const domain = await openDisclosure(page, `${domainName} · gestionar y ver historial`);
  const renewal = domain.locator("form").filter({ has: page.getByRole("button", { name: "Confirmar renovación", exact: true }) });
  await renewal.getByLabel("Nuevo vencimiento real").fill(addMonths(addDays(fixture.asOf, 10), 12));
  await renewal.getByRole("button", { name: "Confirmar renovación", exact: true }).click();
  await expect(domain.getByRole("heading", { name: "Historial de renovaciones", exact: true })).toBeVisible();
  await expect(domain).toContainText(formatDate(addDays(fixture.asOf, 10)));
  await page.goto(planUrl);
  await expect(page.locator("tbody tr").filter({ hasText: coverage }).locator(".badge-paid")).toHaveCount(1);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Resumen", exact: true })).toBeVisible();
  await expect(page.locator("section").filter({ has: page.getByRole("heading", { name: /Últimos pagos/ }) })).toContainText(workName);
});

test("un navegador sin sesión no accede a datos privados", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  try {
    await page.goto(`${fixture.origin}/clientes`);
    await expect(page).toHaveURL(`${fixture.origin}/login`);
    await expect(page.getByRole("button", { name: /Ingresar con GitHub/ })).toBeVisible();
    await expect(page.getByText("Estudio Rivera QA", { exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});
