ALTER TABLE "factions" ADD COLUMN "storage_linked" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_movements" ADD COLUMN "payout_id" uuid;--> statement-breakpoint
ALTER TABLE "storage_movements" ADD CONSTRAINT "storage_movements_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE set null ON UPDATE no action;