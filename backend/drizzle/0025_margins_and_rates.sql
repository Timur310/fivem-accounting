CREATE TABLE "currency_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"faction_id" uuid NOT NULL,
	"from_item_type_id" uuid NOT NULL,
	"to_item_type_id" uuid NOT NULL,
	"rate" numeric(18, 6) NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "factions" ADD COLUMN "margin_min_rank_level" integer;--> statement-breakpoint
ALTER TABLE "currency_rates" ADD CONSTRAINT "currency_rates_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "currency_rates" ADD CONSTRAINT "currency_rates_from_item_type_id_item_types_id_fk" FOREIGN KEY ("from_item_type_id") REFERENCES "public"."item_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "currency_rates" ADD CONSTRAINT "currency_rates_to_item_type_id_item_types_id_fk" FOREIGN KEY ("to_item_type_id") REFERENCES "public"."item_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "currency_rates" ADD CONSTRAINT "currency_rates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "currency_rate_faction" ON "currency_rates" USING btree ("faction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "currency_rate_unique_pair" ON "currency_rates" USING btree ("faction_id","from_item_type_id","to_item_type_id");