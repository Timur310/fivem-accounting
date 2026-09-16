CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"faction_id" uuid NOT NULL,
	"plate" varchar(16) NOT NULL,
	"make" varchar(60),
	"model" varchar(60),
	"color" varchar(40),
	"category" varchar(20) DEFAULT 'car' NOT NULL,
	"year" integer,
	"status" varchar(20) DEFAULT 'in_service' NOT NULL,
	"status_note" varchar(200),
	"owner_user_id" uuid,
	"owner_name" varchar(120),
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vehicle_faction" ON "vehicles" USING btree ("faction_id","plate");--> statement-breakpoint
CREATE INDEX "vehicle_status" ON "vehicles" USING btree ("faction_id","status");--> statement-breakpoint
CREATE INDEX "vehicle_owner" ON "vehicles" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_unique_plate" ON "vehicles" USING btree ("faction_id",upper("plate"));