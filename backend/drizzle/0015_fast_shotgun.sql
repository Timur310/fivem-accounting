CREATE TABLE "discord_channel_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"faction_id" uuid NOT NULL,
	"event_type" varchar(40) NOT NULL,
	"channel_id" varchar(32) NOT NULL,
	"channel_name" varchar(120),
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discord_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"faction_id" uuid NOT NULL,
	"guild_id" varchar(32) NOT NULL,
	"guild_name" varchar(120),
	"linked_by" uuid NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	CONSTRAINT "discord_integrations_faction_id_unique" UNIQUE("faction_id"),
	CONSTRAINT "discord_integrations_guild_id_unique" UNIQUE("guild_id")
);
--> statement-breakpoint
ALTER TABLE "discord_channel_routes" ADD CONSTRAINT "discord_channel_routes_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_integrations" ADD CONSTRAINT "discord_integrations_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_integrations" ADD CONSTRAINT "discord_integrations_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discord_route_unique" ON "discord_channel_routes" USING btree ("faction_id","event_type");