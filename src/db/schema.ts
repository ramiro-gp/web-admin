import { sql } from "drizzle-orm";
import {
  bigint, boolean, check, date, index, integer, pgTable, primaryKey,
  text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
const currency = () => text("currency", { enum: ["ARS", "USD"] }).default("ARS").notNull();

export const clients = pgTable("clients", {
  id: uuid("id").defaultRandom().primaryKey(),
  contactName: text("contact_name").notNull(),
  companyName: text("company_name"),
  phone: text("phone"),
  email: text("email"),
  notes: text("notes"),
  active: boolean("active").default(true).notNull(),
  ...timestamps(),
});

export const siteTypes = pgTable("site_types", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  active: boolean("active").default(true).notNull(),
}, (table) => [uniqueIndex("site_types_name_unique").on(table.name)]);

export const websites = pgTable("websites", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "restrict" }),
  siteTypeId: uuid("site_type_id").notNull().references(() => siteTypes.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  url: text("url"),
  description: text("description"),
  projectNotes: text("project_notes"),
  soldOn: date("sold_on"),
  salePriceMinor: bigint("sale_price_minor", { mode: "bigint" }),
  currency: currency(),
  salePaymentTracked: boolean("sale_payment_tracked").default(false).notNull(),
  saleDueOn: date("sale_due_on"),
  salePaidAmountMinor: bigint("sale_paid_amount_minor", { mode: "bigint" }),
  salePaidOn: date("sale_paid_on"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...timestamps(),
}, (table) => [
  index("websites_client_idx").on(table.clientId),
  check("websites_currency", sql`${table.currency} IN ('ARS', 'USD')`),
  check("websites_sale_nonnegative", sql`${table.salePriceMinor} IS NULL OR ${table.salePriceMinor} >= 0`),
  check("websites_sale_tracking", sql`${table.salePaymentTracked} OR (${table.salePaidAmountMinor} IS NULL AND ${table.salePaidOn} IS NULL AND ${table.saleDueOn} IS NULL)`),
  check("websites_sale_tracked_amount", sql`NOT ${table.salePaymentTracked} OR ${table.salePriceMinor} IS NOT NULL`),
  check("websites_payment_pair", sql`(${table.salePaidAmountMinor} IS NULL AND ${table.salePaidOn} IS NULL) OR (${table.salePaidAmountMinor} IS NOT NULL AND ${table.salePaidOn} IS NOT NULL AND ${table.salePaidAmountMinor} > 0 AND ${table.salePaidAmountMinor} = ${table.salePriceMinor})`),
]);

export const plans = pgTable("plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  websiteId: uuid("website_id").notNull().references(() => websites.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  frequencyMonths: integer("frequency_months").notNull(),
  currency: currency(),
  startedOn: date("started_on"),
  billingStart: date("billing_start").notNull(),
  anchorDay: integer("anchor_day").notNull(),
  endedOn: date("ended_on"),
  hostingIncluded: boolean("hosting_included").default(false).notNull(),
  maintenanceIncluded: boolean("maintenance_included").default(false).notNull(),
  notes: text("notes"),
  ...timestamps(),
}, (table) => [
  index("plans_website_idx").on(table.websiteId),
  check("plans_frequency", sql`${table.frequencyMonths} IN (1, 6, 12)`),
  check("plans_currency", sql`${table.currency} IN ('ARS', 'USD')`),
  check("plans_anchor", sql`${table.anchorDay} BETWEEN 1 AND 31`),
  check("plans_history_dates", sql`${table.startedOn} IS NULL OR ${table.startedOn} <= ${table.billingStart}`),
  check("plans_end_after_start", sql`${table.endedOn} IS NULL OR ${table.endedOn} > ${table.billingStart}`),
]);

export const planPrices = pgTable("plan_prices", {
  id: uuid("id").defaultRandom().primaryKey(),
  planId: uuid("plan_id").notNull().references(() => plans.id, { onDelete: "restrict" }),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  effectiveFrom: date("effective_from").notNull(),
  effectiveDateKnown: boolean("effective_date_known").default(true).notNull(),
  notes: text("notes"),
  ...timestamps(),
}, (table) => [
  uniqueIndex("plan_prices_effective_unique").on(table.planId, table.effectiveFrom),
  check("plan_prices_positive", sql`${table.amountMinor} > 0`),
]);

export const billingPeriods = pgTable("billing_periods", {
  id: uuid("id").defaultRandom().primaryKey(),
  planId: uuid("plan_id").notNull().references(() => plans.id, { onDelete: "restrict" }),
  // Explicit historical imports can predate the administered price history.
  priceId: uuid("price_id").references(() => planPrices.id, { onDelete: "restrict" }),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
  dueOn: date("due_on").notNull(),
  expectedAmountMinor: bigint("expected_amount_minor", { mode: "bigint" }).notNull(),
  paidAmountMinor: bigint("paid_amount_minor", { mode: "bigint" }),
  paidOn: date("paid_on"),
  notes: text("notes"),
  ...timestamps(),
}, (table) => [
  uniqueIndex("billing_periods_plan_start_unique").on(table.planId, table.startsOn),
  index("billing_periods_due_idx").on(table.dueOn),
  check("billing_periods_range", sql`${table.startsOn} < ${table.endsOn}`),
  check("billing_periods_due_at_start", sql`${table.dueOn} = ${table.startsOn}`),
  check("billing_periods_expected_positive", sql`${table.expectedAmountMinor} > 0`),
  check("billing_periods_payment_pair", sql`(${table.paidAmountMinor} IS NULL AND ${table.paidOn} IS NULL) OR (${table.paidAmountMinor} IS NOT NULL AND ${table.paidOn} IS NOT NULL AND ${table.paidAmountMinor} = ${table.expectedAmountMinor})`),
]);

export const domains = pgTable("domains", {
  id: uuid("id").defaultRandom().primaryKey(),
  websiteId: uuid("website_id").notNull().references(() => websites.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  registrar: text("registrar").notNull(),
  registeredOn: date("registered_on"),
  expiresOn: date("expires_on").notNull(),
  autoRenew: boolean("auto_renew").default(false).notNull(),
  notes: text("notes"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...timestamps(),
}, (table) => [
  uniqueIndex("domains_name_unique").on(table.name),
  index("domains_website_idx").on(table.websiteId),
  index("domains_expiry_idx").on(table.expiresOn),
  check("domains_registration_before_expiry", sql`${table.registeredOn} IS NULL OR ${table.registeredOn} < ${table.expiresOn}`),
]);

export const planDomains = pgTable("plan_domains", {
  planId: uuid("plan_id").notNull().references(() => plans.id, { onDelete: "restrict" }),
  domainId: uuid("domain_id").notNull().references(() => domains.id, { onDelete: "restrict" }),
}, (table) => [primaryKey({ columns: [table.planId, table.domainId] })]);

export const domainRenewals = pgTable("domain_renewals", {
  id: uuid("id").defaultRandom().primaryKey(),
  domainId: uuid("domain_id").notNull().references(() => domains.id, { onDelete: "restrict" }),
  renewedOn: date("renewed_on").notNull(),
  previousExpiresOn: date("previous_expires_on").notNull(),
  newExpiresOn: date("new_expires_on").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("domain_renewals_domain_idx").on(table.domainId),
  check("domain_renewals_extends", sql`${table.newExpiresOn} > ${table.previousExpiresOn}`),
]);

export const additionalWorks = pgTable("additional_works", {
  id: uuid("id").defaultRandom().primaryKey(),
  websiteId: uuid("website_id").notNull().references(() => websites.id, { onDelete: "restrict" }),
  description: text("description").notNull(),
  requestedOn: date("requested_on").notNull(),
  status: text("status", { enum: ["requested", "in_progress", "completed", "cancelled"] }).default("requested").notNull(),
  completedOn: date("completed_on"),
  priceMinor: bigint("price_minor", { mode: "bigint" }),
  currency: currency(),
  dueOn: date("due_on"),
  paidAmountMinor: bigint("paid_amount_minor", { mode: "bigint" }),
  paidOn: date("paid_on"),
  notes: text("notes"),
  ...timestamps(),
}, (table) => [
  index("additional_works_website_idx").on(table.websiteId),
  check("additional_works_status", sql`${table.status} IN ('requested', 'in_progress', 'completed', 'cancelled')`),
  check("additional_works_currency", sql`${table.currency} IN ('ARS', 'USD')`),
  check("additional_works_price_nonnegative", sql`${table.priceMinor} IS NULL OR ${table.priceMinor} >= 0`),
  check("additional_works_payment_pair", sql`(${table.paidAmountMinor} IS NULL AND ${table.paidOn} IS NULL) OR (${table.paidAmountMinor} IS NOT NULL AND ${table.paidOn} IS NOT NULL AND ${table.priceMinor} IS NOT NULL AND ${table.paidAmountMinor} > 0 AND ${table.paidAmountMinor} = ${table.priceMinor})`),
  check("additional_works_completion", sql`${table.status} != 'completed' OR ${table.completedOn} IS NOT NULL`),
  check("additional_works_completion_date", sql`${table.completedOn} IS NULL OR ${table.completedOn} >= ${table.requestedOn}`),
]);

// Better Auth owns these records. Domain records never use an auth ID as a business key.
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  ...timestamps(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  ...timestamps(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
}, (table) => [index("session_user_idx").on(table.userId)]);

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  ...timestamps(),
}, (table) => [
  index("account_user_idx").on(table.userId),
  uniqueIndex("account_provider_identity_unique").on(table.providerId, table.accountId),
]);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...timestamps(),
}, (table) => [index("verification_identifier_idx").on(table.identifier)]);
