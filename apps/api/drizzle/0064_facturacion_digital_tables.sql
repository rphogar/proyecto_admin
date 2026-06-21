CREATE TABLE "digital_invoice_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"fiscal_event_id" uuid,
	"numero_control" text NOT NULL,
	"identificador" text NOT NULL,
	"canal" text NOT NULL,
	"destino" text NOT NULL,
	"payload" jsonb NOT NULL,
	"estado" text DEFAULT 'PENDIENTE' NOT NULL,
	"conservacion_estado" text DEFAULT 'PENDIENTE' NOT NULL,
	"conservacion_ref" text,
	"reintentos" integer DEFAULT 0 NOT NULL,
	"max_reintentos" integer DEFAULT 8 NOT NULL,
	"proximo_intento" timestamp with time zone DEFAULT now() NOT NULL,
	"ultimo_error" text,
	"entrega_acuse" jsonb,
	"entregado_at" timestamp with time zone,
	"conservado_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "digital_invoice_deliveries" ADD CONSTRAINT "digital_invoice_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digital_invoice_deliveries" ADD CONSTRAINT "digital_invoice_deliveries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digital_invoice_deliveries" ADD CONSTRAINT "digital_invoice_deliveries_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digital_invoice_deliveries" ADD CONSTRAINT "digital_invoice_deliveries_fiscal_event_id_fiscal_event_log_id_fk" FOREIGN KEY ("fiscal_event_id") REFERENCES "public"."fiscal_event_log"("id") ON DELETE no action ON UPDATE no action;