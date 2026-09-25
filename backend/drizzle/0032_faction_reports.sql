CREATE TABLE "faction_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"faction_id" uuid NOT NULL,
	"author_user_id" uuid,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"target_user_id" uuid,
	"category" varchar(20) DEFAULT 'other' NOT NULL,
	"subject" varchar(140) NOT NULL,
	"body" text NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"resolution_note" text,
	"handled_by" uuid,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "faction_reports" ADD CONSTRAINT "faction_reports_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faction_reports" ADD CONSTRAINT "faction_reports_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faction_reports" ADD CONSTRAINT "faction_reports_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faction_reports" ADD CONSTRAINT "faction_reports_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "faction_report_created" ON "faction_reports" USING btree ("faction_id","created_at");--> statement-breakpoint
CREATE INDEX "faction_report_status" ON "faction_reports" USING btree ("faction_id","status");