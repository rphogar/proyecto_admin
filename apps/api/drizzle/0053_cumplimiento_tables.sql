CREATE TABLE "fiscal_event_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "fiscal_event_log_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid,
	"event_type" text NOT NULL,
	"tipo_documento" text,
	"document_number" text,
	"control_number" text,
	"hash_documento" text,
	"prev_hash" text,
	"event_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"actor_user_id" uuid,
	"ts_utc" timestamp with time zone DEFAULT now() NOT NULL,
	"ts_caracas" text NOT NULL,
	"ip" "inet",
	"device" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fiscal_transmission_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"fiscal_event_id" uuid,
	"document_id" uuid,
	"payload" jsonb NOT NULL,
	"estado" text DEFAULT 'PENDIENTE' NOT NULL,
	"reintentos" integer DEFAULT 0 NOT NULL,
	"max_reintentos" integer DEFAULT 8 NOT NULL,
	"proximo_intento" timestamp with time zone DEFAULT now() NOT NULL,
	"ultimo_error" text,
	"acuse" jsonb,
	"acuse_ref" text,
	"enviado_at" timestamp with time zone,
	"acusado_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"changelog" text NOT NULL,
	"estado_homologacion" text DEFAULT 'DESARROLLO' NOT NULL,
	"hash_artefacto" text,
	"nro_resolucion" text,
	"vigente_desde" date,
	"notas" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fiscal_event_log" ADD CONSTRAINT "fiscal_event_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_event_log" ADD CONSTRAINT "fiscal_event_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_event_log" ADD CONSTRAINT "fiscal_event_log_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_event_log" ADD CONSTRAINT "fiscal_event_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_transmission_queue" ADD CONSTRAINT "fiscal_transmission_queue_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_transmission_queue" ADD CONSTRAINT "fiscal_transmission_queue_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_transmission_queue" ADD CONSTRAINT "fiscal_transmission_queue_fiscal_event_id_fiscal_event_log_id_fk" FOREIGN KEY ("fiscal_event_id") REFERENCES "public"."fiscal_event_log"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_transmission_queue" ADD CONSTRAINT "fiscal_transmission_queue_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_versions" ADD CONSTRAINT "product_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;