CREATE TABLE `processing_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`mode` text DEFAULT 'business' NOT NULL,
	`operation` text NOT NULL,
	`outcome` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`row_count` integer NOT NULL,
	`column_count` integer NOT NULL,
	`time_to_export_ms` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `processing_user_created` ON `processing_events` (`user_id`,`created_at`);