CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "additional_works" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"website_id" uuid NOT NULL,
	"description" text NOT NULL,
	"requested_on" date NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"completed_on" date,
	"price_minor" bigint,
	"currency" text DEFAULT 'ARS' NOT NULL,
	"due_on" date,
	"paid_amount_minor" bigint,
	"paid_on" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "additional_works_status" CHECK ("additional_works"."status" IN ('requested', 'in_progress', 'completed', 'cancelled')),
	CONSTRAINT "additional_works_currency" CHECK ("additional_works"."currency" IN ('ARS', 'USD')),
	CONSTRAINT "additional_works_price_nonnegative" CHECK ("additional_works"."price_minor" IS NULL OR "additional_works"."price_minor" >= 0),
	CONSTRAINT "additional_works_payment_pair" CHECK (("additional_works"."paid_amount_minor" IS NULL AND "additional_works"."paid_on" IS NULL) OR ("additional_works"."paid_amount_minor" IS NOT NULL AND "additional_works"."paid_on" IS NOT NULL AND "additional_works"."price_minor" IS NOT NULL AND "additional_works"."paid_amount_minor" > 0 AND "additional_works"."paid_amount_minor" = "additional_works"."price_minor")),
	CONSTRAINT "additional_works_completion" CHECK ("additional_works"."status" != 'completed' OR "additional_works"."completed_on" IS NOT NULL),
	CONSTRAINT "additional_works_completion_date" CHECK ("additional_works"."completed_on" IS NULL OR "additional_works"."completed_on" >= "additional_works"."requested_on")
);
--> statement-breakpoint
CREATE TABLE "billing_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"price_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"due_on" date NOT NULL,
	"expected_amount_minor" bigint NOT NULL,
	"paid_amount_minor" bigint,
	"paid_on" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_periods_range" CHECK ("billing_periods"."starts_on" < "billing_periods"."ends_on"),
	CONSTRAINT "billing_periods_due_at_start" CHECK ("billing_periods"."due_on" = "billing_periods"."starts_on"),
	CONSTRAINT "billing_periods_expected_positive" CHECK ("billing_periods"."expected_amount_minor" > 0),
	CONSTRAINT "billing_periods_payment_pair" CHECK (("billing_periods"."paid_amount_minor" IS NULL AND "billing_periods"."paid_on" IS NULL) OR ("billing_periods"."paid_amount_minor" IS NOT NULL AND "billing_periods"."paid_on" IS NOT NULL AND "billing_periods"."paid_amount_minor" = "billing_periods"."expected_amount_minor"))
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_name" text NOT NULL,
	"company_name" text,
	"phone" text,
	"email" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_renewals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" uuid NOT NULL,
	"renewed_on" date NOT NULL,
	"previous_expires_on" date NOT NULL,
	"new_expires_on" date NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domain_renewals_extends" CHECK ("domain_renewals"."new_expires_on" > "domain_renewals"."previous_expires_on")
);
--> statement-breakpoint
CREATE TABLE "domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"website_id" uuid NOT NULL,
	"name" text NOT NULL,
	"registrar" text NOT NULL,
	"registered_on" date,
	"expires_on" date NOT NULL,
	"auto_renew" boolean DEFAULT false NOT NULL,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domains_registration_before_expiry" CHECK ("domains"."registered_on" IS NULL OR "domains"."registered_on" < "domains"."expires_on")
);
--> statement-breakpoint
CREATE TABLE "plan_domains" (
	"plan_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	CONSTRAINT "plan_domains_plan_id_domain_id_pk" PRIMARY KEY("plan_id","domain_id")
);
--> statement-breakpoint
CREATE TABLE "plan_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"effective_from" date NOT NULL,
	"effective_date_known" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_prices_positive" CHECK ("plan_prices"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"website_id" uuid NOT NULL,
	"name" text NOT NULL,
	"frequency_months" integer NOT NULL,
	"currency" text DEFAULT 'ARS' NOT NULL,
	"started_on" date,
	"billing_start" date NOT NULL,
	"anchor_day" integer NOT NULL,
	"ended_on" date,
	"hosting_included" boolean DEFAULT false NOT NULL,
	"maintenance_included" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_frequency" CHECK ("plans"."frequency_months" IN (1, 6, 12)),
	CONSTRAINT "plans_currency" CHECK ("plans"."currency" IN ('ARS', 'USD')),
	CONSTRAINT "plans_anchor" CHECK ("plans"."anchor_day" BETWEEN 1 AND 31),
	CONSTRAINT "plans_history_dates" CHECK ("plans"."started_on" IS NULL OR "plans"."started_on" <= "plans"."billing_start"),
	CONSTRAINT "plans_end_after_start" CHECK ("plans"."ended_on" IS NULL OR "plans"."ended_on" > "plans"."billing_start")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "site_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "websites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"site_type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text,
	"description" text,
	"project_notes" text,
	"sold_on" date,
	"sale_price_minor" bigint,
	"currency" text DEFAULT 'ARS' NOT NULL,
	"sale_payment_tracked" boolean DEFAULT false NOT NULL,
	"sale_due_on" date,
	"sale_paid_amount_minor" bigint,
	"sale_paid_on" date,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "websites_currency" CHECK ("websites"."currency" IN ('ARS', 'USD')),
	CONSTRAINT "websites_sale_nonnegative" CHECK ("websites"."sale_price_minor" IS NULL OR "websites"."sale_price_minor" >= 0),
	CONSTRAINT "websites_sale_tracking" CHECK ("websites"."sale_payment_tracked" OR ("websites"."sale_paid_amount_minor" IS NULL AND "websites"."sale_paid_on" IS NULL AND "websites"."sale_due_on" IS NULL)),
	CONSTRAINT "websites_sale_tracked_amount" CHECK (NOT "websites"."sale_payment_tracked" OR "websites"."sale_price_minor" IS NOT NULL),
	CONSTRAINT "websites_payment_pair" CHECK (("websites"."sale_paid_amount_minor" IS NULL AND "websites"."sale_paid_on" IS NULL) OR ("websites"."sale_paid_amount_minor" IS NOT NULL AND "websites"."sale_paid_on" IS NOT NULL AND "websites"."sale_paid_amount_minor" > 0 AND "websites"."sale_paid_amount_minor" = "websites"."sale_price_minor"))
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "additional_works" ADD CONSTRAINT "additional_works_website_id_websites_id_fk" FOREIGN KEY ("website_id") REFERENCES "public"."websites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_periods" ADD CONSTRAINT "billing_periods_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_periods" ADD CONSTRAINT "billing_periods_price_id_plan_prices_id_fk" FOREIGN KEY ("price_id") REFERENCES "public"."plan_prices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_renewals" ADD CONSTRAINT "domain_renewals_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_website_id_websites_id_fk" FOREIGN KEY ("website_id") REFERENCES "public"."websites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_domains" ADD CONSTRAINT "plan_domains_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_domains" ADD CONSTRAINT "plan_domains_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_website_id_websites_id_fk" FOREIGN KEY ("website_id") REFERENCES "public"."websites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "websites" ADD CONSTRAINT "websites_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "websites" ADD CONSTRAINT "websites_site_type_id_site_types_id_fk" FOREIGN KEY ("site_type_id") REFERENCES "public"."site_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_identity_unique" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "additional_works_website_idx" ON "additional_works" USING btree ("website_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_periods_plan_start_unique" ON "billing_periods" USING btree ("plan_id","starts_on");--> statement-breakpoint
CREATE INDEX "billing_periods_due_idx" ON "billing_periods" USING btree ("due_on");--> statement-breakpoint
CREATE INDEX "domain_renewals_domain_idx" ON "domain_renewals" USING btree ("domain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "domains_name_unique" ON "domains" USING btree ("name");--> statement-breakpoint
CREATE INDEX "domains_website_idx" ON "domains" USING btree ("website_id");--> statement-breakpoint
CREATE INDEX "domains_expiry_idx" ON "domains" USING btree ("expires_on");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_prices_effective_unique" ON "plan_prices" USING btree ("plan_id","effective_from");--> statement-breakpoint
CREATE INDEX "plans_website_idx" ON "plans" USING btree ("website_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "site_types_name_unique" ON "site_types" USING btree ("name");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "websites_client_idx" ON "websites" USING btree ("client_id");