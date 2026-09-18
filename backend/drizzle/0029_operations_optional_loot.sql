ALTER TABLE "operation_participants" ADD COLUMN "rating" integer;--> statement-breakpoint
ALTER TABLE "operation_participants" ADD COLUMN "rating_note" varchar(200);--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "credit_to" varchar(10) DEFAULT 'crew' NOT NULL;