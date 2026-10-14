import { additionalWorks, billingPeriods, clients, domainRenewals, domains, planDomains, planPrices, plans, siteTypes, websites } from "../src/db/schema";
import { BackupError, backupRowCount, validateBackup, type BackupPayload } from "../src/lib/backup-codec";
import { readDomainBackup, type DomainExecutor } from "./backup-data";

const optionalBigint = (value: string | null) => value === null ? null : BigInt(value);
const optionalInstant = (value: string | null) => value === null ? null : new Date(value);
const timestamps = (row: { createdAt: string; updatedAt: string }) => ({ createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) });

/** Call inside a transaction. This helper only inserts and never clears data. */
export async function insertDomainBackup(db: DomainExecutor, value: BackupPayload): Promise<number> {
  const payload = validateBackup(value);
  const existing = await readDomainBackup(db);
  if (backupRowCount(existing) !== 0) {
    throw new BackupError("La restauración requiere una base con todas las tablas de dominio vacías. No se modificó ningún registro.");
  }
  const data = payload.tables;
  if (data.clients.length) await db.insert(clients).values(data.clients.map((row) => ({ ...row, ...timestamps(row) })));
  if (data.siteTypes.length) await db.insert(siteTypes).values(data.siteTypes);
  if (data.websites.length) await db.insert(websites).values(data.websites.map((row) => ({ ...row, ...timestamps(row),
    archivedAt: optionalInstant(row.archivedAt), salePriceMinor: optionalBigint(row.salePriceMinor), salePaidAmountMinor: optionalBigint(row.salePaidAmountMinor) })));
  if (data.plans.length) await db.insert(plans).values(data.plans.map((row) => ({ ...row, ...timestamps(row) })));
  if (data.planPrices.length) await db.insert(planPrices).values(data.planPrices.map((row) => ({ ...row, ...timestamps(row), amountMinor: BigInt(row.amountMinor) })));
  if (data.domains.length) await db.insert(domains).values(data.domains.map((row) => ({ ...row, ...timestamps(row), archivedAt: optionalInstant(row.archivedAt) })));
  if (data.planDomains.length) await db.insert(planDomains).values(data.planDomains);
  if (data.domainRenewals.length) await db.insert(domainRenewals).values(data.domainRenewals.map((row) => ({ ...row, createdAt: new Date(row.createdAt) })));
  if (data.billingPeriods.length) await db.insert(billingPeriods).values(data.billingPeriods.map((row) => ({ ...row, ...timestamps(row),
    expectedAmountMinor: BigInt(row.expectedAmountMinor), paidAmountMinor: optionalBigint(row.paidAmountMinor) })));
  if (data.additionalWorks.length) await db.insert(additionalWorks).values(data.additionalWorks.map((row) => ({ ...row, ...timestamps(row),
    priceMinor: optionalBigint(row.priceMinor), paidAmountMinor: optionalBigint(row.paidAmountMinor) })));
  return backupRowCount(payload);
}
