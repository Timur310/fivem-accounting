ALTER TABLE "factions" ADD COLUMN "strike_escalation" jsonb;--> statement-breakpoint
ALTER TABLE "quotas" ADD COLUMN "scope" varchar(10) DEFAULT 'faction' NOT NULL;