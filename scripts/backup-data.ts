import { asc } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { additionalWorks, billingPeriods, clients, domainRenewals, domains, planDomains, planPrices, plans, siteTypes, websites } from "../src/db/schema";
import { createBackup, type BackupPayload } from "../src/lib/backup-codec";

export type DomainExecutor = Pick<PgDatabase<PgQueryResultHKT>, "select" | "insert">;

export async function readDomainBackup(db: DomainExecutor): Promise<BackupPayload> {
  const [clientRows, typeRows, websiteRows, planRows, priceRows, periodRows, domainRows, includedRows, renewalRows, workRows] = await Promise.all([
    db.select().from(clients).orderBy(asc(clients.id)),
    db.select().from(siteTypes).orderBy(asc(siteTypes.id)),
    db.select().from(websites).orderBy(asc(websites.id)),
    db.select().from(plans).orderBy(asc(plans.billingStart)),
    db.select().from(planPrices).orderBy(asc(planPrices.effectiveFrom)),
    db.select().from(billingPeriods).orderBy(asc(billingPeriods.startsOn)),
    db.select().from(domains).orderBy(asc(domains.id)),
    db.select().from(planDomains).orderBy(asc(planDomains.planId), asc(planDomains.domainId)),
    db.select().from(domainRenewals).orderBy(asc(domainRenewals.createdAt)),
    db.select().from(additionalWorks).orderBy(asc(additionalWorks.id)),
  ]);
  return createBackup({ clients: clientRows, siteTypes: typeRows, websites: websiteRows, plans: planRows,
    planPrices: priceRows, billingPeriods: periodRows, domains: domainRows, planDomains: includedRows,
    domainRenewals: renewalRows, additionalWorks: workRows });
}
