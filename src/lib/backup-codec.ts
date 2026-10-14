import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { z } from "zod";
import { parseCalendarDate } from "./calendar";

export class BackupError extends Error {
  constructor(message: string) { super(message); this.name = "BackupError"; }
}

const id = z.uuid();
const date = z.string().refine((value) => {
  try { parseCalendarDate(value); return true; } catch { return false; }
}, "Fecha calendario inválida");
const instant = z.iso.datetime({ offset: true });
const minorPattern = /^(?:0|[1-9]\d{0,18})$/;
const money = z.string().refine((value) => minorPattern.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n);
const positiveMoney = money.refine((value) => minorPattern.test(value) && BigInt(value) > 0n);
const text = z.string().nullable();
const currency = z.enum(["ARS", "USD"]);
const timestamps = { createdAt: instant, updatedAt: instant };

// Only business data is accepted. Authentication accounts, tokens and environment
// configuration cannot be represented in this format.
const tablesSchema = z.strictObject({
  clients: z.array(z.strictObject({ id, contactName: z.string(), companyName: text, phone: text, email: text,
    notes: text, active: z.boolean(), ...timestamps })),
  siteTypes: z.array(z.strictObject({ id, name: z.string(), active: z.boolean() })),
  websites: z.array(z.strictObject({ id, clientId: id, siteTypeId: id, name: z.string(), url: text,
    description: text, projectNotes: text, soldOn: date.nullable(), salePriceMinor: money.nullable(), currency,
    salePaymentTracked: z.boolean(), saleDueOn: date.nullable(), salePaidAmountMinor: positiveMoney.nullable(),
    salePaidOn: date.nullable(), archivedAt: instant.nullable(), ...timestamps })),
  plans: z.array(z.strictObject({ id, websiteId: id, name: z.string(),
    frequencyMonths: z.union([z.literal(1), z.literal(6), z.literal(12)]), currency,
    startedOn: date.nullable(), billingStart: date, anchorDay: z.number().int().min(1).max(31),
    endedOn: date.nullable(), hostingIncluded: z.boolean(), maintenanceIncluded: z.boolean(), notes: text, ...timestamps })),
  planPrices: z.array(z.strictObject({ id, planId: id, amountMinor: positiveMoney, effectiveFrom: date,
    effectiveDateKnown: z.boolean(), notes: text, ...timestamps })),
  billingPeriods: z.array(z.strictObject({ id, planId: id, priceId: id.nullable(), startsOn: date, endsOn: date,
    dueOn: date, expectedAmountMinor: positiveMoney, paidAmountMinor: positiveMoney.nullable(),
    paidOn: date.nullable(), notes: text, ...timestamps })),
  domains: z.array(z.strictObject({ id, websiteId: id, name: z.string(), registrar: z.string(),
    registeredOn: date.nullable(), expiresOn: date, autoRenew: z.boolean(), notes: text,
    archivedAt: instant.nullable(), ...timestamps })),
  planDomains: z.array(z.strictObject({ planId: id, domainId: id })),
  domainRenewals: z.array(z.strictObject({ id, domainId: id, renewedOn: date, previousExpiresOn: date,
    newExpiresOn: date, notes: text, createdAt: instant })),
  additionalWorks: z.array(z.strictObject({ id, websiteId: id, description: z.string(), requestedOn: date,
    status: z.enum(["requested", "in_progress", "completed", "cancelled"]), completedOn: date.nullable(),
    priceMinor: money.nullable(), currency, dueOn: date.nullable(), paidAmountMinor: positiveMoney.nullable(),
    paidOn: date.nullable(), notes: text, ...timestamps })),
});

const payloadSchema = z.strictObject({
  format: z.literal("web-admin-backup"), version: z.literal(1), exportedAt: instant, tables: tablesSchema,
});
const envelopeSchema = z.strictObject({
  format: z.literal("web-admin-backup-encrypted"), version: z.literal(1),
  cipher: z.literal("aes-256-gcm"), kdf: z.literal("scrypt"),
  salt: z.string().regex(/^[a-f0-9]{64}$/), iv: z.string().regex(/^[a-f0-9]{24}$/),
  tag: z.string().regex(/^[a-f0-9]{32}$/), ciphertext: z.string().regex(/^[a-f0-9]+$/),
});

export type BackupPayload = z.infer<typeof payloadSchema>;
export type BackupTables = BackupPayload["tables"];
const aad = Buffer.from("web-admin-backup:v1:aes-256-gcm:scrypt", "utf8");

export function requireBackupPassword(password: string | undefined): string {
  if (!password || password.length < 16) throw new BackupError("BACKUP_PASSWORD debe tener al menos 16 caracteres.");
  return password;
}

/** Bigints remain decimal strings; Date timestamps become ISO strings. */
export function createBackup(tables: unknown, exportedAt = new Date()): BackupPayload {
  const serializable: unknown = JSON.parse(JSON.stringify(tables, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value));
  return validateBackup({ format: "web-admin-backup", version: 1, exportedAt: exportedAt.toISOString(), tables: serializable });
}

export function validateBackup(value: unknown): BackupPayload {
  const parsed = payloadSchema.safeParse(value);
  if (!parsed.success) throw new BackupError("El respaldo tiene un formato, versión o datos inválidos.");
  return parsed.data;
}

function keyFor(password: string, salt: Buffer): Buffer {
  return scryptSync(requireBackupPassword(password), salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

export function encryptBackup(payload: BackupPayload, password: string): string {
  const data = validateBackup(payload);
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(password, salt), iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  return JSON.stringify({ format: "web-admin-backup-encrypted", version: 1, cipher: "aes-256-gcm", kdf: "scrypt",
    salt: salt.toString("hex"), iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), ciphertext: ciphertext.toString("hex") });
}

export function decryptBackup(contents: string, password: string): BackupPayload {
  requireBackupPassword(password);
  try {
    const raw: unknown = JSON.parse(contents);
    const envelope = envelopeSchema.parse(raw);
    const cipher = createDecipheriv("aes-256-gcm", keyFor(password, Buffer.from(envelope.salt, "hex")), Buffer.from(envelope.iv, "hex"));
    cipher.setAAD(aad);
    cipher.setAuthTag(Buffer.from(envelope.tag, "hex"));
    const plaintext = Buffer.concat([cipher.update(Buffer.from(envelope.ciphertext, "hex")), cipher.final()]);
    const payload: unknown = JSON.parse(plaintext.toString("utf8"));
    return validateBackup(payload);
  } catch {
    throw new BackupError("No se pudo abrir el respaldo. Revisá la contraseña y la integridad del archivo.");
  }
}

export function backupRowCount(payload: BackupPayload): number {
  return Object.values(payload.tables).reduce((total, rows) => total + rows.length, 0);
}
