CREATE TABLE "discord_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"faction_id" uuid NOT NULL,
	"channel_id" varchar(32) NOT NULL,
	"channel_name" varchar(120),
	"message" text NOT NULL,
	"title" varchar(120),
	"schedule_type" varchar(10) NOT NULL,
	"time_of_day" varchar(5),
	"weekdays" jsonb,
	"day_of_month" integer,
	"run_at" timestamp with time zone,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discord_reminders" ADD CONSTRAINT "discord_reminders_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_reminders" ADD CONSTRAINT "discord_reminders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discord_reminder_due" ON "discord_reminders" USING btree ("next_run_at");