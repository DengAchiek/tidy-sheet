CREATE TABLE `auth_password_resets` (
	`user_id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`credential_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`ready` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `password_reset_expiry` ON `auth_password_resets` (`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `password_reset_token` ON `auth_password_resets` (`token_hash`);