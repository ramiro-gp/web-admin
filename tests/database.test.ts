import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const ids = {
  client: "10000000-0000-4000-8000-000000000001",
  type: "10000000-0000-4000-8000-000000000002",
  website: "10000000-0000-4000-8000-000000000003",
  plan: "10000000-0000-4000-8000-000000000004",
  price: "10000000-0000-4000-8000-000000000005",
};
let pg: PGlite;

async function addPeriod(paid = false) {
  return pg.query<{ id: string }>(`INSERT INTO billing_periods
    (plan_id, price_id, starts_on, ends_on, due_on, expected_amount_minor, paid_amount_minor, paid_on)
    VALUES ($1, $2, '2026-01-31', '2026-02-28', '2026-01-31', 1800000, $3, $4) RETURNING id`,
  [ids.plan, ids.price, paid ? "1800000" : null, paid ? "2026-02-03" : null]);
}

beforeAll(async () => {
  pg = new PGlite();
  await migrate(drizzle(pg), { migrationsFolder: "./drizzle" });
}, 30_000);

beforeEach(async () => {
  await pg.exec("TRUNCATE clients, site_types CASCADE;");
  await pg.query("INSERT INTO clients (id, contact_name) VALUES ($1, 'Ana Ejemplo')", [ids.client]);
  await pg.query("INSERT INTO site_types (id, name) VALUES ($1, 'Institucional')", [ids.type]);
  await pg.query("INSERT INTO websites (id, client_id, site_type_id, name, sale_price_minor) VALUES ($1,$2,$3,'Estudio', 30000000)", [ids.website, ids.client, ids.type]);
  await pg.query("INSERT INTO plans (id, website_id, name, frequency_months, billing_start, anchor_day) VALUES ($1,$2,'Mantenimiento',1,'2026-01-31',31)", [ids.plan, ids.website]);
  await pg.query("INSERT INTO plan_prices (id,plan_id,amount_minor,effective_from) VALUES ($1,$2,1800000,'2026-01-31')", [ids.price, ids.plan]);
});

afterAll(async () => { await pg?.close(); });

describe("migraciones y restricciones de PostgreSQL", () => {
  it("reaplica las migraciones sin duplicar el schema y conserva bigint", async () => {
    await migrate(drizzle(pg), { migrationsFolder: "./drizzle" });
    const result = await pg.query<{ count: number }>("SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations");
    expect(result.rows[0]?.count).toBe(4);
    await pg.query("UPDATE websites SET sale_price_minor = 9007199254740993 WHERE id = $1", [ids.website]);
    const money = await pg.query<{ amount: string }>("SELECT sale_price_minor::text AS amount FROM websites WHERE id = $1", [ids.website]);
    expect(money.rows[0]?.amount).toBe("9007199254740993");
  });

  it("preserva el ancla 31 después de febrero y contempla años bisiestos", async () => {
    const result = await pg.query<{ february: string; march: string; leap: string; semiannual: string; annual: string }>(`SELECT
      billing_boundary('2026-01-31',31,1)::text AS february,
      billing_boundary('2026-01-31',31,2)::text AS march,
      billing_boundary('2024-01-31',31,1)::text AS leap,
      billing_boundary('2026-10-01',1,6)::text AS semiannual,
      billing_boundary('2024-02-29',29,12)::text AS annual`);
    expect(result.rows[0]).toEqual({ february: "2026-02-28", march: "2026-03-31", leap: "2024-02-29", semiannual: "2027-04-01", annual: "2025-02-28" });
    await addPeriod();
    await expect(pg.query(`INSERT INTO billing_periods
      (plan_id,price_id,starts_on,ends_on,due_on,expected_amount_minor)
      VALUES ($1,$2,'2026-02-28','2026-03-28','2026-02-28',1800000)`, [ids.plan, ids.price])).rejects.toThrow(/calendario/);
  });

  it("rechaza períodos duplicados y permite generación repetida con ON CONFLICT", async () => {
    await addPeriod();
    await expect(addPeriod()).rejects.toThrow(/unique/);
    await pg.query(`INSERT INTO billing_periods
      (plan_id,price_id,starts_on,ends_on,due_on,expected_amount_minor)
      VALUES ($1,$2,'2026-01-31','2026-02-28','2026-01-31',1800000)
      ON CONFLICT (plan_id,starts_on) DO NOTHING`, [ids.plan, ids.price]);
    const result = await pg.query<{ count: number }>("SELECT count(*)::integer AS count FROM billing_periods");
    expect(result.rows[0]?.count).toBe(1);
  });

  it("importa un período conocido anterior al corte sin inventar un precio", async () => {
    await pg.query(`INSERT INTO billing_periods
      (plan_id,starts_on,ends_on,due_on,expected_amount_minor,paid_amount_minor,paid_on,notes)
      VALUES ($1,'2025-12-31','2026-01-31','2025-12-31',1200000,1200000,'2026-01-03','Importe y pago histórico comprobados')`, [ids.plan]);
    const result = await pg.query<{ cutoff: string; price: string | null; count: number }>(`SELECT p.billing_start::text AS cutoff,bp.price_id AS price,
      (SELECT count(*)::integer FROM plan_prices) AS count FROM plans p JOIN billing_periods bp ON bp.plan_id = p.id`);
    expect(result.rows[0]).toEqual({ cutoff: "2026-01-31", price: null, count: 1 });
    await expect(pg.query(`INSERT INTO billing_periods
      (plan_id,starts_on,ends_on,due_on,expected_amount_minor)
      VALUES ($1,'2025-11-30','2025-12-31','2025-11-30',1200000)`, [ids.plan])).rejects.toThrow(/nota/);
    await expect(pg.query(`INSERT INTO billing_periods
      (plan_id,starts_on,ends_on,due_on,expected_amount_minor,notes)
      VALUES ($1,'2026-01-31','2026-02-28','2026-01-31',1200000,'No es histórico')`, [ids.plan])).rejects.toThrow(/anterior al corte/);
    await expect(pg.query(`INSERT INTO billing_periods
      (plan_id,starts_on,ends_on,due_on,expected_amount_minor,notes)
      VALUES ($1,'2025-11-30','2025-12-30','2025-11-30',1200000,'Datos conocidos')`, [ids.plan])).rejects.toThrow(/calendario/);
    await addPeriod();
    const count = await pg.query<{ count: number }>("SELECT count(*)::integer AS count FROM billing_periods");
    expect(count.rows[0]?.count).toBe(2);
  });

  it("requiere pago completo con importe y fecha juntos", async () => {
    await addPeriod();
    await expect(pg.query("UPDATE billing_periods SET paid_on = '2026-02-03'")).rejects.toThrow(/payment_pair/);
    await expect(pg.query("UPDATE billing_periods SET paid_amount_minor = 900000, paid_on = '2026-02-03'")).rejects.toThrow(/payment_pair/);
    await pg.exec("UPDATE billing_periods SET paid_amount_minor = 1800000, paid_on = '2026-02-03';");
    await pg.exec("UPDATE billing_periods SET paid_on = '2026-03-01';");
    const dates = await pg.query<{ starts: string; paid: string }>("SELECT starts_on::text AS starts, paid_on::text AS paid FROM billing_periods");
    expect(dates.rows[0]).toEqual({ starts: "2026-01-31", paid: "2026-03-01" });
    await pg.exec("UPDATE billing_periods SET paid_amount_minor = NULL, paid_on = NULL;");
  });

  it("conserva precios utilizados y permite ajustar un período con nota", async () => {
    await addPeriod();
    await expect(pg.query("UPDATE plan_prices SET amount_minor = 2500000 WHERE id = $1", [ids.price])).rejects.toThrow(/no se sobrescribe/);
    await expect(pg.query("DELETE FROM billing_periods")).rejects.toThrow(/historial/);
    await expect(pg.query("UPDATE billing_periods SET expected_amount_minor = 1500000")).rejects.toThrow(/nota/);
    await pg.exec("UPDATE billing_periods SET expected_amount_minor = 1500000, notes = 'Descuento acordado';");
    await pg.query("INSERT INTO plan_prices (plan_id,amount_minor,effective_from) VALUES ($1,2500000,'2026-02-28')", [ids.plan]);
    const result = await pg.query<{ amount: string }>("SELECT expected_amount_minor::text AS amount FROM billing_periods");
    expect(result.rows[0]?.amount).toBe("1500000");
    await expect(pg.query("INSERT INTO plan_prices (plan_id,amount_minor,effective_from) VALUES ($1,2500000,'2026-01-01')", [ids.plan])).rejects.toThrow(/emitidos/);
  });

  it("rechaza planes solapados y finalizaciones que recorten períodos", async () => {
    await expect(pg.query("INSERT INTO plans (website_id,name,frequency_months,billing_start,anchor_day) VALUES ($1,'Otro',6,'2026-10-31',31)", [ids.website])).rejects.toThrow(/vigente/);
    await addPeriod();
    await expect(pg.query("UPDATE plans SET frequency_months = 6 WHERE id = $1", [ids.plan])).rejects.toThrow(/históricos/);
    await expect(pg.query("UPDATE plans SET ended_on = '2026-02-15' WHERE id = $1", [ids.plan])).rejects.toThrow(/límite/);
    await pg.query("UPDATE plans SET ended_on = '2026-02-28' WHERE id = $1", [ids.plan]);
    await pg.query("INSERT INTO plans (website_id,name,frequency_months,billing_start,anchor_day) VALUES ($1,'Nuevo',6,'2026-02-28',31)", [ids.website]);
  });

  it("un dominio incluido pertenece al mismo sitio y renovar no cambia pagos", async () => {
    const domain = await pg.query<{ id: string }>("INSERT INTO domains (website_id,name,registrar,expires_on,auto_renew) VALUES ($1,'example.com','Registrador','2026-10-31',true) RETURNING id", [ids.website]);
    const domainId = domain.rows[0]!.id;
    await pg.query("INSERT INTO plan_domains (plan_id,domain_id) VALUES ($1,$2)", [ids.plan, domainId]);
    const other = await pg.query<{ id: string }>("INSERT INTO websites (client_id,site_type_id,name) VALUES ($1,$2,'Otro sitio') RETURNING id", [ids.client, ids.type]);
    const otherDomain = await pg.query<{ id: string }>("INSERT INTO domains (website_id,name,registrar,expires_on) VALUES ($1,'other.example','Registrador','2026-10-31') RETURNING id", [other.rows[0]!.id]);
    await expect(pg.query("INSERT INTO plan_domains (plan_id,domain_id) VALUES ($1,$2)", [ids.plan, otherDomain.rows[0]!.id])).rejects.toThrow(/mismo sitio/);
    await addPeriod(true);
    await pg.transaction(async (tx) => {
      await tx.query("INSERT INTO domain_renewals (domain_id,renewed_on,previous_expires_on,new_expires_on) VALUES ($1,'2026-10-20','2026-10-31','2027-10-31')", [domainId]);
      await tx.query("UPDATE domains SET expires_on = '2027-10-31' WHERE id = $1", [domainId]);
    });
    const result = await pg.query<{ paid: string }>("SELECT paid_on::text AS paid FROM billing_periods");
    expect(result.rows[0]?.paid).toBe("2026-02-03");
  });

  it("ventas sin seguimiento y trabajos gratuitos no fabrican pagos", async () => {
    await expect(pg.query("UPDATE websites SET sale_paid_amount_minor = 30000000,sale_paid_on = '2026-01-01' WHERE id = $1", [ids.website])).rejects.toThrow(/tracking/);
    await pg.query("INSERT INTO additional_works (website_id,description,requested_on,price_minor) VALUES ($1,'Ajuste sin cargo','2026-10-01',0)", [ids.website]);
    await expect(pg.query("UPDATE additional_works SET paid_amount_minor = 1, paid_on = '2026-10-01'")).rejects.toThrow(/payment_pair/);
    await pg.exec("UPDATE additional_works SET price_minor = NULL;");
    await expect(pg.query("UPDATE additional_works SET paid_amount_minor = 1, paid_on = '2026-10-01'")).rejects.toThrow(/payment_pair/);
  });

  it("no reasigna una venta pendiente a otro cliente aunque no existan planes ni trabajos", async () => {
    const secondClient = await pg.query<{ id: string }>("INSERT INTO clients (contact_name) VALUES ('Otro cliente') RETURNING id");
    const pendingWebsite = await pg.query<{ id: string }>(`INSERT INTO websites
      (client_id,site_type_id,name,sale_price_minor,sale_payment_tracked)
      VALUES ($1,$2,'Venta pendiente',30000000,true) RETURNING id`, [ids.client, ids.type]);
    const websiteId = pendingWebsite.rows[0]!.id;
    const newClientId = secondClient.rows[0]!.id;
    await expect(pg.query("UPDATE websites SET client_id = $1 WHERE id = $2", [newClientId, websiteId])).rejects.toThrow(/historial/);
    const unchanged = await pg.query<{ client: string; paid: string | null }>("SELECT client_id AS client, sale_paid_on::text AS paid FROM websites WHERE id = $1", [websiteId]);
    expect(unchanged.rows[0]).toEqual({ client: ids.client, paid: null });

    const untrackedWebsite = await pg.query<{ id: string }>(`INSERT INTO websites
      (client_id,site_type_id,name) VALUES ($1,$2,'Sin historial') RETURNING id`, [ids.client, ids.type]);
    await pg.query("UPDATE websites SET client_id = $1 WHERE id = $2", [newClientId, untrackedWebsite.rows[0]!.id]);
    const transferred = await pg.query<{ client: string }>("SELECT client_id AS client FROM websites WHERE id = $1", [untrackedWebsite.rows[0]!.id]);
    expect(transferred.rows[0]?.client).toBe(newClientId);
  });

  it("incluye las tablas de Better Auth con identidad y sesión únicas", async () => {
    await pg.exec(`INSERT INTO "user" (id,name,email) VALUES ('admin','Admin','admin@example.com');
      INSERT INTO account (id,account_id,provider_id,user_id) VALUES ('github','123','github','admin');
      INSERT INTO session (id,expires_at,token,user_id) VALUES ('session','2026-10-21T00:00:00Z','secret-token','admin');`);
    await expect(pg.query("INSERT INTO account (id,account_id,provider_id,user_id) VALUES ('duplicate','123','github','admin')")).rejects.toThrow(/unique/);
    await expect(pg.query("INSERT INTO session (id,expires_at,token,user_id) VALUES ('duplicate','2026-10-21T00:00:00Z','secret-token','admin')")).rejects.toThrow(/unique/);
  });
});
