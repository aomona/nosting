CREATE TABLE `media_uploads` (
	`auth_id` text PRIMARY KEY NOT NULL,
	`pubkey` text NOT NULL,
	`payload_hash` text NOT NULL,
	`object_key` text NOT NULL,
	`size` integer NOT NULL,
	`mime` text NOT NULL,
	`day` integer NOT NULL,
	`created_at` integer NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "media_uploads_positive_size" CHECK("media_uploads"."size">0 AND "media_uploads"."size"<=5242880),
	CONSTRAINT "media_uploads_state" CHECK("media_uploads"."state" IN ('pending','stored'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_uploads_object_key_unique` ON `media_uploads` (`object_key`);--> statement-breakpoint
CREATE INDEX `media_uploads_day` ON `media_uploads` (`day`);--> statement-breakpoint
CREATE INDEX `media_uploads_pubkey_day` ON `media_uploads` (`pubkey`,`day`);