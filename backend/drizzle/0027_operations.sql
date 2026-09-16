CREATE TABLE "operation_loot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"item_type_id" uuid NOT NULL,
	"item_type_name" varchar(100) NOT NULL,
	"quantity" numeric(15, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operation_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"role" varchar(12) NOT NULL,
	"user_id" uuid NOT NULL,
	"item_type_id" uuid NOT NULL,
	"quantity" numeric(15, 2) NOT NULL,
	"entry_id" uuid
);
--> statement-breakpoint
CREATE TABLE "operation_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"share" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"faction_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"kind" varchar(20) DEFAULT 'other' NOT NULL,
	"location" varchar(120),
	"occurred_at" timestamp with time zone NOT NULL,
	"faction_cut_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"logged_by" uuid NOT NULL,
	"reverted_at" timestamp with time zone,
	"reverted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operation_loot" ADD CONSTRAINT "operation_loot_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_loot" ADD CONSTRAINT "operation_loot_item_type_id_item_types_id_fk" FOREIGN KEY ("item_type_id") REFERENCES "public"."item_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_movements" ADD CONSTRAINT "operation_movements_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_movements" ADD CONSTRAINT "operation_movements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_movements" ADD CONSTRAINT "operation_movements_item_type_id_item_types_id_fk" FOREIGN KEY ("item_type_id") REFERENCES "public"."item_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_movements" ADD CONSTRAINT "operation_movements_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_participants" ADD CONSTRAINT "operation_participants_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_participants" ADD CONSTRAINT "operation_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_logged_by_users_id_fk" FOREIGN KEY ("logged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_reverted_by_users_id_fk" FOREIGN KEY ("reverted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operation_loot_operation" ON "operation_loot" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "operation_movement_operation" ON "operation_movements" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "operation_participant_unique" ON "operation_participants" USING btree ("operation_id","user_id");--> statement-breakpoint
CREATE INDEX "operation_faction" ON "operations" USING btree ("faction_id","occurred_at");