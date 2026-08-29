ALTER TABLE "entries" ADD COLUMN "custom_values" jsonb;--> statement-breakpoint
ALTER TABLE "factions" ADD COLUMN "brand_color" varchar(7);--> statement-breakpoint
ALTER TABLE "factions" ADD COLUMN "custom_fields" jsonb;