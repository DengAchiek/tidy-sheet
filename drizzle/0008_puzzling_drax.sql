CREATE TABLE `client_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`rating` integer NOT NULL,
	`comment` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` integer NOT NULL,
	`reviewed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reviews_created` ON `client_reviews` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `reviews_status_created` ON `client_reviews` (`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `reviews_user_created` ON `client_reviews` (`user_id`,`created_at`);