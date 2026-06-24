CREATE TABLE "company_aperturas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"fecha_apertura" date NOT NULL,
	"estado" text DEFAULT 'REGISTRADA' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_aperturas_company_uq" UNIQUE("company_id")
);
--> statement-breakpoint
ALTER TABLE "company_aperturas" ADD CONSTRAINT "company_aperturas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_aperturas" ADD CONSTRAINT "company_aperturas_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_aperturas" ADD CONSTRAINT "company_aperturas_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_aperturas" ADD CONSTRAINT "company_aperturas_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;