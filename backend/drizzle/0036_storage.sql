CREATE TABLE "storage_containers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"faction_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"kind" varchar(20) DEFAULT 'chest' NOT NULL,
	"name" varchar(80) NOT NULL,
	"color" varchar(7),
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"w" integer DEFAULT 1 NOT NULL,
	"h" integer DEFAULT 1 NOT NULL,
	"capacity" numeric(15, 2),
	"notes" text,
	"checked_at" timestamp with time zone,
	"checked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_contents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"faction_id" uuid NOT NULL,
	"container_id" uuid NOT NULL,
	"item_type_id" uuid,
	"label" varchar(100) NOT NULL,
	"quantity" numeric(15, 2) DEFAULT '0' NOT NULL,
	"min_quantity" numeric(15, 2),
	"max_quantity" numeric(15, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"faction_id" uuid NOT NULL,
	"container_id" uuid,
	"to_container_id" uuid,
	"container_name" varchar(80) NOT NULL,
	"to_container_name" varchar(80),
	"item_type_id" uuid,
	"label" varchar(100) NOT NULL,
	"kind" varchar(10) NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"before" numeric(15, 2),
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"faction_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"tiles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"map_marker_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "storage_containers" ADD CONSTRAINT "storage_containers_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_containers" ADD CONSTRAINT "storage_containers_room_id_storage_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."storage_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_containers" ADD CONSTRAINT "storage_containers_checked_by_users_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_contents" ADD CONSTRAINT "storage_contents_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_contents" ADD CONSTRAINT "storage_contents_container_id_storage_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."storage_containers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_contents" ADD CONSTRAINT "storage_contents_item_type_id_item_types_id_fk" FOREIGN KEY ("item_type_id") REFERENCES "public"."item_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_movements" ADD CONSTRAINT "storage_movements_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_movements" ADD CONSTRAINT "storage_movements_container_id_storage_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."storage_containers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_movements" ADD CONSTRAINT "storage_movements_to_container_id_storage_containers_id_fk" FOREIGN KEY ("to_container_id") REFERENCES "public"."storage_containers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_movements" ADD CONSTRAINT "storage_movements_item_type_id_item_types_id_fk" FOREIGN KEY ("item_type_id") REFERENCES "public"."item_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_movements" ADD CONSTRAINT "storage_movements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_rooms" ADD CONSTRAINT "storage_rooms_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_rooms" ADD CONSTRAINT "storage_rooms_map_marker_id_map_markers_id_fk" FOREIGN KEY ("map_marker_id") REFERENCES "public"."map_markers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_rooms" ADD CONSTRAINT "storage_rooms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storage_container_room" ON "storage_containers" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "storage_content_container" ON "storage_contents" USING btree ("container_id");--> statement-breakpoint
CREATE INDEX "storage_content_item" ON "storage_contents" USING btree ("faction_id","item_type_id");--> statement-breakpoint
CREATE INDEX "storage_movement_container" ON "storage_movements" USING btree ("container_id","created_at");--> statement-breakpoint
CREATE INDEX "storage_movement_faction" ON "storage_movements" USING btree ("faction_id","created_at");--> statement-breakpoint
CREATE INDEX "storage_room_faction" ON "storage_rooms" USING btree ("faction_id");