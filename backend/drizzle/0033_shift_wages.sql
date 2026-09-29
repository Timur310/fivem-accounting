CREATE TABLE "shift_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"faction_id" uuid NOT NULL,
	"position" varchar(60),
	"item_type_id" uuid NOT NULL,
	"hourly_rate" numeric(15, 2) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "payout_id" uuid;--> statement-breakpoint
ALTER TABLE "shift_rates" ADD CONSTRAINT "shift_rates_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_rates" ADD CONSTRAINT "shift_rates_item_type_id_item_types_id_fk" FOREIGN KEY ("item_type_id") REFERENCES "public"."item_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shift_rate_faction" ON "shift_rates" USING btree ("faction_id");--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE set null ON UPDATE no action;