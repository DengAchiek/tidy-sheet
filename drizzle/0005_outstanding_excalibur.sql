CREATE TABLE `admin_invitations` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`source_hash` text NOT NULL,
	`email` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`used_by` text,
	`used_at` integer,
	FOREIGN KEY (`used_by`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_invitation_source` ON `admin_invitations` (`source_hash`);