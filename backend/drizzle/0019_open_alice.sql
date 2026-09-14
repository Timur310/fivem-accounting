CREATE TABLE "craft_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"craft_id" uuid NOT NULL,
	"role" varchar(6) NOT NULL,
	"item_type_id" uuid NOT NULL,
	"quantity" numeric(15, 2) NOT NULL,
	"entry_id" uuid,
	"payout_id" uuid
);
--> statement-breakpoint
CREATE TABLE "crafting_recipe_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"item_type_id" uuid NOT NULL,
	"role" varchar(6) NOT NULL,
	"quantity" numeric(15, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crafting_recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"faction_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"credit_output_to" varchar(10) DEFAULT 'nobody' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"faction_id" uuid NOT NULL,
	"recipe_id" uuid,
	"recipe_name" varchar(100) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"crafted_by" uuid NOT NULL,
	"craft_date" date NOT NULL,
	"notes" text,
	"reverted_at" timestamp with time zone,
	"reverted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "craft_movements" ADD CONSTRAINT "craft_movements_craft_id_crafts_id_fk" FOREIGN KEY ("craft_id") REFERENCES "public"."crafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "craft_movements" ADD CONSTRAINT "craft_movements_item_type_id_item_types_id_fk" FOREIGN KEY ("item_type_id") REFERENCES "public"."item_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "craft_movements" ADD CONSTRAINT "craft_movements_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "craft_movements" ADD CONSTRAINT "craft_movements_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crafting_recipe_items" ADD CONSTRAINT "crafting_recipe_items_recipe_id_crafting_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."crafting_recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crafting_recipe_items" ADD CONSTRAINT "crafting_recipe_items_item_type_id_item_types_id_fk" FOREIGN KEY ("item_type_id") REFERENCES "public"."item_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crafting_recipes" ADD CONSTRAINT "crafting_recipes_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crafting_recipes" ADD CONSTRAINT "crafting_recipes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crafts" ADD CONSTRAINT "crafts_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crafts" ADD CONSTRAINT "crafts_recipe_id_crafting_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."crafting_recipes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crafts" ADD CONSTRAINT "crafts_crafted_by_users_id_fk" FOREIGN KEY ("crafted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crafts" ADD CONSTRAINT "crafts_reverted_by_users_id_fk" FOREIGN KEY ("reverted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "craft_movement_craft" ON "craft_movements" USING btree ("craft_id");--> statement-breakpoint
CREATE INDEX "crafting_recipe_item_recipe" ON "crafting_recipe_items" USING btree ("recipe_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crafting_recipe_item_unique" ON "crafting_recipe_items" USING btree ("recipe_id","item_type_id","role");--> statement-breakpoint
CREATE INDEX "crafting_recipe_faction" ON "crafting_recipes" USING btree ("faction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crafting_recipe_unique_name" ON "crafting_recipes" USING btree ("faction_id","name");--> statement-breakpoint
CREATE INDEX "craft_faction" ON "crafts" USING btree ("faction_id","created_at");