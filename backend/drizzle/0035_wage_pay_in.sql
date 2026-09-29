CREATE TABLE "wage_pay_in" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"faction_id" uuid NOT NULL,
	"item_type_id" uuid NOT NULL,
	"pay_item_type_id" uuid NOT NULL,
	"rate" numeric(15, 4) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wage_pay_in" ADD CONSTRAINT "wage_pay_in_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wage_pay_in" ADD CONSTRAINT "wage_pay_in_item_type_id_item_types_id_fk" FOREIGN KEY ("item_type_id") REFERENCES "public"."item_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wage_pay_in" ADD CONSTRAINT "wage_pay_in_pay_item_type_id_item_types_id_fk" FOREIGN KEY ("pay_item_type_id") REFERENCES "public"."item_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wage_pay_in_item" ON "wage_pay_in" USING btree ("faction_id","item_type_id");