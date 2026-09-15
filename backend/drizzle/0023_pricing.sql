CREATE TABLE "counterparties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"faction_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"note" text,
	"color" varchar(7),
	"icon" varchar(16),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_addons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_price_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"price" numeric(15, 2) NOT NULL,
	"item_type_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"faction_id" uuid NOT NULL,
	"item_type_id" uuid NOT NULL,
	"unit_price" numeric(15, 2) NOT NULL,
	"currency_item_type_id" uuid NOT NULL,
	"floor_price" numeric(15, 2),
	"note" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quantity_breaks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"faction_id" uuid NOT NULL,
	"item_type_id" uuid,
	"min_quantity" numeric(15, 2) NOT NULL,
	"discount_percent" numeric(5, 2) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "counterparties" ADD CONSTRAINT "counterparties_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counterparties" ADD CONSTRAINT "counterparties_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_addons" ADD CONSTRAINT "product_addons_product_price_id_product_prices_id_fk" FOREIGN KEY ("product_price_id") REFERENCES "public"."product_prices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_addons" ADD CONSTRAINT "product_addons_item_type_id_item_types_id_fk" FOREIGN KEY ("item_type_id") REFERENCES "public"."item_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_item_type_id_item_types_id_fk" FOREIGN KEY ("item_type_id") REFERENCES "public"."item_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_currency_item_type_id_item_types_id_fk" FOREIGN KEY ("currency_item_type_id") REFERENCES "public"."item_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quantity_breaks" ADD CONSTRAINT "quantity_breaks_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quantity_breaks" ADD CONSTRAINT "quantity_breaks_item_type_id_item_types_id_fk" FOREIGN KEY ("item_type_id") REFERENCES "public"."item_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "counterparty_faction" ON "counterparties" USING btree ("faction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "counterparty_unique_name" ON "counterparties" USING btree ("faction_id","name");--> statement-breakpoint
CREATE INDEX "product_addon_price" ON "product_addons" USING btree ("product_price_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_addon_unique_name" ON "product_addons" USING btree ("product_price_id","name");--> statement-breakpoint
CREATE INDEX "product_price_faction" ON "product_prices" USING btree ("faction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_price_unique_item" ON "product_prices" USING btree ("faction_id","item_type_id");--> statement-breakpoint
CREATE INDEX "quantity_break_faction" ON "quantity_breaks" USING btree ("faction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quantity_break_unique_item" ON "quantity_breaks" USING btree ("faction_id","item_type_id","min_quantity") WHERE item_type_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "quantity_break_unique_default" ON "quantity_breaks" USING btree ("faction_id","min_quantity") WHERE item_type_id IS NULL;