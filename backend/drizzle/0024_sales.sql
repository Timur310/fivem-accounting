CREATE TABLE "sale_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"item_type_id" uuid NOT NULL,
	"item_type_name" varchar(100) NOT NULL,
	"quantity" numeric(15, 2) NOT NULL,
	"unit_price" numeric(15, 2) NOT NULL,
	"addons" jsonb,
	"discount_percent" numeric(5, 2) NOT NULL,
	"gross" numeric(15, 2) NOT NULL,
	"discount" numeric(15, 2) NOT NULL,
	"total" numeric(15, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"role" varchar(10) NOT NULL,
	"item_type_id" uuid NOT NULL,
	"quantity" numeric(15, 2) NOT NULL,
	"entry_id" uuid,
	"payout_id" uuid
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"faction_id" uuid NOT NULL,
	"counterparty_id" uuid,
	"counterparty_name" varchar(80),
	"counterparty_discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"currency_item_type_id" uuid NOT NULL,
	"subtotal" numeric(15, 2) NOT NULL,
	"discount_total" numeric(15, 2) NOT NULL,
	"total" numeric(15, 2) NOT NULL,
	"credit_sale_to" varchar(10) DEFAULT 'nobody' NOT NULL,
	"sold_by" uuid NOT NULL,
	"sale_date" date NOT NULL,
	"notes" text,
	"reverted_at" timestamp with time zone,
	"reverted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_item_type_id_item_types_id_fk" FOREIGN KEY ("item_type_id") REFERENCES "public"."item_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_movements" ADD CONSTRAINT "sale_movements_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_movements" ADD CONSTRAINT "sale_movements_item_type_id_item_types_id_fk" FOREIGN KEY ("item_type_id") REFERENCES "public"."item_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_movements" ADD CONSTRAINT "sale_movements_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_movements" ADD CONSTRAINT "sale_movements_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_counterparty_id_counterparties_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."counterparties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_currency_item_type_id_item_types_id_fk" FOREIGN KEY ("currency_item_type_id") REFERENCES "public"."item_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_sold_by_users_id_fk" FOREIGN KEY ("sold_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_reverted_by_users_id_fk" FOREIGN KEY ("reverted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_line_sale" ON "sale_lines" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_movement_sale" ON "sale_movements" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_faction" ON "sales" USING btree ("faction_id","created_at");