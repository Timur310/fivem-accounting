ALTER TABLE "map_markers" ALTER COLUMN "layer_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "map_markers" DROP COLUMN "min_rank_level";