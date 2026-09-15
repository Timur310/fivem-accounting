CREATE TABLE "map_layers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"faction_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" text,
	"color" varchar(7),
	"icon" varchar(16),
	"min_rank_level" integer,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "map_markers" ADD COLUMN "layer_id" uuid;--> statement-breakpoint
ALTER TABLE "map_layers" ADD CONSTRAINT "map_layers_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_layers" ADD CONSTRAINT "map_layers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "map_layer_faction" ON "map_layers" USING btree ("faction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "map_layer_unique_name" ON "map_layers" USING btree ("faction_id","name");--> statement-breakpoint
ALTER TABLE "map_markers" ADD CONSTRAINT "map_markers_layer_id_map_layers_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."map_layers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "map_marker_layer" ON "map_markers" USING btree ("layer_id");--> statement-breakpoint
-- Existing markers carried their own rank. Visibility now lives on the layer,
-- so each distinct rank a faction was using becomes one layer and the markers
-- that had it move onto it. Nothing changes about who can see what: a marker
-- restricted to level 2 ends up on a layer restricted to level 2.
INSERT INTO "map_layers" ("faction_id", "name", "description", "min_rank_level", "created_by")
SELECT
  m."faction_id",
  CASE
    WHEN m."min_rank_level" IS NULL THEN 'General'
    ELSE 'Restricted (rank ' || m."min_rank_level" || ')'
  END,
  'Created automatically when maps gained layers. Rename it to whatever it actually holds.',
  m."min_rank_level",
  (SELECT f."created_by" FROM "factions" f WHERE f."id" = m."faction_id")
FROM (SELECT DISTINCT "faction_id", "min_rank_level" FROM "map_markers") m;
--> statement-breakpoint
UPDATE "map_markers" mk
SET "layer_id" = l."id"
FROM "map_layers" l
WHERE l."faction_id" = mk."faction_id"
  AND l."min_rank_level" IS NOT DISTINCT FROM mk."min_rank_level"
  AND mk."layer_id" IS NULL;
