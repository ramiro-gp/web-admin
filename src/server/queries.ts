import "server-only";
import { cache } from "react";
import { asc, desc } from "drizzle-orm";
import { getDb } from "@/db";
import { additionalWorks, billingPeriods, clients, domainRenewals, domains, planDomains, planPrices, plans, siteTypes, websites } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";

export type WorkspaceData = {
  clients: (typeof clients.$inferSelect)[];
  siteTypes: (typeof siteTypes.$inferSelect)[];
  websites: (typeof websites.$inferSelect)[];
  plans: (typeof plans.$inferSelect)[];
  prices: (typeof planPrices.$inferSelect)[];
  periods: (typeof billingPeriods.$inferSelect)[];
  domains: (typeof domains.$inferSelect)[];
  planDomains: (typeof planDomains.$inferSelect)[];
  renewals: (typeof domainRenewals.$inferSelect)[];
  works: (typeof additionalWorks.$inferSelect)[];
};

/** Request-local memoization only; private data is never put in a shared Next cache. */
export const getWorkspace = cache(async (): Promise<WorkspaceData> => {
  await requireAdmin();
  const db = getDb();
  const [clientRows, typeRows, websiteRows, planRows, priceRows, periodRows, domainRows, inclusionRows, renewalRows, workRows] = await Promise.all([
    db.select().from(clients).orderBy(asc(clients.contactName)),
    db.select().from(siteTypes).orderBy(asc(siteTypes.name)),
    db.select().from(websites).orderBy(asc(websites.name)),
    db.select().from(plans).orderBy(desc(plans.billingStart)),
    db.select().from(planPrices).orderBy(asc(planPrices.effectiveFrom)),
    db.select().from(billingPeriods).orderBy(desc(billingPeriods.startsOn)),
    db.select().from(domains).orderBy(asc(domains.expiresOn)),
    db.select().from(planDomains),
    db.select().from(domainRenewals).orderBy(desc(domainRenewals.renewedOn)),
    db.select().from(additionalWorks).orderBy(desc(additionalWorks.requestedOn)),
  ]);
  return { clients: clientRows, siteTypes: typeRows, websites: websiteRows, plans: planRows, prices: priceRows,
    periods: periodRows, domains: domainRows, planDomains: inclusionRows, renewals: renewalRows, works: workRows };
});
