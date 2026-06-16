CREATE TABLE "delegaciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"permisos" jsonb NOT NULL,
	"estado" text DEFAULT 'ACTIVA' NOT NULL,
	"otorgado_por" uuid,
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delegaciones_company_user_uq" UNIQUE("company_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "delegaciones" ADD CONSTRAINT "delegaciones_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegaciones" ADD CONSTRAINT "delegaciones_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegaciones" ADD CONSTRAINT "delegaciones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegaciones" ADD CONSTRAINT "delegaciones_otorgado_por_users_id_fk" FOREIGN KEY ("otorgado_por") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegaciones" ADD CONSTRAINT "delegaciones_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;