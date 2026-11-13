PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_media_uploads` (
	`auth_id` text PRIMARY KEY NOT NULL,
	`pubkey` text NOT NULL,
	`payload_hash` text NOT NULL,
	`object_key` text NOT NULL,
	`size` integer NOT NULL,
	`mime` text NOT NULL,
	`day` integer NOT NULL,
	`created_at` integer NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "media_uploads_positive_size" CHECK("__new_media_uploads"."size">0 AND "__new_media_uploads"."size"<=30000000),
	CONSTRAINT "media_uploads_state" CHECK("__new_media_uploads"."state" IN ('pending','stored'))
);
--> statement-breakpoint
INSERT INTO `__new_media_uploads`("auth_id", "pubkey", "payload_hash", "object_key", "size", "mime", "day", "created_at", "state") SELECT "auth_id", "pubkey", "payload_hash", "object_key", "size", "mime", "day", "created_at", "state" FROM `media_uploads`;--> statement-breakpoint
DROP TABLE `media_uploads`;--> statement-breakpoint
ALTER TABLE `__new_media_uploads` RENAME TO `media_uploads`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `media_uploads_object_key_unique` ON `media_uploads` (`object_key`);--> statement-breakpoint
CREATE INDEX `media_uploads_day` ON `media_uploads` (`day`);--> statement-breakpoint
CREATE INDEX `media_uploads_pubkey_day` ON `media_uploads` (`pubkey`,`day`);