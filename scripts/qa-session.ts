/** Local QA fixture runner. It never reads .env or changes the application auth. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { additionalWorks, billingPeriods, clients, domains, planDomains, planPrices, plans, siteTypes, websites } from "../src/db/schema";
import { addDays, addMonths, today } from "../src/lib/calendar";
import { preparePeriods } from "../src/lib/billing";

const origin = "http://localhost:3001";
let stage = "validación del destino";
const ids = {
  client: "30000000-0000-4000-8000-000000000001", website: "30000000-0000-4000-8000-000000000002",
  plan: "30000000-0000-4000-8000-000000000003", price: "30000000-0000-4000-8000-000000000004",
  domain: "30000000-0000-4000-8000-000000000005", work: "30000000-0000-4000-8000-000000000006",
};
const configSchema = z.object({
  QA_DATABASE_URL: z.url(), BETTER_AUTH_SECRET: z.string().min(32),
  qaProjectId: z.string().min(4), qaBranchId: z.string().regex(/^br-[a-z0-9-]+$/),
  qaEndpointHost: z.string().regex(/^ep-[a-z0-9.-]+\.neon\.tech$/), purpose: z.literal("web-admin-e2e"),
});

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

export async function prepareQaSession() {
  if (process.env.NODE_ENV !== "test" || process.env.VERCEL_ENV === "production") throw new Error("QA requiere NODE_ENV=test fuera de producción.");
  const config = configSchema.parse(JSON.parse(await readFile(resolve(".local/qa-env.json"), "utf8")));
  const url = new URL(config.QA_DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== config.qaEndpointHost ||
    process.env.QA_CONFIRMED_BRANCH !== config.qaBranchId || process.env.QA_CONFIRMED_HOST !== config.qaEndpointHost) {
    throw new Error("El destino QA no coincide con la rama y endpoint confirmados.");
  }
  const asOf = today();
  const monthStart = `${asOf.slice(0, 7)}-01`;
  const billingStart = addMonths(monthStart, -8);
  const domainExpiresOn = addDays(asOf, 12);
  const pool = new Pool({ connectionString: config.QA_DATABASE_URL, max: 1, connectionTimeoutMillis: 10_000 });
  const db = drizzle(pool);
  const originalFetch = globalThis.fetch;
  try {
    stage = "migraciones QA";
    await migrate(db, { migrationsFolder: resolve("drizzle") });
    stage = "fixtures QA";
    await db.transaction(async (tx) => {
      await tx.insert(siteTypes).values(["Landing", "Institucional", "Catálogo", "Ecommerce", "Otro"].map((name) => ({ name }))).onConflictDoNothing();
      const [type] = await tx.select().from(siteTypes).where(eq(siteTypes.name, "Institucional"));
      if (!type) throw new Error("Falta el catálogo QA.");
      stage = "cliente QA";
      await tx.insert(clients).values({ id: ids.client, contactName: "Ana Rivera QA", companyName: "Estudio Rivera QA", email: "ana-qa@example.com", notes: "Fixture exclusiva de la rama QA." }).onConflictDoNothing();
      stage = "sitio QA";
      await tx.insert(websites).values({ id: ids.website, clientId: ids.client, siteTypeId: type.id, name: "Sitio Rivera QA",
        url: "https://example.com", description: "Sitio institucional de prueba.", soldOn: addMonths(monthStart, -1),
        salePriceMinor: 30_000_000n, currency: "ARS", salePaymentTracked: true, salePaidAmountMinor: 30_000_000n, salePaidOn: asOf }).onConflictDoNothing();
      const plan = { id: ids.plan, websiteId: ids.website, name: "Mantenimiento Rivera QA", currency: "ARS" as const,
        billingStart, anchorDay: 1, frequencyMonths: 1, hostingIncluded: true, maintenanceIncluded: true };
      const price = { id: ids.price, planId: ids.plan, amountMinor: 1_800_000n, effectiveFrom: billingStart, effectiveDateKnown: true };
      stage = "plan QA";
      await tx.insert(plans).values(plan).onConflictDoNothing();
      stage = "precio QA";
      const [existingPrice] = await tx.select({ id: planPrices.id }).from(planPrices).where(eq(planPrices.id, ids.price));
      if (!existingPrice) await tx.insert(planPrices).values(price);
      stage = "períodos QA";
      await tx.insert(billingPeriods).values(preparePeriods(plan, [price], asOf)).onConflictDoNothing({ target: [billingPeriods.planId, billingPeriods.startsOn] });
      stage = "dominio QA";
      await tx.insert(domains).values({ id: ids.domain, websiteId: ids.website, name: "rivera-qa.example", registrar: "Registrador QA", expiresOn: domainExpiresOn, autoRenew: true }).onConflictDoNothing();
      stage = "inclusión QA";
      await tx.insert(planDomains).values({ planId: ids.plan, domainId: ids.domain }).onConflictDoNothing();
      stage = "trabajo QA";
      await tx.insert(additionalWorks).values({ id: ids.work, websiteId: ids.website, description: "Cuarta página QA", requestedOn: monthStart,
        priceMinor: 6_500_000n, currency: "ARS", dueOn: monthStart, status: "in_progress" }).onConflictDoNothing();
    });

    // These values apply only to this short-lived QA process. No dotenv loading.
    Object.assign(process.env, { DATABASE_URL: config.QA_DATABASE_URL, BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: config.BETTER_AUTH_SECRET,
      GITHUB_CLIENT_ID: "qa-fixture-client", GITHUB_CLIENT_SECRET: "qa-fixture-secret", ADMIN_GITHUB_ID: "123" });
    globalThis.fetch = async (input) => {
      const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (requestUrl === "https://github.com/login/oauth/access_token") return Response.json({ access_token: "qa-fixture-token", token_type: "bearer", scope: "read:user,user:email" });
      if (requestUrl === "https://api.github.com/user") return Response.json({ id: 123, login: "qa-admin", name: "Administrador QA", email: "qa-admin@example.com", avatar_url: null });
      if (requestUrl === "https://api.github.com/user/emails") return Response.json([{ email: "qa-admin@example.com", primary: true, verified: true }]);
      throw new Error("El runner QA sólo permite las respuestas GitHub de prueba.");
    };
    stage = "inicio de Better Auth";
    const { getAuth } = await import("../src/lib/auth");
    const auth = getAuth();
    stage = "estado OAuth";
    const start = await auth.handler(new Request(`${origin}/api/auth/sign-in/social`, { method: "POST", headers: { origin, "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "github", callbackURL: "/", errorCallbackURL: "/login" }) }));
    if (!start.ok) throw new Error("No se pudo iniciar OAuth QA.");
    const state = new URL((await start.json() as { url: string }).url).searchParams.get("state");
    if (!state) throw new Error("No se recibió el estado OAuth QA.");
    const stateCookie = start.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
    stage = "callback OAuth";
    const callback = await auth.handler(new Request(`${origin}/api/auth/callback/github?code=qa-fixture-code&state=${encodeURIComponent(state)}`, { headers: { cookie: stateCookie } }));
    const context = await auth.$context;
    const name = context.authCookies.sessionToken.name;
    const sessionCookie = callback.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`));
    if (callback.status !== 302 || !sessionCookie) throw new Error("La identidad QA no generó una sesión válida.");
    const value = sessionCookie.slice(name.length + 1).split(";")[0]!;
    stage = "verificación y archivo de sesión";
    const authenticated = await auth.api.getSession({ headers: new Headers({ cookie: `${name}=${value}` }), query: { disableCookieCache: true } });
    if (!authenticated || authenticated.user.email !== "qa-admin@example.com") throw new Error("No se pudo verificar la sesión QA emitida.");
    await writeFile(resolve(".local/e2e-storage.json"), JSON.stringify({ cookies: [{ name, value, domain: "localhost", path: "/", expires: -1,
      httpOnly: true, secure: false, sameSite: "Lax" }], origins: [] }, null, 2));
    await writeFile(resolve(".local/qa-fixtures.json"), JSON.stringify({ ...ids, asOf, monthStart, billingStart, domainExpiresOn, origin }, null, 2));
    console.log("Rama QA verificada, fixtures y sesión Better Auth real preparados. No se modificó la configuración de desarrollo.");
  } finally {
    globalThis.fetch = originalFetch;
    await pool.end();
    await (globalThis as typeof globalThis & { webAdminPool?: Pool }).webAdminPool?.end();
  }
}

// Vitest supplies the same server-only module boundary used by our integration
// tests. It does not mock authentication; the application's getAuth runs intact.
if (process.env.QA_SESSION_CHILD !== "1") {
  if (process.env.NODE_ENV !== "test" || process.env.VERCEL_ENV === "production") {
    console.error("QA requiere NODE_ENV=test fuera de producción.");
    process.exitCode = 1;
  } else {
    const result = spawnSync(process.execPath, [resolve("node_modules/vitest/vitest.mjs"), "run", "--config", resolve("e2e/qa-session.vitest.config.mts")], {
      stdio: "inherit", env: { ...process.env, NODE_OPTIONS: undefined, QA_SESSION_CHILD: "1",
        QA_CONFIRMED_BRANCH: argument("--confirm-qa-branch"), QA_CONFIRMED_HOST: argument("--confirm-qa-host") },
    });
    process.exitCode = result.status ?? 1;
  }
}

export function qaFailureStage() { return stage; }
