ALTER TABLE "item_types" ADD COLUMN "icon" varchar(16);--> statement-breakpoint
ALTER TABLE "item_types" ADD COLUMN "category" varchar(20) DEFAULT 'other' NOT NULL;