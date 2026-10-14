import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readDomainBackup } from "../scripts/backup-data";
import { insertDomainBackup } from "../scripts/restore-data";
import { backupRowCount, createBackup, decryptBackup, encryptBackup, validateBackup, type BackupPayload } from "@/lib/backup-codec";

const password = "una-contraseña-local-de-prueba";
let source: PGlite;
let destination: PGlite;
let original: BackupPayload;

async function emptyDatabase() {
  const pg = new PGlite();
  await migrate(drizzle(pg), { migrationsFolder: "./drizzle" });
  return pg;
}

beforeAll(async () => {
  source = await emptyDatabase();
  destination = await emptyDatabase();
  await source.exec(`
    INSERT INTO clients (id,contact_name,company_name,active) VALUES ('20000000-0000-4000-8000-000000000001','Ana Ejemplo','Estudio',false);
    INSERT INTO site_types (id,name) VALUES ('20000000-0000-4000-8000-000000000002','Institucional');
    INSERT INTO websites (id,client_id,site_type_id,name,sold_on,sale_price_minor,sale_payment_tracked,sale_paid_amount_minor,sale_paid_on)
      VALUES ('20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','Sitio histórico','2025-10-01',9007199254740993,true,9007199254740993,'2026-10-03');
    INSERT INTO plans (id,website_id,name,frequency_months,billing_start,anchor_day,hosting_included,maintenance_included)
      VALUES ('20000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000003','Semestral',6,'2026-10-01',1,true,true);
    INSERT INTO plan_prices (id,plan_id,amount_minor,effective_from,effective_date_known)
      VALUES ('20000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000004',10800000,'2026-10-01',false);
    INSERT INTO billing_periods (plan_id,price_id,starts_on,ends_on,due_on,expected_amount_minor,paid_amount_minor,paid_on)
      VALUES ('20000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000005','2026-10-01','2027-04-01','2026-10-01',10800000,10800000,'2026-10-03');
    INSERT INTO billing_periods (plan_id,starts_on,ends_on,due_on,expected_amount_minor,paid_amount_minor,paid_on,notes)
      VALUES ('20000000-0000-4000-8000-000000000004','2026-04-01','2026-10-01','2026-04-01',9000000,9000000,'2026-04-03','Pago histórico comprobado');
    INSERT INTO domains (id,website_id,name,registrar,registered_on,expires_on,auto_renew)
      VALUES ('20000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000003','example.com','Registrador','2025-10-01','2027-10-01',true);
    INSERT INTO plan_domains (plan_id,domain_id)
      VALUES ('20000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000006');
    INSERT INTO domain_renewals (domain_id,renewed_on,previous_expires_on,new_expires_on)
      VALUES ('20000000-0000-4000-8000-000000000006','2026-09-30','2026-10-01','2027-10-01');
    INSERT INTO additional_works (website_id,description,requested_on,status,completed_on,price_minor,paid_amount_minor,paid_on)
      VALUES ('20000000-0000-4000-8000-000000000003','Página adicional','2026-10-02','completed','2026-10-05',2000000,2000000,'2026-10-05');
    INSERT INTO "user" (id,name,email) VALUES ('private-admin','Admin','admin@example.com');
    INSERT INTO account (id,account_id,provider_id,user_id,access_token) VALUES ('github','123','github','private-admin','SECRET_GITHUB_TOKEN');
    INSERT INTO session (id,expires_at,token,user_id) VALUES ('private-session','2026-10-21T00:00:00Z','SECRET_SESSION_TOKEN','private-admin');
  `);
  original = await readDomainBackup(drizzle(source));
}, 30_000);

afterAll(async () => { await Promise.all([source?.close(), destination?.close()]); });

describe("respaldo cifrado de datos de dominio", () => {
  it("serializa dinero exacto y no incluye cuentas ni sesiones", () => {
    expect(original.tables.websites[0]?.salePriceMinor).toBe("9007199254740993");
    expect(original.tables.billingPeriods[0]?.priceId).toBeNull();
    expect(Object.keys(original.tables)).toHaveLength(10);
    expect(JSON.stringify(original)).not.toMatch(/SECRET_GITHUB_TOKEN|SECRET_SESSION_TOKEN|private-admin/);
    expect(original.tables.websites[0]?.salePaidOn).toBe("2026-10-03");
    expect(original.tables.clients[0]?.createdAt).toMatch(/Z$/);
  });

  it("cifra con salt e IV aleatorios y descifra el contenido original", () => {
    const first = encryptBackup(original, password);
    const second = encryptBackup(original, password);
    expect(first).not.toBe(second);
    expect(first).not.toContain("Ana Ejemplo");
    expect(first).not.toContain("9007199254740993");
    expect(decryptBackup(first, password)).toEqual(original);
  });

  it("rechaza contraseña incorrecta, corta, cambios y formatos ajenos", () => {
    const encrypted = encryptBackup(original, password);
    expect(() => decryptBackup(encrypted, "otra-contraseña-incorrecta")).toThrow(/contraseña/);
    expect(() => encryptBackup(original, "corta")).toThrow(/16 caracteres/);
    const envelope: Record<string, unknown> = JSON.parse(encrypted);
    envelope.tag = "0".repeat(32);
    expect(() => decryptBackup(JSON.stringify(envelope), password)).toThrow(/integridad/);
    expect(() => decryptBackup(JSON.stringify(original), password)).toThrow(/integridad/);
    expect(() => validateBackup({ ...original, version: 2 })).toThrow(/versión/);
    expect(() => validateBackup({ ...original, tables: { ...original.tables, account: [] } })).toThrow(/formato/);
    const invalidMoney = structuredClone(original);
    invalidMoney.tables.websites[0]!.salePriceMinor = "1.25";
    expect(() => validateBackup(invalidMoney)).toThrow(/datos inválidos/);
  });

  it("transforma bigint y Date a strings sin usar números decimales", () => {
    const rows = structuredClone(original.tables);
    const withNativeValues = { ...rows, planPrices: rows.planPrices.map((row) => ({ ...row, amountMinor: BigInt(row.amountMinor), createdAt: new Date(row.createdAt) })) };
    expect(createBackup(withNativeValues).tables.planPrices[0]?.amountMinor).toBe("10800000");
  });

  it("restaura exactamente IDs, fechas, importes, historia y relaciones en una base migrada vacía", async () => {
    const decoded = decryptBackup(encryptBackup(original, password), password);
    const db = drizzle(destination);
    const rows = await db.transaction((tx) => insertDomainBackup(tx, decoded));
    expect(rows).toBe(backupRowCount(original));
    const restored = await readDomainBackup(db);
    expect(restored.tables).toEqual(original.tables);
    const auth = await destination.query<{ count: number }>('SELECT count(*)::integer AS count FROM "user"');
    expect(auth.rows[0]?.count).toBe(0);
    await expect(db.transaction((tx) => insertDomainBackup(tx, decoded))).rejects.toThrow(/vacías/);
    expect((await readDomainBackup(db)).tables).toEqual(original.tables);
  });

  it("revierte toda la transacción si una relación del archivo es inválida", async () => {
    const pg = await emptyDatabase();
    try {
      const damaged = structuredClone(original);
      damaged.tables.websites[0]!.clientId = "20000000-0000-4000-8000-999999999999";
      const db = drizzle(pg);
      await expect(db.transaction((tx) => insertDomainBackup(tx, damaged))).rejects.toThrow();
      expect(backupRowCount(await readDomainBackup(db))).toBe(0);
    } finally { await pg.close(); }
  });
});
