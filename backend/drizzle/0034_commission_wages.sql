CREATE TABLE "commission_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"faction_id" uuid NOT NULL,
	"rank" varchar(100),
	"item_type_id" uuid NOT NULL,
	"percent" numeric(5, 2) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "commission_payout_id" uuid;--> statement-breakpoint
ALTER TABLE "commission_rates" ADD CONSTRAINT "commission_rates_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rates" ADD CONSTRAINT "commission_rates_item_type_id_item_types_id_fk" FOREIGN KEY ("item_type_id") REFERENCES "public"."item_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commission_rate_faction" ON "commission_rates" USING btree ("faction_id");--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_commission_payout_id_payouts_id_fk" FOREIGN KEY ("commission_payout_id") REFERENCES "public"."payouts"("id") ON DELETE set null ON UPDATE no action;